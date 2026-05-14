package service

import (
	"testing"

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
