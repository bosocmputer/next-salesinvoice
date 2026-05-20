package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/model"
)

const salesTransFlag = 44

type duplicateDocumentNumberError struct {
	docNo string
	err   error
}

func (e duplicateDocumentNumberError) Error() string {
	if e.docNo == "" {
		return "เลขบิลใหม่ถูกใช้แล้ว กรุณากดตรวจสอบใหม่เพื่อออกเลขชุดใหม่"
	}
	return fmt.Sprintf("เลขบิลใหม่ %s ถูกใช้แล้ว กรุณากดตรวจสอบใหม่เพื่อออกเลขชุดใหม่", e.docNo)
}

func (e duplicateDocumentNumberError) Unwrap() error {
	return e.err
}

type DocumentRepository struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func NewDocumentRepository(pool *pgxpool.Pool, cfg config.Config) *DocumentRepository {
	return &DocumentRepository{pool: pool, cfg: cfg}
}

type documentSearchRange struct {
	start string
	end   string
}

type documentSearchFilter struct {
	search      string
	advanced    bool
	exactDocNos []string
	ranges      []documentSearchRange
}

type documentNoParts struct {
	docNo  string
	prefix string
	number string
}

func parseDocumentSearch(search string) documentSearchFilter {
	search = strings.TrimSpace(search)
	filter := documentSearchFilter{search: search}
	if search == "" {
		return filter
	}

	tokens := strings.FieldsFunc(search, func(r rune) bool {
		return r == ',' || unicode.IsSpace(r)
	})
	if len(tokens) == 0 {
		return filter
	}
	if len(tokens) == 1 && !strings.Contains(search, ",") && !strings.Contains(search, ":") {
		return filter
	}

	exactSet := make(map[string]struct{})
	for _, token := range tokens {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}

		if strings.Contains(token, ":") {
			parts := strings.Split(token, ":")
			if len(parts) != 2 {
				return documentSearchFilter{search: search}
			}
			start, ok := splitDocumentNoParts(parts[0])
			if !ok {
				return documentSearchFilter{search: search}
			}
			end, ok := splitDocumentNoParts(parts[1])
			if !ok || start.prefix != end.prefix || len(start.number) != len(end.number) {
				return documentSearchFilter{search: search}
			}
			rangeStart, rangeEnd := start.docNo, end.docNo
			if rangeStart > rangeEnd {
				rangeStart, rangeEnd = rangeEnd, rangeStart
			}
			filter.ranges = append(filter.ranges, documentSearchRange{start: rangeStart, end: rangeEnd})
			continue
		}

		docNo, ok := splitDocumentNoParts(token)
		if !ok {
			return documentSearchFilter{search: search}
		}
		if _, exists := exactSet[docNo.docNo]; !exists {
			filter.exactDocNos = append(filter.exactDocNos, docNo.docNo)
			exactSet[docNo.docNo] = struct{}{}
		}
	}

	if len(filter.exactDocNos) > 0 || len(filter.ranges) > 0 {
		filter.advanced = true
	}
	return filter
}

func splitDocumentNoParts(value string) (documentNoParts, bool) {
	docNo := strings.ToUpper(strings.TrimSpace(value))
	if docNo == "" {
		return documentNoParts{}, false
	}

	split := len(docNo)
	for split > 0 && docNo[split-1] >= '0' && docNo[split-1] <= '9' {
		split--
	}
	if split == len(docNo) {
		return documentNoParts{}, false
	}
	return documentNoParts{
		docNo:  docNo,
		prefix: docNo[:split],
		number: docNo[split:],
	}, true
}

func (filter documentSearchFilter) rangeBounds() ([]string, []string) {
	starts := make([]string, 0, len(filter.ranges))
	ends := make([]string, 0, len(filter.ranges))
	for _, item := range filter.ranges {
		starts = append(starts, item.start)
		ends = append(ends, item.end)
	}
	return starts, ends
}

func (r *DocumentRepository) List(ctx context.Context, from, to time.Time, page, pageSize int, search string) ([]model.DocumentSummary, bool, int, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	searchFilter := parseDocumentSearch(search)
	searchPattern := searchFilter.search + "%"
	rangeStarts, rangeEnds := searchFilter.rangeBounds()
	offset := (page - 1) * pageSize
	var total int
	countCtx, cancelCount := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancelCount()
	if err := r.pool.QueryRow(countCtx, `
		select count(*)
		from ic_trans
		where trans_flag = $1
			and doc_date >= $2
			and doc_date <= $3
			and (
				(not $4::boolean and ($5 = '' or ic_trans.doc_no ilike $6 or cust_code ilike $6 or remark ilike $6))
				or
				($4::boolean and (
					upper(ic_trans.doc_no) = any($7::text[])
					or exists (
						select 1
						from unnest($8::text[], $9::text[]) as doc_range(start_doc_no, end_doc_no)
						where upper(ic_trans.doc_no) >= doc_range.start_doc_no
							and upper(ic_trans.doc_no) <= doc_range.end_doc_no
					)
				))
			)
	`, salesTransFlag, from, to, searchFilter.advanced, searchFilter.search, searchPattern, searchFilter.exactDocNos, rangeStarts, rangeEnds).Scan(&total); err != nil {
		return nil, false, 0, fmt.Errorf("count documents: %w", err)
	}
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
			and (
				(not $6::boolean and ($7 = '' or ic_trans.doc_no ilike $8 or cust_code ilike $8 or remark ilike $8))
				or
				($6::boolean and (
					upper(ic_trans.doc_no) = any($9::text[])
					or exists (
						select 1
						from unnest($10::text[], $11::text[]) as doc_range(start_doc_no, end_doc_no)
						where upper(ic_trans.doc_no) >= doc_range.start_doc_no
							and upper(ic_trans.doc_no) <= doc_range.end_doc_no
					)
				))
			)
		order by ic_trans.doc_date desc, ic_trans.doc_no desc
		limit $4 offset $5
	`, salesTransFlag, from, to, pageSize+1, offset, searchFilter.advanced, searchFilter.search, searchPattern, searchFilter.exactDocNos, rangeStarts, rangeEnds)
	if err != nil {
		return nil, false, 0, fmt.Errorf("query documents: %w", err)
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
			return nil, false, 0, fmt.Errorf("scan document: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, 0, fmt.Errorf("iterate documents: %w", err)
	}

	hasMore := len(items) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	return items, hasMore, total, nil
}

func (r *DocumentRepository) ListDocNos(ctx context.Context, from, to time.Time, search string, limit int) ([]string, bool, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	searchFilter := parseDocumentSearch(search)
	searchPattern := searchFilter.search + "%"
	rangeStarts, rangeEnds := searchFilter.rangeBounds()
	rows, err := r.pool.Query(queryCtx, `
		select doc_no
		from ic_trans
		where trans_flag = $1
			and doc_date >= $2
			and doc_date <= $3
			and (
				(not $4::boolean and ($5 = '' or doc_no ilike $6 or cust_code ilike $6 or remark ilike $6))
				or
				($4::boolean and (
					upper(doc_no) = any($7::text[])
					or exists (
						select 1
						from unnest($8::text[], $9::text[]) as doc_range(start_doc_no, end_doc_no)
						where upper(doc_no) >= doc_range.start_doc_no
							and upper(doc_no) <= doc_range.end_doc_no
					)
				))
			)
		order by doc_date desc, doc_no desc
		limit $10
	`, salesTransFlag, from, to, searchFilter.advanced, searchFilter.search, searchPattern, searchFilter.exactDocNos, rangeStarts, rangeEnds, limit+1)
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
	if r.cfg.CbTransSyncEnabled {
		paymentBefore, payErr := r.fetchDocumentPayment(queryCtx, r.pool, docNo)
		if payErr == nil && paymentBefore != nil {
			after := simulateDocumentPaymentAfter(*paymentBefore, preview.Totals.TotalAmount)
			after.DocNo = req.NewDocNo
			preview.PaymentBefore = paymentBefore
			preview.PaymentAfter = &after
		}
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

	if len(req.AddedLines) > 0 {
		if err := r.insertAddedDetailLines(queryCtx, tx, docNo, req.CustomerCode, req.InquiryType, req.VatType, req.AddedLines); err != nil {
			return model.DocumentChangePreview{}, err
		}
	}

	totals, err := r.calculateTotals(queryCtx, tx, docNo, nil, req.VatType)
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
			tax_type = $6::smallint,
			sum_amount_exclude_vat = case
				when $6::integer = 0 then sum_amount
				when $6::integer = 1 then round(sum_amount * 100.0 / (100.0 + 7), 2)
				when $6::integer = 2 then sum_amount
				else sum_amount_exclude_vat
			end,
			total_vat_value = case
				when $6::integer = 0 then 0::numeric
				when $6::integer = 1 then sum_amount - round(sum_amount * 100.0 / (100.0 + 7), 2)
				when $6::integer = 2 then round(sum_amount * 7 / 100.0, 2)
				else total_vat_value
			end
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo, req.NewDocNo, req.CustomerCode, req.InquiryType, req.VatType); err != nil {
		if normalized := normalizeDocumentWriteError(err, req.NewDocNo); normalized != nil {
			return model.DocumentChangePreview{}, normalized
		}
		return model.DocumentChangePreview{}, fmt.Errorf("update document detail headers: %w", err)
	}
	if _, err := tx.Exec(queryCtx, `
		update ic_trans
		set doc_no = $3,
			tax_doc_no = $3,
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
		if normalized := normalizeDocumentWriteError(err, req.NewDocNo); normalized != nil {
			return model.DocumentChangePreview{}, normalized
		}
		return model.DocumentChangePreview{}, fmt.Errorf("update document header: %w", err)
	}

	// Sync cb_trans + cb_trans_detail so the payment totals stay equal to
	// the new ic_trans total. Lenient: no cb_trans row → skip; never blocks.
	// Controlled by NSI_CB_TRANS_SYNC flag (default true).
	newTotalFloat, parseErr := strconv.ParseFloat(strings.TrimSpace(totals.TotalAmount), 64)
	if parseErr != nil {
		return model.DocumentChangePreview{}, fmt.Errorf("parse new total for cb_trans sync: %w", parseErr)
	}
	if err := r.syncCbTransToTotal(queryCtx, tx, docNo, req.NewDocNo, newTotalFloat); err != nil {
		return model.DocumentChangePreview{}, err
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
		AddedLines:      req.AddedLines,
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
	req = normalizeBulkChangeRequest(req)
	if len(req.DocNos) == 0 {
		return model.BulkDocumentChangeResult{}, fmt.Errorf("documents are required")
	}
	if len(req.DocNos) > 300 {
		return model.BulkDocumentChangeResult{}, fmt.Errorf("bulk preview supports up to 300 documents per run")
	}

	// Each step gets its own DBQueryTimeout window so a slow remote PG link does
	// not starve later queries when the bulk preview chains 7 round-trips.
	withStepTimeout := func() (context.Context, context.CancelFunc) {
		return context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	}

	stepCtx, cancel := withStepTimeout()
	if err := r.validateBulkChangeBase(stepCtx, r.pool, req); err != nil {
		cancel()
		return model.BulkDocumentChangeResult{}, err
	}
	cancel()

	// Fetch summaries first — they drive both per-doc fallbacks (when a header
	// field is left as "keep") and the new doc-number reuse path.
	stepCtx, cancel = withStepTimeout()
	summaries, err := r.summariesByDocNo(stepCtx, r.pool, req.DocNos)
	cancel()
	if err != nil {
		return model.BulkDocumentChangeResult{}, err
	}

	// New doc numbers are allocated only when the user picked a new format.
	// Otherwise each bill keeps its existing doc_no.
	nextDocNos := make([]string, len(req.DocNos))
	if req.DocFormatCode != "" {
		stepCtx, cancel = withStepTimeout()
		allocated, err := r.nextDocNoSequence(stepCtx, req.DocFormatCode, len(req.DocNos))
		cancel()
		if err != nil {
			return model.BulkDocumentChangeResult{}, err
		}
		copy(nextDocNos, allocated)
	} else {
		copy(nextDocNos, req.DocNos)
	}

	// Duplicate-detection on new doc numbers only matters when we issued fresh
	// ones. Reusing the original doc_no can never collide with itself.
	existingNewDocNos := map[string]struct{}{}
	if req.DocFormatCode != "" {
		stepCtx, cancel = withStepTimeout()
		existingNewDocNos, err = r.existingDocumentNumberSet(stepCtx, r.pool, nextDocNos)
		cancel()
		if err != nil {
			return model.BulkDocumentChangeResult{}, err
		}
	}

	// Per-doc edits override the global RemoveItemCodes when provided. Build
	// the lookup maps once so the per-doc loop below stays simple.
	usePerDoc := len(req.PerDocEdits) > 0
	removeByDocNo := make(map[string][]string, len(req.DocNos))
	addedByDocNo := make(map[string][]model.NewLineInput, len(req.DocNos))
	if usePerDoc {
		for _, edit := range req.PerDocEdits {
			if len(edit.RemoveItemCodes) > 0 {
				removeByDocNo[edit.DocNo] = edit.RemoveItemCodes
			}
			if len(edit.AddedLines) > 0 {
				addedByDocNo[edit.DocNo] = edit.AddedLines
			}
		}
	}

	stepCtx, cancel = withStepTimeout()
	removeHitsByDocNo, err := r.existingRemoveCodesByDocNo(stepCtx, r.pool, req.DocNos, req.RemoveItemCodes)
	cancel()
	if err != nil {
		return model.BulkDocumentChangeResult{}, err
	}

	stepCtx, cancel = withStepTimeout()
	detailsByDocNo, err := r.detailLinesByDocNo(stepCtx, r.pool, req.DocNos)
	cancel()
	if err != nil {
		return model.BulkDocumentChangeResult{}, err
	}

	// VAT recalculation: when the user picked a vat_type, apply it uniformly.
	// When left as "keep" (-1), group docs by their existing vat_type and run
	// the totals query once per group so each bill keeps its own VAT regime.
	// When per-doc edits are in use we skip the SQL aggregation entirely and
	// recompute totals in Go for every bill, since added lines aren't in the
	// DB yet and remove codes can differ per bill.
	totalsByDocNo := make(map[string]model.DocumentTotals, len(req.DocNos))
	if !usePerDoc {
		if req.VatType != -1 {
			stepCtx, cancel = withStepTimeout()
			totalsByDocNo, err = r.calculateTotalsByDocNo(stepCtx, r.pool, req.DocNos, req.RemoveItemCodes, req.VatType)
			cancel()
			if err != nil {
				return model.BulkDocumentChangeResult{}, err
			}
		} else {
			docsByVat := make(map[int16][]string, 4)
			for _, docNo := range req.DocNos {
				vt := int16(0)
				if s, ok := summaries[docNo]; ok {
					vt = s.VatType
				}
				docsByVat[vt] = append(docsByVat[vt], docNo)
			}
			for vt, docs := range docsByVat {
				stepCtx, cancel = withStepTimeout()
				groupTotals, err := r.calculateTotalsByDocNo(stepCtx, r.pool, docs, req.RemoveItemCodes, vt)
				cancel()
				if err != nil {
					return model.BulkDocumentChangeResult{}, err
				}
				for k, v := range groupTotals {
					totalsByDocNo[k] = v
				}
			}
		}
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

		if _, exists := existingNewDocNos[newDocNo]; exists && newDocNo != docNo {
			item.Status = "blocked"
			item.Message = duplicateDocumentNumberError{docNo: newDocNo}.Error()
			result.BlockedCount++
			result.Items = append(result.Items, item)
			continue
		}

		before, exists := summaries[docNo]
		if !exists {
			item.Status = "blocked"
			item.Message = "ไม่พบบิลในระบบ"
			result.BlockedCount++
			result.Items = append(result.Items, item)
			continue
		}

		var removeHits []string
		var addedLines []model.NewLineInput
		if usePerDoc {
			removeHits = removeByDocNo[docNo]
			addedLines = addedByDocNo[docNo]
		} else {
			removeHits = removeHitsByDocNo[docNo]
		}
		if removeHits == nil {
			removeHits = []string{}
		}
		removed, remaining := splitPreviewDetailLines(detailsByDocNo[docNo], removeHits)
		var totals model.DocumentTotals
		if usePerDoc {
			// Resolve effective vat_type per bill so the Go-side totals match
			// what the apply step will write to the DB.
			vt := req.VatType
			if vt == -1 {
				vt = before.VatType
			}
			totals = computeTotalsFromLines(remaining, addedLines, vt)
		} else {
			t, ok := totalsByDocNo[docNo]
			if !ok {
				t = zeroDocumentTotals()
			}
			totals = t
		}
		changeReq := model.DocumentChangeRequest{
			DocFormatCode:   req.DocFormatCode,
			NewDocNo:        newDocNo,
			CustomerCode:    req.CustomerCode,
			InquiryType:     req.InquiryType,
			VatType:         req.VatType,
			Remark:          req.Remark,
			RemoveItemCodes: removeHits,
			AddedLines:      addedLines,
		}
		preview := buildChangePreviewFromFetched(before, changeReq, totals, removed, remaining)
		if err := ensureDocumentHasLines(preview.Totals); err != nil {
			item.Status = "blocked"
			item.Message = err.Error()
			result.BlockedCount++
			result.Items = append(result.Items, item)
			continue
		}

		// Attach cb_trans payment preview (before + simulated after) so the
		// UI can show how the apply step will rescale payment instruments.
		// Best-effort: errors are logged-as-data via status but never block
		// the bill — the apply step has the authoritative sync logic.
		if r.cfg.CbTransSyncEnabled {
			payCtx, payCancel := withStepTimeout()
			paymentBefore, payErr := r.fetchDocumentPayment(payCtx, r.pool, docNo)
			payCancel()
			if payErr == nil && paymentBefore != nil {
				after := simulateDocumentPaymentAfter(*paymentBefore, totals.TotalAmount)
				after.DocNo = newDocNo
				preview.PaymentBefore = paymentBefore
				preview.PaymentAfter = &after
			}
		}

		item.Preview = &preview
		item.RemoveHits = removeHits
		item.AddedLines = addedLines
		if !usePerDoc && len(req.RemoveItemCodes) > 0 && len(removeHits) == 0 {
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
		// Bulk semantics: any field left as a sentinel must be applied as the
		// bill's own existing value. The preview already resolved this into
		// item.Preview.After, so feed those concrete values into ApplyChange so
		// validateChangeRequest (strict) passes and the DB write uses real data.
		after := item.Preview.After
		changeReq := model.DocumentChangeRequest{
			DocFormatCode:   after.DocFormatCode,
			NewDocNo:        item.NewDocNo,
			CustomerCode:    after.CustomerCode,
			InquiryType:     after.InquiryType,
			VatType:         after.VatType,
			Remark:          after.Remark,
			RemoveItemCodes: item.RemoveHits,
			AddedLines:      item.AddedLines,
		}
		applied, err := r.ApplyChange(ctx, item.DocNo, changeReq)
		if err != nil {
			item.Status = "failed"
			item.Message = err.Error()
			item.Preview = nil
			result.FailedCount++
			_ = r.releaseDocumentLock(ctx, item.DocNo)
			_ = r.insertReflowBatchItem(ctx, batchID, *item)
			if isDuplicateDocumentNumberError(err) {
				result.SkippedCount += r.skipRemainingBulkItems(ctx, batchID, result.Items[i+1:], "หยุดบันทึกบิลที่เหลือ เพราะเลขบิลใหม่ซ้ำกับ SML กรุณากดตรวจสอบใหม่เพื่อออกเลขชุดใหม่")
				break
			}
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

func (r *DocumentRepository) skipRemainingBulkItems(ctx context.Context, batchID int64, items []model.BulkDocumentChangeItem, message string) int {
	skipped := 0
	for i := range items {
		item := &items[i]
		if item.Status == "blocked" {
			continue
		}
		item.Status = "skipped"
		item.Message = message
		item.Preview = nil
		skipped++
		_ = r.insertReflowBatchItem(ctx, batchID, *item)
	}
	return skipped
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
				tax_doc_no = $3,
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
	// Restore cb_trans + cb_trans_detail from the snapshot when present.
	// Snapshots created before this feature shipped won't carry the raw
	// payload; in that case we leave cb_trans untouched (legacy behaviour).
	if err := r.restoreCbTransFromSnapshot(queryCtx, tx, currentDocNo, originalDocNo, payload); err != nil {
		return model.RollbackDocumentResult{}, err
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
	// CbTransRaw captures the cb_trans header row (trans_flag=44) at snapshot
	// time so RollbackDocument can fully restore payment-side data after
	// ApplyChange has re-balanced it. Holds JSON null when the bill had no
	// cb_trans companion (typical for credit/AR invoices).
	CbTransRaw json.RawMessage `json:"cbTransRaw,omitempty"`
	// CbTransDetailsRaw is the array of cb_trans_detail rows (trans_flag=44)
	// at snapshot time. Empty array when none existed.
	CbTransDetailsRaw json.RawMessage `json:"cbTransDetailsRaw,omitempty"`
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
	// Capture cb_trans + cb_trans_detail too so rollback can restore the
	// payment side bit-for-bit. Both may be null/empty for credit sales.
	var cbTransRaw, cbTransDetailsRaw json.RawMessage
	if err := r.pool.QueryRow(queryCtx, `
		select coalesce(
			(select to_jsonb(t) from cb_trans t where trans_flag = $1 and doc_no = $2 limit 1),
			'null'::jsonb)
	`, salesTransFlag, docNo).Scan(&cbTransRaw); err != nil {
		return fmt.Errorf("snapshot cb_trans header: %w", err)
	}
	if err := r.pool.QueryRow(queryCtx, `
		select coalesce(jsonb_agg(to_jsonb(d) order by roworder), '[]'::jsonb)
		from cb_trans_detail d
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo).Scan(&cbTransDetailsRaw); err != nil {
		return fmt.Errorf("snapshot cb_trans_detail: %w", err)
	}
	payload := map[string]any{
		"summary":           summary,
		"details":           details,
		"summaryRaw":        summaryRaw,
		"detailsRaw":        detailsRaw,
		"cbTransRaw":        cbTransRaw,
		"cbTransDetailsRaw": cbTransDetailsRaw,
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

// ProductUnits returns the units configured for a product in ic_unit_use, joined with ic_unit for the
// display name. Sorted by line_number then code so the product's primary/default unit appears first.
func (r *DocumentRepository) ProductUnits(ctx context.Context, icCode string) ([]model.ProductUnit, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	rows, err := r.pool.Query(queryCtx, `
		select uu.code, coalesce(u.name_1, '')
		from ic_unit_use uu
		left join ic_unit u on u.code = uu.code
		where uu.ic_code = $1
		order by uu.line_number, uu.code
	`, icCode)
	if err != nil {
		return nil, fmt.Errorf("query product units: %w", err)
	}
	defer rows.Close()

	items := make([]model.ProductUnit, 0)
	for rows.Next() {
		var item model.ProductUnit
		if err := rows.Scan(&item.Code, &item.Name); err != nil {
			return nil, fmt.Errorf("scan product unit: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ItemsByDocs returns distinct items (item_code + name + unit) that appear in any of the given documents,
// together with the number of distinct documents each item appears in. Used by the bulk-edit UI to
// scope the "items to remove" picker to only the lines actually present in the selected bills.
func (r *DocumentRepository) ItemsByDocs(ctx context.Context, docNos []string) ([]model.ProductOption, error) {
	if len(docNos) == 0 {
		return []model.ProductOption{}, nil
	}
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	rows, err := r.pool.Query(queryCtx, `
		select item_code,
		       max(coalesce(item_name, '')) as name,
		       max(coalesce(unit_code, '')) as unit_code,
		       count(distinct doc_no)::int as doc_count
		from ic_trans_detail
		where doc_no = any($1)
		group by item_code
		order by item_code
	`, docNos)
	if err != nil {
		return nil, fmt.Errorf("query items by docs: %w", err)
	}
	defer rows.Close()

	items := make([]model.ProductOption, 0)
	for rows.Next() {
		var item model.ProductOption
		if err := rows.Scan(&item.Code, &item.Name, &item.UnitCode, &item.DocCount); err != nil {
			return nil, fmt.Errorf("scan item by doc: %w", err)
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

	// Normalize PerDocEdits: trim doc numbers, dedupe codes per doc, filter
	// invalid added lines. Entries with empty docNo or no actual edits drop out.
	if len(req.PerDocEdits) > 0 {
		validDocs := make(map[string]struct{}, len(req.DocNos))
		for _, dn := range req.DocNos {
			validDocs[dn] = struct{}{}
		}
		normalized := make([]model.DocEdit, 0, len(req.PerDocEdits))
		seenEdit := make(map[string]int, len(req.PerDocEdits))
		for _, edit := range req.PerDocEdits {
			edit.DocNo = strings.TrimSpace(edit.DocNo)
			if edit.DocNo == "" {
				continue
			}
			if _, ok := validDocs[edit.DocNo]; !ok {
				continue
			}
			codesSeen := make(map[string]struct{}, len(edit.RemoveItemCodes))
			codes := make([]string, 0, len(edit.RemoveItemCodes))
			for _, c := range edit.RemoveItemCodes {
				c = strings.TrimSpace(c)
				if c == "" {
					continue
				}
				if _, ok := codesSeen[c]; ok {
					continue
				}
				codesSeen[c] = struct{}{}
				codes = append(codes, c)
			}
			edit.RemoveItemCodes = codes

			added := make([]model.NewLineInput, 0, len(edit.AddedLines))
			for _, line := range edit.AddedLines {
				line.ItemCode = strings.TrimSpace(line.ItemCode)
				line.ItemName = strings.TrimSpace(line.ItemName)
				line.UnitCode = strings.TrimSpace(line.UnitCode)
				line.Qty = strings.TrimSpace(line.Qty)
				line.Price = strings.TrimSpace(line.Price)
				line.Discount = strings.TrimSpace(line.Discount)
				line.WhCode = strings.TrimSpace(line.WhCode)
				line.ShelfCode = strings.TrimSpace(line.ShelfCode)
				if line.ItemCode == "" || line.Qty == "" || line.Price == "" {
					continue
				}
				added = append(added, line)
			}
			edit.AddedLines = added

			if len(edit.RemoveItemCodes) == 0 && len(edit.AddedLines) == 0 {
				continue
			}
			if idx, ok := seenEdit[edit.DocNo]; ok {
				// Merge into earlier entry (last-write wins per field).
				prev := normalized[idx]
				prev.RemoveItemCodes = append(prev.RemoveItemCodes, edit.RemoveItemCodes...)
				prev.AddedLines = append(prev.AddedLines, edit.AddedLines...)
				normalized[idx] = prev
				continue
			}
			seenEdit[edit.DocNo] = len(normalized)
			normalized = append(normalized, edit)
		}
		req.PerDocEdits = normalized
		// When PerDocEdits is in use, the global RemoveItemCodes is ignored to
		// avoid mixing semantics — frontend supplies removes per doc.
		if len(normalized) > 0 {
			req.RemoveItemCodes = nil
		}
	}
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

func (r *DocumentRepository) validateBulkChangeBase(ctx context.Context, q documentQuerier, req model.BulkDocumentChangeRequest) error {
	// Bulk-edit semantics: every header field is optional. Sentinels mean
	// "keep each bill's existing value":
	//   DocFormatCode "", CustomerCode "", Remark ""  → keep
	//   InquiryType 0                                  → keep (valid 1..4)
	//   VatType -1                                     → keep (valid 0..3)
	// At least one field (or RemoveItemCodes) must carry a change.
	hasChange := req.DocFormatCode != "" ||
		req.CustomerCode != "" ||
		req.InquiryType != 0 ||
		req.VatType != -1 ||
		req.Remark != "" ||
		len(req.RemoveItemCodes) > 0
	if !hasChange {
		return fmt.Errorf("no changes specified")
	}

	if req.InquiryType != 0 && (req.InquiryType < 1 || req.InquiryType > 4) {
		return fmt.Errorf("sale type is invalid")
	}
	if req.VatType != -1 && (req.VatType < 0 || req.VatType > 3) {
		return fmt.Errorf("tax type is invalid")
	}

	var exists bool
	if req.DocFormatCode != "" {
		if err := q.QueryRow(ctx, `
			select exists(select 1 from erp_doc_format where screen_code = 'SI' and code = $1)
		`, req.DocFormatCode).Scan(&exists); err != nil {
			return fmt.Errorf("validate doc format: %w", err)
		}
		if !exists {
			return fmt.Errorf("doc format not found")
		}
	}
	if req.CustomerCode != "" {
		if err := q.QueryRow(ctx, `
			select exists(select 1 from ar_customer where code = $1)
		`, req.CustomerCode).Scan(&exists); err != nil {
			return fmt.Errorf("validate customer: %w", err)
		}
		if !exists {
			return fmt.Errorf("customer not found")
		}
	}
	return nil
}

func (r *DocumentRepository) summariesByDocNo(ctx context.Context, q documentQuerier, docNos []string) (map[string]model.DocumentSummary, error) {
	items := make(map[string]model.DocumentSummary, len(docNos))
	if len(docNos) == 0 {
		return items, nil
	}
	rows, err := q.Query(ctx, summarySQL(`
		where trans_flag = $1 and doc_no = any($2)
	`), salesTransFlag, docNos)
	if err != nil {
		return nil, fmt.Errorf("query document summaries: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		item, err := r.scanSummary(rows)
		if err != nil {
			return nil, err
		}
		items[item.DocNo] = item
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate document summaries: %w", err)
	}
	return items, nil
}

func (r *DocumentRepository) existingDocumentNumberSet(ctx context.Context, q documentQuerier, docNos []string) (map[string]struct{}, error) {
	items := make(map[string]struct{}, len(docNos))
	if len(docNos) == 0 {
		return items, nil
	}
	rows, err := q.Query(ctx, `
		select doc_no
		from ic_trans
		where trans_flag = $1
			and doc_no = any($2)
	`, salesTransFlag, docNos)
	if err != nil {
		return nil, fmt.Errorf("validate new document numbers: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var docNo string
		if err := rows.Scan(&docNo); err != nil {
			return nil, fmt.Errorf("scan existing document number: %w", err)
		}
		items[docNo] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing document numbers: %w", err)
	}
	return items, nil
}

func (r *DocumentRepository) existingRemoveCodesByDocNo(ctx context.Context, q documentQuerier, docNos []string, requested []string) (map[string][]string, error) {
	items := make(map[string][]string, len(docNos))
	if len(docNos) == 0 || len(requested) == 0 {
		return items, nil
	}
	rows, err := q.Query(ctx, `
		select distinct doc_no, item_code
		from ic_trans_detail
		where trans_flag = $1
			and doc_no = any($2)
			and item_code = any($3)
		order by doc_no, item_code
	`, salesTransFlag, docNos, requested)
	if err != nil {
		return nil, fmt.Errorf("check remove items: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var docNo, itemCode string
		if err := rows.Scan(&docNo, &itemCode); err != nil {
			return nil, fmt.Errorf("scan remove item hit: %w", err)
		}
		items[docNo] = append(items[docNo], itemCode)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate remove item hits: %w", err)
	}
	return items, nil
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
			return duplicateDocumentNumberError{docNo: req.NewDocNo}
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
	totals, err := r.calculateTotals(ctx, q, before.DocNo, req.RemoveItemCodes, req.VatType)
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

func buildChangePreviewFromFetched(before model.DocumentSummary, req model.DocumentChangeRequest, totals model.DocumentTotals, removed []model.DocumentDetailLine, remaining []model.DocumentDetailLine) model.DocumentChangePreview {
	after := before
	after.DocNo = req.NewDocNo
	// Sentinels carry "keep before". Only overwrite when the caller supplied a
	// real value, so each bill retains its own header field where the user did
	// not specify a change.
	if req.DocFormatCode != "" {
		after.DocFormatCode = req.DocFormatCode
	}
	if req.CustomerCode != "" {
		after.CustomerCode = req.CustomerCode
	}
	if req.InquiryType != 0 {
		after.InquiryType = req.InquiryType
	}
	if req.VatType != -1 {
		after.VatType = req.VatType
	}
	if req.Remark != "" {
		after.Remark = req.Remark
	}
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
		AddedLines:      req.AddedLines,
	}
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

func (r *DocumentRepository) scanSummary(row interface{ Scan(...any) error }) (model.DocumentSummary, error) {
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

// vatTotalsSelectSQL produces (total_value, total_before_vat, total_vat_value, total_discount, total_amount, line_count)
// by recomputing each detail row's VAT split based on the supplied vat_type.
// Conventions:
//   - sum_amount is treated as the line subtotal (qty*price - discount) in whichever currency was stored.
//   - vat_type 0 = no VAT, 1 = price INCLUDES VAT, 2 = price EXCLUDES VAT (VAT added on top).
//   - vat_rate falls back to 7 when stored as 0/NULL.
const vatTotalsSelectSQL = `
	coalesce(sum(sum_amount), 0)::text,
	coalesce(sum(case
		when $4::integer = 0 then sum_amount
		when $4::integer = 1 then round(sum_amount * 100.0 / (100.0 + 7), 2)
		when $4::integer = 2 then sum_amount
		else sum_amount_exclude_vat
	end), 0)::text,
	coalesce(sum(case
		when $4::integer = 0 then 0::numeric
		when $4::integer = 1 then sum_amount - round(sum_amount * 100.0 / (100.0 + 7), 2)
		when $4::integer = 2 then round(sum_amount * 7 / 100.0, 2)
		else total_vat_value
	end), 0)::text,
	0::numeric::text,
	coalesce(sum(case
		when $4::integer = 0 then sum_amount
		when $4::integer = 1 then sum_amount
		when $4::integer = 2 then sum_amount + round(sum_amount * 7 / 100.0, 2)
		else sum_amount + total_vat_value
	end), 0)::text,
	count(*)::bigint
`

func (r *DocumentRepository) calculateTotals(ctx context.Context, q documentQuerier, docNo string, excludeItemCodes []string, vatType int16) (model.DocumentTotals, error) {
	var totals model.DocumentTotals
	if err := q.QueryRow(ctx, `
		select
		`+vatTotalsSelectSQL+`
		from ic_trans_detail
		where trans_flag = $1
			and doc_no = $2
			and (coalesce(cardinality($3::text[]), 0) = 0 or item_code <> all($3::text[]))
	`, salesTransFlag, docNo, excludeItemCodes, int32(vatType)).Scan(
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

func (r *DocumentRepository) calculateTotalsByDocNo(ctx context.Context, q documentQuerier, docNos []string, excludeItemCodes []string, vatType int16) (map[string]model.DocumentTotals, error) {
	items := make(map[string]model.DocumentTotals, len(docNos))
	if len(docNos) == 0 {
		return items, nil
	}
	rows, err := q.Query(ctx, `
		select
			doc_no,
		`+vatTotalsSelectSQL+`
		from ic_trans_detail
		where trans_flag = $1
			and doc_no = any($2)
			and (coalesce(cardinality($3::text[]), 0) = 0 or item_code <> all($3::text[]))
		group by doc_no
	`, salesTransFlag, docNos, excludeItemCodes, int32(vatType))
	if err != nil {
		return nil, fmt.Errorf("calculate bulk document totals: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var docNo string
		var totals model.DocumentTotals
		if err := rows.Scan(
			&docNo,
			&totals.TotalValue,
			&totals.TotalBeforeVat,
			&totals.TotalVatValue,
			&totals.TotalDiscount,
			&totals.TotalAmount,
			&totals.LineCount,
		); err != nil {
			return nil, fmt.Errorf("scan bulk document totals: %w", err)
		}
		items[docNo] = totals
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate bulk document totals: %w", err)
	}
	return items, nil
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

// insertAddedDetailLines appends user-supplied new lines to a document inside
// the apply transaction. Strategy: clone an existing detail row of the same doc
// (so all NOT-NULL / business fields like doc_date, doc_time, calc_flag,
// stand_value, etc. are inherited), then UPDATE only the line-specific fields.
// Subsequent UPDATE statements in ApplyChange recompute vat/totals.
func (r *DocumentRepository) insertAddedDetailLines(ctx context.Context, q documentExecutor, docNo, custCode string, inquiryType, vatType int16, lines []model.NewLineInput) error {
	if len(lines) == 0 {
		return nil
	}
	var maxLine int32
	if err := q.QueryRow(ctx, `
		select coalesce(max(line_number), 0)
		from ic_trans_detail
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo).Scan(&maxLine); err != nil {
		return fmt.Errorf("query max line_number: %w", err)
	}
	var templateRoworder int64
	var templateWh, templateShelf string
	if err := q.QueryRow(ctx, `
		select roworder, coalesce(wh_code, ''), coalesce(shelf_code, '')
		from ic_trans_detail
		where trans_flag = $1 and doc_no = $2
		order by line_number asc
		limit 1
	`, salesTransFlag, docNo).Scan(&templateRoworder, &templateWh, &templateShelf); err != nil {
		return fmt.Errorf("query template detail line: %w", err)
	}

	// Build a column list of ic_trans_detail minus the PK (roworder), which
	// auto-increments. The list is used in both INSERT and SELECT so cloning
	// remains tolerant to upstream schema additions.
	colRows, err := q.Query(ctx, `
		select column_name
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'ic_trans_detail'
			and column_name <> 'roworder'
		order by ordinal_position
	`)
	if err != nil {
		return fmt.Errorf("query ic_trans_detail columns: %w", err)
	}
	var cols []string
	for colRows.Next() {
		var name string
		if err := colRows.Scan(&name); err != nil {
			colRows.Close()
			return fmt.Errorf("scan ic_trans_detail column: %w", err)
		}
		cols = append(cols, name)
	}
	colRows.Close()
	if err := colRows.Err(); err != nil {
		return fmt.Errorf("iterate ic_trans_detail columns: %w", err)
	}
	if len(cols) == 0 {
		return fmt.Errorf("ic_trans_detail has no clonable columns")
	}
	colList := strings.Join(cols, ", ")
	cloneSQL := fmt.Sprintf(
		`insert into ic_trans_detail (%s) select %s from ic_trans_detail where roworder = $1 returning roworder`,
		colList, colList,
	)

	for i, line := range lines {
		qty, err := strconv.ParseFloat(strings.TrimSpace(line.Qty), 64)
		if err != nil || qty <= 0 {
			return fmt.Errorf("invalid qty for item %s", line.ItemCode)
		}
		price, err := strconv.ParseFloat(strings.TrimSpace(line.Price), 64)
		if err != nil || price < 0 {
			return fmt.Errorf("invalid price for item %s", line.ItemCode)
		}
		disc := 0.0
		if line.Discount != "" {
			if d, err := strconv.ParseFloat(strings.TrimSpace(line.Discount), 64); err == nil {
				disc = d
			}
		}
		sumAmount := qty*price - disc
		lineNumber := maxLine + int32(i) + 1

		wh := strings.TrimSpace(line.WhCode)
		if wh == "" {
			wh = templateWh
		}
		shelf := strings.TrimSpace(line.ShelfCode)
		if shelf == "" {
			shelf = templateShelf
		}

		var newRoworder int64
		if err := q.QueryRow(ctx, cloneSQL, templateRoworder).Scan(&newRoworder); err != nil {
			return fmt.Errorf("clone detail line for %s: %w", line.ItemCode, err)
		}

		if _, err := q.Exec(ctx, `
			update ic_trans_detail set
				line_number = $2,
				cust_code = $3,
				inquiry_type = $4,
				item_code = $5,
				item_name = $6,
				unit_code = $7,
				barcode = '',
				qty = $8::numeric,
				price = $9::numeric,
				discount = $10,
				discount_amount = $11::numeric,
				sum_amount = $12::numeric,
				sum_amount_exclude_vat = $12::numeric,
				total_vat_value = 0::numeric,
				price_exclude_vat = 0::numeric,
				sum_of_cost = 0::numeric,
				sum_of_cost_1 = 0::numeric,
				sum_of_cost_fix = 0::numeric,
				average_cost = 0::numeric,
				average_cost_1 = 0::numeric,
				wh_code = $13,
				shelf_code = $14,
				remark = '',
				ref_doc_no = '',
				ref_doc_date = null,
				ref_line_number = 0,
				ref_cust_code = '',
				ref_row = 0,
				ref_guid = '',
				set_ref_line = '',
				set_ref_price = 0,
				set_ref_qty = 0,
				vat_type = $15::integer,
				tax_type = $15::smallint,
				create_date_time_now = now()
			where roworder = $1
		`,
			newRoworder, lineNumber, custCode, inquiryType,
			line.ItemCode, line.ItemName, line.UnitCode,
			qty, price, line.Discount, disc, sumAmount,
			wh, shelf, int32(vatType),
		); err != nil {
			return fmt.Errorf("update new detail line %s: %w", line.ItemCode, err)
		}
	}
	return nil
}

func (r *DocumentRepository) detailLinesByDocNo(ctx context.Context, q documentQuerier, docNos []string) (map[string][]model.DocumentDetailLine, error) {
	items := make(map[string][]model.DocumentDetailLine, len(docNos))
	if len(docNos) == 0 {
		return items, nil
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
		where trans_flag = $1
			and doc_no = any($2)
		order by doc_no, line_number, roworder
	`, salesTransFlag, docNos)
	if err != nil {
		return nil, fmt.Errorf("query bulk document detail lines: %w", err)
	}
	defer rows.Close()

	lines, err := scanDetailLines(rows)
	if err != nil {
		return nil, err
	}
	for _, line := range lines {
		items[line.DocNo] = append(items[line.DocNo], line)
	}
	return items, nil
}

func splitPreviewDetailLines(lines []model.DocumentDetailLine, removeCodes []string) ([]model.DocumentDetailLine, []model.DocumentDetailLine) {
	removed := make([]model.DocumentDetailLine, 0)
	remaining := make([]model.DocumentDetailLine, 0, len(lines))
	if len(removeCodes) == 0 {
		remaining = append(remaining, lines...)
		return removed, remaining
	}
	removeSet := make(map[string]struct{}, len(removeCodes))
	for _, code := range removeCodes {
		removeSet[code] = struct{}{}
	}
	for _, line := range lines {
		if _, shouldRemove := removeSet[line.ItemCode]; shouldRemove {
			removed = append(removed, line)
			continue
		}
		remaining = append(remaining, line)
	}
	return removed, remaining
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

// computeTotalsFromLines mirrors vatTotalsSelectSQL on the Go side so previews
// can include user-added lines (which are not yet persisted) in the totals.
// Decimal strings are parsed leniently; unparseable values count as zero.
func computeTotalsFromLines(remaining []model.DocumentDetailLine, added []model.NewLineInput, vatType int16) model.DocumentTotals {
	var totalValue, totalBeforeVat, totalVatValue, totalAmount float64
	lineCount := int64(0)

	round2 := func(v float64) float64 {
		// Match Postgres ROUND(numeric, 2) behaviour closely enough for previews.
		if v >= 0 {
			return float64(int64(v*100+0.5)) / 100.0
		}
		return -float64(int64(-v*100+0.5)) / 100.0
	}
	parse := func(s string) float64 {
		s = strings.TrimSpace(s)
		if s == "" {
			return 0
		}
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0
		}
		return v
	}
	apply := func(sum, storedBefore, storedVat float64, useStored bool) {
		lineCount++
		totalValue += sum
		switch vatType {
		case 0:
			totalBeforeVat += sum
			totalAmount += sum
		case 1:
			bv := round2(sum * 100.0 / 107.0)
			totalBeforeVat += bv
			totalVatValue += sum - bv
			totalAmount += sum
		case 2:
			totalBeforeVat += sum
			vat := round2(sum * 7.0 / 100.0)
			totalVatValue += vat
			totalAmount += sum + vat
		default:
			if useStored {
				totalBeforeVat += storedBefore
				totalVatValue += storedVat
				totalAmount += sum + storedVat
			} else {
				totalBeforeVat += sum
				totalAmount += sum
			}
		}
	}

	for _, line := range remaining {
		sum := parse(line.SumAmount)
		bv := parse(line.SumAmountExcludeVat)
		vat := parse(line.TotalVatValue)
		apply(sum, bv, vat, true)
	}
	for _, line := range added {
		qty := parse(line.Qty)
		price := parse(line.Price)
		disc := parse(line.Discount)
		sum := qty*price - disc
		apply(sum, 0, 0, false)
	}

	fmt2 := func(v float64) string {
		return strconv.FormatFloat(round2(v), 'f', 2, 64)
	}
	return model.DocumentTotals{
		TotalValue:     fmt2(totalValue),
		TotalBeforeVat: fmt2(totalBeforeVat),
		TotalVatValue:  fmt2(totalVatValue),
		TotalDiscount:  "0",
		TotalAmount:    fmt2(totalAmount),
		LineCount:      lineCount,
	}
}

func zeroDocumentTotals() model.DocumentTotals {
	return model.DocumentTotals{
		TotalValue:     "0",
		TotalBeforeVat: "0",
		TotalVatValue:  "0",
		TotalDiscount:  "0",
		TotalAmount:    "0",
	}
}

func ensureDocumentHasLines(totals model.DocumentTotals) error {
	if totals.LineCount == 0 {
		return fmt.Errorf("document must keep at least one detail line")
	}
	return nil
}

func normalizeDocumentWriteError(err error, newDocNo string) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return duplicateDocumentNumberError{docNo: newDocNo, err: err}
	}
	if strings.Contains(err.Error(), "duplicate key value") && strings.Contains(err.Error(), "doc_no") {
		return duplicateDocumentNumberError{docNo: newDocNo, err: err}
	}
	return nil
}

func isDuplicateDocumentNumberError(err error) bool {
	var duplicateErr duplicateDocumentNumberError
	return errors.As(err, &duplicateErr)
}

func previewNextDocNo(formatCode, format, latest string, now time.Time) string {
	if format == "" {
		return ""
	}
	formatCode = strings.TrimSpace(formatCode)
	// Substitute date tokens first. SML uses both forms:
	//   - `@YYMM####`  (combined token)
	//   - `@-YYMM####` (where `@` = doc format code prefix, and `YY`/`MM` are bare placeholders)
	// Replace longest first to avoid `YYYY` being consumed by `YY`.
	prefix := strings.ReplaceAll(format, "@YYYYMM", now.Format("200601"))
	prefix = strings.ReplaceAll(prefix, "@YYMM", now.Format("0601"))
	prefix = strings.ReplaceAll(prefix, "@YYYY", now.Format("2006"))
	prefix = strings.ReplaceAll(prefix, "@YY", now.Format("06"))
	prefix = strings.ReplaceAll(prefix, "@MM", now.Format("01"))
	prefix = strings.ReplaceAll(prefix, "YYYYMM", now.Format("200601"))
	prefix = strings.ReplaceAll(prefix, "YYMM", now.Format("0601"))
	prefix = strings.ReplaceAll(prefix, "YYYY", now.Format("2006"))
	prefix = strings.ReplaceAll(prefix, "YY", now.Format("06"))
	prefix = strings.ReplaceAll(prefix, "MM", now.Format("01"))
	// `@` (after date tokens consumed) represents the doc format code.
	if formatCode != "" {
		prefix = strings.ReplaceAll(prefix, "@", formatCode)
	}
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
