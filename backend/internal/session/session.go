package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const CookieName = "nsi_session"

type Claims struct {
	UserCode    string `json:"userCode"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	ExpiresAt   int64  `json:"expiresAt"`
}

type Manager struct {
	secret []byte
	ttl    time.Duration
}

func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

func (m *Manager) Issue(userCode, displayName, role string) (string, Claims, error) {
	claims := Claims{
		UserCode:    userCode,
		DisplayName: displayName,
		Role:        role,
		ExpiresAt:   time.Now().Add(m.ttl).Unix(),
	}
	body, err := json.Marshal(claims)
	if err != nil {
		return "", Claims{}, err
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	signature := m.sign(payload)
	return payload + "." + signature, claims, nil
}

func (m *Manager) Parse(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Claims{}, errors.New("invalid token format")
	}
	if !hmac.Equal([]byte(parts[1]), []byte(m.sign(parts[0]))) {
		return Claims{}, errors.New("invalid token signature")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, fmt.Errorf("decode token: %w", err)
	}
	var claims Claims
	if err := json.Unmarshal(body, &claims); err != nil {
		return Claims{}, fmt.Errorf("parse token: %w", err)
	}
	if claims.ExpiresAt <= time.Now().Unix() {
		return Claims{}, errors.New("token expired")
	}
	return claims, nil
}

func (m *Manager) sign(payload string) string {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
