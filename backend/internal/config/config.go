package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServerAddr                   string
	AppEnv                       string
	SessionSecret                string
	RequestBodyLimit             int64
	AutoCreatePerformanceIndexes bool
	DBHost                       string
	DBPort                       int
	DBName                       string
	DBUser                       string
	DBPassword                   string
	DBSSLMode                    string
	DBSchema                     string
	DBMaxConns                   int32
	DBMinConns                   int32
	DBConnectTimeout             time.Duration
	DBQueryTimeout               time.Duration
	DBLockTimeout                time.Duration
	DBIdleTxTimeout              time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		ServerAddr:                   getEnv("SERVER_ADDR", ":8080"),
		AppEnv:                       getEnv("APP_ENV", "development"),
		SessionSecret:                getEnv("SESSION_SECRET", "dev-secret-change-me-at-least-32-chars"),
		RequestBodyLimit:             int64(getEnvInt("REQUEST_BODY_LIMIT_BYTES", 1_048_576)),
		AutoCreatePerformanceIndexes: getEnvBool("NSI_AUTO_CREATE_PERFORMANCE_INDEXES", true),
		DBHost:                       getEnv("SML_DB_HOST", "192.168.2.248"),
		DBName:                       getEnv("SML_DB_NAME", "sml1_2026"),
		DBUser:                       getEnv("SML_DB_USER", "postgres"),
		DBPassword:                   getEnv("SML_DB_PASSWORD", "sml"),
		DBSSLMode:                    getEnv("SML_DB_SSLMODE", "disable"),
		DBSchema:                     getEnv("SML_DB_SCHEMA", "public"),
		DBPort:                       getEnvInt("SML_DB_PORT", 5432),
		DBMaxConns:                   int32(getEnvInt("SML_DB_MAX_CONNS", 3)),
		DBMinConns:                   int32(getEnvInt("SML_DB_MIN_CONNS", 0)),
		DBConnectTimeout:             time.Duration(getEnvInt("SML_DB_CONNECT_TIMEOUT_SECONDS", 5)) * time.Second,
		DBQueryTimeout:               time.Duration(getEnvInt("SML_DB_QUERY_TIMEOUT_SECONDS", 30)) * time.Second,
		DBLockTimeout:                time.Duration(getEnvInt("SML_DB_LOCK_TIMEOUT_SECONDS", 2)) * time.Second,
		DBIdleTxTimeout:              time.Duration(getEnvInt("SML_DB_IDLE_TX_TIMEOUT_SECONDS", 10)) * time.Second,
	}
	return cfg, cfg.Validate()
}

func (c Config) Validate() error {
	if c.DBHost == "" || c.DBName == "" || c.DBUser == "" || c.DBPassword == "" {
		return errors.New("database env is incomplete")
	}
	if c.DBPort <= 0 || c.DBPort > 65535 {
		return fmt.Errorf("invalid database port: %d", c.DBPort)
	}
	if c.DBMaxConns <= 0 {
		return errors.New("SML_DB_MAX_CONNS must be greater than zero")
	}
	if c.DBMaxConns > 5 {
		return errors.New("SML_DB_MAX_CONNS must be 5 or lower to avoid competing with SML ERP")
	}
	if c.DBMinConns < 0 || c.DBMinConns > c.DBMaxConns {
		return errors.New("SML_DB_MIN_CONNS must be between 0 and SML_DB_MAX_CONNS")
	}
	if c.DBConnectTimeout <= 0 || c.DBQueryTimeout <= 0 || c.DBLockTimeout <= 0 || c.DBIdleTxTimeout <= 0 {
		return errors.New("database timeout values must be greater than zero")
	}
	if c.SessionSecret == "" || len(c.SessionSecret) < 32 {
		return errors.New("SESSION_SECRET must be at least 32 characters")
	}
	if c.AppEnv == "production" && c.SessionSecret == "dev-secret-change-me-at-least-32-chars" {
		return errors.New("SESSION_SECRET must be changed in production")
	}
	if c.RequestBodyLimit <= 0 || c.RequestBodyLimit > 5*1024*1024 {
		return errors.New("REQUEST_BODY_LIMIT_BYTES must be between 1 and 5242880")
	}
	return nil
}

func (c Config) IsProduction() bool {
	return c.AppEnv == "production"
}

func (c Config) WithDatabase(host string, port int, name, user, password, sslMode, schema string, maxConns int32) Config {
	c.DBHost = host
	c.DBPort = port
	c.DBName = name
	c.DBUser = user
	c.DBPassword = password
	c.DBSSLMode = sslMode
	c.DBSchema = schema
	c.DBMaxConns = maxConns
	if c.DBSSLMode == "" {
		c.DBSSLMode = "disable"
	}
	if c.DBSchema == "" {
		c.DBSchema = "public"
	}
	return c
}

func (c Config) DatabaseURL() string {
	hostPort := net.JoinHostPort(c.DBHost, strconv.Itoa(c.DBPort))
	return fmt.Sprintf("postgres://%s:%s@%s/%s?sslmode=%s&search_path=%s",
		url.QueryEscape(c.DBUser),
		url.QueryEscape(c.DBPassword),
		hostPort,
		url.PathEscape(c.DBName),
		url.QueryEscape(c.DBSSLMode),
		url.QueryEscape(c.DBSchema),
	)
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "on"
}
