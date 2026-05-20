package repository

import (
	"context"
	"errors"
	"fmt"
	"strconv"

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
	p := &model.DocumentPayment{}
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
		select coalesce(line_number, 0)::int4,
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
			&d.LineNumber, &d.DocType, &d.TransNumber, &d.BankCode,
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

// simulateDocumentPaymentAfter returns a copy of `before` rescaled so that
// total_amount / total_net_amount / total_amount_pay all equal newTotalStr.
// Used only for preview display — never writes. Mirrors the scaling logic
// in scaleCbTransFields + the pay_cash/money_change reconciliation in
// syncCbTransToTotal so the preview matches what apply will write.
func simulateDocumentPaymentAfter(before model.DocumentPayment, newTotalStr string) model.DocumentPayment {
	newTotal, err := strconv.ParseFloat(newTotalStr, 64)
	if err != nil || newTotal < 0 {
		// Best-effort: just clone before unchanged so the UI still has
		// something to render. Apply step has its own strict validation.
		return before
	}
	fields := [10]float64{
		parseFloatOrZero(before.CashAmount),
		parseFloatOrZero(before.ChqAmount),
		parseFloatOrZero(before.TranferAmount),
		parseFloatOrZero(before.CardAmount),
		parseFloatOrZero(before.WalletAmount),
		parseFloatOrZero(before.CouponAmount),
		parseFloatOrZero(before.PointAmount),
		parseFloatOrZero(before.DepositAmount),
		parseFloatOrZero(before.AdvanceAmount),
		parseFloatOrZero(before.PettyCashAmount),
	}
	oldPay := parseFloatOrZero(before.TotalAmountPay)
	scaled, _ := scaleCbTransFields(fields, oldPay, newTotal)

	// Reconcile pay_cash_amount + money_change with the new cash_amount,
	// same rule as syncCbTransToTotal.
	payCash := parseFloatOrZero(before.PayCashAmount)
	newCash := scaled[0]
	if payCash < newCash {
		payCash = newCash
	}
	moneyChange := payCash - newCash
	if moneyChange < 0 {
		moneyChange = 0
	}

	after := before
	after.TotalAmount = formatFloat2(newTotal)
	after.TotalNetAmount = formatFloat2(newTotal)
	after.TotalAmountPay = formatFloat2(newTotal)
	after.PayCashAmount = formatFloat2(payCash)
	after.MoneyChange = formatFloat2(moneyChange)
	after.CashAmount = formatFloat2(scaled[0])
	after.ChqAmount = formatFloat2(scaled[1])
	after.TranferAmount = formatFloat2(scaled[2])
	after.CardAmount = formatFloat2(scaled[3])
	after.WalletAmount = formatFloat2(scaled[4])
	after.CouponAmount = formatFloat2(scaled[5])
	after.PointAmount = formatFloat2(scaled[6])
	after.DepositAmount = formatFloat2(scaled[7])
	after.AdvanceAmount = formatFloat2(scaled[8])
	after.PettyCashAmount = formatFloat2(scaled[9])

	// Detail rows: apply same ratio. ratio == 0 means previous total was
	// zero or near-zero — apply step zeros all detail amounts.
	if oldPay <= 0.005 && newTotal > 0 {
		after.Details = make([]model.DocumentPaymentDetail, len(before.Details))
		for i, d := range before.Details {
			nd := d
			nd.Amount = "0"
			nd.SumAmount = "0"
			after.Details[i] = nd
		}
	} else if oldPay > 0 {
		ratio := newTotal / oldPay
		after.Details = make([]model.DocumentPaymentDetail, len(before.Details))
		for i, d := range before.Details {
			nd := d
			nd.Amount = formatFloat2(round2(parseFloatOrZero(d.Amount) * ratio))
			nd.SumAmount = formatFloat2(round2(parseFloatOrZero(d.SumAmount) * ratio))
			after.Details[i] = nd
		}
	}
	return after
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
