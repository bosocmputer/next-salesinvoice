package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
)

type Logger struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

type Entry struct {
	UserCode     string
	Action       string
	ResourceType string
	ResourceID   string
	Before       any
	After        any
	IPAddress    string
	UserAgent    string
}

func NewLogger(pool *pgxpool.Pool, cfg config.Config) *Logger {
	return &Logger{pool: pool, cfg: cfg}
}

func (l *Logger) Write(ctx context.Context, entry Entry) error {
	queryCtx, cancel := context.WithTimeout(ctx, l.cfg.DBQueryTimeout)
	defer cancel()

	beforeJSON, err := nullableJSON(entry.Before)
	if err != nil {
		return err
	}
	afterJSON, err := nullableJSON(entry.After)
	if err != nil {
		return err
	}
	_, err = l.pool.Exec(queryCtx, `
		insert into nsi_audit_logs (
			user_code, action, resource_type, resource_id,
			before_data, after_data, ip_address, user_agent
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8)
	`, entry.UserCode, entry.Action, entry.ResourceType, entry.ResourceID,
		beforeJSON, afterJSON, entry.IPAddress, entry.UserAgent)
	if err != nil {
		return fmt.Errorf("write audit log: %w", err)
	}
	return nil
}

func nullableJSON(value any) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	return json.Marshal(value)
}
