package repository

import (
	"encoding/json"
	"testing"
	"time"
)

func TestTimestampWithoutTZAsBangkokKeepsWallClock(t *testing.T) {
	dbValue := time.Date(2026, 5, 25, 14, 7, 54, 123000000, time.UTC)

	got := timestampWithoutTZAsBangkok(dbValue)

	if got.Location().String() != "Asia/Bangkok" {
		t.Fatalf("location = %s, want Asia/Bangkok", got.Location())
	}
	if got.Hour() != 14 || got.Minute() != 7 || got.Second() != 54 {
		t.Fatalf("wall clock = %s, want 14:07:54", got.Format(time.RFC3339Nano))
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal timestamp: %v", err)
	}
	if string(raw) != `"2026-05-25T14:07:54.123+07:00"` {
		t.Fatalf("json = %s, want +07:00 timestamp", raw)
	}
}

func TestTimestampWithoutTZPtrAsBangkokNil(t *testing.T) {
	if got := timestampWithoutTZPtrAsBangkok(nil); got != nil {
		t.Fatalf("nil pointer converted to %#v", got)
	}
}
