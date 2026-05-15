package http

import (
	"errors"
	nethttp "net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"next-salesinvoice/backend/internal/appruntime"
	"next-salesinvoice/backend/internal/audit"
	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/db"
	"next-salesinvoice/backend/internal/errorcode"
	"next-salesinvoice/backend/internal/migration"
	"next-salesinvoice/backend/internal/model"
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
	r.Use(gin.Logger(), deps.jsonRecovery(), deps.requestBodyLimit())
	r.NoRoute(func(c *gin.Context) {
		response.Error(c, nethttp.StatusNotFound, errorcode.NotFound, "not found", "route does not exist")
	})

	api := r.Group("/api/v1")
	api.GET("/health", deps.health)
	api.GET("/system/database-status", deps.databaseStatus)
	api.POST("/system/database-bootstrap", deps.databaseBootstrap)
	api.GET("/system/database-config", deps.authMiddleware(), deps.requireRole("Admin"), deps.databaseConfig)
	api.PUT("/system/database-config", deps.authMiddleware(), deps.requireRole("Admin"), deps.saveDatabaseConfig)
	api.POST("/system/database-reconnect", deps.authMiddleware(), deps.requireRole("Admin"), deps.databaseReconnect)
	api.POST("/system/database-verify", deps.databaseVerify)
	api.POST("/system/database-migrate", deps.authMiddleware(), deps.requireRole("Admin"), deps.databaseMigrate)
	api.POST("/auth/login", deps.login)
	api.POST("/auth/logout", deps.logout)
	api.GET("/auth/me", deps.authMiddleware(), deps.me)
	api.GET("/documents", deps.authMiddleware(), deps.documentsList)
	api.GET("/documents/selectable-doc-nos", deps.authMiddleware(), deps.selectableDocumentNumbers)
	api.POST("/documents/bulk/preview-change", deps.authMiddleware(), deps.bulkDocumentChangePreview)
	api.POST("/documents/bulk/apply-change", deps.authMiddleware(), deps.requireRole("Admin"), deps.bulkDocumentChangeApply)
	api.POST("/documents/rollback", deps.authMiddleware(), deps.requireRole("Admin"), deps.documentRollback)
	api.GET("/documents/:docNo/details", deps.authMiddleware(), deps.documentDetails)
	api.POST("/documents/:docNo/preview-change", deps.authMiddleware(), deps.documentChangePreview)
	api.POST("/documents/:docNo/apply-change", deps.authMiddleware(), deps.requireRole("Admin"), deps.documentChangeApply)
	api.GET("/documents/running-number", deps.authMiddleware(), deps.runningNumber)
	api.GET("/master/doc-formats", deps.authMiddleware(), deps.docFormats)
	api.GET("/master/customers", deps.authMiddleware(), deps.customers)
	api.GET("/master/products", deps.authMiddleware(), deps.products)
	api.GET("/master/sale-types", deps.authMiddleware(), deps.saleTypes)
	api.GET("/master/tax-types", deps.authMiddleware(), deps.taxTypes)
	api.GET("/audit-logs", deps.authMiddleware(), deps.requireRole("Admin"), deps.auditLogs)
	api.GET("/audit-documents", deps.authMiddleware(), deps.requireRole("Admin"), deps.auditDocuments)

	return r
}

func (d RouterDeps) documentsList(c *gin.Context) {
	from, to, ok := parseDateRange(c)
	if !ok {
		return
	}
	page := parseBoundedInt(c.Query("page"), 1, 1, 100000)
	pageSize := parseBoundedInt(c.Query("pageSize"), 50, 1, 100)
	items, hasMore, err := d.state.Current().Documents.List(c.Request.Context(), from, to, page, pageSize, c.Query("q"))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load documents failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{
		"items":    items,
		"page":     page,
		"pageSize": pageSize,
		"total":    len(items),
		"hasMore":  hasMore,
	})
}

func (d RouterDeps) selectableDocumentNumbers(c *gin.Context) {
	from, to, ok := parseDateRange(c)
	if !ok {
		return
	}
	limit := parseBoundedInt(c.Query("limit"), 300, 1, 300)
	items, hasMore, err := d.state.Current().Documents.ListDocNos(c.Request.Context(), from, to, c.Query("q"), limit)
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
	items, err := d.state.Current().Documents.Details(c.Request.Context(), docNo)
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
	preview, err := d.state.Current().Documents.PreviewChange(c.Request.Context(), docNo, req)
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
	preview, err := d.state.Current().Documents.ApplyChangeWithSnapshot(c.Request.Context(), docNo, req, claims.UserCode)
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
	result, err := d.state.Current().Documents.BulkPreviewChange(c.Request.Context(), req)
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
	result, err := d.state.Current().Documents.BulkApplyChange(c.Request.Context(), req, claims.UserCode)
	if err != nil {
		d.writeDocumentAudit(c, claims, "bulk.apply_change_failed", "bulk", gin.H{"request": req}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "apply bulk document change failed", err.Error())
		return
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

func (d RouterDeps) documentRollback(c *gin.Context) {
	var req model.RollbackDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid rollback input", "request body is invalid")
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	result, err := d.state.Current().Documents.RollbackDocument(c.Request.Context(), req, claims.UserCode)
	if err != nil {
		d.writeDocumentAudit(c, claims, "document.rollback_failed", req.DocNo, gin.H{"request": req}, gin.H{"error": err.Error()})
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "rollback document failed", err.Error())
		return
	}
	d.writeDocumentAudit(c, claims, "document.rollback", result.Restored.DocNo, gin.H{"request": req}, gin.H{"restored": result.Restored})
	response.OK(c, nethttp.StatusOK, "document rolled back", result)
}

func (d RouterDeps) writeDocumentAudit(c *gin.Context, claims session.Claims, action, docNo string, before, after any) {
	_ = d.state.Current().Audit.Write(c.Request.Context(), audit.Entry{
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
	items, err := d.state.Current().Documents.DocFormats(c.Request.Context())
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
	nextDocNo, latestDocNo, err := d.state.Current().Documents.NextDocNo(c.Request.Context(), formatCode)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load running number failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"formatCode": formatCode, "latestDocNo": latestDocNo, "nextDocNo": nextDocNo})
}

func (d RouterDeps) customers(c *gin.Context) {
	items, err := d.state.Current().Documents.SearchCustomers(c.Request.Context(), c.Query("q"), parseBoundedInt(c.Query("limit"), 20, 1, 50))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load customers failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) products(c *gin.Context) {
	items, err := d.state.Current().Documents.SearchProducts(c.Request.Context(), c.Query("q"), parseBoundedInt(c.Query("limit"), 20, 1, 50))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load products failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) saleTypes(c *gin.Context) {
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": []gin.H{
		{"value": 1, "label": "ขายเงินเชื่อ"},
		{"value": 2, "label": "ขายเงินสด"},
		{"value": 3, "label": "ขายสินค้าเงินเชื่อ (สินค้าบริการ)"},
		{"value": 4, "label": "ขายสินค้าเงินสด (สินค้าบริการ)"},
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
	items, err := d.state.Current().Audits.List(c.Request.Context(), c.Query("resourceId"), parseBoundedInt(c.Query("limit"), 20, 1, 100))
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load audit logs failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", gin.H{"items": items})
}

func (d RouterDeps) auditDocuments(c *gin.Context) {
	items, err := d.state.Current().Audits.DocumentHistory(c.Request.Context(), c.Query("docNo"), parseBoundedInt(c.Query("limit"), 10, 1, 50))
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

func (d RouterDeps) databaseStatus(c *gin.Context) {
	status, err := d.state.Current().Migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database verification failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", status)
}

func (d RouterDeps) databaseConfig(c *gin.Context) {
	configView, err := d.state.Current().Settings.DatabaseConfig(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "load database config failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "ok", configView)
}

func (d RouterDeps) saveDatabaseConfig(c *gin.Context) {
	var req model.DatabaseConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid database config", "request body is invalid")
		return
	}
	claims := c.MustGet("claims").(session.Claims)
	configView, err := d.state.Current().Settings.SaveDatabaseConfig(c.Request.Context(), req, claims.UserCode)
	if err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "save database config failed", err.Error())
		return
	}
	_ = d.state.Current().Audit.Write(c.Request.Context(), audit.Entry{
		UserCode:     claims.UserCode,
		Action:       "system.database_config_saved",
		ResourceType: "nsi_app_settings",
		ResourceID:   "database.connection",
		After:        configView,
		IPAddress:    c.ClientIP(),
		UserAgent:    c.Request.UserAgent(),
	})
	response.OK(c, nethttp.StatusOK, "database config saved", configView)
}

func (d RouterDeps) databaseReconnect(c *gin.Context) {
	claims := c.MustGet("claims").(session.Claims)
	current := d.state.Current()
	saved, err := current.Settings.SavedDatabaseConfig(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "load saved database config failed", err.Error())
		return
	}
	nextCfg := current.Cfg.WithDatabase(
		saved.Host,
		saved.Port,
		saved.Database,
		saved.User,
		saved.Password,
		saved.SSLMode,
		saved.Schema,
		saved.MaxConns,
	)
	if err := nextCfg.Validate(); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "saved database config is invalid", err.Error())
		return
	}
	snapshot, err := d.state.Reconnect(c.Request.Context(), nextCfg)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database reconnect failed", err.Error())
		return
	}
	status, err := snapshot.Migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database reconnect verify failed", err.Error())
		return
	}
	_ = snapshot.Audit.Write(c.Request.Context(), audit.Entry{
		UserCode:     claims.UserCode,
		Action:       "system.database_reconnected",
		ResourceType: "database",
		ResourceID:   status.Database,
		After: gin.H{
			"database": status.Database,
			"host":     saved.Host,
			"port":     saved.Port,
		},
		IPAddress: c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
	})
	response.OK(c, nethttp.StatusOK, "database reconnected", gin.H{"status": status})
}

type databaseBootstrapRequest struct {
	SetupSecret string               `json:"setupSecret"`
	Config      model.DatabaseConfig `json:"config"`
}

func (d RouterDeps) databaseBootstrap(c *gin.Context) {
	var req databaseBootstrapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid database setup input", "request body is invalid")
		return
	}
	if d.cfg.DatabaseSetupSecret == "" || req.SetupSecret != d.cfg.DatabaseSetupSecret {
		response.Error(c, nethttp.StatusForbidden, errorcode.Forbidden, "forbidden", "database setup secret is invalid")
		return
	}
	cfg := d.state.Current().Cfg.WithDatabase(
		strings.TrimSpace(req.Config.Host),
		req.Config.Port,
		strings.TrimSpace(req.Config.Database),
		strings.TrimSpace(req.Config.User),
		req.Config.Password,
		strings.TrimSpace(req.Config.SSLMode),
		strings.TrimSpace(req.Config.Schema),
		req.Config.MaxConns,
	)
	if cfg.DBMaxConns <= 0 {
		cfg.DBMaxConns = d.cfg.DBMaxConns
	}
	if err := cfg.Validate(); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "database setup is invalid", err.Error())
		return
	}
	snapshot, err := d.state.Reconnect(c.Request.Context(), cfg)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database setup failed", err.Error())
		return
	}
	if err := snapshot.Migrator.VerifyAndMigrate(c.Request.Context()); err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database setup migration failed", err.Error())
		return
	}
	status, err := snapshot.Migrator.Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database setup verify failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "database setup applied", gin.H{"status": status})
}

func (d RouterDeps) databaseVerify(c *gin.Context) {
	var req model.DatabaseConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid database verify input", "request body is invalid")
		return
	}
	cfg := d.state.Current().Cfg.WithDatabase(
		strings.TrimSpace(req.Host),
		req.Port,
		strings.TrimSpace(req.Database),
		strings.TrimSpace(req.User),
		req.Password,
		strings.TrimSpace(req.SSLMode),
		strings.TrimSpace(req.Schema),
		req.MaxConns,
	)
	if cfg.DBMaxConns <= 0 {
		cfg.DBMaxConns = d.cfg.DBMaxConns
	}
	if err := cfg.Validate(); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "database verify input is invalid", err.Error())
		return
	}
	pool, err := db.NewPool(c.Request.Context(), cfg)
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database verify failed", err.Error())
		return
	}
	defer pool.Close()
	status, err := migration.New(pool, cfg).Verify(c.Request.Context())
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database verify failed", err.Error())
		return
	}
	response.OK(c, nethttp.StatusOK, "database verify success", gin.H{"status": status})
}

func (d RouterDeps) databaseMigrate(c *gin.Context) {
	if err := d.state.Current().Migrator.VerifyAndMigrate(c.Request.Context()); err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DatabaseVerification, "database migration failed", err.Error())
		return
	}
	d.databaseStatus(c)
}

type loginRequest struct {
	Code     string `json:"code" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (d RouterDeps) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "invalid login input", "code and password are required")
		return
	}
	result, err := d.state.Current().Auth.Login(c.Request.Context(), req.Code, req.Password, service.AuditMeta{
		IPAddress: c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
	})
	if errors.Is(err, service.ErrInvalidCredentials) {
		response.Error(c, nethttp.StatusUnauthorized, errorcode.InvalidCredentials, "invalid username or password", "login credentials are not valid")
		return
	}
	if errors.Is(err, service.ErrUserInactive) {
		response.Error(c, nethttp.StatusForbidden, errorcode.Forbidden, "user is not allowed to login", "user is inactive or disabled")
		return
	}
	if err != nil {
		response.Error(c, nethttp.StatusInternalServerError, errorcode.DBConnection, "login failed", err.Error())
		return
	}
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
		c.Set("claims", claims)
		c.Next()
	}
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
		Secure:   cfg.IsProduction(),
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
	if to.Sub(from) > 366*24*time.Hour {
		response.Error(c, nethttp.StatusBadRequest, errorcode.InvalidInput, "date range too large", "date range must be 366 days or less")
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
