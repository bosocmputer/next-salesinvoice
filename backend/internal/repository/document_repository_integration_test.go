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
	nextDocNo, latestDocNo, err = repo.NextDocNo(ctx, "G1-CC", "G1-CC-2601DD-0001")
	if err != nil {
		t.Fatalf("NextDocNo G1-CC returned error: %v", err)
	}
	if latestDocNo != "" || nextDocNo != "G1-CC-260113-0001" {
		t.Fatalf("NextDocNo(G1-CC) = latest %s next %s, want latest empty next G1-CC-260113-0001", latestDocNo, nextDocNo)
	}

	ddReq := model.DocumentChangeRequest{
		DocFormatCode: "G1-CC",
		NewDocNo:      nextDocNo,
		CustomerCode:  "AR00004",
		InquiryType:   3,
		VatType:       0,
		Remark:        "UPDATED DD FORMAT",
	}
	if _, err := repo.ApplyChangeWithSnapshot(ctx, "G1-CC-2601DD-0001", ddReq, "tester"); err != nil {
		t.Fatalf("ApplyChangeWithSnapshot DD format returned error: %v", err)
	}
	var appliedDDDocNo, appliedDDTaxDocNo, appliedDDDocRef string
	if err := pool.QueryRow(ctx, `
		select doc_no, coalesce(tax_doc_no, ''), coalesce(doc_ref, '')
		from ic_trans
		where trans_flag = 44 and doc_no = $1
	`, nextDocNo).Scan(&appliedDDDocNo, &appliedDDTaxDocNo, &appliedDDDocRef); err != nil {
		t.Fatalf("read applied DD format document: %v", err)
	}
	if appliedDDDocNo != "G1-CC-260113-0001" || appliedDDTaxDocNo != "G1-CC-260113-0001" || appliedDDDocRef != "G1-CC-2601DD-0001" {
		t.Fatalf("unexpected DD format header doc_no=%s tax_doc_no=%s doc_ref=%s", appliedDDDocNo, appliedDDTaxDocNo, appliedDDDocRef)
	}
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_chq_list
		where doc_ref = 'G1-CC-2601DD-0001'
	`, 0, "old cb_chq_list row after 3881 apply")
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_chq_list
		where doc_ref = 'UNRELATED-DOC'
	`, 1, "unrelated cb_chq_list row after 3881 apply")
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_trans_detail
		where doc_no = 'G1-CC-260113-0001'
			and trans_flag = 44
			and doc_type = 3
			and (trans_number like '%3881%' or credit_card_type like '%3881%')
	`, 0, "3881 cb_trans_detail after apply")
	var ddCashAmount, ddCardAmount string
	if err := pool.QueryRow(ctx, `
		select cash_amount::text, card_amount::text
		from cb_trans
		where trans_flag = 44 and doc_no = 'G1-CC-260113-0001'
	`).Scan(&ddCashAmount, &ddCardAmount); err != nil {
		t.Fatalf("read DD payment header after apply: %v", err)
	}
	if ddCashAmount != "107.00" || ddCardAmount != "0.00" {
		t.Fatalf("unexpected DD payment header after apply: cash=%s card=%s", ddCashAmount, ddCardAmount)
	}
	if _, err := repo.RollbackDocument(ctx, model.RollbackDocumentRequest{DocNo: "G1-CC-260113-0001"}, "tester"); err != nil {
		t.Fatalf("RollbackDocument DD format returned error: %v", err)
	}
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_chq_list
		where doc_ref = 'G1-CC-2601DD-0001'
	`, 1, "old cb_chq_list row after rollback")
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_chq_list
		where doc_ref = 'UNRELATED-DOC'
	`, 1, "unrelated cb_chq_list row after rollback")
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_trans_detail
		where doc_no = 'G1-CC-2601DD-0001'
			and trans_flag = 44
			and doc_type = 3
			and (trans_number like '%3881%' or credit_card_type like '%3881%')
	`, 1, "3881 cb_trans_detail after rollback")

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
	if preview.Totals.LineCount != 1 || preview.Totals.TotalAmount != "100.00" {
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
	var detailVatType int
	var detailTaxType int
	if err := pool.QueryRow(ctx, `
		select vat_type, tax_type
		from ic_trans_detail
		where trans_flag = 44 and doc_no = 'DOC009' and item_code = 'ITEM002'
	`).Scan(&detailVatType, &detailTaxType); err != nil {
		t.Fatalf("read applied detail vat/tax type: %v", err)
	}
	if detailVatType != 0 || detailTaxType != 0 {
		t.Fatalf("detail vat/tax type changed: vat_type=%d tax_type=%d, want original 0/0", detailVatType, detailTaxType)
	}
	if err := pool.QueryRow(ctx, `
		select total_amount::text
		from ic_trans
		where trans_flag = 44 and doc_no = 'DOC009'
	`).Scan(&totalAmount); err != nil {
		t.Fatalf("read total amount: %v", err)
	}
	if totalAmount != "100.00" {
		t.Fatalf("total_amount = %s, want 100.00", totalAmount)
	}

	var vatDocNo, vatArCode, vatTaxNo, vatBase, vatAmount string
	if err := pool.QueryRow(ctx, `
		select doc_no, ar_code, tax_no, base_caltax_amount::text, amount::text
		from gl_journal_vat_sale
		where trans_flag = 44 and doc_no = 'DOC009'
	`).Scan(&vatDocNo, &vatArCode, &vatTaxNo, &vatBase, &vatAmount); err != nil {
		t.Fatalf("read applied vat sale journal: %v", err)
	}
	if vatDocNo != "DOC009" || vatArCode != "AR00004" || vatTaxNo != "1234567890123" || vatBase != "93.46" || vatAmount != "6.54" {
		t.Fatalf("unexpected vat sale journal row: doc=%s ar=%s tax=%s base=%s vat=%s", vatDocNo, vatArCode, vatTaxNo, vatBase, vatAmount)
	}

	customers, err := repo.SearchCustomers(ctx, "เล่าคิม", 10)
	if err != nil {
		t.Fatalf("SearchCustomers substring returned error: %v", err)
	}
	if len(customers) != 1 || customers[0].Code != "TH-NRT-CD-00117" {
		t.Fatalf("substring customer search = %#v, want TH-NRT-CD-00117", customers)
	}

	lineReq := model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC-LINE-NEW",
		CustomerCode:  "AR00004",
		InquiryType:   1,
		VatType:       2,
		Remark:        "LINE EDITED",
		LineEdits: []model.LineEdit{{
			RowOrder: 6,
			Qty:      strPtr("9"),
			Price:    strPtr("3000"),
			Discount: strPtr("100,2%"),
		}},
	}
	if _, err := repo.ApplyChange(ctx, "DOC-LINE", lineReq); err != nil {
		t.Fatalf("ApplyChange line edit returned error: %v", err)
	}
	var lineQty, linePrice, lineDiscount, lineDiscountAmount, lineSum string
	var lineVatType, lineTaxType int
	if err := pool.QueryRow(ctx, `
		select qty::text, price::text, discount, discount_amount::text, sum_amount::text, vat_type, tax_type
		from ic_trans_detail
		where trans_flag = 44 and doc_no = 'DOC-LINE-NEW' and roworder = 6
	`).Scan(&lineQty, &linePrice, &lineDiscount, &lineDiscountAmount, &lineSum, &lineVatType, &lineTaxType); err != nil {
		t.Fatalf("read line edit detail: %v", err)
	}
	if lineQty != "9.00" || linePrice != "3000.00" || lineDiscount != "100,2%" || lineDiscountAmount != "1422.00" || lineSum != "25578.00" {
		t.Fatalf("unexpected line edit values qty=%s price=%s discount=%s discount_amount=%s sum=%s", lineQty, linePrice, lineDiscount, lineDiscountAmount, lineSum)
	}
	if lineVatType != 2 || lineTaxType != 0 {
		t.Fatalf("line edit changed detail vat/tax: vat_type=%d tax_type=%d", lineVatType, lineTaxType)
	}

	cashReq := model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC-CASH",
		CustomerCode:  "AR00004",
		InquiryType:   1,
		VatType:       0,
		Remark:        "CREDIT TO CASH",
	}
	if _, err := repo.ApplyChangeWithSnapshot(ctx, "DOC-CREDIT", cashReq, "tester"); err != nil {
		t.Fatalf("ApplyChangeWithSnapshot credit to cash returned error: %v", err)
	}
	var createdCash, createdTotal, createdDocDate, createdAP string
	if err := pool.QueryRow(ctx, `
		select cash_amount::text, total_amount_pay::text, doc_date::text, coalesce(ap_ar_code, '')
		from cb_trans
		where trans_flag = 44 and doc_no = 'DOC-CASH'
	`).Scan(&createdCash, &createdTotal, &createdDocDate, &createdAP); err != nil {
		t.Fatalf("read created cash payment: %v", err)
	}
	if createdCash != "107.00" || createdTotal != "107.00" || createdDocDate != "2026-03-11" || createdAP != "AR00004" {
		t.Fatalf("unexpected created cash payment cash=%s total=%s date=%s ap=%s", createdCash, createdTotal, createdDocDate, createdAP)
	}
	if _, err := repo.RollbackDocument(ctx, model.RollbackDocumentRequest{DocNo: "DOC-CASH"}, "tester"); err != nil {
		t.Fatalf("RollbackDocument credit to cash returned error: %v", err)
	}
	assertCount(t, ctx, pool, `
		select count(*)::int
		from cb_trans
		where trans_flag = 44 and doc_no = 'DOC-CASH'
	`, 0, "created cash payment after rollback")

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

func assertCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, want int, label string) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, query).Scan(&got); err != nil {
		t.Fatalf("count %s: %v", label, err)
	}
	if got != want {
		t.Fatalf("%s count = %d, want %d", label, got, want)
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
		`create table ar_customer_detail (
			ar_code varchar(25) primary key,
			tax_id varchar(30),
			branch_type smallint,
			branch_code varchar(25)
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
			discount_amount numeric,
			sum_amount numeric,
			remark varchar(255),
			line_number integer,
			total_vat_value numeric,
			vat_type integer,
			sum_amount_exclude_vat numeric,
			tax_type smallint
		)`,
		`create table gl_journal_vat_sale (
			roworder serial primary key,
			doc_date date not null,
			doc_no varchar(80) not null default '',
			book_code varchar(25) not null default '',
			line_number smallint,
			vat_number varchar(80) not null default '',
			tax_group varchar(25) default '',
			description varchar(255) default '',
			base_caltax_amount numeric default 0,
			tax_rate numeric default 0,
			amount numeric default 0,
			except_tax_amount numeric default 0,
			period_number smallint,
			is_add smallint default 0,
			vat_date date,
			trans_type smallint default 0,
			trans_flag smallint default 0,
			vat_effective_period smallint default 0,
			ar_code varchar(25) default '',
			ar_name varchar(120) default '',
			vat_calc smallint default 0,
			vat_effective_year smallint,
			branch_type smallint default 0,
			branch_code varchar(25) default '',
			tax_no varchar(30) default '',
			manual_add smallint default 0,
			is_doc_copy smallint default 0,
			create_date_time_now timestamp not null default now(),
			vat_type smallint default 0,
			ref_vat_no varchar(80) default '',
			ref_vat_date date,
			ref_doc_no varchar(80) default '',
			ref_doc_date date
		)`,
		`create table cb_trans (
			roworder integer,
			trans_flag smallint,
			doc_no varchar(80),
			doc_date date,
			doc_time varchar(20),
			ap_ar_code varchar(25),
			doc_format_code varchar(25),
			trans_type smallint,
			pay_type smallint,
			total_amount numeric,
			total_net_amount numeric,
			total_amount_pay numeric,
			pay_cash_amount numeric,
			money_change numeric,
			cash_amount numeric,
			chq_amount numeric,
			tranfer_amount numeric,
			card_amount numeric,
			wallet_amount numeric,
			coupon_amount numeric,
			point_amount numeric,
			deposit_amount numeric,
			advance_amount numeric,
			petty_cash_amount numeric
		)`,
		`create table cb_trans_detail (
			roworder integer,
			line_number integer,
			doc_no varchar(80),
			trans_flag smallint,
			doc_type smallint,
			trans_number varchar(80),
			bank_code varchar(25),
			credit_card_type varchar(80),
			chq_date date,
			amount numeric,
			sum_amount numeric
		)`,
		`create table cb_chq_list (
			roworder integer,
			doc_ref varchar(80),
			trans_number varchar(80),
			amount numeric
		)`,
		`create table nsi_reflow_batches (
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
		`create table nsi_reflow_batch_items (
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
		`create table nsi_document_snapshots (
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
		`create table nsi_document_locks (
			doc_no varchar(80) primary key,
			batch_id bigint references nsi_reflow_batches(id) on delete cascade,
			locked_by varchar(25) not null default '',
			status varchar(20) not null default 'processing',
			locked_at timestamp without time zone not null default now(),
			expires_at timestamp without time zone not null default now() + interval '30 minutes'
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
			 ('INV2', 'SI', 'Invoice 2', 'INV2-@YYMM###', '', 0),
			 ('G1-CC', 'SI', 'Credit Card', '@-YYMMDD-####', '', 0)`,
		`insert into ar_customer (code, name_1)
		 values
		 ('AR00004', 'Integration Customer'),
		 ('TH-NRT-CD-00117', 'หจก.เล่าคิมเฮงการยาง (สนญ.)')`,
		`insert into ar_customer_detail (ar_code, tax_id, branch_type, branch_code)
		 values ('AR00004', '1234567890123', 0, '')`,
		`insert into ic_trans (
			roworder, trans_flag, doc_no, doc_date, inquiry_type, vat_type, cust_code,
			total_value, total_discount, total_vat_value, total_amount, is_cancel, status,
			remark, total_before_vat, doc_format_code
		 ) values
			 (1, 44, 'DOC001', '2026-03-10', 1, 0, 'OLD', 300.00, 0, 21.00, 321.00, 0, 0, 'OLD', 300.00, 'SI'),
			 (2, 44, 'DOC002', '2026-03-10', 1, 0, 'OLD', 50.00, 0, 3.50, 53.50, 0, 0, 'ORIGINAL', 50.00, 'SI'),
			 (3, 44, 'BF-INV26050009', '2026-05-11', 1, 0, 'AR00004', 10.00, 0, 0, 10.00, 0, 0, 'INV LATEST', 10.00, 'INV'),
			 (4, 44, 'INV2-2605007', '2026-05-11', 1, 0, 'AR00004', 20.00, 0, 0, 20.00, 0, 0, 'INV2 LATEST', 20.00, 'INV2'),
			 (5, 44, 'G1-CC-2601DD-0001', '2026-01-13', 1, 0, 'OLD', 100.00, 0, 7.00, 107.00, 0, 0, 'DD SOURCE', 100.00, 'G1-CC'),
			 (6, 44, 'DOC-CREDIT', '2026-03-11', 0, 0, 'AR00004', 100.00, 0, 7.00, 107.00, 0, 0, 'CREDIT SOURCE', 100.00, 'INV'),
			 (7, 44, 'DOC-LINE', '2026-03-12', 1, 2, 'AR00004', 23040.00, 0, 0, 21697.20, 0, 0, 'LINE EDIT SOURCE', 0.00, 'INV')`,
		`insert into ic_trans_detail (
			roworder, trans_flag, doc_no, cust_code, inquiry_type, item_code, item_name,
			unit_code, qty, price, discount, sum_amount, remark, line_number,
			total_vat_value, vat_type, sum_amount_exclude_vat, tax_type
		 ) values
			 (1, 44, 'DOC001', 'OLD', 1, 'ITEM001', 'Remove item', 'EA', 1, 200.00, '', 200.00, '', 1, 14.00, 0, 200.00, 0),
			 (2, 44, 'DOC001', 'OLD', 1, 'ITEM002', 'Keep item', 'EA', 1, 100.00, '', 100.00, '', 2, 7.00, 0, 100.00, 0),
			 (3, 44, 'DOC002', 'OLD', 1, 'ITEM003', 'Original item', 'EA', 1, 50.00, '', 50.00, '', 1, 3.50, 0, 50.00, 0),
			 (4, 44, 'G1-CC-2601DD-0001', 'OLD', 1, 'ITEM013', 'DD source item', 'EA', 1, 100.00, '', 100.00, '', 1, 7.00, 0, 100.00, 0),
			 (5, 44, 'DOC-CREDIT', 'AR00004', 0, 'ITEM-CREDIT', 'Credit item', 'EA', 1, 100.00, '', 100.00, '', 1, 7.00, 0, 100.00, 0),
			 (6, 44, 'DOC-LINE', 'AR00004', 1, 'ITEM-LINE', 'Line edit item', 'EA', 9, 2560.00, '100,2%', 21697.20, '', 1, 0.00, 2, 0.00, 0)`,
		`insert into gl_journal_vat_sale (
			roworder, doc_date, doc_no, line_number, vat_number, base_caltax_amount, tax_rate,
			amount, except_tax_amount, period_number, vat_date, trans_type, trans_flag,
			vat_effective_period, ar_code, ar_name, vat_calc, vat_effective_year, branch_type, branch_code, tax_no
		 ) values
		 (1, '2026-03-10', 'DOC001', 0, 'DOC001', 300.00, 7.00, 21.00, 0, 3, '2026-03-10', 2, 44, 3, 'OLD', 'Old Customer', 1, 2026, 0, '', ''),
		 (2, '2026-01-13', 'G1-CC-2601DD-0001', 0, 'G1-CC-2601DD-0001', 100.00, 7.00, 7.00, 0, 1, '2026-01-13', 2, 44, 1, 'OLD', 'Old Customer', 1, 2026, 0, '', '')`,
		`insert into cb_trans (
			roworder, trans_flag, doc_no, trans_type, pay_type, total_amount, total_net_amount,
			total_amount_pay, pay_cash_amount, money_change, cash_amount, chq_amount,
			tranfer_amount, card_amount, wallet_amount, coupon_amount, point_amount,
			deposit_amount, advance_amount, petty_cash_amount
		 ) values
		 (1, 44, 'G1-CC-2601DD-0001', 2, 3, 107.00, 107.00, 107.00, 0.00, 0.00, 0.00, 0.00, 0.00, 107.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00)`,
		`insert into cb_trans_detail (
			roworder, line_number, doc_no, trans_flag, doc_type, trans_number, bank_code,
			credit_card_type, chq_date, amount, sum_amount
		 ) values
		 (1, 1, 'G1-CC-2601DD-0001', 44, 3, 'CARD-3881', 'BANK', '', '2026-01-13', 107.00, 107.00)`,
		`insert into cb_chq_list (roworder, doc_ref, trans_number, amount)
		 values
		 (1, 'G1-CC-2601DD-0001', 'CARD-3881', 107.00),
		 (2, 'UNRELATED-DOC', 'CARD-3881', 50.00)`,
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed integration data: %v", err)
		}
	}
}
