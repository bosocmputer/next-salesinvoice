package appruntime

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/audit"
	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/db"
	"next-salesinvoice/backend/internal/migration"
	"next-salesinvoice/backend/internal/repository"
	"next-salesinvoice/backend/internal/service"
	"next-salesinvoice/backend/internal/session"
)

// maxExtraPools caps the number of additional per-DB pools that can be
// created at runtime. This prevents pool accumulation if many different
// database names are probed (e.g. by a misconfigured client).
const maxExtraPools = 10

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

type dbCache struct {
	names     []string
	fetchedAt time.Time
}

type State struct {
	mu       sync.RWMutex
	current  *Snapshot
	previous []*pgxpool.Pool

	// extra pools keyed by dbName (lazy-created, guarded by mu)
	extraPools map[string]*pgxpool.Pool

	// cached database name list from pg_database
	dbCache   dbCache
	dbCacheMu sync.Mutex

	sessions *session.Manager
	cfg      config.Config
}

func New(ctx context.Context, cfg config.Config, sessions *session.Manager) (*State, error) {
	snapshot, err := buildSnapshot(ctx, cfg, sessions)
	if err != nil {
		return nil, err
	}
	return &State{
		current:    snapshot,
		sessions:   sessions,
		cfg:        cfg,
		extraPools: make(map[string]*pgxpool.Pool),
	}, nil
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
	s.cfg = cfg
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
	for _, pool := range s.extraPools {
		pool.Close()
	}
}

// ListDatabases returns the set of databases users may connect to. The result
// is cached for 60 seconds because pg_database changes very rarely.
func (s *State) ListDatabases(ctx context.Context) ([]string, error) {
	s.dbCacheMu.Lock()
	defer s.dbCacheMu.Unlock()

	if time.Since(s.dbCache.fetchedAt) < 60*time.Second && len(s.dbCache.names) > 0 {
		return s.dbCache.names, nil
	}

	basePool := s.Current().Pool
	rows, err := basePool.Query(ctx,
		`SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname`)
	if err != nil {
		return nil, fmt.Errorf("list databases: %w", err)
	}
	defer rows.Close()

	var all []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan database name: %w", err)
		}
		all = append(all, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list databases: %w", err)
	}

	allowed := s.cfg.AllowedDatabases
	if len(allowed) > 0 {
		set := make(map[string]struct{}, len(allowed))
		for _, a := range allowed {
			set[a] = struct{}{}
		}
		filtered := all[:0]
		for _, name := range all {
			if _, ok := set[name]; ok {
				filtered = append(filtered, name)
			}
		}
		all = filtered
	}

	s.dbCache = dbCache{names: all, fetchedAt: time.Now()}
	return all, nil
}

// ValidateDBName returns an error if dbName is not in the allowed database
// list. Always call this before PoolFor to prevent probing unknown databases.
func (s *State) ValidateDBName(ctx context.Context, dbName string) error {
	if dbName == "" {
		return errors.New("database name must not be empty")
	}
	names, err := s.ListDatabases(ctx)
	if err != nil {
		return fmt.Errorf("cannot verify database: %w", err)
	}
	for _, n := range names {
		if n == dbName {
			return nil
		}
	}
	return fmt.Errorf("database %q is not available", dbName)
}

// PoolFor returns the connection pool for the given database name. The base
// pool (cfg.DBName) is returned directly; extra pools are created lazily and
// cached. Call ValidateDBName before PoolFor.
func (s *State) PoolFor(ctx context.Context, dbName string) (*pgxpool.Pool, error) {
	s.mu.RLock()
	baseName := s.cfg.DBName
	if dbName == "" || dbName == baseName {
		pool := s.current.Pool
		s.mu.RUnlock()
		return pool, nil
	}
	existing, ok := s.extraPools[dbName]
	s.mu.RUnlock()
	if ok {
		return existing, nil
	}

	// Need to create a new pool — take write lock.
	s.mu.Lock()
	defer s.mu.Unlock()

	// Double-check under write lock.
	if pool, ok := s.extraPools[dbName]; ok {
		return pool, nil
	}
	if len(s.extraPools) >= maxExtraPools {
		log.Printf("[WARN] appruntime: maxExtraPools (%d) reached, rejecting pool for %q", maxExtraPools, dbName)
		return nil, fmt.Errorf("too many database connections active (max %d)", maxExtraPools)
	}

	extraCfg := s.cfg
	extraCfg.DBName = dbName
	pool, err := db.NewPool(ctx, extraCfg)
	if err != nil {
		return nil, fmt.Errorf("open pool for %q: %w", dbName, err)
	}
	s.extraPools[dbName] = pool
	return pool, nil
}

func buildSnapshot(ctx context.Context, cfg config.Config, sessions *session.Manager) (*Snapshot, error) {
	pool, err := db.NewPool(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	migrator := migration.New(pool, cfg)
	if _, err := migrator.Verify(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("verify database: %w", err)
	}

	auditLogger := audit.NewLogger(pool, cfg)
	documentRepo := repository.NewDocumentRepository(pool, cfg)
	auditRepo := repository.NewAuditRepository(pool, cfg)
	settingsRepo := repository.NewSettingsRepository(pool, cfg)
	authService := service.NewAuthService(cfg, sessions)

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
