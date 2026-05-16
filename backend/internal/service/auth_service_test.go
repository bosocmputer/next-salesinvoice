package service

import (
	"testing"

	"golang.org/x/crypto/bcrypt"

	"next-salesinvoice/backend/internal/model"
)

func TestPasswordMatchesPlainTextDevPassword(t *testing.T) {
	user := model.ERPUser{Code: "EMP001", Password: "1234"}

	if !passwordMatches(user, "1234") {
		t.Fatal("passwordMatches() rejected the correct dev password")
	}
	if passwordMatches(user, "wrong") {
		t.Fatal("passwordMatches() accepted a wrong password")
	}
	if passwordMatches(model.ERPUser{Code: "EMP001"}, "1234") {
		t.Fatal("passwordMatches() accepted an empty stored password")
	}
}

func TestPasswordMatchesBcryptHash(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("secret-pass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}
	user := model.ERPUser{Code: "EMP002", Password: string(hash)}

	if !passwordMatches(user, "secret-pass") {
		t.Fatal("passwordMatches() rejected the correct bcrypt password")
	}
	if passwordMatches(user, "wrong-pass") {
		t.Fatal("passwordMatches() accepted a wrong bcrypt password")
	}
}

func TestIsBcryptHash(t *testing.T) {
	cases := map[string]bool{
		"$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345": true,
		"$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345": true,
		"$2y$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345": true,
		"1234":         false,
		"plainpass":    false,
		"$2a$10$short": false,
	}
	for hash, expected := range cases {
		if got := isBcryptHash(hash); got != expected {
			t.Errorf("isBcryptHash(%q) = %v, want %v", hash, got, expected)
		}
	}
}
