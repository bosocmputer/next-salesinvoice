package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLoginRateLimiterBlocksAfterMaxAttempts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	deps := RouterDeps{}
	router := gin.New()
	router.POST("/login", deps.loginRateLimiter(), func(c *gin.Context) {
		c.Status(http.StatusUnauthorized) // simulate failed login
	})

	for i := 1; i <= 5; i++ {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i, recorder.Code)
		}
	}

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("6th attempt: expected 429, got %d", recorder.Code)
	}
	if recorder.Header().Get("Retry-After") == "" {
		t.Fatal("429 response missing Retry-After header")
	}
}

func TestLoginRateLimiterIsolatesIPs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	deps := RouterDeps{}
	router := gin.New()
	router.POST("/login", deps.loginRateLimiter(), func(c *gin.Context) {
		c.Status(http.StatusUnauthorized)
	})

	for i := 1; i <= 6; i++ {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = "10.0.0.2:1234"
		router.ServeHTTP(recorder, req)
		_ = recorder
	}

	// A different IP should still be allowed.
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = "10.0.0.3:1234"
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("isolated IP should not be rate-limited, got %d", recorder.Code)
	}
}
