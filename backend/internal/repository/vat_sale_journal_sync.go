package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"next-salesinvoice/backend/internal/model"
)

type vatSaleCustomerInfo struct {
	Code       string
	Name       string
	TaxNo      string
	BranchType int16
	BranchCode string
}

func (r *DocumentRepository) syncVatSaleJournal(
	ctx context.Context,
	tx pgx.Tx,
	oldDocNo string,
	newDocNo string,
	before model.DocumentSummary,
	req model.DocumentChangeRequest,
	totals model.DocumentTotals,
) error {
	customer, err := r.vatSaleCustomerInfo(ctx, tx, req.CustomerCode, oldDocNo)
	if err != nil {
		return err
	}

	vatDate := taxDateOrDocDate(before.TaxDocDate, before.DocDate)
	period := int16(vatDate.Month())
	year := int16(vatDate.Year())
	baseAmount, vatAmount := vatSaleAmounts(req.VatType, totals)

	rows, err := tx.Query(ctx, `
		select roworder
		from gl_journal_vat_sale
		where trans_flag = $1 and doc_no = $2
		order by roworder
		for update
	`, salesTransFlag, oldDocNo)
	if err != nil {
		return fmt.Errorf("vat sale journal: lock rows: %w", err)
	}
	defer rows.Close()

	roworders := make([]int64, 0, 1)
	for rows.Next() {
		var roworder int64
		if err := rows.Scan(&roworder); err != nil {
			return fmt.Errorf("vat sale journal: scan locked row: %w", err)
		}
		roworders = append(roworders, roworder)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("vat sale journal: iterate locked rows: %w", err)
	}

	if len(roworders) == 0 {
		if err := r.insertVatSaleJournal(ctx, tx, newDocNo, before.DocDate, vatDate, period, year, customer, baseAmount, vatAmount); err != nil {
			return err
		}
		return nil
	}

	for i, roworder := range roworders {
		rowBase, rowVat := "0", "0"
		if i == 0 {
			rowBase, rowVat = baseAmount, vatAmount
		}
		if _, err := tx.Exec(ctx, `
			update gl_journal_vat_sale
			set doc_no = $2,
				doc_date = $3::date,
				vat_number = $2,
				vat_date = $4::date,
				base_caltax_amount = $5::numeric,
				tax_rate = 7::numeric,
				amount = $6::numeric,
				except_tax_amount = 0::numeric,
				period_number = $7,
				vat_effective_period = $7,
				vat_effective_year = $8,
				ar_code = $9,
				ar_name = $10,
				tax_no = $11,
				branch_type = $12,
				branch_code = $13
			where roworder = $1
		`, roworder, newDocNo, before.DocDate, vatDate, rowBase, rowVat, period, year, req.CustomerCode, customer.Name, customer.TaxNo, customer.BranchType, customer.BranchCode); err != nil {
			return fmt.Errorf("vat sale journal: update row %d: %w", roworder, err)
		}
	}
	return nil
}

func (r *DocumentRepository) insertVatSaleJournal(
	ctx context.Context,
	tx pgx.Tx,
	docNo string,
	docDate time.Time,
	vatDate time.Time,
	period int16,
	year int16,
	customer vatSaleCustomerInfo,
	baseAmount string,
	vatAmount string,
) error {
	if _, err := tx.Exec(ctx, `
		insert into gl_journal_vat_sale (
			doc_date, doc_no, book_code, line_number, vat_number, tax_group, description,
			base_caltax_amount, tax_rate, amount, except_tax_amount, period_number,
			is_add, vat_date, trans_type, trans_flag, vat_effective_period, ar_code, ar_name,
			vat_calc, vat_effective_year, branch_type, branch_code, tax_no, manual_add,
			is_doc_copy, vat_type
		)
		values (
			$1::date, $2, '', 0, $2, '', '',
			$3::numeric, 7::numeric, $4::numeric, 0::numeric, $5,
			0, $6::date, 2, $7, $5, $8, $9,
			1, $10, $11, $12, $13, 0,
			0, 0
		)
	`, docDate, docNo, baseAmount, vatAmount, period, vatDate, salesTransFlag, customer.Code, customer.Name, year, customer.BranchType, customer.BranchCode, customer.TaxNo); err != nil {
		return fmt.Errorf("vat sale journal: insert row: %w", err)
	}
	return nil
}

func (r *DocumentRepository) vatSaleCustomerInfo(ctx context.Context, q documentQuerier, customerCode string, fallbackDocNo string) (vatSaleCustomerInfo, error) {
	var info vatSaleCustomerInfo
	err := q.QueryRow(ctx, `
		select
			c.code,
			coalesce(c.name_1, ''),
			coalesce(d.tax_id, ''),
			coalesce(d.branch_type, 0)::smallint,
			coalesce(d.branch_code, '')
		from ar_customer c
		left join ar_customer_detail d on d.ar_code = c.code
		where c.code = $1
		limit 1
	`, customerCode).Scan(&info.Code, &info.Name, &info.TaxNo, &info.BranchType, &info.BranchCode)
	if err == nil {
		return info, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return vatSaleCustomerInfo{}, fmt.Errorf("vat sale journal: load customer tax info: %w", err)
	}

	err = q.QueryRow(ctx, `
		select
			coalesce(nullif(ar_code, ''), $3),
			coalesce(ar_name, ''),
			coalesce(tax_no, ''),
			coalesce(branch_type, 0)::smallint,
			coalesce(branch_code, '')
		from gl_journal_vat_sale
		where trans_flag = $1 and doc_no = $2
		order by roworder
		limit 1
	`, salesTransFlag, fallbackDocNo, customerCode).Scan(&info.Code, &info.Name, &info.TaxNo, &info.BranchType, &info.BranchCode)
	if err == nil {
		return info, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return vatSaleCustomerInfo{}, fmt.Errorf("vat sale journal: load existing customer tax info: %w", err)
	}

	return vatSaleCustomerInfo{Code: customerCode}, nil
}

func taxDateOrDocDate(taxDocDate string, docDate time.Time) time.Time {
	trimmed := strings.TrimSpace(taxDocDate)
	if trimmed == "" {
		return docDate
	}
	parsed, err := time.Parse("2006-01-02", trimmed)
	if err != nil {
		return docDate
	}
	return parsed
}

func vatSaleAmounts(vatType int16, totals model.DocumentTotals) (baseAmount string, vatAmount string) {
	if vatType == 0 || vatType == 1 {
		return nonEmptyMoney(totals.TotalBeforeVat), nonEmptyMoney(totals.TotalVatValue)
	}
	return "0", "0"
}

func nonEmptyMoney(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "0"
	}
	if _, err := strconv.ParseFloat(value, 64); err != nil {
		return "0"
	}
	return value
}

func (r *DocumentRepository) restoreVatSaleJournalFromSnapshot(
	ctx context.Context,
	tx pgx.Tx,
	currentDocNo, originalDocNo string,
	payload documentSnapshotPayload,
) error {
	if len(payload.VatSaleRaw) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `
		delete from gl_journal_vat_sale
		where trans_flag = $1 and doc_no in ($2, $3)
	`, salesTransFlag, currentDocNo, originalDocNo); err != nil {
		return fmt.Errorf("rollback vat sale journal clear: %w", err)
	}
	if len(payload.VatSaleRaw) > 0 && !isJSONNull(payload.VatSaleRaw) {
		if _, err := tx.Exec(ctx, `
			insert into gl_journal_vat_sale
			select * from jsonb_populate_recordset(null::gl_journal_vat_sale, $1::jsonb)
		`, string(payload.VatSaleRaw)); err != nil {
			return fmt.Errorf("rollback vat sale journal insert: %w", err)
		}
	}
	return nil
}

func marshalVatSaleSnapshot(ctx context.Context, q documentQuerier, docNo string) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := q.QueryRow(ctx, `
		select coalesce(jsonb_agg(to_jsonb(v) order by roworder), '[]'::jsonb)
		from gl_journal_vat_sale v
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo).Scan(&raw); err != nil {
		return nil, fmt.Errorf("snapshot vat sale journal: %w", err)
	}
	return raw, nil
}
