package repository

import (
	"context"
	"errors"
	"os"
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

func TestValidateChangeRequestAllowsSaleTypeZero(t *testing.T) {
	repo := &DocumentRepository{}
	err := repo.validateChangeRequest(context.Background(), fakeDocumentQuerier{
		docFormatExists:    true,
		customerExists:     true,
		currentInquiryType: 0,
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM001"},
		},
	}, "DOC001", model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC009",
		CustomerCode:  "AR00004",
		InquiryType:   0,
		VatType:       1,
	})
	if err != nil {
		t.Fatalf("expected sale type 0 to pass, got %v", err)
	}
}

func TestValidateChangeRequestRejectsOutOfRangeInquiryType(t *testing.T) {
	repo := &DocumentRepository{}
	err := repo.validateChangeRequest(context.Background(), fakeDocumentQuerier{
		docFormatExists:    true,
		customerExists:     true,
		currentInquiryType: 1,
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM001"},
		},
	}, "DOC001", model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC009",
		CustomerCode:  "AR00004",
		InquiryType:   4,
		VatType:       1,
	})
	if err == nil || !strings.Contains(err.Error(), "sale type is invalid") {
		t.Fatalf("expected invalid sale type error, got %v", err)
	}
}

func TestValidateChangeRequestAllowsMissingCustomerWhenPreservingExisting(t *testing.T) {
	repo := &DocumentRepository{}
	err := repo.validateChangeRequest(context.Background(), fakeDocumentQuerier{
		docFormatExists:     true,
		customerExists:      false,
		currentCustomerCode: "TH-BKK-CD-01031",
		currentInquiryType:  1,
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM001"},
		},
	}, "DOC001", model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC009",
		CustomerCode:  "TH-BKK-CD-01031",
		InquiryType:   1,
		VatType:       1,
	})
	if err != nil {
		t.Fatalf("expected preserving missing source customer to pass, got %v", err)
	}
}

func TestValidateChangeRequestRejectsMissingChangedCustomer(t *testing.T) {
	repo := &DocumentRepository{}
	err := repo.validateChangeRequest(context.Background(), fakeDocumentQuerier{
		docFormatExists:     true,
		customerExists:      false,
		currentCustomerCode: "TH-BKK-CD-01031",
		currentInquiryType:  1,
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM001"},
		},
	}, "DOC001", model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC009",
		CustomerCode:  "AR-MISSING",
		InquiryType:   1,
		VatType:       1,
	})
	if err == nil || !strings.Contains(err.Error(), "customer not found") {
		t.Fatalf("expected missing changed customer error, got %v", err)
	}
}

func TestRetryBulkRequestForDocNosFiltersEditsAndClearsOverrides(t *testing.T) {
	req := model.BulkDocumentChangeRequest{
		DocNos:        []string{"DOC001", "DOC002", "DOC003"},
		DocFormatCode: "INV",
		CustomerCode:  "AR00004",
		InquiryType:   0,
		VatType:       1,
		Remark:        "retry",
		PerDocEdits: []model.DocEdit{
			{DocNo: "DOC001", RemoveItemCodes: []string{"A"}},
			{DocNo: "DOC002", RemoveItemCodes: []string{"B"}},
		},
		DocNoOverrides: map[string]string{
			"DOC001": "INV-OLD-1",
			"DOC002": "INV-OLD-2",
		},
	}

	got := retryBulkRequestForDocNos(req, []string{"DOC002", "DOC003"})
	if !reflect.DeepEqual(got.DocNos, []string{"DOC002", "DOC003"}) {
		t.Fatalf("retry doc nos = %#v", got.DocNos)
	}
	if got.DocNoOverrides != nil {
		t.Fatalf("expected retry to clear doc no overrides, got %#v", got.DocNoOverrides)
	}
	if len(got.PerDocEdits) != 1 || got.PerDocEdits[0].DocNo != "DOC002" {
		t.Fatalf("expected only failed doc edits to remain, got %#v", got.PerDocEdits)
	}
}

func TestExistingCustomerCodeSetReturnsOnlyMasterRows(t *testing.T) {
	repo := &DocumentRepository{}
	got, err := repo.existingCustomerCodeSet(context.Background(), fakeDocumentQuerier{
		existingCustomerCodes: map[string]bool{
			"AR00001": true,
		},
	}, []string{"AR00001", "TH-BKK-CD-01031"})
	if err != nil {
		t.Fatalf("existingCustomerCodeSet returned error: %v", err)
	}
	if _, ok := got["AR00001"]; !ok {
		t.Fatalf("expected AR00001 to exist, got %#v", got)
	}
	if _, ok := got["TH-BKK-CD-01031"]; ok {
		t.Fatalf("expected missing transferred customer to be absent, got %#v", got)
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
	if preview.Totals.LineCount != 1 || preview.Totals.TotalAmount != "100.00" || preview.Totals.TotalVatValue != "6.54" {
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

func TestComputeTotalsFromLinesMatchesSMLVatTypeLabels(t *testing.T) {
	lines := []model.DocumentDetailLine{{DocNo: "DOC001", ItemCode: "ITEM", SumAmount: "100.00", SumAmountExcludeVat: "93.46", TotalVatValue: "6.54"}}
	tests := []struct {
		name           string
		vatType        int16
		totalBeforeVat string
		totalVatValue  string
		totalAfterVat  string
		totalAmount    string
	}{
		{name: "exclusive vat", vatType: 0, totalBeforeVat: "100.00", totalVatValue: "7.00", totalAfterVat: "107.00", totalAmount: "107.00"},
		{name: "inclusive vat", vatType: 1, totalBeforeVat: "93.46", totalVatValue: "6.54", totalAfterVat: "100.00", totalAmount: "100.00"},
		{name: "zero vat", vatType: 2, totalBeforeVat: "0.00", totalVatValue: "0.00", totalAfterVat: "0.00", totalAmount: "100.00"},
		{name: "no vat impact", vatType: 3, totalBeforeVat: "0.00", totalVatValue: "0.00", totalAfterVat: "0.00", totalAmount: "100.00"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeTotalsFromLines(lines, nil, tt.vatType)
			if got.TotalBeforeVat != tt.totalBeforeVat || got.TotalVatValue != tt.totalVatValue ||
				got.TotalAfterVat != tt.totalAfterVat || got.TotalExceptVat != "0" || got.TotalAmount != tt.totalAmount {
				t.Fatalf("unexpected totals for vat_type=%d: %#v", tt.vatType, got)
			}
		})
	}
}

func TestDocumentDetailWritesDoNotOverwriteVatTypeOrTaxType(t *testing.T) {
	sourceBytes, err := os.ReadFile("document_repository.go")
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))
	searchFrom := 0
	for {
		idx := strings.Index(source[searchFrom:], "update ic_trans_detail")
		if idx < 0 {
			break
		}
		idx += searchFrom
		end := len(source)
		if whereTrans := strings.Index(source[idx:], "where trans_flag"); whereTrans >= 0 {
			end = idx + whereTrans
		}
		if whereRow := strings.Index(source[idx:], "where roworder"); whereRow >= 0 && idx+whereRow < end {
			end = idx + whereRow
		}
		stmt := source[idx:end]
		if strings.Contains(stmt, "vat_type =") || strings.Contains(stmt, "tax_type =") {
			t.Fatalf("ic_trans_detail update must not overwrite detail vat_type/tax_type:\n%s", stmt)
		}
		searchFrom = idx + len("update ic_trans_detail")
	}
}

func TestBuildChangePreviewAppliesLineQtyEditsByRowOrder(t *testing.T) {
	repo := &DocumentRepository{}
	before := model.DocumentSummary{
		DocNo:         "DOC001",
		CustomerCode:  "OLD",
		InquiryType:   1,
		VatType:       1,
		DocFormatCode: "INV",
		TotalAmount:   "300.00",
	}

	preview, err := repo.buildChangePreview(context.Background(), fakeDocumentQuerier{
		detailLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", RowOrder: 10, LineNumber: 1, ItemCode: "DUP", ItemName: "unchanged", Qty: "2", Price: "50", SumAmount: "100.00", SumAmountExcludeVat: "93.46", TotalVatValue: "6.54"},
			{DocNo: "DOC001", RowOrder: 20, LineNumber: 2, ItemCode: "DUP", ItemName: "changed", Qty: "2", Price: "100", SumAmount: "200.00", SumAmountExcludeVat: "186.92", TotalVatValue: "13.08"},
		},
	}, before, model.DocumentChangeRequest{
		DocFormatCode: "INV",
		NewDocNo:      "DOC009",
		CustomerCode:  "AR00004",
		InquiryType:   1,
		VatType:       1,
		LineEdits:     []model.LineEdit{{RowOrder: 20, Qty: strPtr("3")}},
	})
	if err != nil {
		t.Fatalf("buildChangePreview returned error: %v", err)
	}

	if preview.Totals.LineCount != 2 || preview.Totals.TotalAmount != "400.00" || preview.Totals.TotalVatValue != "26.17" {
		t.Fatalf("unexpected totals after qty edit: %#v", preview.Totals)
	}
	if preview.RemainingLines[0].Qty != "2" || preview.RemainingLines[0].SumAmount != "100.00" {
		t.Fatalf("first duplicate line should stay unchanged: %#v", preview.RemainingLines[0])
	}
	if preview.RemainingLines[1].Qty != "3.00" || preview.RemainingLines[1].SumAmount != "300.00" {
		t.Fatalf("second duplicate line should be edited by roworder: %#v", preview.RemainingLines[1])
	}
}

func TestApplyLineEditsToLinesRecomputesPriceAndSMLDiscount(t *testing.T) {
	lines := []model.DocumentDetailLine{{
		DocNo:     "DOC001",
		RowOrder:  10,
		ItemCode:  "ITEM001",
		Qty:       "9",
		Price:     "2560",
		Discount:  "100,2%",
		SumAmount: "21697.20",
	}}
	out, err := applyLineEditsToLines(lines, []model.LineEdit{{
		RowOrder: 10,
		Price:    strPtr("3000"),
		Discount: strPtr("100,2%"),
	}})
	if err != nil {
		t.Fatalf("applyLineEditsToLines returned error: %v", err)
	}
	if out[0].Price != "3000.00" || out[0].Discount != "100,2%" || out[0].SumAmount != "25578.00" {
		t.Fatalf("unexpected edited line: %#v", out[0])
	}
}

func TestApplyLineEditsToLinesBlocksNegativeDiscount(t *testing.T) {
	lines := []model.DocumentDetailLine{{
		DocNo:     "DOC001",
		RowOrder:  10,
		ItemCode:  "ITEM001",
		Qty:       "1",
		Price:     "100",
		Discount:  "",
		SumAmount: "100",
	}}
	if _, err := applyLineEditsToLines(lines, []model.LineEdit{{RowOrder: 10, Discount: strPtr("200")}}); err == nil {
		t.Fatal("expected negative discount guard")
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
	if got := previewNextDocNo("INV", "@-YYMM####", "INV-26059581", now); got != "INV-26059582" {
		t.Fatalf("expected SML @-YYMM substitution, got %s", got)
	}
	if got := previewNextDocNo("INV", "@-YYMM####", "", now); got != "INV-26050001" {
		t.Fatalf("expected SML @-YYMM first number, got %s", got)
	}
	jan13 := time.Date(2026, 1, 13, 0, 0, 0, 0, time.UTC)
	if got := previewNextDocNo("G1-CC", "@-YYMMDD-####", "", jan13); got != "G1-CC-260113-0001" {
		t.Fatalf("expected SML @-YYMMDD first number, got %s", got)
	}
	if got := previewNextDocNo("G1-CC", "@-YYMMDD-####", "G1-CC-260113-0007", jan13); got != "G1-CC-260113-0008" {
		t.Fatalf("expected SML @-YYMMDD latest increment, got %s", got)
	}
	if got := previewNextDocNo("G1-CC", "@YYMMDD####", "", jan13); got != "G1-CC2601130001" {
		t.Fatalf("expected SML @YYMMDD first number, got %s", got)
	}
	april := time.Date(2026, 4, 11, 0, 0, 0, 0, time.UTC)
	if got := previewNextDocNo("INV", "@YYMM####", "INV26040009", april); got != "INV26040010" {
		t.Fatalf("expected source-month running INV26040010, got %s", got)
	}
	if got := previewNextDocNo("INV", "@YYMM####", "", april); got != "INV26040001" {
		t.Fatalf("expected source-month first number INV26040001, got %s", got)
	}
}

func TestNextAvailableDocNoSkipsExistingGlobalDocNo(t *testing.T) {
	now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	repo := &DocumentRepository{}
	q := fakeDocumentQuerier{existingDocNos: map[string]bool{
		"INV-26059582": true,
	}}

	got, err := repo.nextAvailableDocNo(context.Background(), q, "INV", "@-YYMM####", "INV-26059581", now, nil)
	if err != nil {
		t.Fatalf("nextAvailableDocNo returned error: %v", err)
	}
	if got != "INV-26059583" {
		t.Fatalf("expected allocator to skip used INV-26059582, got %s", got)
	}
}

func TestNextAvailableDocNoSkipsReservedAndExistingDocNos(t *testing.T) {
	now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	repo := &DocumentRepository{}
	q := fakeDocumentQuerier{existingDocNos: map[string]bool{
		"INV-26059583": true,
	}}
	reserved := map[string]struct{}{
		"INV-26059582": {},
	}

	got, err := repo.nextAvailableDocNo(context.Background(), q, "INV", "@-YYMM####", "INV-26059581", now, reserved)
	if err != nil {
		t.Fatalf("nextAvailableDocNo returned error: %v", err)
	}
	if got != "INV-26059584" {
		t.Fatalf("expected allocator to skip reserved and existing doc nos, got %s", got)
	}
}

type fakeDocumentQuerier struct {
	docFormatExists       bool
	customerExists        bool
	currentCustomerCode   string
	currentInquiryType    int16
	detailLines           []model.DocumentDetailLine
	existingDocNos        map[string]bool
	existingCustomerCodes map[string]bool
	latestDocNo           string
	queryErr              error
}

func (q fakeDocumentQuerier) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	if q.queryErr != nil {
		return nil, q.queryErr
	}
	switch {
	case strings.Contains(sql, "from ar_customer"):
		rows := make([][]any, 0)
		for _, code := range toStringSlice(args[0]) {
			if q.existingCustomerCodes[code] {
				rows = append(rows, []any{code})
			}
		}
		return &fakeRows{rows: rows}, nil
	case strings.Contains(sql, "select unnest"):
		docNo := args[2].(string)
		switch requested := args[0].(type) {
		case []int64:
			existing := map[int64]struct{}{}
			for _, line := range q.detailLines {
				if line.DocNo == docNo {
					existing[line.RowOrder] = struct{}{}
				}
			}
			rows := make([][]any, 0)
			for _, rowOrder := range requested {
				if _, ok := existing[rowOrder]; !ok {
					rows = append(rows, []any{rowOrder})
				}
			}
			return &fakeRows{rows: rows}, nil
		default:
			requestedCodes := toStringSlice(requested)
			existing := map[string]struct{}{}
			for _, line := range q.detailLines {
				if line.DocNo == docNo {
					existing[line.ItemCode] = struct{}{}
				}
			}
			rows := make([][]any, 0)
			for _, code := range requestedCodes {
				if _, ok := existing[code]; !ok {
					rows = append(rows, []any{code})
				}
			}
			return &fakeRows{rows: rows}, nil
		}
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
		lines := make([]model.DocumentDetailLine, 0, len(q.detailLines))
		for _, line := range q.detailLines {
			if line.DocNo != args[1].(string) {
				continue
			}
			if _, ok := exclude[line.ItemCode]; ok {
				continue
			}
			lines = append(lines, line)
		}
		vatType := int16(args[3].(int32))
		totals := computeTotalsFromLines(lines, nil, vatType)
		return fakeRow{values: []any{
			totals.TotalValue,
			totals.TotalBeforeVat,
			totals.TotalVatValue,
			totals.TotalDiscount,
			totals.TotalAfterVat,
			totals.TotalExceptVat,
			totals.TotalAmount,
			totals.LineCount,
		}}
	case strings.Contains(sql, "select coalesce(inquiry_type"):
		return fakeRow{values: []any{q.currentInquiryType}}
	case strings.Contains(sql, "select coalesce(cust_code"):
		return fakeRow{values: []any{q.currentCustomerCode}}
	case strings.Contains(sql, "right(doc_no"):
		if q.latestDocNo == "" {
			return fakeRow{err: pgx.ErrNoRows}
		}
		return fakeRow{values: []any{q.latestDocNo}}
	case strings.Contains(sql, "from ic_trans"):
		docNo := args[1].(string)
		if q.existingDocNos != nil {
			return fakeRow{values: []any{q.existingDocNos[docNo]}}
		}
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
		case *int16:
			*ptr = values[i].(int16)
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
		nonZeroRowOrder(line),
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

func nonZeroRowOrder(line model.DocumentDetailLine) int64 {
	if line.RowOrder != 0 {
		return line.RowOrder
	}
	if line.LineNumber != 0 {
		return int64(line.LineNumber)
	}
	return 1
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

func strPtr(value string) *string {
	return &value
}

var _ documentQuerier = fakeDocumentQuerier{}
var _ pgx.Rows = (*fakeRows)(nil)
var _ pgx.Row = fakeRow{}
