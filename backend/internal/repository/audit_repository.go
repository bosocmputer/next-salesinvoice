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

type AuditRepository struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func NewAuditRepository(pool *pgxpool.Pool, cfg config.Config) *AuditRepository {
	return &AuditRepository{pool: pool, cfg: cfg}
}

func (r *AuditRepository) List(ctx context.Context, resourceID string, limit int) ([]model.AuditLogItem, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	resourceID = strings.TrimSpace(resourceID)
	rows, err := r.pool.Query(queryCtx, `
		select
			id,
			user_code,
			action,
			resource_type,
			resource_id,
			coalesce(before_data, '{}'::jsonb),
			coalesce(after_data, '{}'::jsonb),
			ip_address,
			user_agent,
			created_at
		from nsi_audit_logs
		where ($1 = '' or resource_id = $1)
		order by id desc
		limit $2
	`, resourceID, limit)
	if err != nil {
		return nil, fmt.Errorf("query audit logs: %w", err)
	}
	defer rows.Close()

	items := make([]model.AuditLogItem, 0)
	for rows.Next() {
		var item model.AuditLogItem
		var beforeData []byte
		var afterData []byte
		if err := rows.Scan(
			&item.ID,
			&item.UserCode,
			&item.Action,
			&item.ResourceType,
			&item.ResourceID,
			&beforeData,
			&afterData,
			&item.IPAddress,
			&item.UserAgent,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan audit log: %w", err)
		}
		item.BeforeData = cloneRawJSON(beforeData)
		item.AfterData = cloneRawJSON(afterData)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit logs: %w", err)
	}
	return items, nil
}

func (r *AuditRepository) DocumentHistory(ctx context.Context, docNo string, limit int) ([]model.DocumentHistoryItem, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	docNo = strings.TrimSpace(docNo)
	rows, err := r.pool.Query(queryCtx, `
		select
			s.id,
			coalesce(s.batch_id, 0),
			s.original_doc_no,
			coalesce(nullif(s.current_doc_no, ''), s.original_doc_no),
			s.snapshot_data,
			coalesce(s.created_by, ''),
			s.created_at,
			s.rolled_back_at,
			coalesce(item.after_data, '{}'::jsonb),
			coalesce(item.status, ''),
			coalesce(item.message, '')
		from nsi_document_snapshots s
		left join lateral (
			select after_data, status, message
			from nsi_reflow_batch_items
			where batch_id = s.batch_id
				and doc_no = s.original_doc_no
			order by id desc
			limit 1
		) item on true
		where ($1 = '' or s.original_doc_no = $1 or s.current_doc_no = $1)
		order by s.id desc
		limit $2
	`, docNo, limit)
	if err != nil {
		return nil, fmt.Errorf("query document history: %w", err)
	}
	defer rows.Close()

	items := make([]model.DocumentHistoryItem, 0)
	for rows.Next() {
		var item model.DocumentHistoryItem
		var snapshotData []byte
		var afterSummary []byte
		if err := rows.Scan(
			&item.SnapshotID,
			&item.BatchID,
			&item.OriginalDocNo,
			&item.CurrentDocNo,
			&snapshotData,
			&item.CreatedBy,
			&item.CreatedAt,
			&item.RolledBackAt,
			&afterSummary,
			&item.Status,
			&item.Message,
		); err != nil {
			return nil, fmt.Errorf("scan document history: %w", err)
		}
		var snapshot struct {
			SummaryRaw      json.RawMessage `json:"summaryRaw"`
			DetailsRaw      json.RawMessage `json:"detailsRaw"`
			AfterSummaryRaw json.RawMessage `json:"afterSummaryRaw"`
			AfterDetailsRaw json.RawMessage `json:"afterDetailsRaw"`
		}
		if err := json.Unmarshal(snapshotData, &snapshot); err != nil {
			return nil, fmt.Errorf("decode document snapshot: %w", err)
		}
		item.Before = model.DocumentRawState{
			ICTrans:       defaultRawJSON(snapshot.SummaryRaw, `{}`),
			ICTransDetail: defaultRawJSON(snapshot.DetailsRaw, `[]`),
		}
		after := model.DocumentRawState{
			ICTrans:       defaultRawJSON(snapshot.AfterSummaryRaw, `{}`),
			ICTransDetail: defaultRawJSON(snapshot.AfterDetailsRaw, `[]`),
		}
		if string(after.ICTrans) == "{}" && string(after.ICTransDetail) == "[]" {
			after, err = r.currentDocumentRaw(queryCtx, item.CurrentDocNo)
			if err != nil {
				return nil, err
			}
		}
		item.After = after
		item.AfterSummary = cloneRawJSON(afterSummary)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate document history: %w", err)
	}
	return items, nil
}

func (r *AuditRepository) currentDocumentRaw(ctx context.Context, docNo string) (model.DocumentRawState, error) {
	var header json.RawMessage
	err := r.pool.QueryRow(ctx, `
		select to_jsonb(t)
		from (
			select *
			from ic_trans
			where trans_flag = $1 and doc_no = $2
		) t
	`, salesTransFlag, docNo).Scan(&header)
	if err != nil {
		if err == pgx.ErrNoRows {
			header = json.RawMessage(`{}`)
		} else {
			return model.DocumentRawState{}, fmt.Errorf("read current document header: %w", err)
		}
	}
	var details json.RawMessage
	if err := r.pool.QueryRow(ctx, `
		select coalesce(jsonb_agg(to_jsonb(d) order by line_number, roworder), '[]'::jsonb)
		from (
			select *
			from ic_trans_detail
			where trans_flag = $1 and doc_no = $2
		) d
	`, salesTransFlag, docNo).Scan(&details); err != nil {
		return model.DocumentRawState{}, fmt.Errorf("read current document details: %w", err)
	}
	return model.DocumentRawState{
		ICTrans:       defaultRawJSON(header, `{}`),
		ICTransDetail: defaultRawJSON(details, `[]`),
	}, nil
}

func cloneRawJSON(value []byte) json.RawMessage {
	if len(value) == 0 {
		return json.RawMessage(`{}`)
	}
	cloned := make([]byte, len(value))
	copy(cloned, value)
	return json.RawMessage(cloned)
}

func defaultRawJSON(value json.RawMessage, fallback string) json.RawMessage {
	if len(value) == 0 || strings.TrimSpace(string(value)) == "" || string(value) == "null" {
		return json.RawMessage(fallback)
	}
	cloned := make([]byte, len(value))
	copy(cloned, value)
	return json.RawMessage(cloned)
}
