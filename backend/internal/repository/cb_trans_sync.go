package repository

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"next-salesinvoice/backend/internal/model"
)

// cbTransPaymentFields lists every numeric payment-instrument column on
// cb_trans whose values together must equal total_amount_pay. Bulk edit usually
// adjusts only index 0 (cash_amount). The explicit exception is credit-card
// detail rows for card marker 3881, which are deleted from cb_trans_detail,
// cleaned from cb_chq_list by the original doc_ref, and moved from card_amount
// into cash_amount.
var cbTransPaymentFields = []string{
	"cash_amount",       // 0 — receives the total delta
	"chq_amount",        // 1
	"tranfer_amount",    // 2 (sic, SML schema)
	"card_amount",       // 3
	"wallet_amount",     // 4
	"coupon_amount",     // 5
	"point_amount",      // 6
	"deposit_amount",    // 7
	"advance_amount",    // 8
	"petty_cash_amount", // 9
}

// syncCbTransToTotal aligns cb_trans + cb_trans_detail with a new bill total.
//
// Behaviour:
//   - Disabled via NSI_CB_TRANS_SYNC=false → no-op (returns nil).
//   - No cb_trans row for the bill (credit / AR sales) → no-op (returns nil).
//     This is the common case for non-POS invoices.
//   - oldTotal == newTotal → only renames doc_no on header + detail rows.
//   - General case → adjusts cash_amount by the exact delta and leaves every
//     non-cash field untouched.
//   - Explicit card migration → cb_trans_detail rows with doc_type=3 and
//     trans_number/credit_card_type containing 3881 are deleted; their amount
//     moves from card_amount into cash_amount so payment totals still match the
//     bill. cb_chq_list rows pointing at the original doc_no are also deleted.
//   - If the new bill total falls below the original cash_amount, or cash would
//     go negative, the caller is blocked.
//
// The function ALWAYS uses SELECT ... FOR UPDATE inside the caller's
// transaction. Validation or write failures bubble up as errors which the
// caller (ApplyChange) rolls back.
func (r *DocumentRepository) syncCbTransToTotal(
	ctx context.Context, tx pgx.Tx,
	oldDocNo, newDocNo string, newTotal float64, docCtx cbTransSyncDocumentContext,
) error {
	if !r.cfg.CbTransSyncEnabled {
		return nil
	}
	if newTotal < 0 {
		return fmt.Errorf("cb_trans sync: newTotal must be >= 0 (got %.4f)", newTotal)
	}

	// Lock the header row first (PK = (doc_no, trans_flag)).
	row := tx.QueryRow(ctx, `
		select coalesce(cash_amount,0)::float8, coalesce(chq_amount,0)::float8,
			coalesce(tranfer_amount,0)::float8, coalesce(card_amount,0)::float8,
			coalesce(wallet_amount,0)::float8, coalesce(coupon_amount,0)::float8,
			coalesce(point_amount,0)::float8, coalesce(deposit_amount,0)::float8,
			coalesce(advance_amount,0)::float8, coalesce(petty_cash_amount,0)::float8,
			coalesce(total_amount_pay,0)::float8,
			coalesce(pay_cash_amount,0)::float8
		from cb_trans
		where doc_no = $1 and trans_flag = $2
		for update
	`, oldDocNo, salesTransFlag)

	var fields [10]float64
	var oldPay float64
	var payCash float64
	if err := row.Scan(
		&fields[0], &fields[1], &fields[2], &fields[3], &fields[4],
		&fields[5], &fields[6], &fields[7], &fields[8], &fields[9],
		&oldPay, &payCash,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if docCtx.InquiryType == 1 {
				return createCashCbTrans(ctx, tx, newDocNo, newTotal, docCtx)
			}
			return nil
		}
		return fmt.Errorf("cb_trans sync: lock header: %w", err)
	}

	detailBefore, err := snapshotCbTransDetailPaymentAmounts(ctx, tx, oldDocNo)
	if err != nil {
		return fmt.Errorf("cb_trans sync: snapshot detail before: %w", err)
	}
	paymentDetails, err := paymentDetailsForUpdate(ctx, tx, oldDocNo)
	if err != nil {
		return err
	}
	card3881Details := card3881PaymentDetails(paymentDetails)
	hasCard3881Details := len(card3881Details) > 0

	paymentBefore := documentPaymentFromCbTransFields(fields, oldPay, payCash)
	paymentBefore.Details = paymentDetails
	policy := evaluateCbTransPaymentPolicy(paymentBefore, newTotal)
	if !policy.Allowed {
		return fmt.Errorf("%s", policy.BlockedReason)
	}
	newCash := policy.NewCash
	newCard := parseFloatOrZero(policy.PaymentAfter.CardAmount)
	payCash = policy.PayCash
	expectedInstrumentSum := policy.ExpectedInstrumentSum
	newMoneyChange := policy.NewMoneyChange

	tag, err := tx.Exec(ctx, `
		update cb_trans
		set doc_no             = $13,
			cash_amount        = $1,
			chq_amount         = $2,
			tranfer_amount     = $3,
			card_amount        = $4,
			wallet_amount      = $5,
			coupon_amount      = $6,
			point_amount       = $7,
			deposit_amount     = $8,
			advance_amount     = $9,
			petty_cash_amount  = $10,
			total_amount       = $11,
			total_net_amount   = $11,
			total_amount_pay   = $11,
			pay_cash_amount    = $14,
			money_change       = $15
		where doc_no = $12 and trans_flag = $16
	`,
		newCash, fields[1], fields[2], newCard, fields[4],
		fields[5], fields[6], fields[7], fields[8], fields[9],
		newTotal, oldDocNo, newDocNo, payCash, newMoneyChange,
		salesTransFlag,
	)
	if err != nil {
		return fmt.Errorf("cb_trans sync: update header: %w", err)
	}
	if n := tag.RowsAffected(); n != 1 {
		return fmt.Errorf("cb_trans sync: expected 1 header row affected, got %d", n)
	}

	if hasCard3881Details {
		if _, err := tx.Exec(ctx, `
			delete from cb_trans_detail
			where doc_no = $1
				and trans_flag = $2
				and coalesce(doc_type, 0) = 3
				and (
					coalesce(trans_number, '') like '%3881%'
					or coalesce(credit_card_type, '') like '%3881%'
				)
		`, oldDocNo, salesTransFlag); err != nil {
			return fmt.Errorf("cb_trans sync: delete 3881 credit-card detail: %w", err)
		}
		if err := deleteCbChqListByDocRef(ctx, tx, oldDocNo); err != nil {
			return err
		}
	}

	if oldDocNo != newDocNo {
		if _, err := tx.Exec(ctx, `
			update cb_trans_detail
			set doc_no = $2
			where doc_no = $1 and trans_flag = $3
		`, oldDocNo, newDocNo, salesTransFlag); err != nil {
			return fmt.Errorf("cb_trans sync: rename detail: %w", err)
		}
	}

	detailAfter, err := snapshotCbTransDetailPaymentAmounts(ctx, tx, newDocNo)
	if err != nil {
		return fmt.Errorf("cb_trans sync: snapshot detail after: %w", err)
	}
	if detailAfter != detailBefore {
		if !hasCard3881Details {
			return fmt.Errorf("cb_trans sync: cb_trans_detail payment amounts changed unexpectedly")
		}
		hasCard3881, err := hasCard3881Detail(ctx, tx, newDocNo)
		if err != nil {
			return err
		}
		if hasCard3881 {
			return fmt.Errorf("cb_trans sync: 3881 credit-card detail still exists after cash transfer")
		}
	}

	// Post-write invariant: re-read the row at the NEW doc_no and confirm
	// that every cross-total relationship holds within 0.01. Any drift
	// triggers a tx rollback by the caller.
	var (
		vCash, vChq, vTranfer, vCard, vWallet, vCoupon, vPoint, vDeposit, vAdvance, vPetty float64
		vTotal, vTotalNet, vTotalPay                                                       float64
	)
	if err := tx.QueryRow(ctx, `
		select coalesce(cash_amount,0)::float8, coalesce(chq_amount,0)::float8,
			coalesce(tranfer_amount,0)::float8, coalesce(card_amount,0)::float8,
			coalesce(wallet_amount,0)::float8, coalesce(coupon_amount,0)::float8,
			coalesce(point_amount,0)::float8, coalesce(deposit_amount,0)::float8,
			coalesce(advance_amount,0)::float8, coalesce(petty_cash_amount,0)::float8,
			coalesce(total_amount,0)::float8, coalesce(total_net_amount,0)::float8,
			coalesce(total_amount_pay,0)::float8
		from cb_trans
		where doc_no = $1 and trans_flag = $2
	`, newDocNo, salesTransFlag).Scan(
		&vCash, &vChq, &vTranfer, &vCard, &vWallet, &vCoupon, &vPoint,
		&vDeposit, &vAdvance, &vPetty, &vTotal, &vTotalNet, &vTotalPay,
	); err != nil {
		return fmt.Errorf("cb_trans sync: re-read invariant: %w", err)
	}
	const tol = 0.01
	sumInstruments := vCash + vChq + vTranfer + vCard + vWallet + vCoupon + vPoint + vDeposit + vAdvance + vPetty
	if math.Abs(sumInstruments-expectedInstrumentSum) > tol ||
		math.Abs(vTotal-newTotal) > tol ||
		math.Abs(vTotalNet-newTotal) > tol ||
		math.Abs(vTotalPay-newTotal) > tol {
		return fmt.Errorf(
			"ตรวจสอบยอดชำระไม่ผ่าน: ระบบจะไม่ส่งบิลนี้เข้า SML กรุณาตรวจสอบข้อมูลการชำระเงินของบิล %s",
			newDocNo,
		)
	}
	return nil
}

type cbTransSyncDocumentContext struct {
	DocDate       time.Time
	DocTime       string
	CustomerCode  string
	DocFormatCode string
	InquiryType   int16
}

func createCashCbTrans(ctx context.Context, tx pgx.Tx, docNo string, total float64, docCtx cbTransSyncDocumentContext) error {
	if _, err := tx.Exec(ctx, `
		insert into cb_trans (
			trans_type, trans_flag, doc_date, doc_no, doc_time, ap_ar_code,
			pay_type, doc_format_code, total_amount, total_net_amount,
			total_amount_pay, cash_amount, chq_amount, tranfer_amount,
			card_amount, wallet_amount, coupon_amount, point_amount,
			deposit_amount, advance_amount, petty_cash_amount,
			pay_cash_amount, money_change
		) values (
			2, $1, $2, $3, $4, $5,
			1, $6, $7, $7,
			$7, $7, 0, 0,
			0, 0, 0, 0,
			0, 0, 0,
			0, 0
		)
	`, salesTransFlag, docCtx.DocDate, docNo, docCtx.DocTime, docCtx.CustomerCode, docCtx.DocFormatCode, total); err != nil {
		return fmt.Errorf("cb_trans sync: create cash header: %w", err)
	}
	return nil
}

func paymentDetailsForUpdate(ctx context.Context, tx pgx.Tx, docNo string) ([]model.DocumentPaymentDetail, error) {
	rows, err := tx.Query(ctx, `
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
		where doc_no = $1
			and trans_flag = $2
		order by roworder
		for update
	`, docNo, salesTransFlag)
	if err != nil {
		return nil, fmt.Errorf("cb_trans sync: lock payment detail: %w", err)
	}
	defer rows.Close()

	var details []model.DocumentPaymentDetail
	for rows.Next() {
		var detail model.DocumentPaymentDetail
		if err := rows.Scan(
			&detail.RowOrder, &detail.LineNumber, &detail.DocType, &detail.TransNumber,
			&detail.BankCode, &detail.CreditCardType, &detail.ChqDate, &detail.Amount, &detail.SumAmount,
		); err != nil {
			return nil, fmt.Errorf("cb_trans sync: scan 3881 credit-card detail: %w", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cb_trans sync: iterate 3881 credit-card detail: %w", err)
	}
	return details, nil
}

func card3881PaymentDetails(details []model.DocumentPaymentDetail) []model.DocumentPaymentDetail {
	out := make([]model.DocumentPaymentDetail, 0)
	for _, detail := range details {
		if isCard3881PaymentDetail(detail) {
			out = append(out, detail)
		}
	}
	return out
}

func hasCard3881Detail(ctx context.Context, tx pgx.Tx, docNo string) (bool, error) {
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from cb_trans_detail
			where doc_no = $1
				and trans_flag = $2
				and coalesce(doc_type, 0) = 3
				and (
					coalesce(trans_number, '') like '%3881%'
					or coalesce(credit_card_type, '') like '%3881%'
				)
		)
	`, docNo, salesTransFlag).Scan(&exists); err != nil {
		return false, fmt.Errorf("cb_trans sync: verify 3881 credit-card detail removal: %w", err)
	}
	return exists, nil
}

func documentPaymentFromCbTransFields(fields [10]float64, oldPay, payCash float64) model.DocumentPayment {
	return model.DocumentPayment{
		TotalAmount:     formatFloat2(oldPay),
		TotalNetAmount:  formatFloat2(oldPay),
		TotalAmountPay:  formatFloat2(oldPay),
		PayCashAmount:   formatFloat2(payCash),
		CashAmount:      formatFloat2(fields[0]),
		ChqAmount:       formatFloat2(fields[1]),
		TranferAmount:   formatFloat2(fields[2]),
		CardAmount:      formatFloat2(fields[3]),
		WalletAmount:    formatFloat2(fields[4]),
		CouponAmount:    formatFloat2(fields[5]),
		PointAmount:     formatFloat2(fields[6]),
		DepositAmount:   formatFloat2(fields[7]),
		AdvanceAmount:   formatFloat2(fields[8]),
		PettyCashAmount: formatFloat2(fields[9]),
		MoneyChange:     formatFloat2(payCash - fields[0]),
		Details:         []model.DocumentPaymentDetail{},
	}
}

// scaleCbTransFields returns the new payment-field values and the cash delta.
// Pure helper for unit tests.
func scaleCbTransFields(fields [10]float64, oldPay, newTotal float64) ([10]float64, float64) {
	out := fields
	delta := round2(newTotal - oldPay)
	out[0] = round2(out[0] + delta)
	return out, delta
}

func paymentTotalBelowCashAmount(fields [10]float64, newTotal float64) bool {
	const tol = 0.01
	return newTotal < fields[0]-tol
}

func sumPaymentFields(fields [10]float64) float64 {
	var sum float64
	for _, value := range fields {
		sum += value
	}
	return round2(sum)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func snapshotCbTransDetailPaymentAmounts(ctx context.Context, tx pgx.Tx, docNo string) (string, error) {
	var snapshot string
	err := tx.QueryRow(ctx, `
		select coalesce(jsonb_agg(
			jsonb_build_object(
				'roworder', coalesce(roworder, 0),
				'line_number', coalesce(line_number, 0),
				'doc_type', coalesce(doc_type, 0),
				'amount', coalesce(amount, 0)::numeric::text,
				'sum_amount', coalesce(sum_amount, 0)::numeric::text
			)
			order by coalesce(roworder, 0), coalesce(line_number, 0), coalesce(doc_type, 0)
		), '[]'::jsonb)::text
		from cb_trans_detail
		where doc_no = $1 and trans_flag = $2
	`, docNo, salesTransFlag).Scan(&snapshot)
	return snapshot, err
}

// restoreCbTransFromSnapshot wipes any cb_trans / cb_trans_detail rows
// currently sitting under `currentDocNo` (whatever ApplyChange may have
// left behind) and re-inserts the originals captured in the snapshot under
// `originalDocNo`. Safe to call on legacy snapshots that pre-date this
// feature — when the raw payment payload is absent the function is a no-op
// so existing rollbacks remain backward compatible.
func (r *DocumentRepository) restoreCbTransFromSnapshot(
	ctx context.Context, tx pgx.Tx,
	currentDocNo, originalDocNo string,
	payload documentSnapshotPayload,
) error {
	// Legacy snapshot (created before cb_trans capture shipped) — leave the
	// payment tables untouched. Operators can still hand-fix if they need to.
	if len(payload.CbTransRaw) == 0 && len(payload.CbTransDetailsRaw) == 0 {
		return nil
	}

	// Clear whatever ApplyChange left behind. We must clear under BOTH the
	// current doc_no (post-apply) and the original doc_no (in case the bill
	// kept the same number) so the re-insert below never collides on PK.
	if _, err := tx.Exec(ctx, `
		delete from cb_trans_detail
		where trans_flag = $1 and doc_no in ($2, $3)
	`, salesTransFlag, currentDocNo, originalDocNo); err != nil {
		return fmt.Errorf("rollback cb_trans_detail clear: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		delete from cb_trans
		where trans_flag = $1 and doc_no in ($2, $3)
	`, salesTransFlag, currentDocNo, originalDocNo); err != nil {
		return fmt.Errorf("rollback cb_trans clear: %w", err)
	}

	// Re-insert the header when the snapshot actually held one (i.e. the
	// raw JSON is anything other than `null`).
	if !isJSONNull(payload.CbTransRaw) {
		if _, err := tx.Exec(ctx, `
			insert into cb_trans
			select * from jsonb_populate_record(null::cb_trans, $1::jsonb)
		`, string(payload.CbTransRaw)); err != nil {
			return fmt.Errorf("rollback cb_trans insert: %w", err)
		}
	}
	if len(payload.CbTransDetailsRaw) > 0 && !isJSONNull(payload.CbTransDetailsRaw) {
		if _, err := tx.Exec(ctx, `
			insert into cb_trans_detail
			select * from jsonb_populate_recordset(null::cb_trans_detail, $1::jsonb)
		`, string(payload.CbTransDetailsRaw)); err != nil {
			return fmt.Errorf("rollback cb_trans_detail insert: %w", err)
		}
	}
	return nil
}

func isJSONNull(raw []byte) bool {
	for i, b := range raw {
		switch b {
		case ' ', '\t', '\n', '\r':
			continue
		case 'n':
			return i+4 <= len(raw) && string(raw[i:i+4]) == "null"
		default:
			return false
		}
	}
	return true
}
