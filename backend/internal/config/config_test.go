package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadDefaultsAreConservativeForSML(t *testing.T) {
	t.Setenv("SESSION_SECRET", "test-secret-at-least-32-characters")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DBMaxConns != 3 {
		t.Fatalf("DBMaxConns = %d, want 3", cfg.DBMaxConns)
	}
	if cfg.DBMinConns != 0 {
		t.Fatalf("DBMinConns = %d, want 0", cfg.DBMinConns)
	}
	if cfg.DBConnectTimeout != 5*time.Second {
		t.Fatalf("DBConnectTimeout = %v, want 5s", cfg.DBConnectTimeout)
	}
}

func TestValidateRejectsTooManyConnections(t *testing.T) {
	cfg := Config{
		ServerAddr:       ":8080",
		SessionSecret:    "test-secret-at-least-32-characters",
		DBHost:           "127.0.0.1",
		DBPort:           5432,
		DBName:           "sml",
		DBUser:           "postgres",
		DBPassword:       "secret",
		DBSSLMode:        "disable",
		DBSchema:         "public",
		DBMaxConns:       10,
		DBMinConns:       0,
		DBConnectTimeout: 5 * time.Second,
		DBQueryTimeout:   30 * time.Second,
		DBLockTimeout:    2 * time.Second,
		DBIdleTxTimeout:  10 * time.Second,
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("Validate() accepted too many DB connections")
	}
	if !strings.Contains(err.Error(), "5 or lower") {
		t.Fatalf("Validate() error = %q, want max connection message", err.Error())
	}
}

func TestValidateRejectsDefaultSecretInProduction(t *testing.T) {
	cfg := Config{
		ServerAddr:       ":8080",
		AppEnv:           "production",
		SessionSecret:    "dev-secret-change-me-at-least-32-chars",
		RequestBodyLimit: 1024,
		DBHost:           "127.0.0.1",
		DBPort:           5432,
		DBName:           "sml",
		DBUser:           "postgres",
		DBPassword:       "secret",
		DBSSLMode:        "disable",
		DBSchema:         "public",
		DBMaxConns:       3,
		DBMinConns:       0,
		DBConnectTimeout: 5 * time.Second,
		DBQueryTimeout:   30 * time.Second,
		DBLockTimeout:    2 * time.Second,
		DBIdleTxTimeout:  10 * time.Second,
	}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "changed in production") {
		t.Fatalf("Validate() error = %v, want production secret error", err)
	}
}

func TestValidateRejectsHugeRequestBodyLimit(t *testing.T) {
	cfg := Config{
		ServerAddr:       ":8080",
		SessionSecret:    "test-secret-at-least-32-characters",
		RequestBodyLimit: 10 * 1024 * 1024,
		DBHost:           "127.0.0.1",
		DBPort:           5432,
		DBName:           "sml",
		DBUser:           "postgres",
		DBPassword:       "secret",
		DBSSLMode:        "disable",
		DBSchema:         "public",
		DBMaxConns:       3,
		DBMinConns:       0,
		DBConnectTimeout: 5 * time.Second,
		DBQueryTimeout:   30 * time.Second,
		DBLockTimeout:    2 * time.Second,
		DBIdleTxTimeout:  10 * time.Second,
	}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "REQUEST_BODY_LIMIT_BYTES") {
		t.Fatalf("Validate() error = %v, want request body limit error", err)
	}
}

func TestDatabaseURLEscapesCredentials(t *testing.T) {
	cfg := Config{
		DBHost:     "127.0.0.1",
		DBPort:     5432,
		DBName:     "sml db",
		DBUser:     "post@gres",
		DBPassword: "p@ss word",
		DBSSLMode:  "disable",
		DBSchema:   "public",
	}

	dsn := cfg.DatabaseURL()
	if strings.Contains(dsn, "p@ss word") || strings.Contains(dsn, "post@gres") {
		t.Fatalf("DatabaseURL() did not escape credentials: %s", dsn)
	}
}
