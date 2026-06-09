package repository

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"next-salesinvoice/backend/internal/model"
)

// fetchDocumentPayment loads the cb_trans header + cb_trans_detail rows for a
// single doc_no using the sales trans_flag. Returns (nil, nil) when no
// cb_trans companion row exists (typical credit/AR sales) so callers can
// treat the document as having no payment side-effect to display.
func (r *DocumentRepository) fetchDocumentPayment(ctx context.Context, q documentQuerier, docNo string) (*model.DocumentPayment, error) {
	row := q.QueryRow(ctx, `
		select coalesce(doc_no, '')::text,
			coalesce(trans_flag, 0)::smallint,
			coalesce(trans_type, 0)::smallint,
			coalesce(pay_type, 0)::smallint,
			coalesce(total_amount, 0)::numeric::text,
			coalesce(total_net_amount, 0)::numeric::text,
			coalesce(total_amount_pay, 0)::numeric::text,
			coalesce(pay_cash_amount, 0)::numeric::text,
			coalesce(money_change, 0)::numeric::text,
			coalesce(cash_amount, 0)::numeric::text,
			coalesce(chq_amount, 0)::numeric::text,
			coalesce(tranfer_amount, 0)::numeric::text,
			coalesce(card_amount, 0)::numeric::text,
			coalesce(wallet_amount, 0)::numeric::text,
			coalesce(coupon_amount, 0)::numeric::text,
			coalesce(point_amount, 0)::numeric::text,
			coalesce(deposit_amount, 0)::numeric::text,
			coalesce(advance_amount, 0)::numeric::text,
			coalesce(petty_cash_amount, 0)::numeric::text
		from cb_trans
		where trans_flag = $1 and doc_no = $2
	`, salesTransFlag, docNo)
	p := &model.DocumentPayment{Details: []model.DocumentPaymentDetail{}}
	if err := row.Scan(
		&p.DocNo, &p.TransFlag, &p.TransType, &p.PayType,
		&p.TotalAmount, &p.TotalNetAmount, &p.TotalAmountPay,
		&p.PayCashAmount, &p.MoneyChange,
		&p.CashAmount, &p.ChqAmount, &p.TranferAmount, &p.CardAmount,
		&p.WalletAmount, &p.CouponAmount, &p.PointAmount,
		&p.DepositAmount, &p.AdvanceAmount, &p.PettyCashAmount,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("fetch cb_trans header: %w", err)
	}

	rows, err := q.Query(ctx, `
		select coalesce(roworder, 0)::int8,
			coalesce(line_number, 0)::int4,
			coalesce(doc_type, 0)::smallint,
			coalesce(trans_number, '')::text,
			coalesce(bank_code, '')::text,
			coalesce(credit_card_type, '')::text,
			coalesce(to_char(chq_date, 'YYYY-MM-DD'), '')::text,
			coalesce(amount, 0)::numeric::text,
			coalesce(sum_amount, 0)::numeric::text
		from cb_trans_detail
		where trans_flag = $1 and doc_no = $2
		order by roworder
	`, salesTransFlag, docNo)
	if err != nil {
		return nil, fmt.Errorf("fetch cb_trans_detail: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d model.DocumentPaymentDetail
		if err := rows.Scan(
			&d.RowOrder, &d.LineNumber, &d.DocType, &d.TransNumber, &d.BankCode,
			&d.CreditCardType, &d.ChqDate, &d.Amount, &d.SumAmount,
		); err != nil {
			return nil, fmt.Errorf("scan cb_trans_detail: %w", err)
		}
		p.Details = append(p.Details, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cb_trans_detail: %w", err)
	}
	return p, nil
}

func (r *DocumentRepository) fetchDocumentPayments(ctx context.Context, q documentQuerier, docNos []string) (map[string]*model.DocumentPayment, error) {
	items := make(map[string]*model.DocumentPayment, len(docNos))
	if len(docNos) == 0 {
		return items, nil
	}
	rows, err := q.Query(ctx, `
		select coalesce(doc_no, '')::text,
			coalesce(trans_flag, 0)::smallint,
			coalesce(trans_type, 0)::smallint,
			coalesce(pay_type, 0)::smallint,
			coalesce(total_amount, 0)::numeric::text,
			coalesce(total_net_amount, 0)::numeric::text,
			coalesce(total_amount_pay, 0)::numeric::text,
			coalesce(pay_cash_amount, 0)::numeric::text,
			coalesce(money_change, 0)::numeric::text,
			coalesce(cash_amount, 0)::numeric::text,
			coalesce(chq_amount, 0)::numeric::text,
			coalesce(tranfer_amount, 0)::numeric::text,
			coalesce(card_amount, 0)::numeric::text,
			coalesce(wallet_amount, 0)::numeric::text,
			coalesce(coupon_amount, 0)::numeric::text,
			coalesce(point_amount, 0)::numeric::text,
			coalesce(deposit_amount, 0)::numeric::text,
			coalesce(advance_amount, 0)::numeric::text,
			coalesce(petty_cash_amount, 0)::numeric::text
		from cb_trans
		where trans_flag = $1 and doc_no = any($2)
	`, salesTransFlag, docNos)
	if err != nil {
		return nil, fmt.Errorf("fetch cb_trans headers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		p := &model.DocumentPayment{Details: []model.DocumentPaymentDetail{}}
		if err := rows.Scan(
			&p.DocNo, &p.TransFlag, &p.TransType, &p.PayType,
			&p.TotalAmount, &p.TotalNetAmount, &p.TotalAmountPay,
			&p.PayCashAmount, &p.MoneyChange,
			&p.CashAmount, &p.ChqAmount, &p.TranferAmount, &p.CardAmount,
			&p.WalletAmount, &p.CouponAmount, &p.PointAmount,
			&p.DepositAmount, &p.AdvanceAmount, &p.PettyCashAmount,
		); err != nil {
			return nil, fmt.Errorf("scan cb_trans header: %w", err)
		}
		items[p.DocNo] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cb_trans headers: %w", err)
	}
	detailRows, err := q.Query(ctx, `
		select coalesce(doc_no, '')::text,
			coalesce(roworder, 0)::int8,
			coalesce(line_number, 0)::int4,
			coalesce(doc_type, 0)::smallint,
			coalesce(trans_number, '')::text,
			coalesce(bank_code, '')::text,
			coalesce(credit_card_type, '')::text,
			coalesce(to_char(chq_date, 'YYYY-MM-DD'), '')::text,
			coalesce(amount, 0)::numeric::text,
			coalesce(sum_amount, 0)::numeric::text
		from cb_trans_detail
		where trans_flag = $1 and doc_no = any($2)
		order by doc_no, roworder
	`, salesTransFlag, docNos)
	if err != nil {
		return nil, fmt.Errorf("fetch cb_trans_detail batch: %w", err)
	}
	defer detailRows.Close()
	for detailRows.Next() {
		var docNo string
		var d model.DocumentPaymentDetail
		if err := detailRows.Scan(
			&docNo, &d.RowOrder, &d.LineNumber, &d.DocType, &d.TransNumber, &d.BankCode,
			&d.CreditCardType, &d.ChqDate, &d.Amount, &d.SumAmount,
		); err != nil {
			return nil, fmt.Errorf("scan cb_trans_detail batch: %w", err)
		}
		if p := items[docNo]; p != nil {
			p.Details = append(p.Details, d)
		}
	}
	if err := detailRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cb_trans_detail batch: %w", err)
	}
	return items, nil
}

func newCashDocumentPayment(docNo string, totalStr string) (*model.DocumentPayment, error) {
	total, err := strconv.ParseFloat(totalStr, 64)
	if err != nil || total < 0 {
		return nil, fmt.Errorf("ยอดชำระใหม่ไม่ถูกต้อง")
	}
	totalText := formatFloat2(total)
	return &model.DocumentPayment{
		DocNo:           docNo,
		TransFlag:       salesTransFlag,
		TransType:       2,
		PayType:         1,
		TotalAmount:     totalText,
		TotalNetAmount:  totalText,
		TotalAmountPay:  totalText,
		PayCashAmount:   "0.00",
		MoneyChange:     "0.00",
		CashAmount:      totalText,
		ChqAmount:       "0.00",
		TranferAmount:   "0.00",
		CardAmount:      "0.00",
		WalletAmount:    "0.00",
		CouponAmount:    "0.00",
		PointAmount:     "0.00",
		DepositAmount:   "0.00",
		AdvanceAmount:   "0.00",
		PettyCashAmount: "0.00",
		Details:         []model.DocumentPaymentDetail{},
	}, nil
}

type cbTransPaymentPolicyResult struct {
	Allowed               bool
	BlockedReason         string
	TechnicalReason       string
	PaymentAfter          model.DocumentPayment
	CardToCashAmount      float64
	NewTotal              float64
	OldPay                float64
	OldCash               float64
	PayCash               float64
	NewCash               float64
	NewMoneyChange        float64
	ProtectedAmount       float64
	ProtectedLabels       []string
	ExpectedInstrumentSum float64
}

// simulateDocumentPaymentAfter returns a copy of `before` adjusted so that
// total_amount / total_net_amount / total_amount_pay all equal newTotalStr.
// Only cash is allowed to absorb the delta. Non-cash instruments stay intact.
func simulateDocumentPaymentAfter(before model.DocumentPayment, newTotalStr string) (model.DocumentPayment, error) {
	newTotal, err := strconv.ParseFloat(newTotalStr, 64)
	if err != nil || newTotal < 0 {
		return before, fmt.Errorf("ยอดชำระใหม่ไม่ถูกต้อง")
	}
	return applyCashOnlyPaymentDelta(before, newTotal)
}

func applyCashOnlyPaymentDelta(before model.DocumentPayment, newTotal float64) (model.DocumentPayment, error) {
	policy := evaluateCbTransPaymentPolicy(before, newTotal)
	if !policy.Allowed {
		return before, fmt.Errorf("%s", policy.BlockedReason)
	}
	return policy.PaymentAfter, nil
}

func evaluateCbTransPaymentPolicy(before model.DocumentPayment, newTotal float64) cbTransPaymentPolicyResult {
	result := cbTransPaymentPolicyResult{
		Allowed:      false,
		NewTotal:     newTotal,
		PaymentAfter: before,
	}
	if newTotal < 0 {
		result.BlockedReason = "ยอดชำระใหม่ไม่ถูกต้อง"
		result.TechnicalReason = fmt.Sprintf("negative new total %.4f", newTotal)
		return result
	}

	oldPay := parseFloatOrZero(before.TotalAmountPay)
	oldCash := parseFloatOrZero(before.CashAmount)
	oldCard := parseFloatOrZero(before.CardAmount)
	payCash := parseFloatOrZero(before.PayCashAmount)
	cardToCashAmount := paymentCard3881TransferAmount(before.Details)
	cardReduction := math.Min(oldCard, cardToCashAmount)
	protected := protectedPaymentSnapshot(before, cardReduction)
	newCash := round2(newTotal - protected.Total)
	newCard := round2(oldCard - cardReduction)
	const tol = 0.01
	result.OldPay = oldPay
	result.OldCash = oldCash
	result.PayCash = payCash
	result.NewCash = newCash
	result.CardToCashAmount = cardToCashAmount
	result.ProtectedAmount = protected.Total
	result.ProtectedLabels = protected.Labels
	if newTotal < protected.Total-tol {
		result.BlockedReason = fmt.Sprintf(
			"ยอดบิลใหม่ต่ำกว่า payment ที่ต้องคงเดิม (%s) จึงยังไม่ส่งเข้า SML",
			strings.Join(protected.Labels, ", "),
		)
		result.TechnicalReason = fmt.Sprintf("newTotal %.4f below protected payment %.4f", newTotal, protected.Total)
		return result
	}
	if newCash < -tol {
		result.BlockedReason = "ยอดบิลใหม่ทำให้เงินสดติดลบ จึงยังไม่ส่งเข้า SML"
		result.TechnicalReason = fmt.Sprintf("new cash %.4f below zero", newCash)
		return result
	}
	newCash = math.Max(0, newCash)
	newCard = math.Max(0, newCard)
	newPayCash := payCash
	if cardToCashAmount > tol && newPayCash < newCash {
		newPayCash = newCash
	}
	moneyChange := round2(newPayCash - newCash)
	if moneyChange < 0 {
		moneyChange = 0
	}
	result.NewCash = newCash
	result.PayCash = newPayCash
	result.NewMoneyChange = moneyChange
	result.ExpectedInstrumentSum = round2(protected.HeaderTotal + newCash)
	after := before
	after.TotalAmount = formatFloat2(newTotal)
	after.TotalNetAmount = formatFloat2(newTotal)
	after.TotalAmountPay = formatFloat2(newTotal)
	after.PayCashAmount = formatFloat2(newPayCash)
	after.MoneyChange = formatFloat2(moneyChange)
	after.CashAmount = formatFloat2(newCash)
	after.CardAmount = formatFloat2(newCard)
	after.Details = make([]model.DocumentPaymentDetail, 0, len(before.Details))
	for _, d := range before.Details {
		if isCard3881PaymentDetail(d) {
			continue
		}
		after.Details = append(after.Details, d)
	}
	result.PaymentAfter = after
	result.Allowed = true
	return result
}

type protectedPaymentInfo struct {
	Total       float64
	HeaderTotal float64
	Labels      []string
}

func protectedPaymentSnapshot(p model.DocumentPayment, cardReduction float64) protectedPaymentInfo {
	header := map[string]float64{
		"เช็ค":         parseFloatOrZero(p.ChqAmount),
		"เงินโอน":      parseFloatOrZero(p.TranferAmount),
		"บัตรเครดิต":   math.Max(0, round2(parseFloatOrZero(p.CardAmount)-cardReduction)),
		"Wallet":       parseFloatOrZero(p.WalletAmount),
		"คูปอง":        parseFloatOrZero(p.CouponAmount),
		"พอยต์":        parseFloatOrZero(p.PointAmount),
		"มัดจำ":        parseFloatOrZero(p.DepositAmount),
		"เงินล่วงหน้า": parseFloatOrZero(p.AdvanceAmount),
		"เงินสดย่อย":   parseFloatOrZero(p.PettyCashAmount),
	}
	detail := map[string]float64{}
	otherDetail := 0.0
	for _, row := range p.Details {
		if isCard3881PaymentDetail(row) {
			continue
		}
		amount := parseFloatOrZero(row.Amount)
		if amount == 0 {
			amount = parseFloatOrZero(row.SumAmount)
		}
		if amount <= 0 {
			continue
		}
		switch row.DocType {
		case 1:
			detail["เงินโอน"] += amount
		case 2:
			detail["เช็ค"] += amount
		case 3:
			detail["บัตรเครดิต"] += amount
		case 4:
			detail["เงินสดย่อย"] += amount
		case 5:
			detail["เงินล่วงหน้า"] += amount
		case 9:
			detail["คูปอง"] += amount
		case 21:
			detail["Wallet"] += amount
		default:
			otherDetail += amount
		}
	}
	order := []string{"เช็ค", "เงินโอน", "บัตรเครดิต", "Wallet", "คูปอง", "พอยต์", "มัดจำ", "เงินล่วงหน้า", "เงินสดย่อย"}
	const tol = 0.01
	info := protectedPaymentInfo{}
	for _, label := range order {
		headerAmount := round2(header[label])
		detailAmount := round2(detail[label])
		amount := math.Max(headerAmount, detailAmount)
		if amount <= tol {
			continue
		}
		info.Total = round2(info.Total + amount)
		info.HeaderTotal = round2(info.HeaderTotal + headerAmount)
		info.Labels = append(info.Labels, fmt.Sprintf("%s %s", label, formatFloat2(amount)))
	}
	if otherDetail > tol {
		other := round2(otherDetail)
		info.Total = round2(info.Total + other)
		info.Labels = append(info.Labels, fmt.Sprintf("รายการชำระอื่น %s", formatFloat2(other)))
	}
	if len(info.Labels) == 0 {
		info.Labels = []string{"ไม่มี"}
	}
	return info
}

func isCard3881PaymentDetail(detail model.DocumentPaymentDetail) bool {
	if detail.DocType != 3 {
		return false
	}
	return strings.Contains(detail.TransNumber, "3881") || strings.Contains(detail.CreditCardType, "3881")
}

func paymentCard3881TransferAmount(details []model.DocumentPaymentDetail) float64 {
	var total float64
	for _, detail := range details {
		if !isCard3881PaymentDetail(detail) {
			continue
		}
		amount := parseFloatOrZero(detail.Amount)
		if amount == 0 {
			amount = parseFloatOrZero(detail.SumAmount)
		}
		total += amount
	}
	return round2(total)
}

func documentPaymentInstrumentSum(p model.DocumentPayment) float64 {
	return round2(
		parseFloatOrZero(p.CashAmount) +
			parseFloatOrZero(p.ChqAmount) +
			parseFloatOrZero(p.TranferAmount) +
			parseFloatOrZero(p.CardAmount) +
			parseFloatOrZero(p.WalletAmount) +
			parseFloatOrZero(p.CouponAmount) +
			parseFloatOrZero(p.PointAmount) +
			parseFloatOrZero(p.DepositAmount) +
			parseFloatOrZero(p.AdvanceAmount) +
			parseFloatOrZero(p.PettyCashAmount),
	)
}

func parseFloatOrZero(s string) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}

func formatFloat2(v float64) string {
	return strconv.FormatFloat(round2(v), 'f', 2, 64)
}
