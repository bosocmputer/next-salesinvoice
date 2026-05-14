package model

type DatabaseConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password,omitempty"`
	SSLMode  string `json:"sslMode"`
	Schema   string `json:"schema"`
	MaxConns int32  `json:"maxConns"`
}

type DatabaseConfigView struct {
	Saved          DatabaseConfig `json:"saved"`
	Active         DatabaseConfig `json:"active"`
	HasSavedConfig bool           `json:"hasSavedConfig"`
	NeedsReconnect bool           `json:"needsReconnect"`
}
