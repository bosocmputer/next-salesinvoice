package migration

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
)

type Status struct {
	Connected        bool     `json:"connected"`
	Database         string   `json:"database"`
	Schema           string   `json:"schema"`
	RequiredSMLReady bool     `json:"requiredSmlReady"`
	AppSchemaReady   bool     `json:"appSchemaReady"`
	MissingSMLTables []string `json:"missingSmlTables"`
	MissingAppTables []string `json:"missingAppTables"`
}

type Migrator struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func New(pool *pgxpool.Pool, cfg config.Config) *Migrator {
	return &Migrator{pool: pool, cfg: cfg}
}

func (m *Migrator) Verify(ctx context.Context) (Status, error) {
	queryCtx, cancel := context.WithTimeout(ctx, m.cfg.DBQueryTimeout)
	defer cancel()

	status := Status{
		Connected: true,
		Schema:    m.cfg.DBSchema,
	}
	if err := m.pool.QueryRow(queryCtx, "select current_database()").Scan(&status.Database); err != nil {
		return status, fmt.Errorf("read current database: %w", err)
	}

	status.MissingSMLTables = m.missingTables(queryCtx, []string{
		"erp_user",
		"ic_trans",
		"ic_trans_detail",
		"erp_doc_format",
		"ar_customer",
		"ic_inventory",
	})
	status.MissingAppTables = m.missingTables(queryCtx, []string{
		"nsi_schema_migrations",
		"nsi_app_users",
		"nsi_app_settings",
		"nsi_audit_logs",
		"nsi_reflow_batches",
		"nsi_reflow_batch_items",
		"nsi_document_snapshots",
		"nsi_document_locks",
	})
	status.RequiredSMLReady = len(status.MissingSMLTables) == 0
	status.AppSchemaReady = len(status.MissingAppTables) == 0
	return status, nil
}

func (m *Migrator) VerifyAndMigrate(ctx context.Context) error {
	status, err := m.Verify(ctx)
	if err != nil {
		return err
	}
	if !status.RequiredSMLReady {
		return fmt.Errorf("required SML tables missing: %s", strings.Join(status.MissingSMLTables, ", "))
	}
	return m.Migrate(ctx)
}

func (m *Migrator) Migrate(ctx context.Context) error {
	queryCtx, cancel := context.WithTimeout(ctx, m.cfg.DBQueryTimeout)
	defer cancel()

	tx, err := m.pool.BeginTx(queryCtx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback(queryCtx)

	if _, err := tx.Exec(queryCtx, "select pg_advisory_xact_lock($1)", int64(2026051101)); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	for _, statement := range migrationStatements {
		if _, err := tx.Exec(queryCtx, statement); err != nil {
			return fmt.Errorf("run migration: %w", err)
		}
	}
	if _, err := tx.Exec(queryCtx, `
		insert into nsi_schema_migrations (version, name, checksum, applied_by)
		values ($1, $2, $3, current_user)
		on conflict (version) do nothing
	`, 1, "initial_app_tables", "manual-v1"); err != nil {
		return fmt.Errorf("record migration: %w", err)
	}
	if err := tx.Commit(queryCtx); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	if m.cfg.AutoCreatePerformanceIndexes {
		if err := m.ensurePerformanceIndexes(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (m *Migrator) ensurePerformanceIndexes(ctx context.Context) error {
	for _, statement := range performanceIndexStatements {
		queryCtx, cancel := context.WithTimeout(ctx, m.cfg.DBQueryTimeout)
		if _, err := m.pool.Exec(queryCtx, statement); err != nil {
			cancel()
			return fmt.Errorf("run performance index migration: %w", err)
		}
		cancel()
	}
	return nil
}

func (m *Migrator) missingTables(ctx context.Context, names []string) []string {
	missing := make([]string, 0)
	for _, name := range names {
		var exists bool
		err := m.pool.QueryRow(ctx, `
			select exists (
				select 1
				from information_schema.tables
				where table_schema = $1 and table_name = $2 and table_type = 'BASE TABLE'
			)
		`, m.cfg.DBSchema, name).Scan(&exists)
		if err != nil || !exists {
			missing = append(missing, name)
		}
	}
	return missing
}

var migrationStatements = []string{
	`create table if not exists nsi_schema_migrations (
		version integer primary key,
		name varchar(120) not null,
		checksum varchar(120) not null,
		applied_at timestamp without time zone not null default now(),
		applied_by varchar(80) not null default current_user
	)`,
	`create table if not exists nsi_app_users (
		id bigserial primary key,
		erp_user_code varchar(25) not null unique,
		display_name varchar(120) not null default '',
		role varchar(20) not null default 'User',
		is_active boolean not null default true,
		created_at timestamp without time zone not null default now(),
		updated_at timestamp without time zone not null default now()
	)`,
	`create table if not exists nsi_app_settings (
		key varchar(120) primary key,
		value jsonb not null default '{}'::jsonb,
		updated_by varchar(25) not null default '',
		updated_at timestamp without time zone not null default now()
	)`,
	`create table if not exists nsi_audit_logs (
		id bigserial primary key,
		user_code varchar(25) not null default '',
		action varchar(80) not null,
		resource_type varchar(80) not null default '',
		resource_id varchar(120) not null default '',
		before_data jsonb,
		after_data jsonb,
		ip_address varchar(80) not null default '',
		user_agent text not null default '',
		created_at timestamp without time zone not null default now()
	)`,
	`create index if not exists nsi_audit_logs_user_code_idx on nsi_audit_logs (user_code)`,
	`create index if not exists nsi_audit_logs_action_idx on nsi_audit_logs (action)`,
	`create index if not exists nsi_audit_logs_resource_idx on nsi_audit_logs (resource_type, resource_id)`,
	`create index if not exists nsi_audit_logs_created_at_idx on nsi_audit_logs (created_at)`,
	`create table if not exists nsi_reflow_batches (
		id bigserial primary key,
		batch_no varchar(40) not null unique,
		user_code varchar(25) not null default '',
		status varchar(20) not null default 'pending',
		config jsonb not null default '{}'::jsonb,
		total_count integer not null default 0,
		ready_count integer not null default 0,
		warning_count integer not null default 0,
		blocked_count integer not null default 0,
		applied_count integer not null default 0,
		failed_count integer not null default 0,
		started_at timestamp without time zone,
		finished_at timestamp without time zone,
		created_at timestamp without time zone not null default now(),
		updated_at timestamp without time zone not null default now()
	)`,
	`create table if not exists nsi_reflow_batch_items (
		id bigserial primary key,
		batch_id bigint not null references nsi_reflow_batches(id) on delete cascade,
		doc_no varchar(80) not null,
		new_doc_no varchar(80) not null default '',
		status varchar(20) not null default 'pending',
		message text not null default '',
		before_data jsonb,
		after_data jsonb,
		removed_lines jsonb,
		created_at timestamp without time zone not null default now(),
		updated_at timestamp without time zone not null default now()
	)`,
	`create table if not exists nsi_document_snapshots (
		id bigserial primary key,
		batch_id bigint references nsi_reflow_batches(id) on delete set null,
		original_doc_no varchar(80) not null,
		current_doc_no varchar(80) not null default '',
		snapshot_data jsonb not null,
		created_by varchar(25) not null default '',
		created_at timestamp without time zone not null default now(),
		rolled_back_at timestamp without time zone,
		rolled_back_by varchar(25) not null default ''
	)`,
	`create table if not exists nsi_document_locks (
		doc_no varchar(80) primary key,
		batch_id bigint references nsi_reflow_batches(id) on delete cascade,
		locked_by varchar(25) not null default '',
		status varchar(20) not null default 'processing',
		locked_at timestamp without time zone not null default now(),
		expires_at timestamp without time zone not null default now() + interval '30 minutes'
	)`,
	`create index if not exists nsi_reflow_batches_status_idx on nsi_reflow_batches (status, created_at desc)`,
	`create index if not exists nsi_reflow_batch_items_doc_idx on nsi_reflow_batch_items (doc_no, status)`,
	`create index if not exists nsi_document_snapshots_doc_idx on nsi_document_snapshots (original_doc_no, created_at desc)`,
	`create index if not exists nsi_document_locks_status_idx on nsi_document_locks (status, expires_at)`,
}

var performanceIndexStatements = []string{
	`create extension if not exists pg_trgm`,
	`create index concurrently if not exists nsi_ic_trans_sales_date_doc_idx
		on ic_trans (trans_flag, doc_date desc, doc_no desc)`,
	`create index concurrently if not exists nsi_ic_trans_sales_format_date_doc_idx
		on ic_trans (trans_flag, doc_format_code, doc_date desc, doc_no desc)`,
	`create index concurrently if not exists nsi_ic_trans_doc_no_trgm_idx
		on ic_trans using gin (doc_no gin_trgm_ops)`,
	`create index concurrently if not exists nsi_ic_trans_cust_code_trgm_idx
		on ic_trans using gin (cust_code gin_trgm_ops)`,
	`create index concurrently if not exists nsi_ic_trans_detail_doc_flag_line_idx
		on ic_trans_detail (doc_no, trans_flag, line_number, roworder)`,
	`create index concurrently if not exists nsi_ar_customer_code_trgm_idx
		on ar_customer using gin (code gin_trgm_ops)`,
	`create index concurrently if not exists nsi_ar_customer_name1_trgm_idx
		on ar_customer using gin (name_1 gin_trgm_ops)`,
}
