package service

import (
	"context"
	"errors"
	"strings"

	"next-salesinvoice/backend/internal/audit"
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
	erpUsers *repository.ERPUserRepository
	appUsers *repository.AppUserRepository
	audit    *audit.Logger
	sessions *session.Manager
}

func NewAuthService(
	erpUsers *repository.ERPUserRepository,
	appUsers *repository.AppUserRepository,
	auditLogger *audit.Logger,
	sessions *session.Manager,
) *AuthService {
	return &AuthService{erpUsers: erpUsers, appUsers: appUsers, audit: auditLogger, sessions: sessions}
}

func (s *AuthService) Login(ctx context.Context, code, password string, meta AuditMeta) (LoginResult, error) {
	code = strings.TrimSpace(code)
	if code == "" || password == "" {
		return LoginResult{}, ErrInvalidCredentials
	}

	erpUser, err := s.erpUsers.FindByCode(ctx, code)
	if err != nil {
		_ = s.audit.Write(ctx, audit.Entry{
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
		_ = s.audit.Write(ctx, audit.Entry{
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
		_ = s.audit.Write(ctx, audit.Entry{
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

	appUser, err := s.appUsers.FindOrProvision(ctx, erpUser)
	if err != nil {
		return LoginResult{}, err
	}
	if !appUser.IsActive {
		return LoginResult{}, ErrUserInactive
	}

	token, claims, err := s.sessions.Issue(appUser.ERPUserCode, appUser.DisplayName, appUser.Role)
	if err != nil {
		return LoginResult{}, err
	}
	_ = s.audit.Write(ctx, audit.Entry{
		UserCode:     code,
		Action:       "login_success",
		ResourceType: "auth",
		ResourceID:   code,
		After:        map[string]any{"role": appUser.Role},
		IPAddress:    meta.IPAddress,
		UserAgent:    meta.UserAgent,
	})
	return LoginResult{Token: token, Claims: claims, ExpiresAt: claims.ExpiresAt}, nil
}

func passwordMatches(user model.ERPUser, password string) bool {
	// Current SML dev database stores EMP001 as plain text password "1234".
	// Keep this isolated so a hashed/custom SML verifier can replace it cleanly.
	return user.Password != "" && hmacSafeEqual(user.Password, password)
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
