package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/model"
)

const salesTransFlag = 44

type DocumentRepository struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func NewDocumentRepository(pool *pgxpool.Pool, cfg config.Config) *DocumentRepository {
	return &DocumentRepository{pool: pool, cfg: cfg}
}

func (r *DocumentRepository) List(ctx context.Context, from, to time.Time, page, pageSize int, search string) ([]model.DocumentSummary, bool, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	search = strings.TrimSpace(search)
	searchPattern := search + "%"
	offset := (page - 1) * pageSize
	rows, err := r.pool.Query(queryCtx, `
		select
			ic_trans.doc_no,
			ic_trans.doc_date,
			coalesce(doc_time, ''),
			coalesce(tax_doc_no, ''),
			coalesce(tax_doc_date::text, ''),
			coalesce(doc_ref, ''),
			coalesce(doc_ref_date::text, ''),
			coalesce(cust_code, ''),
			coalesce(contactor, ''),
			coalesce(inquiry_type, 0),
			coalesce(vat_type, 0),
			coalesce(sale_code, ''),
			coalesce(sale_group, ''),
			coalesce(credit_day::text, ''),
			coalesce(credit_date::text, ''),
			coalesce(send_day::text, ''),
			coalesce(send_date::text, ''),
			coalesce(vat_rate, 0)::text,
			coalesce(total_value, 0)::text,
			coalesce(total_before_vat, 0)::text,
			coalesce(total_vat_value, 0)::text,
			coalesce(total_discount, 0)::text,
			coalesce(total_after_vat, 0)::text,
			coalesce(total_except_vat, 0)::text,
			coalesce(total_amount, 0)::text,
			coalesce(is_cancel, 0),
			coalesce(ic_trans.status, 0),
			coalesce(remark, ''),
			coalesce(doc_format_code, ''),
			case
				when lock.doc_no is not null then 'processing'
				when snapshot.rolled_back_at is not null then 'rolled_back'
				when batch_item.status = 'applied' then 'done'
				when batch_item.status = 'failed' then 'failed'
				when batch_item.status = 'blocked' then 'failed'
				else 'pending'
			end as app_status
		from ic_trans
		left join lateral (
			select dl.doc_no
			from nsi_document_locks dl
			where dl.doc_no = ic_trans.doc_no
				and dl.expires_at > now()
			limit 1
		) lock on true
		left join lateral (
			select bi.status
			from nsi_reflow_batch_items bi
			join nsi_reflow_batches b on b.id = bi.batch_id
			where bi.doc_no = ic_trans.doc_no or bi.new_doc_no = ic_trans.doc_no
			order by bi.created_at desc, bi.id desc
			limit 1
		) batch_item on true
		left join lateral (
			select s.rolled_back_at
			from nsi_document_snapshots s
			where s.original_doc_no = ic_trans.doc_no or s.current_doc_no = ic_trans.doc_no
			order by coalesce(s.rolled_back_at, s.created_at) desc, s.id desc
			limit 1
		) snapshot on true
		where trans_flag = $1
			and doc_date >= $2
			and doc_date <= $3
			and ($6 = '' or ic_trans.doc_no ilike $7 or cust_code ilike $7 or remark ilike $7)
		order by ic_trans.doc_date desc, ic_trans.doc_no desc
		limit $4 offset $5
	`, salesTransFlag, from, to, pageSize+1, offset, search, searchPattern)
	if err != nil {
		return nil, false, fmt.Errorf("query documents: %w", err)
	}
	defer rows.Close()

	items := make([]model.DocumentSummary, 0)
	for rows.Next() {
		var item model.DocumentSummary
		if err := rows.Scan(
			&item.DocNo,
			&item.DocDate,
			&item.DocTime,
			&item.TaxDocNo,
			&item.TaxDocDate,
			&item.DocRef,
			&item.DocRefDate,
			&item.CustomerCode,
			&item.Contactor,
			&item.InquiryType,
			&item.VatType,
			&item.SaleCode,
			&item.SaleGroup,
			&item.CreditDay,
			&item.CreditDate,
			&item.SendDay,
			&item.SendDate,
			&item.VatRate,
			&item.TotalValue,
			&item.TotalBeforeVat,
			&item.TotalVatValue,
			&item.TotalDiscount,
			&item.TotalAfterVat,
			&item.TotalExceptVat,
			&item.TotalAmount,
			&item.IsCancel,
			&item.Status,
			&item.Remark,
			&item.DocFormatCode,
			&item.AppStatus,
		); err != nil {
			return nil, false, fmt.Errorf("scan document: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate documents: %w", err)
	}

	hasMore := len(items) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	return items, hasMore, nil
}

func (r *DocumentRepository) ListDocNos(ctx context.Context, from, to time.Time, search string, limit int) ([]string, bool, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	search = strings.TrimSpace(search)
	searchPattern := search + "%"
	rows, err := r.pool.Query(queryCtx, `
		select doc_no
		from ic_trans
		where trans_flag = $1
			and doc_date >= $2
			and doc_date <= $3
			and ($4 = '' or doc_no ilike $5 or cust_code ilike $5 or remark ilike $5)
		order by doc_date desc, doc_no desc
		limit $6
	`, salesTransFlag, from, to, search, searchPattern, limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("query selectable document numbers: %w", err)
	}
	defer rows.Close()

	docNos := make([]string, 0, limit)
	for rows.Next() {
		var docNo string
		if err := rows.Scan(&docNo); err != nil {
			return nil, false, fmt.Errorf("scan selectable document number: %w", err)
		}
		docNos = append(docNos, docNo)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate selectable document numbers: %w", err)
	}

	hasMore := len(docNos) > limit
	if hasMore {
		docNos = docNos[:limit]
	}
	return docNos, hasMore, nil
}

func (r *DocumentRepository) Details(ctx context.Context, docNo string) ([]model.DocumentDetailLine, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	rows, err := r.pool.Query(queryCtx, `
		select
			doc_no,
			coalesce(line_number, 0),
			coalesce(item_code, ''),
			coalesce(item_name, ''),
			coalesce(barcode, ''),
			coalesce(wh_code, ''),
			coalesce(shelf_code, ''),
			coalesce(unit_code, ''),
			coalesce(qty, 0)::text,
			coalesce(price, 0)::text,
			coalesce(discount, ''),
			coalesce(sum_amount, 0)::text,
			coalesce(total_vat_value, 0)::text,
			coalesce(sum_amount_exclude_vat, 0)::text,
			coalesce(vat_type, 0),
			coalesce(tax_type, 0)
		from ic_trans_detail
		where trans_flag = $1 and doc_no = $2
		order by line_number, roworder
		limit 500
	`, salesTransFlag, docNo)
	if err != nil {
		return nil, fmt.Errorf("query document details: %w", err)
	}
	defer rows.Close()

	items := make([]model.DocumentDetailLine, 0)
	for rows.Next() {
		var item model.DocumentDetailLine
		if err := rows.Scan(
			&item.DocNo,
			&item.LineNumber,
			&item.ItemCode,
			&item.ItemName,
			&item.Barcode,
			&item.WhCode,
			&item.ShelfCode,
			&item.UnitCode,
			&item.Qty,
			&item.Price,
			&item.Discount,
			&item.SumAmount,
			&item.TotalVatValue,
			&item.SumAmountExcludeVat,
			&item.VatType,
			&item.TaxType,
		); err != nil {
			return nil, fmt.Errorf("scan document detail: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate document details: %w", err)
	}
	return items, nil
}

func (r *DocumentRepository) PreviewChange(ctx context.Context, docNo string, req model.DocumentChangeRequest) (model.DocumentChangePreview, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	req = normalizeChangeRequest(req)
	before, err := r.getSummary(queryCtx, r.pool, docNo)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	if err := r.validateChangeRequest(queryCtx, r.pool, docNo, req); err != nil {
		return model.DocumentChangePreview{}, err
	}
	preview, err := r.buildChangePreview(queryCtx, r.pool, before, req)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	if err := ensureDocumentHasLines(preview.Totals); err != nil {
		return model.DocumentChangePreview{}, err
	}
	return preview, nil
}

func (r *DocumentRepository) ApplyChange(ctx context.Context, docNo string, req model.DocumentChangeRequest) (model.DocumentChangePreview, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	req = normalizeChangeRequest(req)
	tx, err := r.pool.BeginTx(queryCtx, pgx.TxOptions{})
	if err != nil {
		return model.DocumentChangePreview{}, fmt.Errorf("begin document change: %w", err)
	}
	defer func() { _ = tx.Rollback(queryCtx) }()

	before, err := r.getSummaryForUpdate(queryCtx, tx, docNo)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	if err := r.validateChangeRequest(queryCtx, tx, docNo, req); err != nil {
		return model.DocumentChangePreview{}, err
	}

	if _, err := tx.Exec(queryCtx, `
		select 1
		from ic_trans_detail
		where trans_flag = $1 and doc_no = $2
		for update
	`, salesTransFlag, docNo); err != nil {
		return model.DocumentChangePreview{}, fmt.Errorf("lock document details: %w", err)
	}

	removed, err := r.detailLines(queryCtx, tx, docNo, req.RemoveItemCodes, true)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	if len(req.RemoveItemCodes) > 0 {
		if _, err := tx.Exec(queryCtx, `
			delete from ic_trans_detail
			where trans_flag = $1
				and doc_no = $2
				and item_code = any($3)
		`, salesTransFlag, docNo, req.RemoveItemCodes); err != nil {
			return model.DocumentChangePreview{}, fmt.Errorf("delete document detail lines: %w", err)
		}
	}

	totals, err := r.calculateTotals(queryCtx, tx, docNo, nil)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	if err := ensureDocumentHasLines(totals); err != nil {
		return model.DocumentChangePreview{}, err
	}
	if _, err := tx.Exec(queryCtx, `
		update ic_trans_detail
		set doc_no = $3,
			cust_code = $4,
			inquiry_type = $5,
			vat_type = $6::integer,
			tax_type = $6::smallint
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo, req.NewDocNo, req.CustomerCode, req.InquiryType, req.VatType); err != nil {
		return model.DocumentChangePreview{}, fmt.Errorf("update document detail headers: %w", err)
	}
	if _, err := tx.Exec(queryCtx, `
		update ic_trans
		set doc_no = $3,
			doc_format_code = $4,
			cust_code = $5,
			inquiry_type = $6,
			vat_type = $7,
			remark = $8,
			total_value = $9::numeric,
			total_before_vat = $10::numeric,
			total_vat_value = $11::numeric,
			total_discount = $12::numeric,
			total_amount = $13::numeric
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo, req.NewDocNo, req.DocFormatCode, req.CustomerCode, req.InquiryType, req.VatType, req.Remark,
		totals.TotalValue, totals.TotalBeforeVat, totals.TotalVatValue, totals.TotalDiscount, totals.TotalAmount); err != nil {
		return model.DocumentChangePreview{}, fmt.Errorf("update document header: %w", err)
	}

	after, err := r.getSummary(queryCtx, tx, req.NewDocNo)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	remaining, err := r.detailLines(queryCtx, tx, req.NewDocNo, req.RemoveItemCodes, false)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	preview := model.DocumentChangePreview{
		DocNo:           req.NewDocNo,
		Before:          before,
		After:           after,
		Totals:          totals,
		RemoveItemCodes: req.RemoveItemCodes,
		RemovedLines:    removed,
		RemainingLines:  remaining,
	}

	if err := tx.Commit(queryCtx); err != nil {
		return model.DocumentChangePreview{}, fmt.Errorf("commit document change: %w", err)
	}
	return preview, nil
}

func (r *DocumentRepository) ApplyChangeWithSnapshot(ctx context.Context, docNo string, req model.DocumentChangeRequest, userCode string) (model.DocumentChangePreview, error) {
	preview, err := r.PreviewChange(ctx, docNo, req)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	bulkReq := model.BulkDocumentChangeRequest{
		DocNos:          []string{docNo},
		DocFormatCode:   req.DocFormatCode,
		CustomerCode:    req.CustomerCode,
		InquiryType:     req.InquiryType,
		VatType:         req.VatType,
		Remark:          req.Remark,
		RemoveItemCodes: req.RemoveItemCodes,
	}
	bulkPreview := model.BulkDocumentChangeResult{
		Items: []model.BulkDocumentChangeItem{{
			DocNo:      docNo,
			NewDocNo:   req.NewDocNo,
			Status:     "ready",
			Message:    "พร้อมบันทึก",
			Preview:    &preview,
			RemoveHits: preview.RemoveItemCodes,
		}},
		TotalCount: 1,
		ReadyCount: 1,
	}
	batchID, _, err := r.createReflowBatch(ctx, userCode, bulkReq, bulkPreview)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	if err := r.acquireDocumentLock(ctx, batchID, docNo, userCode); err != nil {
		_ = r.insertReflowBatchItem(ctx, batchID, model.BulkDocumentChangeItem{
			DocNo:    docNo,
			NewDocNo: req.NewDocNo,
			Status:   "failed",
			Message:  err.Error(),
		})
		_ = r.finishReflowBatch(ctx, batchID, model.BulkDocumentChangeResult{TotalCount: 1, FailedCount: 1})
		return model.DocumentChangePreview{}, err
	}
	defer func() {
		_ = r.releaseDocumentLock(ctx, docNo)
		_ = r.releaseDocumentLock(ctx, req.NewDocNo)
	}()
	if err := r.createDocumentSnapshot(ctx, batchID, docNo, userCode); err != nil {
		_ = r.insertReflowBatchItem(ctx, batchID, model.BulkDocumentChangeItem{
			DocNo:    docNo,
			NewDocNo: req.NewDocNo,
			Status:   "failed",
			Message:  err.Error(),
		})
		_ = r.finishReflowBatch(ctx, batchID, model.BulkDocumentChangeResult{TotalCount: 1, FailedCount: 1})
		return model.DocumentChangePreview{}, err
	}
	applied, err := r.ApplyChange(ctx, docNo, req)
	if err != nil {
		_ = r.insertReflowBatchItem(ctx, batchID, model.BulkDocumentChangeItem{
			DocNo:    docNo,
			NewDocNo: req.NewDocNo,
			Status:   "failed",
			Message:  err.Error(),
		})
		_ = r.finishReflowBatch(ctx, batchID, model.BulkDocumentChangeResult{TotalCount: 1, FailedCount: 1})
		return model.DocumentChangePreview{}, err
	}
	item := model.BulkDocumentChangeItem{
		DocNo:      docNo,
		NewDocNo:   applied.After.DocNo,
		Status:     "applied",
		Message:    "บันทึกสำเร็จ",
		Preview:    &applied,
		RemoveHits: preview.RemoveItemCodes,
	}
	_ = r.markSnapshotCurrentDocNo(ctx, batchID, docNo, applied.After.DocNo)
	_ = r.insertReflowBatchItem(ctx, batchID, item)
	_ = r.finishReflowBatch(ctx, batchID, model.BulkDocumentChangeResult{TotalCount: 1, AppliedCount: 1})
	return applied, nil
}

func (r *DocumentRepository) BulkPreviewChange(ctx context.Context, req model.BulkDocumentChangeRequest) (model.BulkDocumentChangeResult, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	req = normalizeBulkChangeRequest(req)
	if len(req.DocNos) == 0 {
		return model.BulkDocumentChangeResult{}, fmt.Errorf("documents are required")
	}
	if len(req.DocNos) > 300 {
		return model.BulkDocumentChangeResult{}, fmt.Errorf("bulk preview supports up to 300 documents per run")
	}

	nextDocNos, err := r.nextDocNoSequence(queryCtx, req.DocFormatCode, len(req.DocNos))
	if err != nil {
		return model.BulkDocumentChangeResult{}, err
	}

	result := model.BulkDocumentChangeResult{
		Items:      make([]model.BulkDocumentChangeItem, 0, len(req.DocNos)),
		TotalCount: len(req.DocNos),
	}
	reserved := make(map[string]struct{}, len(nextDocNos))
	for i, docNo := range req.DocNos {
		newDocNo := nextDocNos[i]
		item := model.BulkDocumentChangeItem{DocNo: docNo, NewDocNo: newDocNo}
		if _, exists := reserved[newDocNo]; exists {
			item.Status = "blocked"
			item.Message = "เลขบิลใหม่ซ้ำในชุดที่เลือก"
			result.BlockedCount++
			result.Items = append(result.Items, item)
			continue
		}
		reserved[newDocNo] = struct{}{}

		removeHits, err := r.existingRemoveCodes(queryCtx, r.pool, docNo, req.RemoveItemCodes)
		if err != nil {
			item.Status = "blocked"
			item.Message = err.Error()
			result.BlockedCount++
			result.Items = append(result.Items, item)
			continue
		}

		changeReq := model.DocumentChangeRequest{
			DocFormatCode:   req.DocFormatCode,
			NewDocNo:        newDocNo,
			CustomerCode:    req.CustomerCode,
			InquiryType:     req.InquiryType,
			VatType:         req.VatType,
			Remark:          req.Remark,
			RemoveItemCodes: removeHits,
		}
		preview, err := r.PreviewChange(queryCtx, docNo, changeReq)
		if err != nil {
			item.Status = "blocked"
			item.Message = err.Error()
			result.BlockedCount++
			result.Items = append(result.Items, item)
			continue
		}

		item.Preview = &preview
		item.RemoveHits = removeHits
		if len(req.RemoveItemCodes) > 0 && len(removeHits) == 0 {
			item.Status = "warning"
			item.Message = "ไม่พบสินค้าที่เลือกในบิลนี้ จะเปลี่ยนข้อมูลหัวบิลเท่านั้น"
			result.WarningCount++
		} else {
			item.Status = "ready"
			item.Message = "พร้อมบันทึก"
			result.ReadyCount++
		}
		result.Items = append(result.Items, item)
	}

	return result, nil
}

func (r *DocumentRepository) BulkApplyChange(ctx context.Context, req model.BulkDocumentChangeRequest, userCode string) (model.BulkDocumentChangeResult, error) {
	previewResult, err := r.BulkPreviewChange(ctx, req)
	if err != nil {
		return model.BulkDocumentChangeResult{}, err
	}

	result := previewResult
	batchID, batchNo, err := r.createReflowBatch(ctx, userCode, req, previewResult)
	if err != nil {
		return model.BulkDocumentChangeResult{}, err
	}
	result.BatchID = batchID
	result.BatchNo = batchNo
	result.AppliedCount = 0
	result.FailedCount = 0
	for i := range result.Items {
		item := &result.Items[i]
		if item.Status == "blocked" || item.Preview == nil {
			_ = r.insertReflowBatchItem(ctx, batchID, *item)
			continue
		}
		if err := r.acquireDocumentLock(ctx, batchID, item.DocNo, userCode); err != nil {
			item.Status = "failed"
			item.Message = err.Error()
			item.Preview = nil
			result.FailedCount++
			_ = r.insertReflowBatchItem(ctx, batchID, *item)
			continue
		}
		if err := r.createDocumentSnapshot(ctx, batchID, item.DocNo, userCode); err != nil {
			item.Status = "failed"
			item.Message = err.Error()
			item.Preview = nil
			result.FailedCount++
			_ = r.releaseDocumentLock(ctx, item.DocNo)
			_ = r.insertReflowBatchItem(ctx, batchID, *item)
			continue
		}
		changeReq := model.DocumentChangeRequest{
			DocFormatCode:   req.DocFormatCode,
			NewDocNo:        item.NewDocNo,
			CustomerCode:    req.CustomerCode,
			InquiryType:     req.InquiryType,
			VatType:         req.VatType,
			Remark:          req.Remark,
			RemoveItemCodes: item.RemoveHits,
		}
		applied, err := r.ApplyChange(ctx, item.DocNo, changeReq)
		if err != nil {
			item.Status = "failed"
			item.Message = err.Error()
			item.Preview = nil
			result.FailedCount++
			_ = r.releaseDocumentLock(ctx, item.DocNo)
			_ = r.insertReflowBatchItem(ctx, batchID, *item)
			continue
		}
		item.Status = "applied"
		item.Message = "บันทึกสำเร็จ"
		item.Preview = &applied
		result.AppliedCount++
		_ = r.markSnapshotCurrentDocNo(ctx, batchID, item.DocNo, applied.After.DocNo)
		_ = r.releaseDocumentLock(ctx, item.DocNo)
		_ = r.releaseDocumentLock(ctx, applied.After.DocNo)
		_ = r.insertReflowBatchItem(ctx, batchID, *item)
	}
	_ = r.finishReflowBatch(ctx, batchID, result)
	return result, nil
}

func (r *DocumentRepository) RollbackDocument(ctx context.Context, req model.RollbackDocumentRequest, userCode string) (model.RollbackDocumentResult, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	snapshotID, originalDocNo, currentDocNo, payload, err := r.loadRollbackSnapshot(queryCtx, req)
	if err != nil {
		return model.RollbackDocumentResult{}, err
	}

	tx, err := r.pool.BeginTx(queryCtx, pgx.TxOptions{})
	if err != nil {
		return model.RollbackDocumentResult{}, fmt.Errorf("begin rollback: %w", err)
	}
	defer func() { _ = tx.Rollback(queryCtx) }()

	if _, err := tx.Exec(queryCtx, `
		select 1
		from ic_trans
		where trans_flag = $1 and doc_no = $2
		for update
	`, salesTransFlag, currentDocNo); err != nil {
		return model.RollbackDocumentResult{}, fmt.Errorf("lock rollback document: %w", err)
	}
	if len(payload.SummaryRaw) > 0 && len(payload.DetailsRaw) > 0 {
		if _, err := tx.Exec(queryCtx, `
			delete from ic_trans_detail
			where trans_flag = $1 and doc_no = $2
		`, salesTransFlag, currentDocNo); err != nil {
			return model.RollbackDocumentResult{}, fmt.Errorf("clear current detail lines: %w", err)
		}
		if _, err := tx.Exec(queryCtx, `
			delete from ic_trans
			where trans_flag = $1 and doc_no = $2
		`, salesTransFlag, currentDocNo); err != nil {
			return model.RollbackDocumentResult{}, fmt.Errorf("clear current header: %w", err)
		}
		if _, err := tx.Exec(queryCtx, `
			insert into ic_trans
			select * from jsonb_populate_record(null::ic_trans, $1::jsonb)
		`, string(payload.SummaryRaw)); err != nil {
			return model.RollbackDocumentResult{}, fmt.Errorf("restore raw header: %w", err)
		}
		if _, err := tx.Exec(queryCtx, `
			insert into ic_trans_detail
			select * from jsonb_populate_recordset(null::ic_trans_detail, $1::jsonb)
		`, string(payload.DetailsRaw)); err != nil {
			return model.RollbackDocumentResult{}, fmt.Errorf("restore raw detail lines: %w", err)
		}
	} else {
		if _, err := tx.Exec(queryCtx, `
			update ic_trans_detail
			set doc_no = $3,
				cust_code = $4,
				inquiry_type = $5,
				vat_type = $6::integer,
				tax_type = $6::smallint
			where trans_flag = $1 and doc_no = $2
		`, salesTransFlag, currentDocNo, originalDocNo, payload.Summary.CustomerCode, payload.Summary.InquiryType, payload.Summary.VatType); err != nil {
			return model.RollbackDocumentResult{}, fmt.Errorf("restore detail headers: %w", err)
		}
		if _, err := tx.Exec(queryCtx, `
			update ic_trans
			set doc_no = $3,
				doc_format_code = $4,
				cust_code = $5,
				inquiry_type = $6,
				vat_type = $7,
				remark = $8,
				total_value = $9::numeric,
				total_before_vat = $10::numeric,
				total_vat_value = $11::numeric,
				total_discount = $12::numeric,
				total_amount = $13::numeric
			where trans_flag = $1 and doc_no = $2
		`, salesTransFlag, currentDocNo, originalDocNo, payload.Summary.DocFormatCode, payload.Summary.CustomerCode,
			payload.Summary.InquiryType, payload.Summary.VatType, payload.Summary.Remark, payload.Summary.TotalValue,
			payload.Summary.TotalBeforeVat, payload.Summary.TotalVatValue, payload.Summary.TotalDiscount, payload.Summary.TotalAmount); err != nil {
			return model.RollbackDocumentResult{}, fmt.Errorf("restore document header: %w", err)
		}
	}
	if _, err := tx.Exec(queryCtx, `
		update nsi_document_snapshots
		set rolled_back_at = now(),
			rolled_back_by = $2
		where id = $1
	`, snapshotID, userCode); err != nil {
		return model.RollbackDocumentResult{}, fmt.Errorf("mark rollback snapshot: %w", err)
	}
	if err := tx.Commit(queryCtx); err != nil {
		return model.RollbackDocumentResult{}, fmt.Errorf("commit rollback: %w", err)
	}
	restored, err := r.getSummary(ctx, r.pool, originalDocNo)
	if err != nil {
		return model.RollbackDocumentResult{}, err
	}
	return model.RollbackDocumentResult{SnapshotID: snapshotID, Restored: restored}, nil
}

type documentSnapshotPayload struct {
	Summary    model.DocumentSummary      `json:"summary"`
	Details    []model.DocumentDetailLine `json:"details"`
	SummaryRaw json.RawMessage            `json:"summaryRaw,omitempty"`
	DetailsRaw json.RawMessage            `json:"detailsRaw,omitempty"`
}

func (r *DocumentRepository) loadRollbackSnapshot(ctx context.Context, req model.RollbackDocumentRequest) (int64, string, string, documentSnapshotPayload, error) {
	var id int64
	var originalDocNo string
	var currentDocNo string
	var raw []byte
	var row pgx.Row
	if req.SnapshotID > 0 {
		row = r.pool.QueryRow(ctx, `
			select id, original_doc_no, coalesce(nullif(current_doc_no, ''), original_doc_no), snapshot_data
			from nsi_document_snapshots
			where id = $1 and rolled_back_at is null
		`, req.SnapshotID)
	} else {
		docNo := strings.TrimSpace(req.DocNo)
		if docNo == "" {
			return 0, "", "", documentSnapshotPayload{}, fmt.Errorf("snapshot id or doc no is required")
		}
		row = r.pool.QueryRow(ctx, `
			select id, original_doc_no, coalesce(nullif(current_doc_no, ''), original_doc_no), snapshot_data
			from nsi_document_snapshots
			where rolled_back_at is null
				and (original_doc_no = $1 or current_doc_no = $1)
			order by created_at desc
			limit 1
		`, docNo)
	}
	if err := row.Scan(&id, &originalDocNo, &currentDocNo, &raw); err != nil {
		return 0, "", "", documentSnapshotPayload{}, fmt.Errorf("load rollback snapshot: %w", err)
	}
	var payload documentSnapshotPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return 0, "", "", documentSnapshotPayload{}, fmt.Errorf("decode rollback snapshot: %w", err)
	}
	return id, originalDocNo, currentDocNo, payload, nil
}

func (r *DocumentRepository) createReflowBatch(ctx context.Context, userCode string, req model.BulkDocumentChangeRequest, preview model.BulkDocumentChangeResult) (int64, string, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	batchNo := "RF" + time.Now().Format("20060102150405")
	configJSON, _ := json.Marshal(req)
	var id int64
	if err := r.pool.QueryRow(queryCtx, `
		insert into nsi_reflow_batches (
			batch_no, user_code, status, config, total_count, ready_count, warning_count, blocked_count, started_at
		)
		values ($1, $2, 'processing', $3::jsonb, $4, $5, $6, $7, now())
		returning id
	`, batchNo, userCode, string(configJSON), preview.TotalCount, preview.ReadyCount, preview.WarningCount, preview.BlockedCount).Scan(&id); err != nil {
		return 0, "", fmt.Errorf("create reflow batch: %w", err)
	}
	return id, batchNo, nil
}

func (r *DocumentRepository) finishReflowBatch(ctx context.Context, batchID int64, result model.BulkDocumentChangeResult) error {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	status := "done"
	if result.FailedCount > 0 || result.BlockedCount > 0 {
		status = "failed"
	}
	if result.AppliedCount > 0 && (result.FailedCount > 0 || result.BlockedCount > 0) {
		status = "partial"
	}
	_, err := r.pool.Exec(queryCtx, `
		update nsi_reflow_batches
		set status = $2,
			applied_count = $3,
			failed_count = $4,
			finished_at = now(),
			updated_at = now()
		where id = $1
	`, batchID, status, result.AppliedCount, result.FailedCount)
	if err != nil {
		return fmt.Errorf("finish reflow batch: %w", err)
	}
	return nil
}

func (r *DocumentRepository) insertReflowBatchItem(ctx context.Context, batchID int64, item model.BulkDocumentChangeItem) error {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	var beforeJSON, afterJSON, removedJSON []byte
	if item.Preview != nil {
		beforeJSON, _ = json.Marshal(item.Preview.Before)
		afterJSON, _ = json.Marshal(item.Preview.After)
		removedJSON, _ = json.Marshal(item.Preview.RemovedLines)
	}
	_, err := r.pool.Exec(queryCtx, `
		insert into nsi_reflow_batch_items (
			batch_id, doc_no, new_doc_no, status, message, before_data, after_data, removed_lines
		)
		values ($1, $2, $3, $4, $5, nullif($6, '')::jsonb, nullif($7, '')::jsonb, nullif($8, '')::jsonb)
	`, batchID, item.DocNo, item.NewDocNo, item.Status, item.Message, string(beforeJSON), string(afterJSON), string(removedJSON))
	if err != nil {
		return fmt.Errorf("insert reflow batch item: %w", err)
	}
	return nil
}

func (r *DocumentRepository) acquireDocumentLock(ctx context.Context, batchID int64, docNo, userCode string) error {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	tag, err := r.pool.Exec(queryCtx, `
		insert into nsi_document_locks (doc_no, batch_id, locked_by, status, expires_at)
		values ($1, $2, $3, 'processing', now() + interval '30 minutes')
		on conflict (doc_no) do update
		set batch_id = excluded.batch_id,
			locked_by = excluded.locked_by,
			status = excluded.status,
			locked_at = now(),
			expires_at = excluded.expires_at
		where nsi_document_locks.expires_at < now()
	`, docNo, batchID, userCode)
	if err != nil {
		return fmt.Errorf("lock document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("document is locked by another process")
	}
	return nil
}

func (r *DocumentRepository) releaseDocumentLock(ctx context.Context, docNo string) error {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()
	if _, err := r.pool.Exec(queryCtx, `delete from nsi_document_locks where doc_no = $1`, docNo); err != nil {
		return fmt.Errorf("release document lock: %w", err)
	}
	return nil
}

func (r *DocumentRepository) createDocumentSnapshot(ctx context.Context, batchID int64, docNo, userCode string) error {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	summary, err := r.getSummary(queryCtx, r.pool, docNo)
	if err != nil {
		return err
	}
	details, err := r.Details(queryCtx, docNo)
	if err != nil {
		return err
	}
	var summaryRaw, detailsRaw json.RawMessage
	if err := r.pool.QueryRow(queryCtx, `
		select to_jsonb(t)
		from (
			select *
			from ic_trans
			where trans_flag = $1 and doc_no = $2
		) t
	`, salesTransFlag, docNo).Scan(&summaryRaw); err != nil {
		return fmt.Errorf("snapshot raw header: %w", err)
	}
	if err := r.pool.QueryRow(queryCtx, `
		select coalesce(jsonb_agg(to_jsonb(d) order by line_number, roworder), '[]'::jsonb)
		from (
			select *
			from ic_trans_detail
			where trans_flag = $1 and doc_no = $2
		) d
	`, salesTransFlag, docNo).Scan(&detailsRaw); err != nil {
		return fmt.Errorf("snapshot raw detail lines: %w", err)
	}
	payload := map[string]any{
		"summary":    summary,
		"details":    details,
		"summaryRaw": summaryRaw,
		"detailsRaw": detailsRaw,
	}
	snapshotJSON, _ := json.Marshal(payload)
	if _, err := r.pool.Exec(queryCtx, `
		insert into nsi_document_snapshots (batch_id, original_doc_no, current_doc_no, snapshot_data, created_by)
		values ($1, $2, $2, $3::jsonb, $4)
	`, batchID, docNo, string(snapshotJSON), userCode); err != nil {
		return fmt.Errorf("create document snapshot: %w", err)
	}
	return nil
}

func (r *DocumentRepository) markSnapshotCurrentDocNo(ctx context.Context, batchID int64, originalDocNo, currentDocNo string) error {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()
	var summaryRaw, detailsRaw json.RawMessage
	if err := r.pool.QueryRow(queryCtx, `
		select to_jsonb(t)
		from (
			select *
			from ic_trans
			where trans_flag = $1 and doc_no = $2
		) t
	`, salesTransFlag, currentDocNo).Scan(&summaryRaw); err != nil {
		return fmt.Errorf("snapshot after raw header: %w", err)
	}
	if err := r.pool.QueryRow(queryCtx, `
		select coalesce(jsonb_agg(to_jsonb(d) order by line_number, roworder), '[]'::jsonb)
		from (
			select *
			from ic_trans_detail
			where trans_flag = $1 and doc_no = $2
		) d
	`, salesTransFlag, currentDocNo).Scan(&detailsRaw); err != nil {
		return fmt.Errorf("snapshot after raw detail lines: %w", err)
	}
	if _, err := r.pool.Exec(queryCtx, `
		update nsi_document_snapshots
		set current_doc_no = $3,
			snapshot_data = jsonb_set(
				jsonb_set(snapshot_data, '{afterSummaryRaw}', $4::jsonb, true),
				'{afterDetailsRaw}', $5::jsonb, true
			)
		where batch_id = $1 and original_doc_no = $2 and rolled_back_at is null
	`, batchID, originalDocNo, currentDocNo, string(summaryRaw), string(detailsRaw)); err != nil {
		return fmt.Errorf("mark snapshot current doc no: %w", err)
	}
	return nil
}

func (r *DocumentRepository) DocFormats(ctx context.Context) ([]model.DocFormat, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	rows, err := r.pool.Query(queryCtx, `
		select
			code,
			coalesce(name_1, ''),
			coalesce(format, ''),
			coalesce(doc_running, ''),
			coalesce(vat_type, 0)
		from erp_doc_format
		where screen_code = 'SI'
		order by code
		limit 100
	`)
	if err != nil {
		return nil, fmt.Errorf("query doc formats: %w", err)
	}
	defer rows.Close()

	items := make([]model.DocFormat, 0)
	for rows.Next() {
		var item model.DocFormat
		if err := rows.Scan(&item.Code, &item.Name, &item.Format, &item.DocRunning, &item.VatType); err != nil {
			return nil, fmt.Errorf("scan doc format: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *DocumentRepository) NextDocNo(ctx context.Context, formatCode string) (string, string, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	var docFormat string
	if err := r.pool.QueryRow(queryCtx, `
		select coalesce(format, '')
		from erp_doc_format
		where screen_code = 'SI' and code = $1
	`, formatCode).Scan(&docFormat); err != nil {
		return "", "", fmt.Errorf("read doc format: %w", err)
	}

	var latest string
	_ = r.pool.QueryRow(queryCtx, `
		select coalesce(doc_no, '')
		from ic_trans
		where trans_flag = $1
			and doc_format_code = $2
		order by doc_no desc
		limit 1
	`, salesTransFlag, formatCode).Scan(&latest)

	return previewNextDocNo(formatCode, docFormat, latest, time.Now()), latest, nil
}

func (r *DocumentRepository) SearchCustomers(ctx context.Context, q string, limit int) ([]model.CustomerOption, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	q = strings.TrimSpace(q)
	pattern := q + "%"
	rows, err := r.pool.Query(queryCtx, `
		select code, coalesce(name_1, '')
		from ar_customer
		where ($1 = '' or code ilike $2 or name_1 ilike $2)
		order by code
		limit $3
	`, q, pattern, limit)
	if err != nil {
		return nil, fmt.Errorf("query customers: %w", err)
	}
	defer rows.Close()
	return scanOptions(rows, "customer")
}

func (r *DocumentRepository) SearchProducts(ctx context.Context, q string, limit int) ([]model.ProductOption, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	q = strings.TrimSpace(q)
	pattern := q + "%"
	rows, err := r.pool.Query(queryCtx, `
		select code, coalesce(name_1, ''), coalesce(unit_standard, '')
		from ic_inventory
		where ($1 = '' or code ilike $2 or name_1 ilike $2)
		order by code
		limit $3
	`, q, pattern, limit)
	if err != nil {
		return nil, fmt.Errorf("query products: %w", err)
	}
	defer rows.Close()

	items := make([]model.ProductOption, 0)
	for rows.Next() {
		var item model.ProductOption
		if err := rows.Scan(&item.Code, &item.Name, &item.UnitCode); err != nil {
			return nil, fmt.Errorf("scan product: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type optionRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

type documentQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type documentExecutor interface {
	documentQuerier
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func scanOptions(rows optionRows, name string) ([]model.CustomerOption, error) {
	items := make([]model.CustomerOption, 0)
	for rows.Next() {
		var item model.CustomerOption
		if err := rows.Scan(&item.Code, &item.Name); err != nil {
			return nil, fmt.Errorf("scan %s: %w", name, err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func normalizeChangeRequest(req model.DocumentChangeRequest) model.DocumentChangeRequest {
	req.DocFormatCode = strings.TrimSpace(req.DocFormatCode)
	req.NewDocNo = strings.TrimSpace(req.NewDocNo)
	req.CustomerCode = strings.TrimSpace(req.CustomerCode)
	req.Remark = strings.TrimSpace(req.Remark)
	seen := make(map[string]struct{}, len(req.RemoveItemCodes))
	codes := make([]string, 0, len(req.RemoveItemCodes))
	for _, code := range req.RemoveItemCodes {
		code = strings.TrimSpace(code)
		if code == "" {
			continue
		}
		if _, ok := seen[code]; ok {
			continue
		}
		seen[code] = struct{}{}
		codes = append(codes, code)
	}
	req.RemoveItemCodes = codes
	return req
}

func normalizeBulkChangeRequest(req model.BulkDocumentChangeRequest) model.BulkDocumentChangeRequest {
	base := normalizeChangeRequest(model.DocumentChangeRequest{
		DocFormatCode:   req.DocFormatCode,
		CustomerCode:    req.CustomerCode,
		InquiryType:     req.InquiryType,
		VatType:         req.VatType,
		Remark:          req.Remark,
		RemoveItemCodes: req.RemoveItemCodes,
	})
	req.DocFormatCode = base.DocFormatCode
	req.CustomerCode = base.CustomerCode
	req.InquiryType = base.InquiryType
	req.VatType = base.VatType
	req.Remark = base.Remark
	req.RemoveItemCodes = base.RemoveItemCodes

	seen := make(map[string]struct{}, len(req.DocNos))
	docNos := make([]string, 0, len(req.DocNos))
	for _, docNo := range req.DocNos {
		docNo = strings.TrimSpace(docNo)
		if docNo == "" {
			continue
		}
		if _, ok := seen[docNo]; ok {
			continue
		}
		seen[docNo] = struct{}{}
		docNos = append(docNos, docNo)
	}
	req.DocNos = docNos
	return req
}

func (r *DocumentRepository) nextDocNoSequence(ctx context.Context, formatCode string, count int) ([]string, error) {
	formatCode = strings.TrimSpace(formatCode)
	if formatCode == "" {
		return nil, fmt.Errorf("doc format is required")
	}
	if count <= 0 {
		return nil, nil
	}

	var docFormat string
	if err := r.pool.QueryRow(ctx, `
		select coalesce(format, '')
		from erp_doc_format
		where screen_code = 'SI' and code = $1
	`, formatCode).Scan(&docFormat); err != nil {
		return nil, fmt.Errorf("read doc format: %w", err)
	}
	if docFormat == "" {
		return nil, fmt.Errorf("doc format is empty")
	}

	var latest string
	_ = r.pool.QueryRow(ctx, `
		select coalesce(doc_no, '')
		from ic_trans
		where trans_flag = $1
			and doc_format_code = $2
		order by doc_no desc
		limit 1
	`, salesTransFlag, formatCode).Scan(&latest)

	items := make([]string, 0, count)
	for len(items) < count {
		next := previewNextDocNo(formatCode, docFormat, latest, time.Now())
		if next == "" {
			return nil, fmt.Errorf("cannot preview next document number")
		}
		items = append(items, next)
		latest = next
	}
	return items, nil
}

func (r *DocumentRepository) existingRemoveCodes(ctx context.Context, q documentQuerier, docNo string, requested []string) ([]string, error) {
	if len(requested) == 0 {
		return []string{}, nil
	}
	rows, err := q.Query(ctx, `
		select distinct item_code
		from ic_trans_detail
		where trans_flag = $1
			and doc_no = $2
			and item_code = any($3)
		order by item_code
	`, salesTransFlag, docNo, requested)
	if err != nil {
		return nil, fmt.Errorf("check remove items: %w", err)
	}
	defer rows.Close()

	found := make([]string, 0, len(requested))
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, fmt.Errorf("scan remove item hit: %w", err)
		}
		found = append(found, code)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate remove item hits: %w", err)
	}
	return found, nil
}

func (r *DocumentRepository) validateChangeRequest(ctx context.Context, q documentQuerier, docNo string, req model.DocumentChangeRequest) error {
	if req.DocFormatCode == "" {
		return fmt.Errorf("doc format is required")
	}
	if req.NewDocNo == "" {
		return fmt.Errorf("new document number is required")
	}
	if req.CustomerCode == "" {
		return fmt.Errorf("customer is required")
	}
	if req.InquiryType < 1 || req.InquiryType > 4 {
		return fmt.Errorf("sale type is invalid")
	}
	if req.VatType < 0 || req.VatType > 3 {
		return fmt.Errorf("tax type is invalid")
	}
	var exists bool
	if err := q.QueryRow(ctx, `
		select exists(select 1 from erp_doc_format where screen_code = 'SI' and code = $1)
	`, req.DocFormatCode).Scan(&exists); err != nil {
		return fmt.Errorf("validate doc format: %w", err)
	}
	if !exists {
		return fmt.Errorf("doc format not found")
	}
	if err := q.QueryRow(ctx, `
		select exists(select 1 from ar_customer where code = $1)
	`, req.CustomerCode).Scan(&exists); err != nil {
		return fmt.Errorf("validate customer: %w", err)
	}
	if !exists {
		return fmt.Errorf("customer not found")
	}
	if req.NewDocNo != docNo {
		if err := q.QueryRow(ctx, `
			select exists(select 1 from ic_trans where trans_flag = $1 and doc_no = $2)
		`, salesTransFlag, req.NewDocNo).Scan(&exists); err != nil {
			return fmt.Errorf("validate new document number: %w", err)
		}
		if exists {
			return fmt.Errorf("new document number already exists")
		}
	}
	if len(req.RemoveItemCodes) > 0 {
		rows, err := q.Query(ctx, `
			select unnest($1::text[])
			except
			select item_code
			from ic_trans_detail
			where trans_flag = $2
				and doc_no = $3
		`, req.RemoveItemCodes, salesTransFlag, docNo)
		if err != nil {
			return fmt.Errorf("validate remove items: %w", err)
		}
		defer rows.Close()
		missing := make([]string, 0)
		for rows.Next() {
			var code string
			if err := rows.Scan(&code); err != nil {
				return fmt.Errorf("scan missing remove item: %w", err)
			}
			missing = append(missing, code)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate missing remove item: %w", err)
		}
		if len(missing) > 0 {
			return fmt.Errorf("remove item not found in sales details: %s", strings.Join(missing, ", "))
		}
	}
	return nil
}

func (r *DocumentRepository) buildChangePreview(ctx context.Context, q documentQuerier, before model.DocumentSummary, req model.DocumentChangeRequest) (model.DocumentChangePreview, error) {
	removed, err := r.detailLines(ctx, q, before.DocNo, req.RemoveItemCodes, true)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	remaining, err := r.detailLines(ctx, q, before.DocNo, req.RemoveItemCodes, false)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	totals, err := r.calculateTotals(ctx, q, before.DocNo, req.RemoveItemCodes)
	if err != nil {
		return model.DocumentChangePreview{}, err
	}
	after := before
	after.DocNo = req.NewDocNo
	after.DocFormatCode = req.DocFormatCode
	after.CustomerCode = req.CustomerCode
	after.InquiryType = req.InquiryType
	after.VatType = req.VatType
	after.Remark = req.Remark
	after.TotalValue = totals.TotalValue
	after.TotalBeforeVat = totals.TotalBeforeVat
	after.TotalVatValue = totals.TotalVatValue
	after.TotalDiscount = totals.TotalDiscount
	after.TotalAmount = totals.TotalAmount
	return model.DocumentChangePreview{
		DocNo:           before.DocNo,
		Before:          before,
		After:           after,
		Totals:          totals,
		RemoveItemCodes: req.RemoveItemCodes,
		RemovedLines:    removed,
		RemainingLines:  remaining,
	}, nil
}

func (r *DocumentRepository) getSummary(ctx context.Context, q documentQuerier, docNo string) (model.DocumentSummary, error) {
	return r.scanSummary(q.QueryRow(ctx, summarySQL(`
		where trans_flag = $1 and doc_no = $2
	`), salesTransFlag, docNo))
}

func (r *DocumentRepository) getSummaryForUpdate(ctx context.Context, q documentQuerier, docNo string) (model.DocumentSummary, error) {
	return r.scanSummary(q.QueryRow(ctx, summarySQL(`
		where trans_flag = $1 and doc_no = $2
		for update
	`), salesTransFlag, docNo))
}

func summarySQL(suffix string) string {
	return `
		select
			doc_no,
			doc_date,
			coalesce(doc_time, ''),
			coalesce(tax_doc_no, ''),
			coalesce(tax_doc_date::text, ''),
			coalesce(doc_ref, ''),
			coalesce(doc_ref_date::text, ''),
			coalesce(cust_code, ''),
			coalesce(contactor, ''),
			coalesce(inquiry_type, 0),
			coalesce(vat_type, 0),
			coalesce(sale_code, ''),
			coalesce(sale_group, ''),
			coalesce(credit_day::text, ''),
			coalesce(credit_date::text, ''),
			coalesce(send_day::text, ''),
			coalesce(send_date::text, ''),
			coalesce(vat_rate, 0)::text,
			coalesce(total_value, 0)::text,
			coalesce(total_before_vat, 0)::text,
			coalesce(total_vat_value, 0)::text,
			coalesce(total_discount, 0)::text,
			coalesce(total_after_vat, 0)::text,
			coalesce(total_except_vat, 0)::text,
			coalesce(total_amount, 0)::text,
			coalesce(is_cancel, 0),
			coalesce(status, 0),
			coalesce(remark, ''),
			coalesce(doc_format_code, '')
		from ic_trans
	` + suffix
}

func (r *DocumentRepository) scanSummary(row pgx.Row) (model.DocumentSummary, error) {
	var item model.DocumentSummary
	if err := row.Scan(
		&item.DocNo,
		&item.DocDate,
		&item.DocTime,
		&item.TaxDocNo,
		&item.TaxDocDate,
		&item.DocRef,
		&item.DocRefDate,
		&item.CustomerCode,
		&item.Contactor,
		&item.InquiryType,
		&item.VatType,
		&item.SaleCode,
		&item.SaleGroup,
		&item.CreditDay,
		&item.CreditDate,
		&item.SendDay,
		&item.SendDate,
		&item.VatRate,
		&item.TotalValue,
		&item.TotalBeforeVat,
		&item.TotalVatValue,
		&item.TotalDiscount,
		&item.TotalAfterVat,
		&item.TotalExceptVat,
		&item.TotalAmount,
		&item.IsCancel,
		&item.Status,
		&item.Remark,
		&item.DocFormatCode,
	); err != nil {
		return model.DocumentSummary{}, fmt.Errorf("read document summary: %w", err)
	}
	return item, nil
}

func (r *DocumentRepository) calculateTotals(ctx context.Context, q documentQuerier, docNo string, excludeItemCodes []string) (model.DocumentTotals, error) {
	var totals model.DocumentTotals
	if err := q.QueryRow(ctx, `
		select
			coalesce(sum(sum_amount), 0)::text,
			coalesce(sum(sum_amount_exclude_vat), 0)::text,
			coalesce(sum(total_vat_value), 0)::text,
			0::numeric::text,
			(coalesce(sum(sum_amount), 0) + coalesce(sum(total_vat_value), 0))::text,
			count(*)::bigint
		from ic_trans_detail
		where trans_flag = $1
			and doc_no = $2
			and (coalesce(cardinality($3::text[]), 0) = 0 or item_code <> all($3::text[]))
	`, salesTransFlag, docNo, excludeItemCodes).Scan(
		&totals.TotalValue,
		&totals.TotalBeforeVat,
		&totals.TotalVatValue,
		&totals.TotalDiscount,
		&totals.TotalAmount,
		&totals.LineCount,
	); err != nil {
		return model.DocumentTotals{}, fmt.Errorf("calculate document totals: %w", err)
	}
	return totals, nil
}

func (r *DocumentRepository) detailLines(ctx context.Context, q documentQuerier, docNo string, itemCodes []string, include bool) ([]model.DocumentDetailLine, error) {
	condition := "and (coalesce(cardinality($3::text[]), 0) = 0 or item_code <> all($3::text[]))"
	if include {
		condition = "and coalesce(cardinality($3::text[]), 0) > 0 and item_code = any($3::text[])"
	}
	rows, err := q.Query(ctx, `
		select
			doc_no,
			coalesce(line_number, 0),
			coalesce(item_code, ''),
			coalesce(item_name, ''),
			coalesce(barcode, ''),
			coalesce(wh_code, ''),
			coalesce(shelf_code, ''),
			coalesce(unit_code, ''),
			coalesce(qty, 0)::text,
			coalesce(price, 0)::text,
			coalesce(discount, ''),
			coalesce(sum_amount, 0)::text,
			coalesce(total_vat_value, 0)::text,
			coalesce(sum_amount_exclude_vat, 0)::text,
			coalesce(vat_type, 0),
			coalesce(tax_type, 0)
		from ic_trans_detail
		where trans_flag = $1 and doc_no = $2
		`+condition+`
		order by line_number, roworder
		limit 500
	`, salesTransFlag, docNo, itemCodes)
	if err != nil {
		return nil, fmt.Errorf("query document detail lines: %w", err)
	}
	defer rows.Close()
	return scanDetailLines(rows)
}

func scanDetailLines(rows pgx.Rows) ([]model.DocumentDetailLine, error) {
	items := make([]model.DocumentDetailLine, 0)
	for rows.Next() {
		var item model.DocumentDetailLine
		if err := rows.Scan(
			&item.DocNo,
			&item.LineNumber,
			&item.ItemCode,
			&item.ItemName,
			&item.Barcode,
			&item.WhCode,
			&item.ShelfCode,
			&item.UnitCode,
			&item.Qty,
			&item.Price,
			&item.Discount,
			&item.SumAmount,
			&item.TotalVatValue,
			&item.SumAmountExcludeVat,
			&item.VatType,
			&item.TaxType,
		); err != nil {
			return nil, fmt.Errorf("scan document detail line: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ensureDocumentHasLines(totals model.DocumentTotals) error {
	if totals.LineCount == 0 {
		return fmt.Errorf("document must keep at least one detail line")
	}
	return nil
}

func previewNextDocNo(formatCode, format, latest string, now time.Time) string {
	if format == "" {
		return ""
	}
	formatCode = strings.TrimSpace(formatCode)
	prefix := strings.ReplaceAll(format, "@YYYYMM", now.Format("200601"))
	prefix = strings.ReplaceAll(prefix, "@YYMM", now.Format("0601"))
	prefix = strings.ReplaceAll(prefix, "@YYYY", now.Format("2006"))
	prefix = strings.ReplaceAll(prefix, "@YY", now.Format("06"))
	prefix = strings.ReplaceAll(prefix, "@MM", now.Format("01"))
	prefix = strings.ReplaceAll(prefix, "@MM", now.Format("01"))
	hashCount := strings.Count(prefix, "#")
	if hashCount == 0 {
		return ensureDocFormatPrefix(formatCode, prefix)
	}
	staticPrefix := strings.TrimRight(prefix, "#")
	nextNumber := 1
	if len(latest) >= len(staticPrefix)+hashCount {
		raw := latest[len(latest)-hashCount:]
		if parsed, err := strconv.Atoi(raw); err == nil {
			nextNumber = parsed + 1
		}
	}
	number := fmt.Sprintf("%0*d", hashCount, nextNumber)
	return ensureDocFormatPrefix(formatCode, staticPrefix+number)
}

func ensureDocFormatPrefix(formatCode, docNo string) string {
	if formatCode == "" || docNo == "" || strings.HasPrefix(docNo, formatCode) {
		return docNo
	}
	return formatCode + docNo
}
