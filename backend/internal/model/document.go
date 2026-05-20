package model

import "time"

type DocumentSummary struct {
	DocNo          string    `json:"docNo"`
	DocDate        time.Time `json:"docDate"`
	DocTime        string    `json:"docTime"`
	TaxDocNo       string    `json:"taxDocNo"`
	TaxDocDate     string    `json:"taxDocDate"`
	DocRef         string    `json:"docRef"`
	DocRefDate     string    `json:"docRefDate"`
	CustomerCode   string    `json:"customerCode"`
	Contactor      string    `json:"contactor"`
	InquiryType    int16     `json:"inquiryType"`
	VatType        int16     `json:"vatType"`
	SaleCode       string    `json:"saleCode"`
	SaleGroup      string    `json:"saleGroup"`
	CreditDay      string    `json:"creditDay"`
	CreditDate     string    `json:"creditDate"`
	SendDay        string    `json:"sendDay"`
	SendDate       string    `json:"sendDate"`
	VatRate        string    `json:"vatRate"`
	TotalValue     string    `json:"totalValue"`
	TotalBeforeVat string    `json:"totalBeforeVat"`
	TotalVatValue  string    `json:"totalVatValue"`
	TotalDiscount  string    `json:"totalDiscount"`
	TotalAfterVat  string    `json:"totalAfterVat"`
	TotalExceptVat string    `json:"totalExceptVat"`
	TotalAmount    string    `json:"totalAmount"`
	IsCancel       int16     `json:"isCancel"`
	Status         int16     `json:"status"`
	Remark         string    `json:"remark"`
	DocFormatCode  string    `json:"docFormatCode"`
	AppStatus      string    `json:"appStatus"`
}

type DocumentDetailLine struct {
	DocNo               string `json:"docNo"`
	LineNumber          int32  `json:"lineNumber"`
	ItemCode            string `json:"itemCode"`
	ItemName            string `json:"itemName"`
	Barcode             string `json:"barcode"`
	WhCode              string `json:"whCode"`
	ShelfCode           string `json:"shelfCode"`
	UnitCode            string `json:"unitCode"`
	Qty                 string `json:"qty"`
	Price               string `json:"price"`
	Discount            string `json:"discount"`
	SumAmount           string `json:"sumAmount"`
	TotalVatValue       string `json:"totalVatValue"`
	SumAmountExcludeVat string `json:"sumAmountExcludeVat"`
	VatType             int32  `json:"vatType"`
	TaxType             int32  `json:"taxType"`
}

type DocFormat struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	Format     string `json:"format"`
	DocRunning string `json:"docRunning"`
	VatType    int16  `json:"vatType"`
}

type CustomerOption struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type ProductOption struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	UnitCode string `json:"unitCode"`
	DocCount int32  `json:"docCount,omitempty"`
}

type ProductUnit struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type StaticOption struct {
	Value int    `json:"value"`
	Label string `json:"label"`
}

type DocumentChangeRequest struct {
	DocFormatCode   string         `json:"docFormatCode"`
	NewDocNo        string         `json:"newDocNo"`
	CustomerCode    string         `json:"customerCode"`
	InquiryType     int16          `json:"inquiryType"`
	VatType         int16          `json:"vatType"`
	Remark          string         `json:"remark"`
	RemoveItemCodes []string       `json:"removeItemCodes"`
	AddedLines      []NewLineInput `json:"addedLines"`
}

type DocumentTotals struct {
	TotalValue     string `json:"totalValue"`
	TotalBeforeVat string `json:"totalBeforeVat"`
	TotalVatValue  string `json:"totalVatValue"`
	TotalDiscount  string `json:"totalDiscount"`
	TotalAmount    string `json:"totalAmount"`
	LineCount      int64  `json:"lineCount"`
}

type DocumentChangePreview struct {
	DocNo           string               `json:"docNo"`
	Before          DocumentSummary      `json:"before"`
	After           DocumentSummary      `json:"after"`
	Totals          DocumentTotals       `json:"totals"`
	RemoveItemCodes []string             `json:"removeItemCodes"`
	RemovedLines    []DocumentDetailLine `json:"removedLines"`
	RemainingLines  []DocumentDetailLine `json:"remainingLines"`
	AddedLines      []NewLineInput       `json:"addedLines"`
	// PaymentBefore / PaymentAfter capture the cb_trans + cb_trans_detail state
	// that the apply step will sync to match the new total_amount. nil when
	// the bill has no cb_trans companion row (typical credit/AR sales).
	PaymentBefore *DocumentPayment `json:"paymentBefore,omitempty"`
	PaymentAfter  *DocumentPayment `json:"paymentAfter,omitempty"`
}

// DocumentPayment mirrors a cb_trans header plus its cb_trans_detail rows
// for display in the bulk-edit preview. All monetary fields are returned as
// decimal strings to stay consistent with DocumentSummary/Totals shape.
type DocumentPayment struct {
	DocNo           string                  `json:"docNo"`
	TransFlag       int16                   `json:"transFlag"`
	TransType       int16                   `json:"transType"`
	PayType         int16                   `json:"payType"`
	TotalAmount     string                  `json:"totalAmount"`
	TotalNetAmount  string                  `json:"totalNetAmount"`
	TotalAmountPay  string                  `json:"totalAmountPay"`
	PayCashAmount   string                  `json:"payCashAmount"`
	MoneyChange     string                  `json:"moneyChange"`
	CashAmount      string                  `json:"cashAmount"`
	ChqAmount       string                  `json:"chqAmount"`
	TranferAmount   string                  `json:"tranferAmount"`
	CardAmount      string                  `json:"cardAmount"`
	WalletAmount    string                  `json:"walletAmount"`
	CouponAmount    string                  `json:"couponAmount"`
	PointAmount     string                  `json:"pointAmount"`
	DepositAmount   string                  `json:"depositAmount"`
	AdvanceAmount   string                  `json:"advanceAmount"`
	PettyCashAmount string                  `json:"pettyCashAmount"`
	Details         []DocumentPaymentDetail `json:"details"`
}

type DocumentPaymentDetail struct {
	LineNumber     int32  `json:"lineNumber"`
	DocType        int16  `json:"docType"`
	TransNumber    string `json:"transNumber"`
	BankCode       string `json:"bankCode"`
	CreditCardType string `json:"creditCardType"`
	ChqDate        string `json:"chqDate"`
	Amount         string `json:"amount"`
	SumAmount      string `json:"sumAmount"`
}

type BulkDocumentChangeRequest struct {
	DocNos          []string `json:"docNos"`
	DocFormatCode   string   `json:"docFormatCode"`
	CustomerCode    string   `json:"customerCode"`
	InquiryType     int16    `json:"inquiryType"`
	VatType         int16    `json:"vatType"`
	Remark          string   `json:"remark"`
	RemoveItemCodes []string `json:"removeItemCodes"`
	// PerDocEdits, when non-empty, takes precedence over RemoveItemCodes and
	// allows per-bill remove/add item operations. RemoveItemCodes remains for
	// backward compatibility when PerDocEdits is empty.
	PerDocEdits []DocEdit `json:"perDocEdits"`
}

// DocEdit holds per-document line edits applied on top of the bulk request.
type DocEdit struct {
	DocNo           string         `json:"docNo"`
	RemoveItemCodes []string       `json:"removeItemCodes"`
	AddedLines      []NewLineInput `json:"addedLines"`
}

// NewLineInput is a user-entered new detail line to append to a document.
// Qty/Price/Discount are decimal strings to match existing detail-line shape.
type NewLineInput struct {
	ItemCode  string `json:"itemCode"`
	ItemName  string `json:"itemName"`
	UnitCode  string `json:"unitCode"`
	Qty       string `json:"qty"`
	Price     string `json:"price"`
	Discount  string `json:"discount"`
	WhCode    string `json:"whCode"`
	ShelfCode string `json:"shelfCode"`
}

type BulkDocumentChangeItem struct {
	DocNo      string                 `json:"docNo"`
	NewDocNo   string                 `json:"newDocNo"`
	Status     string                 `json:"status"`
	Message    string                 `json:"message"`
	Preview    *DocumentChangePreview `json:"preview"`
	RemoveHits []string               `json:"removeHits"`
	AddedLines []NewLineInput         `json:"addedLines"`
}

type BulkDocumentChangeResult struct {
	BatchID      int64                    `json:"batchId"`
	BatchNo      string                   `json:"batchNo"`
	Items        []BulkDocumentChangeItem `json:"items"`
	TotalCount   int                      `json:"totalCount"`
	ReadyCount   int                      `json:"readyCount"`
	WarningCount int                      `json:"warningCount"`
	BlockedCount int                      `json:"blockedCount"`
	AppliedCount int                      `json:"appliedCount"`
	FailedCount  int                      `json:"failedCount"`
	SkippedCount int                      `json:"skippedCount"`
}

type RollbackDocumentRequest struct {
	SnapshotID int64  `json:"snapshotId"`
	DocNo      string `json:"docNo"`
}

type RollbackDocumentResult struct {
	SnapshotID int64           `json:"snapshotId"`
	Restored   DocumentSummary `json:"restored"`
}
