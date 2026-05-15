package repository

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"next-salesinvoice/backend/internal/model"
)

func TestNormalizeChangeRequestTrimsAndDeduplicates(t *testing.T) {
	req := normalizeChangeRequest(model.DocumentChangeRequest{
		DocFormatCode:   " INV ",
		NewDocNo:        " DOC001 ",
		CustomerCode:    " AR00004 ",
		Remark:          " TEST ",
		RemoveItemCodes: []string{" HENNA001 ", "", "HENNA001", "BF00002"},
	})

	if req.DocFormatCode != "INV" || req.NewDocNo != "DOC001" || req.CustomerCode != "AR00004" || req.Remark != "TEST" {
		t.Fatalf("request was not trimmed: %#v", req)
	}
	if !reflect.DeepEqual(req.RemoveItemCodes, []string{"HENNA001", "BF00002"}) {
		t.Fatalf("remove item codes were not normalized: %#v", req.RemoveItemCodes)
	}
}

func TestParseDocumentSearchSupportsDocRangesAndExactList(t *testing.T) {
	filter := parseDocumentSearch("INV26050025:INV26050030,INV26050040")

	if !filter.advanced {
		t.Fatalf("expected advanced document search")
	}
	if !reflect.DeepEqual(filter.exactDocNos, []string{"INV26050040"}) {
		t.Fatalf("exact docs = %#v, want INV26050040", filter.exactDocNos)
	}
	if !reflect.DeepEqual(filter.ranges, []documentSearchRange{{start: "INV26050025", end: "INV26050030"}}) {
		t.Fatalf("ranges = %#v", filter.ranges)
	}
}

func TestParseDocumentSearchSupportsWhitespaceListAndNormalizesCase(t *testing.T) {
	filter := parseDocumentSearch("inv26050025:inv26050030 INV26050040")

	if !filter.advanced {
		t.Fatalf("expected advanced document search")
	}
	if !reflect.DeepEqual(filter.exactDocNos, []string{"INV26050040"}) {
		t.Fatalf("exact docs = %#v, want INV26050040", filter.exactDocNos)
	}
	if !reflect.DeepEqual(filter.ranges, []documentSearchRange{{start: "INV26050025", end: "INV26050030"}}) {
		t.Fatalf("ranges = %#v", filter.ranges)
	}
}

func TestParseDocumentSearchSupportsCommaSeparatedExactDocuments(t *testing.T) {
	filter := parseDocumentSearch("INV26050025, INV26050026")

	if !filter.advanced {
		t.Fatalf("expected advanced document search")
	}
	if !reflect.DeepEqual(filter.exactDocNos, []string{"INV26050025", "INV26050026"}) {
		t.Fatalf("exact docs = %#v, want both comma-separated documents", filter.exactDocNos)
	}
	if len(filter.ranges) != 0 {
		t.Fatalf("ranges = %#v, want no ranges", filter.ranges)
	}
}

func TestParseDocumentSearchFallsBackToFuzzyForNormalAndInvalidQueries(t *testing.T) {
	tests := []string{
		"AR00001",
		"ทดสอบครั้งที่ 1",
		"INV26050025:30",
	}
	for _, query := range tests {
		t.Run(query, func(t *testing.T) {
			filter := parseDocumentSearch(query)
			if filter.advanced {
				t.Fatalf("expected fuzzy search fallback for %q, got %#v", query, filter)
			}
			if filter.search != query {
				t.Fatalf("search = %q, want %q", filter.search, query)
			}
		})
	}
}

func TestValidateChangeRequestRejectsUnknownRemoveItemForDocument(t *testing.T) {
	repo := &DocumentRepository{}
	err := repo.validateChangeRequest(context.Background(), fakeDocumentQuerier{
		docFormatExists: true,
		customerExists:  true,
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM001"},
		},
	}, "DOC001", model.DocumentChangeRequest{
		DocFormatCode:   "INV",
		NewDocNo:        "DOC001",
		CustomerCode:    "AR00004",
		InquiryType:     1,
		VatType:         0,
		RemoveItemCodes: []string{"MISSING"},
	})
	if err == nil || !strings.Contains(err.Error(), "remove item not found") {
		t.Fatalf("expected missing remove item error, got %v", err)
	}
}

func TestBuildChangePreviewRecalculatesTotalsAndSplitsLines(t *testing.T) {
	repo := &DocumentRepository{}
	docDate := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	before := model.DocumentSummary{
		DocNo:          "DOC001",
		DocDate:        docDate,
		CustomerCode:   "OLD",
		InquiryType:    1,
		VatType:        0,
		TotalValue:     "300.00",
		TotalBeforeVat: "300.00",
		TotalVatValue:  "21.00",
		TotalAmount:    "321.00",
		Remark:         "old",
		DocFormatCode:  "SI",
	}

	preview, err := repo.buildChangePreview(context.Background(), fakeDocumentQuerier{
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", LineNumber: 1, ItemCode: "ITEM001", ItemName: "remove", SumAmount: "200.00", SumAmountExcludeVat: "200.00", TotalVatValue: "14.00"},
			{DocNo: "DOC001", LineNumber: 2, ItemCode: "ITEM002", ItemName: "keep", SumAmount: "100.00", SumAmountExcludeVat: "100.00", TotalVatValue: "7.00"},
		},
	}, before, model.DocumentChangeRequest{
		DocFormatCode:   "INV",
		NewDocNo:        "DOC009",
		CustomerCode:    "AR00004",
		InquiryType:     3,
		VatType:         1,
		Remark:          "new",
		RemoveItemCodes: []string{"ITEM001"},
	})
	if err != nil {
		t.Fatalf("buildChangePreview returned error: %v", err)
	}

	if preview.After.DocNo != "DOC009" || preview.After.CustomerCode != "AR00004" || preview.After.InquiryType != 3 || preview.After.VatType != 1 || preview.After.Remark != "new" {
		t.Fatalf("after summary was not updated: %#v", preview.After)
	}
	if preview.Totals.LineCount != 1 || preview.Totals.TotalAmount != "107.00" || preview.Totals.TotalVatValue != "7.00" {
		t.Fatalf("unexpected totals: %#v", preview.Totals)
	}
	if len(preview.RemovedLines) != 1 || preview.RemovedLines[0].ItemCode != "ITEM001" {
		t.Fatalf("unexpected removed lines: %#v", preview.RemovedLines)
	}
	if len(preview.RemainingLines) != 1 || preview.RemainingLines[0].ItemCode != "ITEM002" {
		t.Fatalf("unexpected remaining lines: %#v", preview.RemainingLines)
	}
}

func TestSplitPreviewDetailLinesUsesBatchRemoveHits(t *testing.T) {
	lines := []model.DocumentDetailLine{
		{DocNo: "DOC001", LineNumber: 1, ItemCode: "KEEP"},
		{DocNo: "DOC001", LineNumber: 2, ItemCode: "REMOVE"},
		{DocNo: "DOC001", LineNumber: 3, ItemCode: "KEEP2"},
	}

	removed, remaining := splitPreviewDetailLines(lines, []string{"REMOVE"})
	if len(removed) != 1 || removed[0].ItemCode != "REMOVE" {
		t.Fatalf("unexpected removed lines: %#v", removed)
	}
	if len(remaining) != 2 || remaining[0].ItemCode != "KEEP" || remaining[1].ItemCode != "KEEP2" {
		t.Fatalf("unexpected remaining lines: %#v", remaining)
	}
}

func TestEnsureDocumentHasLinesBlocksEmptyDocument(t *testing.T) {
	err := ensureDocumentHasLines(model.DocumentTotals{LineCount: 0})
	if err == nil || !strings.Contains(err.Error(), "at least one detail line") {
		t.Fatalf("expected empty document guard error, got %v", err)
	}
	if err := ensureDocumentHasLines(model.DocumentTotals{LineCount: 1}); err != nil {
		t.Fatalf("expected non-empty document to pass, got %v", err)
	}
}

func TestNormalizeDocumentWriteErrorDetectsDuplicateDocNo(t *testing.T) {
	err := normalizeDocumentWriteError(&pgconn.PgError{
		Code:           "23505",
		ConstraintName: "ic_trans_ic_trans_pk_primary",
		Detail:         "Key (doc_no, trans_flag)=(BF-INV26050001, 44) already exists.",
	}, "BF-INV26050001")
	if err == nil {
		t.Fatal("expected duplicate document number error")
	}
	if !isDuplicateDocumentNumberError(err) {
		t.Fatalf("expected duplicate error type, got %T", err)
	}
	if !strings.Contains(err.Error(), "BF-INV26050001") || !strings.Contains(err.Error(), "ตรวจสอบใหม่") {
		t.Fatalf("unexpected user-facing message: %v", err)
	}
}

func TestPreviewNextDocNo(t *testing.T) {
	now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	if got := previewNextDocNo("INV", "@YYMM####", "26050009", now); got != "INV26050010" {
		t.Fatalf("expected next doc INV26050010, got %s", got)
	}
	if got := previewNextDocNo("INV", "@YYMM####", "BF-INV26050001", now); got != "INV26050002" {
		t.Fatalf("expected doc format code prefix, got %s", got)
	}
	if got := previewNextDocNo("INV2", "INV2-@YYMM###", "INV2-2605007", now); got != "INV2-2605008" {
		t.Fatalf("expected format prefix to be preserved, got %s", got)
	}
}

type fakeDocumentQuerier struct {
	docFormatExists bool
	customerExists  bool
	detailLines     []model.DocumentDetailLine
	queryErr        error
}

func (q fakeDocumentQuerier) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	if q.queryErr != nil {
		return nil, q.queryErr
	}
	switch {
	case strings.Contains(sql, "select unnest"):
		requested := toStringSlice(args[0])
		docNo := args[2].(string)
		existing := map[string]struct{}{}
		for _, line := range q.detailLines {
			if line.DocNo == docNo {
				existing[line.ItemCode] = struct{}{}
			}
		}
		rows := make([][]any, 0)
		for _, code := range requested {
			if _, ok := existing[code]; !ok {
				rows = append(rows, []any{code})
			}
		}
		return &fakeRows{rows: rows}, nil
	case strings.Contains(sql, "from ic_trans_detail"):
		docNo := args[1].(string)
		codes := map[string]struct{}{}
		for _, code := range toStringSlice(args[2]) {
			codes[code] = struct{}{}
		}
		include := strings.Contains(sql, "item_code = any")
		rows := make([][]any, 0)
		for _, line := range q.detailLines {
			if line.DocNo != docNo {
				continue
			}
			_, selected := codes[line.ItemCode]
			if include != selected {
				continue
			}
			rows = append(rows, detailRow(line))
		}
		return &fakeRows{rows: rows}, nil
	default:
		return nil, errors.New("unexpected query")
	}
}

func (q fakeDocumentQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	switch {
	case strings.Contains(sql, "erp_doc_format"):
		return fakeRow{values: []any{q.docFormatExists}}
	case strings.Contains(sql, "ar_customer"):
		return fakeRow{values: []any{q.customerExists}}
	case strings.Contains(sql, "coalesce(sum(sum_amount)"):
		exclude := map[string]struct{}{}
		for _, code := range toStringSlice(args[2]) {
			exclude[code] = struct{}{}
		}
		var value, beforeVAT, vat float64
		var count int64
		for _, line := range q.detailLines {
			if line.DocNo != args[1].(string) {
				continue
			}
			if _, ok := exclude[line.ItemCode]; ok {
				continue
			}
			value += mustMoney(line.SumAmount)
			beforeVAT += mustMoney(line.SumAmountExcludeVat)
			vat += mustMoney(line.TotalVatValue)
			count++
		}
		return fakeRow{values: []any{
			formatTestMoney(value),
			formatTestMoney(beforeVAT),
			formatTestMoney(vat),
			"0",
			formatTestMoney(value + vat),
			count,
		}}
	case strings.Contains(sql, "from ic_trans"):
		docNo := args[1].(string)
		exists := false
		for _, line := range q.detailLines {
			if line.DocNo == docNo {
				exists = true
				break
			}
		}
		return fakeRow{values: []any{exists}}
	default:
		return fakeRow{err: errors.New("unexpected query row")}
	}
}

type fakeRows struct {
	rows   [][]any
	index  int
	closed bool
	err    error
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.err }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error) {
	if r.index == 0 || r.index > len(r.rows) {
		return nil, errors.New("no current row")
	}
	return r.rows[r.index-1], nil
}
func (r *fakeRows) RawValues() [][]byte { return nil }
func (r *fakeRows) Conn() *pgx.Conn     { return nil }
func (r *fakeRows) Next() bool {
	if r.index >= len(r.rows) {
		r.closed = true
		return false
	}
	r.index++
	return true
}
func (r *fakeRows) Scan(dest ...any) error {
	if r.index == 0 || r.index > len(r.rows) {
		return errors.New("no current row")
	}
	return assignValues(dest, r.rows[r.index-1])
}

type fakeRow struct {
	values []any
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignValues(dest, r.values)
}

func assignValues(dest []any, values []any) error {
	if len(dest) != len(values) {
		return errors.New("destination/value length mismatch")
	}
	for i := range dest {
		switch ptr := dest[i].(type) {
		case *string:
			*ptr = values[i].(string)
		case *int32:
			*ptr = values[i].(int32)
		case *int64:
			*ptr = values[i].(int64)
		case *bool:
			*ptr = values[i].(bool)
		default:
			return errors.New("unsupported scan destination")
		}
	}
	return nil
}

func detailRow(line model.DocumentDetailLine) []any {
	return []any{
		line.DocNo,
		line.LineNumber,
		line.ItemCode,
		line.ItemName,
		line.Barcode,
		line.WhCode,
		line.ShelfCode,
		line.UnitCode,
		line.Qty,
		line.Price,
		line.Discount,
		line.SumAmount,
		line.TotalVatValue,
		line.SumAmountExcludeVat,
		line.VatType,
		line.TaxType,
	}
}

func toStringSlice(value any) []string {
	if value == nil {
		return nil
	}
	return value.([]string)
}

func mustMoney(value string) float64 {
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		panic(err)
	}
	return parsed
}

func formatTestMoney(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

var _ documentQuerier = fakeDocumentQuerier{}
var _ pgx.Rows = (*fakeRows)(nil)
var _ pgx.Row = fakeRow{}
