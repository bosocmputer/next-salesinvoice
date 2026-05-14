package session

import (
	"strings"
	"testing"
	"time"
)

func TestManagerIssueAndParse(t *testing.T) {
	manager := NewManager("test-secret-at-least-32-characters", time.Hour)

	token, issued, err := manager.Issue("EMP001", "พนักงานขายหน้าร้าน", "Admin")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if token == "" {
		t.Fatal("Issue() returned empty token")
	}

	parsed, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if parsed.UserCode != issued.UserCode || parsed.DisplayName != issued.DisplayName || parsed.Role != issued.Role {
		t.Fatalf("parsed claims mismatch: got %+v want %+v", parsed, issued)
	}
}

func TestManagerRejectsTamperedToken(t *testing.T) {
	manager := NewManager("test-secret-at-least-32-characters", time.Hour)

	token, _, err := manager.Issue("EMP001", "User", "Admin")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		t.Fatalf("unexpected token format: %q", token)
	}
	tampered := parts[0] + ".bad-signature"

	if _, err := manager.Parse(tampered); err == nil {
		t.Fatal("Parse() accepted tampered token")
	}
}

func TestManagerRejectsExpiredToken(t *testing.T) {
	manager := NewManager("test-secret-at-least-32-characters", -time.Second)

	token, _, err := manager.Issue("EMP001", "User", "Admin")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if _, err := manager.Parse(token); err == nil {
		t.Fatal("Parse() accepted expired token")
	}
}
