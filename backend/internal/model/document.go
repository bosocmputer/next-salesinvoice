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
}

type StaticOption struct {
	Value int    `json:"value"`
	Label string `json:"label"`
}

type DocumentChangeRequest struct {
	DocFormatCode   string   `json:"docFormatCode"`
	NewDocNo        string   `json:"newDocNo"`
	CustomerCode    string   `json:"customerCode"`
	InquiryType     int16    `json:"inquiryType"`
	VatType         int16    `json:"vatType"`
	Remark          string   `json:"remark"`
	RemoveItemCodes []string `json:"removeItemCodes"`
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
}

type BulkDocumentChangeRequest struct {
	DocNos          []string `json:"docNos"`
	DocFormatCode   string   `json:"docFormatCode"`
	CustomerCode    string   `json:"customerCode"`
	InquiryType     int16    `json:"inquiryType"`
	VatType         int16    `json:"vatType"`
	Remark          string   `json:"remark"`
	RemoveItemCodes []string `json:"removeItemCodes"`
}

type BulkDocumentChangeItem struct {
	DocNo      string                 `json:"docNo"`
	NewDocNo   string                 `json:"newDocNo"`
	Status     string                 `json:"status"`
	Message    string                 `json:"message"`
	Preview    *DocumentChangePreview `json:"preview"`
	RemoveHits []string               `json:"removeHits"`
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
}

type RollbackDocumentRequest struct {
	SnapshotID int64  `json:"snapshotId"`
	DocNo      string `json:"docNo"`
}

type RollbackDocumentResult struct {
	SnapshotID int64           `json:"snapshotId"`
	Restored   DocumentSummary `json:"restored"`
}
