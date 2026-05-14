package repository

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/model"
)

const integrationDatabaseURLEnv = "NSI_INTEGRATION_DATABASE_URL"
const allowSMLTestDatabaseEnv = "NSI_ALLOW_SML1_2026_INTEGRATION"

func TestDocumentRepositoryApplyChangeIntegration(t *testing.T) {
	rawURL := os.Getenv(integrationDatabaseURLEnv)
	if rawURL == "" {
		t.Skipf("set %s to a cloned/test PostgreSQL database URL to run integration tests", integrationDatabaseURLEnv)
	}
	if strings.Contains(rawURL, "sml1_2026") && os.Getenv(allowSMLTestDatabaseEnv) != "1" {
		t.Fatalf("%s contains sml1_2026; set %s=1 only when this database is a confirmed test database", integrationDatabaseURLEnv, allowSMLTestDatabaseEnv)
	}

	ctx := context.Background()
	schema := fmt.Sprintf("nsi_it_%d", time.Now().UnixNano())
	pool := openIntegrationPool(t, ctx, rawURL, schema)
	defer pool.Close()
	defer func() {
		_, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`)
	}()

	createIntegrationSchema(t, ctx, pool, schema)
	seedIntegrationData(t, ctx, pool)

	repo := NewDocumentRepository(pool, config.Config{
		DBQueryTimeout: 30 * time.Second,
	})
	nextDocNo, latestDocNo, err := repo.NextDocNo(ctx, "INV")
	if err != nil {
		t.Fatalf("NextDocNo returned error: %v", err)
	}
	if latestDocNo != "BF-INV26050009" || nextDocNo != "INV26050010" {
		t.Fatalf("NextDocNo(INV) = latest %s next %s, want latest BF-INV26050009 next INV26050010", latestDocNo, nextDocNo)
	}
	nextDocNo, latestDocNo, err = repo.NextDocNo(ctx, "INV2")
	if err != nil {
		t.Fatalf("NextDocNo INV2 returned error: %v", err)
	}
	if latestDocNo != "INV2-2605007" || nextDocNo != "INV2-2605008" {
		t.Fatalf("NextDocNo(INV2) = latest %s next %s, want latest INV2-2605007 next INV2-2605008", latestDocNo, nextDocNo)
	}

	req := model.DocumentChangeRequest{
		DocFormatCode:   "INV",
		NewDocNo:        "DOC009",
		CustomerCode:    "AR00004",
		InquiryType:     3,
		VatType:         1,
		Remark:          "UPDATED BY INTEGRATION TEST",
		RemoveItemCodes: []string{"ITEM001"},
	}

	preview, err := repo.PreviewChange(ctx, "DOC001", req)
	if err != nil {
		t.Fatalf("PreviewChange returned error: %v", err)
	}
	if preview.After.DocNo != "DOC009" {
		t.Fatalf("preview new doc no = %s, want DOC009", preview.After.DocNo)
	}
	if preview.Totals.LineCount != 1 || preview.Totals.TotalAmount != "107.00" {
		t.Fatalf("unexpected preview totals: %#v", preview.Totals)
	}

	applied, err := repo.ApplyChange(ctx, "DOC001", req)
	if err != nil {
		t.Fatalf("ApplyChange returned error: %v", err)
	}
	if applied.After.DocNo != "DOC009" || applied.After.CustomerCode != "AR00004" || applied.After.InquiryType != 3 || applied.After.VatType != 1 {
		t.Fatalf("header was not updated: %#v", applied.After)
	}

	var detailCount int
	var appliedDocFormatCode string
	var totalAmount string
	if err := pool.QueryRow(ctx, `
		select doc_format_code
		from ic_trans
		where trans_flag = 44 and doc_no = 'DOC009'
	`).Scan(&appliedDocFormatCode); err != nil {
		t.Fatalf("read applied doc format code: %v", err)
	}
	if appliedDocFormatCode != "INV" {
		t.Fatalf("applied doc_format_code = %s, want INV", appliedDocFormatCode)
	}
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from ic_trans_detail
		where trans_flag = 44 and doc_no = 'DOC009'
	`).Scan(&detailCount); err != nil {
		t.Fatalf("read detail count: %v", err)
	}
	if detailCount != 1 {
		t.Fatalf("detail count = %d, want 1", detailCount)
	}
	if err := pool.QueryRow(ctx, `
		select total_amount::text
		from ic_trans
		where trans_flag = 44 and doc_no = 'DOC009'
	`).Scan(&totalAmount); err != nil {
		t.Fatalf("read total amount: %v", err)
	}
	if totalAmount != "107.00" {
		t.Fatalf("total_amount = %s, want 107.00", totalAmount)
	}

	beforeInvalid, err := repo.getSummary(ctx, pool, "DOC002")
	if err != nil {
		t.Fatalf("read DOC002 before invalid apply: %v", err)
	}
	_, err = repo.ApplyChange(ctx, "DOC002", model.DocumentChangeRequest{
		DocFormatCode:   "INV",
		NewDocNo:        "DOC010",
		CustomerCode:    "MISSING",
		InquiryType:     1,
		VatType:         0,
		Remark:          "SHOULD NOT COMMIT",
		RemoveItemCodes: []string{"ITEM003"},
	})
	if err == nil {
		t.Fatal("ApplyChange accepted invalid customer")
	}
	afterInvalid, err := repo.getSummary(ctx, pool, "DOC002")
	if err != nil {
		t.Fatalf("read DOC002 after invalid apply: %v", err)
	}
	if beforeInvalid.CustomerCode != afterInvalid.CustomerCode || beforeInvalid.Remark != afterInvalid.Remark || beforeInvalid.TotalAmount != afterInvalid.TotalAmount {
		t.Fatalf("invalid apply mutated DOC002: before=%#v after=%#v", beforeInvalid, afterInvalid)
	}
}

func openIntegrationPool(t *testing.T, ctx context.Context, rawURL, schema string) *pgxpool.Pool {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse %s: %v", integrationDatabaseURLEnv, err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()

	poolCfg, err := pgxpool.ParseConfig(parsed.String())
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}
	poolCfg.MaxConns = 1
	poolCfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		t.Fatalf("open integration pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping integration db: %v", err)
	}
	return pool
}

func createIntegrationSchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schema string) {
	t.Helper()
	statements := []string{
		`create schema ` + schema,
		`create table erp_doc_format (
			code varchar(25) not null,
			screen_code varchar(25) not null,
			name_1 varchar(120),
			format varchar(80),
			doc_running varchar(80),
			vat_type smallint
		)`,
		`create table ar_customer (
			code varchar(25) primary key,
			name_1 varchar(120)
		)`,
		`create table ic_trans (
			roworder integer,
			trans_flag smallint,
			doc_no varchar(80),
			doc_date date,
			doc_time varchar(20),
			tax_doc_no varchar(80),
			tax_doc_date date,
			doc_ref varchar(80),
			doc_ref_date date,
			inquiry_type smallint,
			vat_type smallint,
			cust_code varchar(25),
			contactor varchar(120),
			sale_code varchar(25),
			sale_group varchar(25),
			credit_day integer,
			credit_date date,
			send_day integer,
			send_date date,
			vat_rate numeric,
			total_value numeric,
			total_discount numeric,
			total_vat_value numeric,
			total_after_vat numeric,
			total_except_vat numeric,
			total_amount numeric,
			is_cancel smallint,
			status smallint,
			remark varchar(255),
			total_before_vat numeric,
			doc_format_code varchar(25)
		)`,
		`create table ic_trans_detail (
			roworder integer,
			trans_flag smallint,
			doc_no varchar(80),
			cust_code varchar(25),
			inquiry_type smallint,
			item_code varchar(80),
			item_name varchar(255),
			barcode varchar(80),
			wh_code varchar(25),
			shelf_code varchar(25),
			unit_code varchar(25),
			qty numeric,
			price numeric,
			discount varchar(80),
			sum_amount numeric,
			remark varchar(255),
			line_number integer,
			total_vat_value numeric,
			vat_type integer,
			sum_amount_exclude_vat numeric,
			tax_type smallint
		)`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("run schema statement %q: %v", statement, err)
		}
	}
}

func seedIntegrationData(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	statements := []string{
		`insert into erp_doc_format (code, screen_code, name_1, format, doc_running, vat_type)
		 values
		 ('INV', 'SI', 'Invoice', '@YYMM####', '', 0),
		 ('INV2', 'SI', 'Invoice 2', 'INV2-@YYMM###', '', 0)`,
		`insert into ar_customer (code, name_1)
		 values ('AR00004', 'Integration Customer')`,
		`insert into ic_trans (
			roworder, trans_flag, doc_no, doc_date, inquiry_type, vat_type, cust_code,
			total_value, total_discount, total_vat_value, total_amount, is_cancel, status,
			remark, total_before_vat, doc_format_code
		 ) values
		 (1, 44, 'DOC001', '2026-03-10', 1, 0, 'OLD', 300.00, 0, 21.00, 321.00, 0, 0, 'OLD', 300.00, 'SI'),
		 (2, 44, 'DOC002', '2026-03-10', 1, 0, 'OLD', 50.00, 0, 3.50, 53.50, 0, 0, 'ORIGINAL', 50.00, 'SI'),
		 (3, 44, 'BF-INV26050009', '2026-05-11', 1, 0, 'AR00004', 10.00, 0, 0, 10.00, 0, 0, 'INV LATEST', 10.00, 'INV'),
		 (4, 44, 'INV2-2605007', '2026-05-11', 1, 0, 'AR00004', 20.00, 0, 0, 20.00, 0, 0, 'INV2 LATEST', 20.00, 'INV2')`,
		`insert into ic_trans_detail (
			roworder, trans_flag, doc_no, cust_code, inquiry_type, item_code, item_name,
			unit_code, qty, price, discount, sum_amount, remark, line_number,
			total_vat_value, vat_type, sum_amount_exclude_vat, tax_type
		 ) values
		 (1, 44, 'DOC001', 'OLD', 1, 'ITEM001', 'Remove item', 'EA', 1, 200.00, '', 200.00, '', 1, 14.00, 0, 200.00, 0),
		 (2, 44, 'DOC001', 'OLD', 1, 'ITEM002', 'Keep item', 'EA', 1, 100.00, '', 100.00, '', 2, 7.00, 0, 100.00, 0),
		 (3, 44, 'DOC002', 'OLD', 1, 'ITEM003', 'Original item', 'EA', 1, 50.00, '', 50.00, '', 1, 3.50, 0, 50.00, 0)`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed integration data: %v", err)
		}
	}
}
