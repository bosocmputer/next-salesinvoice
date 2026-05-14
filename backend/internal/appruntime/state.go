package appruntime

import (
	"context"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/audit"
	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/db"
	"next-salesinvoice/backend/internal/migration"
	"next-salesinvoice/backend/internal/repository"
	"next-salesinvoice/backend/internal/service"
	"next-salesinvoice/backend/internal/session"
)

type Snapshot struct {
	Cfg       config.Config
	Pool      *pgxpool.Pool
	Migrator  *migration.Migrator
	Auth      *service.AuthService
	Documents *repository.DocumentRepository
	Audits    *repository.AuditRepository
	Settings  *repository.SettingsRepository
	Audit     *audit.Logger
}

type State struct {
	mu       sync.RWMutex
	current  *Snapshot
	previous []*pgxpool.Pool
	sessions *session.Manager
}

func New(ctx context.Context, cfg config.Config, sessions *session.Manager) (*State, error) {
	snapshot, err := buildSnapshot(ctx, cfg, sessions)
	if err != nil {
		return nil, err
	}
	return &State{current: snapshot, sessions: sessions}, nil
}

func (s *State) Current() *Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current
}

func (s *State) Reconnect(ctx context.Context, cfg config.Config) (*Snapshot, error) {
	snapshot, err := buildSnapshot(ctx, cfg, s.sessions)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	old := s.current
	s.current = snapshot
	if old != nil && old.Pool != nil {
		s.previous = append(s.previous, old.Pool)
	}
	s.mu.Unlock()
	return snapshot, nil
}

func (s *State) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil && s.current.Pool != nil {
		s.current.Pool.Close()
	}
	for _, pool := range s.previous {
		pool.Close()
	}
}

func buildSnapshot(ctx context.Context, cfg config.Config, sessions *session.Manager) (*Snapshot, error) {
	pool, err := db.NewPool(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	migrator := migration.New(pool, cfg)
	if err := migrator.VerifyAndMigrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("verify and migrate database: %w", err)
	}

	auditLogger := audit.NewLogger(pool, cfg)
	userRepo := repository.NewERPUserRepository(pool, cfg)
	appUserRepo := repository.NewAppUserRepository(pool, cfg)
	documentRepo := repository.NewDocumentRepository(pool, cfg)
	auditRepo := repository.NewAuditRepository(pool, cfg)
	settingsRepo := repository.NewSettingsRepository(pool, cfg)
	authService := service.NewAuthService(userRepo, appUserRepo, auditLogger, sessions)

	return &Snapshot{
		Cfg:       cfg,
		Pool:      pool,
		Migrator:  migrator,
		Auth:      authService,
		Documents: documentRepo,
		Audits:    auditRepo,
		Settings:  settingsRepo,
		Audit:     auditLogger,
	}, nil
}
