package http

import (
	"reflect"
	"testing"
	"time"

	"next-salesinvoice/backend/internal/model"
)

func TestDocumentAuditAfterIncludesTraceablePayload(t *testing.T) {
	req := model.DocumentChangeRequest{
		DocFormatCode:   "INV",
		NewDocNo:        "DOC009",
		CustomerCode:    "AR00004",
		InquiryType:     1,
		VatType:         0,
		Remark:          "TEST",
		RemoveItemCodes: []string{"ITEM001"},
	}
	preview := model.DocumentChangePreview{
		DocNo: "DOC001",
		After: model.DocumentSummary{
			DocNo:         "DOC001",
			DocDate:       time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC),
			CustomerCode:  "AR00004",
			InquiryType:   1,
			VatType:       0,
			TotalAmount:   "107.00",
			Remark:        "TEST",
			DocFormatCode: "INV",
		},
		Totals: model.DocumentTotals{
			TotalAmount: "107.00",
			LineCount:   1,
		},
		RemoveItemCodes: []string{"ITEM001"},
		RemovedLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM001", SumAmount: "200.00"},
		},
		RemainingLines: []model.DocumentDetailLine{
			{DocNo: "DOC001", ItemCode: "ITEM002", SumAmount: "100.00"},
		},
	}

	payload := documentAuditAfter(preview, req)

	if payload["removedLineCount"] != 1 {
		t.Fatalf("expected removedLineCount 1, got %#v", payload["removedLineCount"])
	}
	if payload["remainingLineCount"] != 1 {
		t.Fatalf("expected remainingLineCount 1, got %#v", payload["remainingLineCount"])
	}
	if !reflect.DeepEqual(payload["request"], req) {
		t.Fatalf("expected request payload to be preserved")
	}
	if payload["totals"] != preview.Totals {
		t.Fatalf("expected totals payload to be preserved")
	}
	if len(payload["removedLines"].([]model.DocumentDetailLine)) != 1 {
		t.Fatalf("expected removed lines payload")
	}
	if len(payload["remainingLines"].([]model.DocumentDetailLine)) != 1 {
		t.Fatalf("expected remaining lines payload")
	}
}
