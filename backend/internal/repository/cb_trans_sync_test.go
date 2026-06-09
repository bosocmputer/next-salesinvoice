package repository

import (
	"errors"
	"math"
	"os"
	"strings"
	"testing"

	"next-salesinvoice/backend/internal/model"
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
	out, delta := scaleCbTransFields(fields, 100, 100)
	if delta != 0 {
		t.Fatalf("delta = %v, want 0", delta)
	}
	if out != fields {
		t.Fatalf("fields mutated: got %v want %v", out, fields)
	}
}

func TestScaleCbTransFields_NoChange_NearEpsilon(t *testing.T) {
	fields := [10]float64{123.45, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	// Difference smaller than 0.005 is treated as no-change.
	out, delta := scaleCbTransFields(fields, 123.45, 123.4501)
	if delta != 0 || out != fields {
		t.Fatalf("expected noop, got delta=%v out=%v", delta, out)
	}
}

func TestScaleCbTransFields_OldPayZero_CashAbsorbs(t *testing.T) {
	var fields [10]float64 // all zero
	out, delta := scaleCbTransFields(fields, 0, 250.75)
	if delta != 250.75 {
		t.Fatalf("delta = %v, want 250.75", delta)
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
	out, delta := scaleCbTransFields(fields, 0.001, 500)
	if delta != 500 {
		t.Fatalf("delta = %v, want 500", delta)
	}
	if out[0] != 500 {
		t.Fatalf("cash_amount = %v, want 500", out[0])
	}
}

func TestScaleCbTransFields_Proportional_ExactSum(t *testing.T) {
	// Cash 60 + transfer 40 = 100; cash-only to 250 → cash 210, transfer 40.
	fields := [10]float64{60, 0, 40, 0, 0, 0, 0, 0, 0, 0}
	out, delta := scaleCbTransFields(fields, 100, 250)
	if math.Abs(delta-150) > 1e-9 {
		t.Fatalf("delta = %v, want 150", delta)
	}
	if !approxEqual(out[0], 210) {
		t.Fatalf("cash = %v, want 210", out[0])
	}
	if !approxEqual(out[2], 40) {
		t.Fatalf("tranfer = %v, want 40", out[2])
	}
	if !approxEqual(sumArr(out), 250) {
		t.Fatalf("sum = %v, want 250", sumArr(out))
	}
}

func TestScaleCbTransFields_Proportional_RoundingResidualToCash(t *testing.T) {
	// Small delta must land on cash only.
	fields := [10]float64{33.33, 33.33, 0, 33.34, 0, 0, 0, 0, 0, 0}
	out, delta := scaleCbTransFields(fields, 100, 100.01)
	if !approxEqual(delta, 0.01) {
		t.Fatalf("delta = %v, want 0.01", delta)
	}
	if !approxEqual(sumArr(out), 100.01) {
		t.Fatalf("sum = %v, want 100.01 (residual not absorbed)", sumArr(out))
	}
}

func TestScaleCbTransFields_ScaleDown(t *testing.T) {
	// 1000 → 750: only cash shrinks; non-cash stays untouched.
	fields := [10]float64{500, 0, 300, 200, 0, 0, 0, 0, 0, 0}
	out, delta := scaleCbTransFields(fields, 1000, 750)
	if math.Abs(delta+250) > 1e-9 {
		t.Fatalf("delta = %v, want -250", delta)
	}
	if !approxEqual(sumArr(out), 750) {
		t.Fatalf("sum = %v, want 750", sumArr(out))
	}
	if !approxEqual(out[2], 300) {
		t.Fatalf("tranfer = %v, want 300", out[2])
	}
	if !approxEqual(out[3], 200) {
		t.Fatalf("card = %v, want 200", out[3])
	}
}

func TestScaleCbTransFields_ScaleToZero(t *testing.T) {
	// Bill emptied (all lines removed) → newTotal 0, all fields zeroed.
	fields := [10]float64{200, 0, 100, 0, 0, 0, 0, 0, 0, 0}
	out, delta := scaleCbTransFields(fields, 300, 0)
	if math.Abs(delta+300) > 1e-9 {
		t.Fatalf("delta = %v, want -300", delta)
	}
	if !approxEqual(sumArr(out), 0) {
		t.Fatalf("sum = %v, want 0", sumArr(out))
	}
}

func TestScaleCbTransFields_LegacyDetailOnlyPaymentKeepsHeaderDrift(t *testing.T) {
	// Some transferred SML bills keep payment amount in cb_trans_detail
	// (for example doc_type=11) while all cb_trans instrument columns are 0.
	// Bulk edit must not invent a cash payment when the bill total is unchanged.
	var fields [10]float64
	out, delta := scaleCbTransFields(fields, 631.30, 631.30)
	if delta != 0 {
		t.Fatalf("delta = %v, want 0", delta)
	}
	if out != fields {
		t.Fatalf("fields mutated: got %v want %v", out, fields)
	}
	if got := sumPaymentFields(out); got != 0 {
		t.Fatalf("sumPaymentFields = %v, want legacy drift 0", got)
	}
}

func TestPaymentTotalBelowCashAmount(t *testing.T) {
	cases := []struct {
		name     string
		fields   [10]float64
		newTotal float64
		want     bool
	}{
		{name: "cash only below cash is blocked", fields: [10]float64{7400, 0, 0, 0, 0, 0, 0, 0, 0, 0}, newTotal: 5000, want: true},
		{name: "cash only equal cash allowed", fields: [10]float64{7400, 0, 0, 0, 0, 0, 0, 0, 0, 0}, newTotal: 7400, want: false},
		{name: "multi channel equal", fields: [10]float64{7400, 0, 1000, 0, 0, 0, 0, 0, 0, 0}, newTotal: 7400, want: false},
		{name: "multi channel above", fields: [10]float64{7400, 0, 1000, 0, 0, 0, 0, 0, 0, 0}, newTotal: 7500, want: false},
		{name: "multi channel below within tolerance", fields: [10]float64{7400, 0, 1000, 0, 0, 0, 0, 0, 0, 0}, newTotal: 7399.995, want: false},
		{name: "multi channel below", fields: [10]float64{7400, 0, 1000, 0, 0, 0, 0, 0, 0, 0}, newTotal: 7399.98, want: true},
		{name: "no cash", fields: [10]float64{}, newTotal: 0, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := paymentTotalBelowCashAmount(tc.fields, tc.newTotal); got != tc.want {
				t.Fatalf("paymentTotalBelowCashAmount(%v, %v) = %v, want %v", tc.fields, tc.newTotal, got, tc.want)
			}
		})
	}
}

func TestApplyCashOnlyPaymentDelta_AllowsCashAmountReduction(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "7400.00",
		CashAmount:     "7400.00",
		Details:        []model.DocumentPaymentDetail{},
	}
	after, err := applyCashOnlyPaymentDelta(before, 5000)
	if err != nil {
		t.Fatalf("applyCashOnlyPaymentDelta returned error: %v", err)
	}
	if after.CashAmount != "5000.00" || after.TotalAmountPay != "5000.00" {
		t.Fatalf("unexpected reduced cash payment: %#v", after)
	}
}

func TestApplyCashOnlyPaymentDelta_BlocksBelowPettyCashDetail(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "7400.00",
		CashAmount:     "0.00",
		Details:        []model.DocumentPaymentDetail{{DocType: 4, TransNumber: "PC007", Amount: "7400.00", SumAmount: "0.00"}},
	}
	_, err := applyCashOnlyPaymentDelta(before, 5000)
	if err == nil {
		t.Fatal("applyCashOnlyPaymentDelta returned nil, want protected petty cash block")
	}
	if !strings.Contains(err.Error(), "เงินสดย่อย") {
		t.Fatalf("expected petty cash label in error, got %v", err)
	}
}

func TestApplyCashOnlyPaymentDelta_IncreaseKeepsNonCash(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "100.00",
		PayCashAmount:  "120.00",
		MoneyChange:    "60.00",
		CashAmount:     "60.00",
		TranferAmount:  "40.00",
		CardAmount:     "0.00",
		Details:        []model.DocumentPaymentDetail{{DocType: 1, Amount: "40.00", SumAmount: "0.00"}},
	}
	after, err := applyCashOnlyPaymentDelta(before, 120)
	if err != nil {
		t.Fatalf("applyCashOnlyPaymentDelta returned error: %v", err)
	}
	if after.CashAmount != "80.00" || after.TranferAmount != "40.00" || after.PayCashAmount != "120.00" || after.MoneyChange != "40.00" {
		t.Fatalf("unexpected payment after: %#v", after)
	}
	if after.Details[0].Amount != "40.00" {
		t.Fatalf("unexpected detail amounts: %#v", after.Details)
	}
}

func TestApplyCashOnlyPaymentDelta_IncreaseUsesCashAmountNotPayCashAmount(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "100.00",
		PayCashAmount:  "0.00",
		CashAmount:     "60.00",
		TranferAmount:  "40.00",
		Details:        []model.DocumentPaymentDetail{{DocType: 1, Amount: "40.00", SumAmount: "0.00"}},
	}
	after, err := applyCashOnlyPaymentDelta(before, 170)
	if err != nil {
		t.Fatalf("applyCashOnlyPaymentDelta returned error: %v", err)
	}
	if after.CashAmount != "130.00" || after.PayCashAmount != "0.00" || after.TotalAmountPay != "170.00" {
		t.Fatalf("unexpected payment after: %#v", after)
	}
	if after.Details[0].Amount != "40.00" {
		t.Fatalf("payment detail amount = %s, want unchanged 40.00", after.Details[0].Amount)
	}
}

func TestApplyCashOnlyPaymentDelta_AllowsLegacyHeaderWhenTotalUnchanged(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "7400.00",
		PayCashAmount:  "0.00",
		CashAmount:     "7400.00",
		Details:        []model.DocumentPaymentDetail{},
	}
	after, err := applyCashOnlyPaymentDelta(before, 7400)
	if err != nil {
		t.Fatalf("applyCashOnlyPaymentDelta returned error for unchanged legacy cash header: %v", err)
	}
	if after.CashAmount != "7400.00" || after.PayCashAmount != "0.00" || after.TotalAmountPay != "7400.00" {
		t.Fatalf("unexpected unchanged legacy payment after: %#v", after)
	}
}

func TestEvaluateCbTransPaymentPolicy_LegacyDetailOnlyPaymentAllowed(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "631.30",
		CashAmount:     "0.00",
		PayCashAmount:  "0.00",
		Details:        []model.DocumentPaymentDetail{{DocType: 11, Amount: "631.30", SumAmount: "0.00"}},
	}
	policy := evaluateCbTransPaymentPolicy(before, 631.30)
	if !policy.Allowed {
		t.Fatalf("policy blocked legacy detail-only payment: %s", policy.BlockedReason)
	}
	if policy.PaymentAfter.CashAmount != "0.00" || policy.ExpectedInstrumentSum != 0 {
		t.Fatalf("unexpected legacy policy result: %#v", policy)
	}
	if policy.PaymentAfter.Details[0].Amount != "631.30" || policy.PaymentAfter.Details[0].SumAmount != "0.00" {
		t.Fatalf("payment detail changed: %#v", policy.PaymentAfter.Details)
	}
}

func TestEvaluateCbTransPaymentPolicy_Converts3881CreditCardDetailToCash(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "1000.00",
		CashAmount:     "100.00",
		PayCashAmount:  "1000.00",
		CardAmount:     "900.00",
		Details: []model.DocumentPaymentDetail{
			{DocType: 3, TransNumber: "CARD-3881", Amount: "900.00", SumAmount: "900.00"},
		},
	}

	policy := evaluateCbTransPaymentPolicy(before, 1000)
	if !policy.Allowed {
		t.Fatalf("policy blocked 3881 card conversion: %s", policy.BlockedReason)
	}
	if policy.CardToCashAmount != 900 {
		t.Fatalf("CardToCashAmount = %v, want 900", policy.CardToCashAmount)
	}
	after := policy.PaymentAfter
	if after.CashAmount != "1000.00" || after.CardAmount != "0.00" || after.TotalAmountPay != "1000.00" {
		t.Fatalf("unexpected payment after: %#v", after)
	}
	if len(after.Details) != 0 {
		t.Fatalf("expected 3881 card detail to be removed, got %#v", after.Details)
	}
	if policy.ExpectedInstrumentSum != 1000 {
		t.Fatalf("ExpectedInstrumentSum = %v, want 1000", policy.ExpectedInstrumentSum)
	}
}

func TestEvaluateCbTransPaymentPolicy_ConvertsDetailOnly3881CreditCardToCash(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "900.00",
		CashAmount:     "0.00",
		PayCashAmount:  "0.00",
		CardAmount:     "0.00",
		Details: []model.DocumentPaymentDetail{
			{DocType: 3, TransNumber: "3881", Amount: "900.00", SumAmount: "900.00"},
		},
	}

	policy := evaluateCbTransPaymentPolicy(before, 900)
	if !policy.Allowed {
		t.Fatalf("policy blocked detail-only 3881 card conversion: %s", policy.BlockedReason)
	}
	after := policy.PaymentAfter
	if after.CashAmount != "900.00" || after.PayCashAmount != "900.00" || after.CardAmount != "0.00" || after.TotalAmountPay != "900.00" {
		t.Fatalf("unexpected payment after: %#v", after)
	}
	if len(after.Details) != 0 {
		t.Fatalf("expected detail-only 3881 card detail to be removed, got %#v", after.Details)
	}
	if policy.ExpectedInstrumentSum != 900 {
		t.Fatalf("ExpectedInstrumentSum = %v, want 900", policy.ExpectedInstrumentSum)
	}
}

func TestEvaluateCbTransPaymentPolicy_Matches3881CreditCardTypeAndAppliesDelta(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "1000.00",
		CashAmount:     "100.00",
		PayCashAmount:  "1000.00",
		CardAmount:     "900.00",
		Details: []model.DocumentPaymentDetail{
			{DocType: 3, CreditCardType: "3881", Amount: "900.00", SumAmount: "900.00"},
		},
	}

	policy := evaluateCbTransPaymentPolicy(before, 950)
	if !policy.Allowed {
		t.Fatalf("policy blocked 3881 card conversion with delta: %s", policy.BlockedReason)
	}
	after := policy.PaymentAfter
	if after.CashAmount != "950.00" || after.CardAmount != "0.00" || after.TotalAmountPay != "950.00" {
		t.Fatalf("unexpected payment after: %#v", after)
	}
	if len(after.Details) != 0 {
		t.Fatalf("expected 3881 card detail to be removed, got %#v", after.Details)
	}
}

func TestEvaluateCbTransPaymentPolicy_DoesNotConvertOtherCreditCards(t *testing.T) {
	before := model.DocumentPayment{
		TotalAmountPay: "1000.00",
		CashAmount:     "100.00",
		PayCashAmount:  "1000.00",
		CardAmount:     "900.00",
		Details: []model.DocumentPaymentDetail{
			{DocType: 3, TransNumber: "CARD-9999", Amount: "900.00", SumAmount: "900.00"},
		},
	}

	policy := evaluateCbTransPaymentPolicy(before, 1000)
	if !policy.Allowed {
		t.Fatalf("policy blocked other card: %s", policy.BlockedReason)
	}
	after := policy.PaymentAfter
	if after.CashAmount != "100.00" || after.CardAmount != "900.00" || len(after.Details) != 1 {
		t.Fatalf("unexpected payment after: %#v", after)
	}
	if policy.CardToCashAmount != 0 {
		t.Fatalf("CardToCashAmount = %v, want 0", policy.CardToCashAmount)
	}
}

func TestCbChqListCleanupSourceUsesDocRefPredicateAnd3881Gate(t *testing.T) {
	cleanupSrc, err := os.ReadFile("cb_chq_list_sync.go")
	if err != nil {
		t.Fatalf("read cb_chq_list_sync.go: %v", err)
	}
	syncSrc, err := os.ReadFile("cb_trans_sync.go")
	if err != nil {
		t.Fatalf("read cb_trans_sync.go: %v", err)
	}
	cleanup := string(cleanupSrc)
	if !strings.Contains(cleanup, "delete from cb_chq_list") || !strings.Contains(cleanup, "where doc_ref = $1") {
		t.Fatalf("cb_chq_list delete must use direct doc_ref predicate, source:\n%s", cleanup)
	}
	for _, forbidden := range []string{"coalesce(doc_ref", "doc_ref ilike", "lower(doc_ref"} {
		if strings.Contains(strings.ToLower(cleanup), forbidden) {
			t.Fatalf("cb_chq_list cleanup should not wrap doc_ref with %q", forbidden)
		}
	}
	sync := string(syncSrc)
	gateIndex := strings.Index(sync, "if hasCard3881Details")
	callIndex := strings.Index(sync, "deleteCbChqListByDocRef(ctx, tx, oldDocNo)")
	if gateIndex < 0 || callIndex < 0 || callIndex < gateIndex {
		t.Fatalf("cb_chq_list cleanup must be called only from the 3881 detail branch")
	}
	if strings.Count(sync, "deleteCbChqListByDocRef(ctx, tx, oldDocNo)") != 1 {
		t.Fatalf("expected exactly one cb_chq_list cleanup call in syncCbTransToTotal")
	}
}

func TestUserFacingBatchItemError_HidesCbTransTechnicalDetail(t *testing.T) {
	msg := userFacingBatchItemError(
		errors.New("cb_trans sync invariant violated: doc_no=G1-ET-2605-0003 newTotal=631.3000 sum=0.0000"),
	)
	if strings.Contains(msg, "cb_trans") || strings.Contains(msg, "invariant") || strings.Contains(msg, "doc_no=") {
		t.Fatalf("technical detail leaked: %s", msg)
	}
	if !strings.Contains(msg, "ยอดชำระ") {
		t.Fatalf("unexpected friendly message: %s", msg)
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
