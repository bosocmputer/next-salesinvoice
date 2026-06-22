package http

import (
	"encoding/json"
	"errors"
	"log"
	nethttp "net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"next-salesinvoice/backend/internal/appruntime"
	"next-salesinvoice/backend/internal/audit"
	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/errorcode"
	"next-salesinvoice/backend/internal/metrics"
	"next-salesinvoice/backend/internal/migration"
	"next-salesinvoice/backend/internal/model"
	"next-salesinvoice/backend/internal/repository"
	"next-salesinvoice/backend/internal/response"
	"next-salesinvoice/backend/internal/service"
	"next-salesinvoice/backend/internal/session"
)

type RouterDeps struct {
	cfg      config.Config
	state    *appruntime.State
	sessions *session.Manager
}

func NewRouter(
	cfg config.Config,
	state *appruntime.State,
	sessions *session.Manager,
) *gin.Engine {
	if cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	deps := RouterDeps{cfg: cfg, state: state, sessions: sessions}
	r := gin.New()
	r.Use(deps.structuredLogger(), deps.metricsMiddleware(), deps.jsonRecovery(), deps.requestBodyLimit())
	r.NoRoute(func(c *gin.Context) {
		response.Error(c, nethttp.StatusNotFound, errorcode.NotFound, "not found", "route does not exist")
	})

	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	api := r.Group("/api/v1")
	api.GET("/health", deps.health)
	api.GET("/healthz", deps.health)
	api.GET("/readyz", deps.readyz)
	api.GET("/system/databases", deps.databaseList)
	api.GET("/system/database-status", deps.databaseStatus)
	api.POST("/system/database-migrate/bootstrap", deps.writeRateLimiter("database_migrate_bootstrap", 5), deps.databaseMigrateBootstrap)
	api.POST("/system/database-migrate", deps.authMiddleware(), deps.requireRole("Admin"), deps.databaseMigrate)
	api.POST("/auth/login", deps.loginRateLimiter(), deps.login)
	api.POST("/auth/logout", deps.logout)
	api.GET("/auth/me", deps.authMiddleware(), deps.me)
	api.GET("/documents", deps.authMiddleware(), deps.documentsList)
	api.GET("/documents/selectable-doc-nos", deps.authMiddleware(), deps.selectableDocumentNumbers)
	api.POST("/documents/bulk/preview-change", deps.authMiddleware(), deps.bulkDocumentChangePreview)
	api.POST("/documents/bulk/apply-change", deps.authMiddleware(), deps.requireRole("Admin"), deps.writeRateLimiter("bulk_apply", 30), deps.bulkDocumentChangeApply)
	api.POST("/documents/bulk/apply-change/start", deps.authMiddleware(), deps.requireRole("Admin"), deps.writeRateLimiter("bulk_apply_start", 30), deps.bulkDocumentChangeApplyStart)
	api.GET("/documents/bulk/batches/:batchId", deps.authMiddleware(), deps.requireRole("Admin"), deps.bulkDocumentChangeBatch)
	api.POST("/documents/bulk/batches/:batchId/retry-failed", deps.authMiddleware(), deps.requireRole("Admin"), deps.writeRateLimiter("bulk_apply_retry", 30), deps.bulkDocumentChangeRetryFailed)
	api.POST("/documents/rollback", deps.authMiddleware(), deps.requireRole("Admin"), deps.writeRateLimiter("rollback", 30), deps.documentRollback)
	api.GET("/documents/:docNo/details", deps.authMiddleware(), deps.documentDetails)
	api.POST("/documents/items", deps.authMiddleware(), deps.documentsItems)
	api.POST("/documents/:docNo/preview-change", deps.authMiddleware(), deps.documentChangePreview)
	api.POST("/documents/:docNo/apply-change", deps.authMiddleware(), deps.requireRole("Admin"), deps.writeRateLimiter("doc_apply", 60), deps.documentChangeApply)
	api.GET("/documents/running-number", deps.authMiddleware(), deps.runningNumber)
	api.GET("/master/doc-formats", deps.authMiddleware(), deps.docFormats)
	api.GET("/master/customers", deps.authMiddleware(), deps.customers)
	api.GET("/master/products", deps.authMiddleware(), deps.products)
	api.GET("/master/product-units", deps.authMiddleware(), deps.productUnits)
	api.GET("/master/sale-types", deps.authMiddleware(), deps.saleTypes)
	api.GET("/master/tax-types", deps.authMiddleware(), deps.taxTypes)
	api.GET("/audit-logs", deps.authMiddleware(), deps.requireRole("Admin"), deps.auditLogs)
	api.GET("/audit-documents", deps.authMiddleware(), deps.requireRole("Admin"), deps.auditDocuments)
	api.POST("/client-events", deps.clientEvents)

	return r
}

func (d RouterDeps) documentsList(c *gin.Context) {
	from, to, ok := parseDateRange(c)
	if !ok {
		return
	}
	page := parseBoundedInt(c.Query("page"), 1, 1, 100000)
	pageSize := parseBoundedInt(c.Query("pageSize"), 50, 1, 100)
	items, hasMore, total, err := d.docs(c).List(c.Request.Context(), from, to, page, pageSize, c.Query("q"))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load documents failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{
		"items":    items,
		"page":     page,
		"pageSize": pageSize,
		"total":    total,
		"hasMore":  hasMore,
	})
}

func (d RouterDeps) selectableDocumentNumbers(c *gin.Context) {
	from, to, ok := parseDateRange(c)
	if !ok {
		return
	}
	limit := parseBoundedInt(c.Query("limit"), 300, 1, 300)
	items, hasMore, err := d.docs(c).ListDocNos(c.Request.Context(), from, to, c.Query("q"), limit)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load selectable documents failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{
		"docNos":  items,
		"count":   len(items),
		"limit":   limit,
		"hasMore": hasMore,
	})
}

func (d RouterDeps) documentDetails(c *gin.Context) {
	docNo := c.Param("docNo")
	if docNo == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid document", "docNo is required")
		return
	}
	items, err := d.docs(c).Details(c.Request.Context(), docNo)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load document details failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) documentChangePreview(c *gin.Context) {
	docNo := c.Param("docNo")
	if docNo == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid document", "docNo is required")
		return
	}
	req, ok := bindDocumentChange(c)
	if !ok {
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	preview, err := d.docs(c).PreviewChange(c.Request.Context(), docNo, req)
	if err != nil {
		d.writeDocumentAudit(c, claims, "document.preview_change_failed", docNo, gin.H{
			"request": req,
		}, gin.H{
			"error": err.Error(),
		})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "preview document change failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "document.preview_change", docNo, gin.H{
		"request": req,
		"before":  preview.Before,
	}, documentAuditAfter(preview, req))
	response.OK(c, nethttp.StatusOK, "ok", preview)
}

func (d RouterDeps) documentChangeApply(c *gin.Context) {
	docNo := c.Param("docNo")
	if docNo == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid document", "docNo is required")
		return
	}
	req, ok := bindDocumentChange(c)
	if !ok {
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	preview, err := d.docs(c).ApplyChangeWithSnapshot(c.Request.Context(), docNo, req, claims.UserCode)
	if err != nil {
		d.writeDocumentAudit(c, claims, "document.apply_change_failed", docNo, gin.H{
			"request": req,
		}, gin.H{
			"error": err.Error(),
		})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "apply document change failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "document.apply_change", preview.After.DocNo, gin.H{
		"request": req,
		"before":  preview.Before,
	}, documentAuditAfter(preview, req))
	response.OK(c, nethttp.StatusOK, "document updated", preview)
}

func (d RouterDeps) bulkDocumentChangePreview(c *gin.Context) {
	req, ok := bindBulkDocumentChange(c)
	if !ok {
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	result, err := d.docs(c).BulkPreviewChange(c.Request.Context(), req)
	if err != nil {
		d.writeDocumentAudit(c, claims, "bulk.preview_change_failed", "bulk", gin.H{"request": req}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "preview bulk document change failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "bulk.preview_change", "bulk", gin.H{"request": req}, gin.H{
		"totalCount":   result.TotalCount,
		"readyCount":   result.ReadyCount,
		"warningCount": result.WarningCount,
		"blockedCount": result.BlockedCount,
	})
	response.OK(c, nethttp.StatusOK, "ok", result)
}

func (d RouterDeps) bulkDocumentChangeApply(c *gin.Context) {
	req, ok := bindBulkDocumentChange(c)
	if !ok {
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	result, err := d.docs(c).BulkApplyChange(c.Request.Context(), req, claims.UserCode)
	if err != nil {
		metrics.BulkApplyDocumentsTotal.WithLabelValues("error").Add(float64(len(req.DocNos)))
		d.writeDocumentAudit(c, claims, "bulk.apply_change_failed", "bulk", gin.H{"request": req}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "apply bulk document change failed", err.Error())
		return
	}
	if result.AppliedCount > 0 {
		metrics.BulkApplyDocumentsTotal.WithLabelValues("applied").Add(float64(result.AppliedCount))
	}
	if result.FailedCount > 0 {
		metrics.BulkApplyDocumentsTotal.WithLabelValues("failed").Add(float64(result.FailedCount))
	}
	if result.BlockedCount > 0 {
		metrics.BulkApplyDocumentsTotal.WithLabelValues("blocked").Add(float64(result.BlockedCount))
	}
	if result.SkippedCount > 0 {
		metrics.BulkApplyDocumentsTotal.WithLabelValues("skipped").Add(float64(result.SkippedCount))
	}
	d.writeDocumentAudit(c, claims, "bulk.apply_change", "bulk", gin.H{"request": req}, gin.H{
		"totalCount":   result.TotalCount,
		"appliedCount": result.AppliedCount,
		"failedCount":  result.FailedCount,
		"blockedCount": result.BlockedCount,
		"skippedCount": result.SkippedCount,
	})
	response.OK(c, nethttp.StatusOK, "bulk documents updated", result)
}

func (d RouterDeps) bulkDocumentChangeApplyStart(c *gin.Context) {
	req, ok := bindBulkDocumentChange(c)
	if !ok {
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	progress, err := d.docs(c).StartBulkApplyChange(c.Request.Context(), req, claims.UserCode)
	if err != nil {
		metrics.BulkApplyDocumentsTotal.WithLabelValues("error").Add(float64(len(req.DocNos)))
		d.writeDocumentAudit(c, claims, "bulk.apply_change_start_failed", "bulk", gin.H{"request": req}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "start bulk document change failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "bulk.apply_change_start", "bulk", gin.H{"request": req}, gin.H{
		"batchId":    progress.BatchID,
		"batchNo":    progress.BatchNo,
		"totalCount": progress.TotalCount,
	})
	response.OK(c, nethttp.StatusAccepted, "bulk apply started", progress)
}

func (d RouterDeps) bulkDocumentChangeBatch(c *gin.Context) {
	batchID, ok := parseBatchID(c)
	if !ok {
		return
	}
	progress, err := d.docs(c).BulkApplyBatchProgress(c.Request.Context(), batchID)
	if err != nil {
		response.Error(c, nethttp.StatusNotFound, errorcode.NotFound, "load bulk apply batch failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", progress)
}

func (d RouterDeps) bulkDocumentChangeRetryFailed(c *gin.Context) {
	batchID, ok := parseBatchID(c)
	if !ok {
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	progress, err := d.docs(c).RetryFailedBulkApplyChange(c.Request.Context(), batchID, claims.UserCode)
	if err != nil {
		d.writeDocumentAudit(c, claims, "bulk.apply_change_retry_failed", "bulk", gin.H{"batchId": batchID}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "retry failed bulk documents failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "bulk.apply_change_retry", "bulk", gin.H{"batchId": batchID}, gin.H{
		"batchId":    progress.BatchID,
		"batchNo":    progress.BatchNo,
		"totalCount": progress.TotalCount,
	})
	response.OK(c, nethttp.StatusAccepted, "bulk retry started", progress)
}

func (d RouterDeps) documentRollback(c *gin.Context) {
	var req model.RollbackDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid rollback input", "request body is invalid")
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	result, err := d.docs(c).RollbackDocument(c.Request.Context(), req, claims.UserCode)
	if err != nil {
		d.writeDocumentAudit(c, claims, "document.rollback_failed", req.DocNo, gin.H{"request": req}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "rollback document failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "document.rollback", result.Restored.DocNo, gin.H{"request": req}, gin.H{"restored": result.Restored})
	response.OK(c, nethttp.StatusOK, "document rolled back", result)
}

func (d RouterDeps) writeDocumentAudit(c *gin.Context, claims session.Claims, action, docNo string, before, after any) {
	_ = d.auditLog(c).Write(c.Request.Context(), audit.Entry{
		UserCode:     claims.UserCode,
		Action:       action,
		ResourceType: "ic_trans",
		ResourceID:   docNo,
		Before:       before,
		After:        after,
		IPAddress:    c.ClientIP(),
		UserAgent:    c.Request.UserAgent(),
	})
}

func documentAuditAfter(preview model.DocumentChangePreview, req model.DocumentChangeRequest) gin.H {
	return gin.H{
		"request":            req,
		"after":              preview.After,
		"totals":             preview.Totals,
		"removedLineCount":   len(preview.RemovedLines),
		"remainingLineCount": len(preview.RemainingLines),
		"removeItemCodes":    preview.RemoveItemCodes,
		"removedLines":       preview.RemovedLines,
		"remainingLines":     preview.RemainingLines,
	}
}

func (d RouterDeps) docFormats(c *gin.Context) {
	items, err := d.docs(c).DocFormats(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load document formats failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) runningNumber(c *gin.Context) {
	formatCode := c.Query("formatCode")
	if formatCode == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid format", "formatCode is required")
		return
	}
	sourceDocNo := strings.TrimSpace(c.Query("sourceDocNo"))
	nextDocNo, latestDocNo, err := d.docs(c).NextDocNo(c.Request.Context(), formatCode, sourceDocNo)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load running number failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"formatCode": formatCode, "latestDocNo": latestDocNo, "nextDocNo": nextDocNo})
}

func (d RouterDeps) customers(c *gin.Context) {
	items, err := d.docs(c).SearchCustomers(c.Request.Context(), c.Query("q"), parseBoundedInt(c.Query("limit"), 20, 1, 50))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load customers failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) products(c *gin.Context) {
	items, err := d.docs(c).SearchProducts(c.Request.Context(), c.Query("q"), parseBoundedInt(c.Query("limit"), 20, 1, 50))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load products failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) productUnits(c *gin.Context) {
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid input", "code is required")
		return
	}
	items, err := d.docs(c).ProductUnits(c.Request.Context(), code)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load product units failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) documentsItems(c *gin.Context) {
	var body struct {
		DocNos []string `json:"docNos"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid request body", err.Error())
		return
	}
	// Dedupe + trim + drop empties to keep query parameter clean.
	seen := make(map[string]struct{}, len(body.DocNos))
	cleaned := make([]string, 0, len(body.DocNos))
	for _, v := range body.DocNos {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, dup := seen[v]; dup {
			continue
		}
		seen[v] = struct{}{}
		cleaned = append(cleaned, v)
	}
	if len(cleaned) > 500 {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "too many documents", "docNos must be 500 or fewer")
		return
	}
	items, err := d.docs(c).ItemsByDocs(c.Request.Context(), cleaned)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load items by docs failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) saleTypes(c *gin.Context) {
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": []gin.H{
		{"value": 0, "label": "ขายเงินเชื่อ"},
		{"value": 1, "label": "ขายเงินสด"},
		{"value": 2, "label": "ขายสินค้าเงินเชื่อ (สินค้าบริการ)"},
		{"value": 3, "label": "ขายสินค้าเงินสด (สินค้าบริการ)"},
	}})
}

func (d RouterDeps) taxTypes(c *gin.Context) {
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": []gin.H{
		{"value": 0, "label": "ภาษีแยกนอก"},
		{"value": 1, "label": "ภาษีรวมใน"},
		{"value": 2, "label": "ภาษีอัตราศูนย์"},
		{"value": 3, "label": "ไม่กระทบภาษี"},
	}})
}

func (d RouterDeps) auditLogs(c *gin.Context) {
	items, err := d.audits(c).List(c.Request.Context(), c.Query("resourceId"), parseBoundedInt(c.Query("limit"), 20, 1, 100))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load audit logs failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) auditDocuments(c *gin.Context) {
	items, err := d.audits(c).DocumentHistory(c.Request.Context(), c.Query("docNo"), parseBoundedInt(c.Query("limit"), 10, 1, 50))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load document history failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func bindDocumentChange(c *gin.Context) (model.DocumentChangeRequest, bool) {
	var req model.DocumentChangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid document change input", "request body is invalid")
		return model.DocumentChangeRequest{}, false
	}
	return req, true
}

func bindBulkDocumentChange(c *gin.Context) (model.BulkDocumentChangeRequest, bool) {
	var req model.BulkDocumentChangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid bulk document change input", "request body is invalid")
		return model.BulkDocumentChangeRequest{}, false
	}
	return req, true
}

func (d RouterDeps) health(c *gin.Context) {
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"status": "healthy"})
}

// clientEvents accepts unauthenticated client telemetry pings. The payload is
// strictly bounded (small JSON), tagged with the client IP, and written to the
// structured log. Counters are incremented per event kind for Prometheus.
func (d RouterDeps) clientEvents(c *gin.Context) {
	var event struct {
		Kind    string         `json:"kind"`
		Message string         `json:"message"`
		URL     string         `json:"url"`
		UA      string         `json:"ua"`
		TS      string         `json:"ts"`
		Detail  map[string]any `json:"detail"`
	}
	c.Request.Body = nethttp.MaxBytesReader(c.Writer, c.Request.Body, 8*1024)
	if err := c.ShouldBindJSON(&event); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid event", "payload is invalid")
		return
	}
	kind := event.Kind
	switch kind {
	case "error", "rejection", "vitals":
	default:
		kind = "unknown"
	}
	metrics.ClientEventsTotal.WithLabelValues(kind).Inc()
	if len(event.Message) > 500 {
		event.Message = event.Message[:500]
	}
	if b, err := json.Marshal(map[string]any{
		"ts":      time.Now().UTC().Format(time.RFC3339Nano),
		"level":   "warn",
		"source":  "client",
		"kind":    kind,
		"message": event.Message,
		"url":     event.URL,
		"ip":      c.ClientIP(),
	}); err == nil {
		log.Println(string(b))
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{})
}

func (d RouterDeps) readyz(c *gin.Context) {
	status, err := d.state.Current().Migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusServiceUnavailable, errorcode.DatabaseVerification, "not ready", err.Error())
		return
	}
	if !status.Connected || !status.RequiredSMLReady || !status.AppSchemaReady {
		response.Error(c, nethttp.StatusServiceUnavailable, errorcode.DatabaseVerification, "not ready", "database or schema not ready")
		return
	}
	response.OK(c, nethttp.StatusOK, "ready", gin.H{"status": "ready"})
}

// databaseList returns the list of databases the user may connect to.
// Result is cached for 60 s in appruntime.State.
func (d RouterDeps) databaseList(c *gin.Context) {
	names, err := d.state.ListDatabases(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "cannot list databases", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"databases": names})
}

// migratorForDB returns a Migrator pointed at dbName (or the base DB if empty).
// Validates dbName before opening any pool.
func (d RouterDeps) migratorForDB(c *gin.Context, dbName string) (*migration.Migrator, bool) {
	if dbName == "" {
		return d.state.Current().Migrator, true
	}
	if err := d.state.ValidateDBName(c.Request.Context(), dbName); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid database", err.Error())
		return nil, false
	}
	pool, err := d.state.PoolFor(c.Request.Context(), dbName)
	if err != nil {
		response.Error(c, nethttp.StatusServiceUnavailable, errorcode.DBConnection, "cannot connect to database", err.Error())
		return nil, false
	}
	cfg := d.cfg
	cfg.DBName = dbName
	return migration.New(pool, cfg), true
}

func (d RouterDeps) databaseStatus(c *gin.Context) {
	dbName := c.Query("db")
	migrator, ok := d.migratorForDB(c, dbName)
	if !ok {
		return
	}
	status, err := migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database verification failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", status)
}

func (d RouterDeps) databaseMigrate(c *gin.Context) {
	if err := d.state.Current().Migrator.VerifyAndMigrate(c.Request.Context()); err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database migration failed", err.Error())
		return
	}
	d.databaseStatus(c)
}

type bootstrapRequest struct {
	DB string `json:"db"`
}

func (d RouterDeps) databaseMigrateBootstrap(c *gin.Context) {
	var req bootstrapRequest
	_ = c.ShouldBindJSON(&req) // optional body — ignore parse error

	migrator, ok := d.migratorForDB(c, req.DB)
	if !ok {
		return
	}

	status, err := migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusServiceUnavailable, errorcode.DatabaseVerification, "database verification failed", err.Error())
		return
	}
	if !status.Connected || !status.RequiredSMLReady {
		response.Error(c, nethttp.StatusConflict, errorcode.DatabaseVerification, "database not ready", "SML tables หลักยังไม่ครบ จึงยังติดตั้งตารางระบบไม่ได้")
		return
	}
	if status.AppSchemaReady {
		response.OK(c, nethttp.StatusOK, "database schema already ready", status)
		return
	}
	if err := migrator.Migrate(c.Request.Context()); err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database migration failed", err.Error())
		return
	}
	// re-verify and return fresh status
	status, err = migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database verification failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", status)
}

type loginRequest struct {
	Code     string `json:"code"     binding:"required"`
	Password string `json:"password" binding:"required"`
	DB       string `json:"db"`      // optional — defaults to cfg.DBName
}

func (d RouterDeps) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid login input", "code and password are required")
		return
	}

	dbName := req.DB
	if dbName == "" {
		dbName = d.cfg.DBName
	}

	// Validate before touching credentials — prevents probing unknown databases.
	if err := d.state.ValidateDBName(c.Request.Context(), dbName); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid database", err.Error())
		return
	}
	pool, err := d.state.PoolFor(c.Request.Context(), dbName)
	if err != nil {
		response.Error(c, nethttp.StatusServiceUnavailable, errorcode.DBConnection, "cannot connect to database", err.Error())
		return
	}

	result, err := d.state.Current().Auth.Login(c.Request.Context(), pool, dbName, req.Code, req.Password, service.AuditMeta{
		IPAddress: c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
	})
	if errors.Is(err, service.ErrInvalidCredentials) {
		metrics.LoginAttemptsTotal.WithLabelValues("invalid").Inc()
		response.Error(c, nethttp.StatusUnauthorized, errorcode.InvalidCredentials, "invalid username or password", "login credentials are not valid")
		return
	}
	if errors.Is(err, service.ErrUserInactive) {
		metrics.LoginAttemptsTotal.WithLabelValues("forbidden").Inc()
		response.Error(c, nethttp.StatusForbidden, errorcode.Forbidden, "user is not allowed to login", "user is inactive or disabled")
		return
	}
	if err != nil {
		metrics.LoginAttemptsTotal.WithLabelValues("error").Inc()
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "login failed", err.Error())
		return
	}
	metrics.LoginAttemptsTotal.WithLabelValues("success").Inc()
	maxAge := int(time.Until(time.Unix(result.ExpiresAt, 0)).Seconds())
	setSessionCookie(c, d.cfg, result.Token, maxAge)
	response.OK(c, nethttp.StatusOK, "login success", gin.H{
		"user":      result.Claims,
		"expiresAt": result.ExpiresAt,
	})
}

func (d RouterDeps) logout(c *gin.Context) {
	setSessionCookie(c, d.cfg, "", -1)
	response.OK(c, nethttp.StatusOK, "logout success", gin.H{})
}

func (d RouterDeps) me(c *gin.Context) {
	claims := c.MustGet("claims").(session.Claims)
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"user": claims})
}

func (d RouterDeps) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(session.CookieName)
		if err != nil {
			response.Error(c, nethttp.StatusUnauthorized, errorcode.Unauthorized, "unauthorized", "session cookie is missing")
			c.Abort()
			return
		}
		claims, err := d.sessions.Parse(token)
		if err != nil {
			response.Error(c, nethttp.StatusUnauthorized, errorcode.Unauthorized, "unauthorized", "session is invalid or expired")
			c.Abort()
			return
		}

		// Resolve the pool for this session's database.
		// claims.DbName == "" means an old token — fall back to base pool.
		dbName := claims.DbName
		if dbName == "" {
			dbName = d.cfg.DBName
		}
		pool, err := d.state.PoolFor(c.Request.Context(), dbName)
		if err != nil {
			response.Error(c, nethttp.StatusServiceUnavailable, errorcode.DBConnection, "database unavailable", "cannot connect to session database")
			c.Abort()
			return
		}

		c.Set("claims", claims)
		c.Set("pool", pool)
		c.Next()
	}
}

// poolFromCtx returns the per-request pool injected by authMiddleware.
func poolFromCtx(c *gin.Context) *pgxpool.Pool {
	v, _ := c.Get("pool")
	return v.(*pgxpool.Pool)
}

// docs returns a DocumentRepository bound to the request's session pool.
func (d RouterDeps) docs(c *gin.Context) *repository.DocumentRepository {
	return repository.NewDocumentRepository(poolFromCtx(c), d.cfg)
}

// audits returns an AuditRepository bound to the request's session pool.
func (d RouterDeps) audits(c *gin.Context) *repository.AuditRepository {
	return repository.NewAuditRepository(poolFromCtx(c), d.cfg)
}

// auditLog returns an audit.Logger bound to the request's session pool.
func (d RouterDeps) auditLog(c *gin.Context) *audit.Logger {
	return audit.NewLogger(poolFromCtx(c), d.cfg)
}

func (d RouterDeps) requireRole(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[strings.ToLower(role)] = struct{}{}
	}
	return func(c *gin.Context) {
		claims := c.MustGet("claims").(session.Claims)
		if _, ok := allowed[strings.ToLower(claims.Role)]; !ok {
			response.Error(c, nethttp.StatusForbidden, errorcode.Forbidden, "forbidden", "user role is not allowed for this action")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (d RouterDeps) requestBodyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = nethttp.MaxBytesReader(c.Writer, c.Request.Body, d.cfg.RequestBodyLimit)
		}
		c.Next()
	}
}

func (d RouterDeps) jsonRecovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.Internal, "internal server error", "server recovered from an unexpected error")
	})
}

func setSessionCookie(c *gin.Context, cfg config.Config, value string, maxAge int) {
	sameSite := nethttp.SameSiteLaxMode
	if cfg.IsProduction() {
		sameSite = nethttp.SameSiteStrictMode
	}
	nethttp.SetCookie(c.Writer, &nethttp.Cookie{
		Name:     session.CookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: sameSite,
	})
}

func parseDateRange(c *gin.Context) (time.Time, time.Time, bool) {
	fromRaw := c.Query("from")
	toRaw := c.Query("to")
	if fromRaw == "" || toRaw == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid date range", "from and to are required")
		return time.Time{}, time.Time{}, false
	}
	from, err := time.Parse("2006-01-02", fromRaw)
	if err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid from date", "from must use YYYY-MM-DD")
		return time.Time{}, time.Time{}, false
	}
	to, err := time.Parse("2006-01-02", toRaw)
	if err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid to date", "to must use YYYY-MM-DD")
		return time.Time{}, time.Time{}, false
	}
	if to.Before(from) {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid date range", "to must be after from")
		return time.Time{}, time.Time{}, false
	}
	return from, to, true
}

func parseBoundedInt(raw string, fallback, minValue, maxValue int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func parseBatchID(c *gin.Context) (int64, bool) {
	raw := strings.TrimSpace(c.Param("batchId"))
	if raw == "" {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid batch id", "batch id is required")
		return 0, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid batch id", "batch id must be a positive number")
		return 0, false
	}
	return value, true
}

// loginRateLimiter throttles authentication attempts per client IP.
// Defaults to 5 attempts per minute and an additional 30s lockout when exceeded.
func (d RouterDeps) loginRateLimiter() gin.HandlerFunc {
	const (
		windowDuration = time.Minute
		maxAttempts    = 5
		lockoutPeriod  = 30 * time.Second
	)
	type bucket struct {
		windowStart time.Time
		count       int
		lockedUntil time.Time
	}
	var (
		mu      sync.Mutex
		buckets = make(map[string]*bucket)
	)
	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()
		mu.Lock()
		b, ok := buckets[ip]
		if !ok {
			b = &bucket{windowStart: now}
			buckets[ip] = b
		}
		// opportunistic cleanup
		if len(buckets) > 4096 {
			for k, v := range buckets {
				if now.Sub(v.windowStart) > 10*time.Minute && now.After(v.lockedUntil) {
					delete(buckets, k)
				}
			}
		}
		if now.Before(b.lockedUntil) {
			retry := int(b.lockedUntil.Sub(now).Seconds()) + 1
			mu.Unlock()
			c.Header("Retry-After", strconv.Itoa(retry))
			response.Error(c, nethttp.StatusTooManyRequests, errorcode.Forbidden, "too many login attempts", "please wait before retrying")
			c.Abort()
			return
		}
		if now.Sub(b.windowStart) > windowDuration {
			b.windowStart = now
			b.count = 0
		}
		b.count++
		if b.count > maxAttempts {
			b.lockedUntil = now.Add(lockoutPeriod)
			retry := int(lockoutPeriod.Seconds())
			mu.Unlock()
			metrics.LoginAttemptsTotal.WithLabelValues("rate_limited").Inc()
			c.Header("Retry-After", strconv.Itoa(retry))
			response.Error(c, nethttp.StatusTooManyRequests, errorcode.Forbidden, "too many login attempts", "please wait before retrying")
			c.Abort()
			return
		}
		mu.Unlock()
		c.Next()
	}
}

// writeRateLimiter throttles write endpoints per authenticated user (fallback to IP).
// Uses a rolling 1-minute window. Rejects requests beyond maxPerMin with HTTP 429.
// Intended for high-risk routes (bulk-apply, single apply, rollback).
func (d RouterDeps) writeRateLimiter(routeName string, maxPerMin int) gin.HandlerFunc {
	const windowDuration = time.Minute
	type bucket struct {
		windowStart time.Time
		count       int
	}
	var (
		mu      sync.Mutex
		buckets = make(map[string]*bucket)
	)
	return func(c *gin.Context) {
		key := c.ClientIP()
		if v, ok := c.Get("claims"); ok {
			if cl, ok := v.(session.Claims); ok && cl.UserCode != "" {
				key = "u:" + cl.UserCode
			}
		}
		now := time.Now()
		mu.Lock()
		b, ok := buckets[key]
		if !ok {
			b = &bucket{windowStart: now}
			buckets[key] = b
		}
		if len(buckets) > 4096 {
			for k, v := range buckets {
				if now.Sub(v.windowStart) > 10*time.Minute {
					delete(buckets, k)
				}
			}
		}
		if now.Sub(b.windowStart) > windowDuration {
			b.windowStart = now
			b.count = 0
		}
		b.count++
		if b.count > maxPerMin {
			retry := int(windowDuration.Seconds() - now.Sub(b.windowStart).Seconds())
			if retry < 1 {
				retry = 1
			}
			mu.Unlock()
			metrics.WriteRateLimitedTotal.WithLabelValues(routeName).Inc()
			c.Header("Retry-After", strconv.Itoa(retry))
			response.Error(c, nethttp.StatusTooManyRequests, errorcode.Forbidden, "too many write requests", "please slow down and retry shortly")
			c.Abort()
			return
		}
		mu.Unlock()
		c.Next()
	}
}

// metricsMiddleware records per-request Prometheus counters and a latency histogram.
func (d RouterDeps) metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		status := strconv.Itoa(c.Writer.Status())
		metrics.HTTPRequestsTotal.WithLabelValues(c.Request.Method, route, status).Inc()
		metrics.HTTPRequestDurationSeconds.WithLabelValues(c.Request.Method, route).Observe(time.Since(start).Seconds())
	}
}

// structuredLogger emits one JSON log line per request. Replaces gin.Logger().
func (d RouterDeps) structuredLogger() gin.HandlerFunc {
	logger := log.New(gin.DefaultWriter, "", 0)
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		entry := map[string]any{
			"ts":         start.UTC().Format(time.RFC3339Nano),
			"level":      "info",
			"method":     c.Request.Method,
			"path":       c.Request.URL.Path,
			"route":      route,
			"status":     c.Writer.Status(),
			"latency_ms": float64(time.Since(start).Microseconds()) / 1000.0,
			"ip":         c.ClientIP(),
			"bytes":      c.Writer.Size(),
		}
		if ua := c.Request.UserAgent(); ua != "" {
			entry["user_agent"] = ua
		}
		if errs := c.Errors.ByType(gin.ErrorTypePrivate); len(errs) > 0 {
			entry["error"] = errs.String()
			entry["level"] = "error"
		}
		if b, err := json.Marshal(entry); err == nil {
			logger.Println(string(b))
		}
	}
}
