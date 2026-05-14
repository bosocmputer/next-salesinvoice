package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/model"
)

const databaseConfigKey = "database.connection"

type SettingsRepository struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func NewSettingsRepository(pool *pgxpool.Pool, cfg config.Config) *SettingsRepository {
	return &SettingsRepository{pool: pool, cfg: cfg}
}

func (r *SettingsRepository) DatabaseConfig(ctx context.Context) (model.DatabaseConfigView, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	active := activeDatabaseConfig(r.cfg)
	saved := active
	hasSaved := false
	var raw []byte
	err := r.pool.QueryRow(queryCtx, `
		select value
		from nsi_app_settings
		where key = $1
	`, databaseConfigKey).Scan(&raw)
	if err == nil {
		hasSaved = true
		if err := json.Unmarshal(raw, &saved); err != nil {
			return model.DatabaseConfigView{}, fmt.Errorf("decode database config: %w", err)
		}
	}
	if err != nil && err != pgx.ErrNoRows {
		return model.DatabaseConfigView{}, fmt.Errorf("load database config: %w", err)
	}

	view := model.DatabaseConfigView{
		Saved:          maskDatabasePassword(saved),
		Active:         maskDatabasePassword(active),
		HasSavedConfig: hasSaved,
		NeedsReconnect: hasSaved && !sameDatabaseConfig(saved, active),
	}
	return view, nil
}

func (r *SettingsRepository) SaveDatabaseConfig(ctx context.Context, req model.DatabaseConfig, userCode string) (model.DatabaseConfigView, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	req.Host = strings.TrimSpace(req.Host)
	req.Database = strings.TrimSpace(req.Database)
	req.User = strings.TrimSpace(req.User)
	req.SSLMode = strings.TrimSpace(req.SSLMode)
	req.Schema = strings.TrimSpace(req.Schema)
	if req.SSLMode == "" {
		req.SSLMode = "disable"
	}
	if req.Schema == "" {
		req.Schema = "public"
	}
	if req.Port <= 0 || req.Port > 65535 {
		return model.DatabaseConfigView{}, fmt.Errorf("invalid database port")
	}
	if req.Host == "" || req.Database == "" || req.User == "" {
		return model.DatabaseConfigView{}, fmt.Errorf("host, database, and user are required")
	}
	if req.MaxConns <= 0 {
		req.MaxConns = r.cfg.DBMaxConns
	}
	if req.MaxConns > 5 {
		return model.DatabaseConfigView{}, fmt.Errorf("max connections must be 5 or lower")
	}

	existing, _ := r.loadRawDatabaseConfig(queryCtx)
	if req.Password == "" {
		req.Password = existing.Password
	}
	if req.Password == "" {
		req.Password = r.cfg.DBPassword
	}

	payload, _ := json.Marshal(req)
	if _, err := r.pool.Exec(queryCtx, `
		insert into nsi_app_settings (key, value, updated_by, updated_at)
		values ($1, $2::jsonb, $3, now())
		on conflict (key) do update
		set value = excluded.value,
			updated_by = excluded.updated_by,
			updated_at = now()
	`, databaseConfigKey, string(payload), userCode); err != nil {
		return model.DatabaseConfigView{}, fmt.Errorf("save database config: %w", err)
	}
	return r.DatabaseConfig(ctx)
}

func (r *SettingsRepository) SavedDatabaseConfig(ctx context.Context) (model.DatabaseConfig, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()
	return r.loadRawDatabaseConfig(queryCtx)
}

func (r *SettingsRepository) loadRawDatabaseConfig(ctx context.Context) (model.DatabaseConfig, error) {
	var raw []byte
	if err := r.pool.QueryRow(ctx, `
		select value
		from nsi_app_settings
		where key = $1
	`, databaseConfigKey).Scan(&raw); err != nil {
		return activeDatabaseConfig(r.cfg), err
	}
	var cfg model.DatabaseConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return model.DatabaseConfig{}, err
	}
	return cfg, nil
}

func activeDatabaseConfig(cfg config.Config) model.DatabaseConfig {
	return model.DatabaseConfig{
		Host:     cfg.DBHost,
		Port:     cfg.DBPort,
		Database: cfg.DBName,
		User:     cfg.DBUser,
		Password: cfg.DBPassword,
		SSLMode:  cfg.DBSSLMode,
		Schema:   cfg.DBSchema,
		MaxConns: cfg.DBMaxConns,
	}
}

func maskDatabasePassword(cfg model.DatabaseConfig) model.DatabaseConfig {
	cfg.Password = ""
	return cfg
}

func sameDatabaseConfig(left, right model.DatabaseConfig) bool {
	left.Password = ""
	right.Password = ""
	return left == right
}
