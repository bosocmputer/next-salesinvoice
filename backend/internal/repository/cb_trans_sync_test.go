package repository

import (
	"math"
	"testing"
)

// approxEqual returns true when |a-b| is within 0.01 — the same tolerance the
// production invariant check uses.
func approxEqual(a, b float64) bool {
	return math.Abs(a-b) <= 0.01
}

func sumArr(a [10]float64) float64 {
	var s float64
	for _, v := range a {
		s += v
	}
	return s
}

func TestScaleCbTransFields_NoChange(t *testing.T) {
	fields := [10]float64{100, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	out, ratio := scaleCbTransFields(fields, 100, 100)
	if ratio != 1 {
		t.Fatalf("ratio = %v, want 1", ratio)
	}
	if out != fields {
		t.Fatalf("fields mutated: got %v want %v", out, fields)
	}
}

func TestScaleCbTransFields_NoChange_NearEpsilon(t *testing.T) {
	fields := [10]float64{123.45, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	// Difference smaller than 0.005 is treated as no-change.
	out, ratio := scaleCbTransFields(fields, 123.45, 123.4501)
	if ratio != 1 || out != fields {
		t.Fatalf("expected noop, got ratio=%v out=%v", ratio, out)
	}
}

func TestScaleCbTransFields_OldPayZero_CashAbsorbs(t *testing.T) {
	var fields [10]float64 // all zero
	out, ratio := scaleCbTransFields(fields, 0, 250.75)
	if ratio != 0 {
		t.Fatalf("ratio = %v, want 0", ratio)
	}
	if out[0] != 250.75 {
		t.Fatalf("cash_amount = %v, want 250.75", out[0])
	}
	for i := 1; i < 10; i++ {
		if out[i] != 0 {
			t.Fatalf("field[%d] = %v, want 0", i, out[i])
		}
	}
}

func TestScaleCbTransFields_OldPayTiny_CashAbsorbs(t *testing.T) {
	// oldPay below 0.005 threshold also routes everything to cash.
	fields := [10]float64{0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	out, ratio := scaleCbTransFields(fields, 0.001, 500)
	if ratio != 0 {
		t.Fatalf("ratio = %v, want 0 (tiny oldPay branch)", ratio)
	}
	if out[0] != 500 {
		t.Fatalf("cash_amount = %v, want 500", out[0])
	}
}

func TestScaleCbTransFields_Proportional_ExactSum(t *testing.T) {
	// Cash 60 + transfer 40 = 100; rescale to 250 → cash 150, transfer 100.
	fields := [10]float64{60, 0, 40, 0, 0, 0, 0, 0, 0, 0}
	out, ratio := scaleCbTransFields(fields, 100, 250)
	if math.Abs(ratio-2.5) > 1e-9 {
		t.Fatalf("ratio = %v, want 2.5", ratio)
	}
	if !approxEqual(out[0], 150) {
		t.Fatalf("cash = %v, want 150", out[0])
	}
	if !approxEqual(out[2], 100) {
		t.Fatalf("tranfer = %v, want 100", out[2])
	}
	if !approxEqual(sumArr(out), 250) {
		t.Fatalf("sum = %v, want 250", sumArr(out))
	}
}

func TestScaleCbTransFields_Proportional_RoundingResidualToCash(t *testing.T) {
	// Three equal slices that don't divide cleanly: oldPay = 100, newTotal = 100.01.
	// Each non-cash field scales but the rounding residual must land on cash.
	fields := [10]float64{33.33, 33.33, 0, 33.34, 0, 0, 0, 0, 0, 0}
	out, ratio := scaleCbTransFields(fields, 100, 100.01)
	if ratio == 1 {
		t.Fatalf("unexpected noop ratio for non-trivial diff")
	}
	if !approxEqual(sumArr(out), 100.01) {
		t.Fatalf("sum = %v, want 100.01 (residual not absorbed)", sumArr(out))
	}
}

func TestScaleCbTransFields_ScaleDown(t *testing.T) {
	// 1000 → 750 (75%): each field shrinks, residual into cash.
	fields := [10]float64{500, 0, 300, 200, 0, 0, 0, 0, 0, 0}
	out, ratio := scaleCbTransFields(fields, 1000, 750)
	if math.Abs(ratio-0.75) > 1e-9 {
		t.Fatalf("ratio = %v, want 0.75", ratio)
	}
	if !approxEqual(sumArr(out), 750) {
		t.Fatalf("sum = %v, want 750", sumArr(out))
	}
	if !approxEqual(out[2], 225) {
		t.Fatalf("tranfer = %v, want 225", out[2])
	}
	if !approxEqual(out[3], 150) {
		t.Fatalf("card = %v, want 150", out[3])
	}
}

func TestScaleCbTransFields_ScaleToZero(t *testing.T) {
	// Bill emptied (all lines removed) → newTotal 0, all fields zeroed.
	fields := [10]float64{200, 0, 100, 0, 0, 0, 0, 0, 0, 0}
	out, ratio := scaleCbTransFields(fields, 300, 0)
	// ratio = 0/300 = 0; sum should be 0 after residual reconciliation.
	if math.Abs(ratio) > 1e-9 {
		t.Fatalf("ratio = %v, want 0", ratio)
	}
	if !approxEqual(sumArr(out), 0) {
		t.Fatalf("sum = %v, want 0", sumArr(out))
	}
}

func TestRound2(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0, 0},
		{1.004, 1.00},
		{1.006, 1.01},
		{123.456, 123.46},
	}
	for _, c := range cases {
		got := round2(c.in)
		if math.Abs(got-c.want) > 1e-9 {
			t.Errorf("round2(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestIsJSONNull(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"null", true},
		{"  null", true},
		{"\n\tnull", true},
		{"{}", false},
		{"[]", false},
		{`{"a":1}`, false},
		{"", true}, // empty = treated as null-ish (no data)
	}
	for _, c := range cases {
		got := isJSONNull([]byte(c.in))
		if got != c.want {
			t.Errorf("isJSONNull(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
