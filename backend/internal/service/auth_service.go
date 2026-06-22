package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"next-salesinvoice/backend/internal/audit"
	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/model"
	"next-salesinvoice/backend/internal/repository"
	"next-salesinvoice/backend/internal/session"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserInactive       = errors.New("user inactive")
)

type AuditMeta struct {
	IPAddress string
	UserAgent string
}

type LoginResult struct {
	Token     string         `json:"-"`
	Claims    session.Claims `json:"user"`
	ExpiresAt int64          `json:"expiresAt"`
}

type AuthService struct {
	cfg      config.Config
	sessions *session.Manager
}

func NewAuthService(
	cfg config.Config,
	sessions *session.Manager,
) *AuthService {
	return &AuthService{cfg: cfg, sessions: sessions}
}

// Login validates credentials against the given pool (which may point to any
// allowed database) and issues a session token embedding dbName.
func (s *AuthService) Login(ctx context.Context, pool *pgxpool.Pool, dbName, code, password string, meta AuditMeta) (LoginResult, error) {
	code = strings.TrimSpace(code)
	if code == "" || password == "" {
		return LoginResult{}, ErrInvalidCredentials
	}

	erpUsers := repository.NewERPUserRepository(pool, s.cfg)
	appUsers := repository.NewAppUserRepository(pool, s.cfg)
	auditLogger := audit.NewLogger(pool, s.cfg)

	erpUser, err := erpUsers.FindByCode(ctx, code)
	if err != nil {
		_ = auditLogger.Write(ctx, audit.Entry{
			UserCode:     code,
			Action:       "login_failed",
			ResourceType: "auth",
			ResourceID:   code,
			After:        map[string]any{"reason": "user_not_found"},
			IPAddress:    meta.IPAddress,
			UserAgent:    meta.UserAgent,
		})
		return LoginResult{}, ErrInvalidCredentials
	}
	if !passwordMatches(erpUser, password) {
		_ = auditLogger.Write(ctx, audit.Entry{
			UserCode:     code,
			Action:       "login_failed",
			ResourceType: "auth",
			ResourceID:   code,
			After:        map[string]any{"reason": "wrong_password"},
			IPAddress:    meta.IPAddress,
			UserAgent:    meta.UserAgent,
		})
		return LoginResult{}, ErrInvalidCredentials
	}
	if erpUser.Status != 1 {
		_ = auditLogger.Write(ctx, audit.Entry{
			UserCode:     code,
			Action:       "login_failed",
			ResourceType: "auth",
			ResourceID:   code,
			After:        map[string]any{"reason": "inactive_status", "status": erpUser.Status},
			IPAddress:    meta.IPAddress,
			UserAgent:    meta.UserAgent,
		})
		return LoginResult{}, ErrUserInactive
	}

	appUser, err := appUsers.FindOrProvision(ctx, erpUser)
	if err != nil {
		return LoginResult{}, err
	}
	if !appUser.IsActive {
		return LoginResult{}, ErrUserInactive
	}

	token, claims, err := s.sessions.Issue(appUser.ERPUserCode, appUser.DisplayName, appUser.Role, dbName)
	if err != nil {
		return LoginResult{}, err
	}
	_ = auditLogger.Write(ctx, audit.Entry{
		UserCode:     code,
		Action:       "login_success",
		ResourceType: "auth",
		ResourceID:   code,
		After:        map[string]any{"role": appUser.Role, "db": dbName},
		IPAddress:    meta.IPAddress,
		UserAgent:    meta.UserAgent,
	})
	return LoginResult{Token: token, Claims: claims, ExpiresAt: claims.ExpiresAt}, nil
}

func passwordMatches(user model.ERPUser, password string) bool {
	if user.Password == "" {
		return false
	}
	// If SML upgrades to bcrypt-style hashes ($2a$/$2b$/$2y$), verify via bcrypt.
	if isBcryptHash(user.Password) {
		return bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)) == nil
	}
	// Fallback: legacy plain-text comparison (current SML behaviour).
	return hmacSafeEqual(user.Password, password)
}

func isBcryptHash(s string) bool {
	return len(s) >= 60 && (strings.HasPrefix(s, "$2a$") || strings.HasPrefix(s, "$2b$") || strings.HasPrefix(s, "$2y$"))
}

func hmacSafeEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	var result byte
	for i := range left {
		result |= left[i] ^ right[i]
	}
	return result == 0
}
