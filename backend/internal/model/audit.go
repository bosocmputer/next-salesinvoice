package model

import (
	"encoding/json"
	"time"
)

type AuditLogItem struct {
	ID           int64           `json:"id"`
	UserCode     string          `json:"userCode"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resourceType"`
	ResourceID   string          `json:"resourceId"`
	BeforeData   json.RawMessage `json:"beforeData"`
	AfterData    json.RawMessage `json:"afterData"`
	IPAddress    string          `json:"ipAddress"`
	UserAgent    string          `json:"userAgent"`
	CreatedAt    time.Time       `json:"createdAt"`
}

type DocumentRawState struct {
	ICTrans       json.RawMessage `json:"icTrans"`
	ICTransDetail json.RawMessage `json:"icTransDetail"`
}

type DocumentHistoryItem struct {
	SnapshotID    int64            `json:"snapshotId"`
	BatchID       int64            `json:"batchId"`
	OriginalDocNo string           `json:"originalDocNo"`
	CurrentDocNo  string           `json:"currentDocNo"`
	CreatedBy     string           `json:"createdBy"`
	CreatedAt     time.Time        `json:"createdAt"`
	RolledBackAt  *time.Time       `json:"rolledBackAt,omitempty"`
	Before        DocumentRawState `json:"before"`
	After         DocumentRawState `json:"after"`
	AfterSummary  json.RawMessage  `json:"afterSummary,omitempty"`
	Status        string           `json:"status"`
	Message       string           `json:"message"`
}
