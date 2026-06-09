package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func deleteCbChqListByDocRef(ctx context.Context, tx pgx.Tx, docRef string) error {
	if _, err := tx.Exec(ctx, `
		delete from cb_chq_list
		where doc_ref = $1
	`, docRef); err != nil {
		return fmt.Errorf("cb_chq_list cleanup: delete doc_ref %s: %w", docRef, err)
	}
	return nil
}

func restoreCbChqListFromSnapshot(
	ctx context.Context,
	tx pgx.Tx,
	currentDocNo, originalDocNo string,
	payload documentSnapshotPayload,
) error {
	if len(payload.CbChqListRaw) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `
		delete from cb_chq_list
		where doc_ref in ($1, $2)
	`, currentDocNo, originalDocNo); err != nil {
		return fmt.Errorf("rollback cb_chq_list clear: %w", err)
	}
	if !isJSONNull(payload.CbChqListRaw) {
		if _, err := tx.Exec(ctx, `
			insert into cb_chq_list
			select * from jsonb_populate_recordset(null::cb_chq_list, $1::jsonb)
		`, string(payload.CbChqListRaw)); err != nil {
			return fmt.Errorf("rollback cb_chq_list insert: %w", err)
		}
	}
	return nil
}

func marshalCbChqListSnapshot(ctx context.Context, q documentQuerier, docRef string) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := q.QueryRow(ctx, `
		select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
		from cb_chq_list c
		where doc_ref = $1
	`, docRef).Scan(&raw); err != nil {
		return nil, fmt.Errorf("snapshot cb_chq_list: %w", err)
	}
	return raw, nil
}
