package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/session"
)

func TestSetSessionCookieIsSecureInProduction(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)

	setSessionCookie(ctx, config.Config{AppEnv: "production"}, "token", 3600)

	raw := recorder.Header().Get("Set-Cookie")
	if !strings.Contains(raw, "Secure") {
		t.Fatalf("production cookie missing Secure: %s", raw)
	}
	if !strings.Contains(raw, "SameSite=Strict") {
		t.Fatalf("production cookie missing strict SameSite: %s", raw)
	}
	if !strings.Contains(raw, "HttpOnly") {
		t.Fatalf("production cookie missing HttpOnly: %s", raw)
	}
}

func TestRequireRoleRejectsNonAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	deps := RouterDeps{}
	router := gin.New()
	router.GET("/admin", func(c *gin.Context) {
		c.Set("claims", session.Claims{UserCode: "EMP002", Role: "User"})
	}, deps.requireRole("Admin"), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestRequireRoleAllowsAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	deps := RouterDeps{}
	router := gin.New()
	router.GET("/admin", func(c *gin.Context) {
		c.Set("claims", session.Claims{UserCode: "EMP001", Role: "Admin"})
	}, deps.requireRole("Admin"), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}
