package repository

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
)

// cbTransPaymentFields lists every numeric payment-instrument column on
// cb_trans whose values together must equal total_amount_pay. They are scaled
// proportionally when the bill total changes; the rounding residual is
// absorbed back into cash_amount so the post-write invariant
//
//	sum(payment fields) == total_amount_pay == total_amount == newTotal
//
// holds exactly within 0.01.
//
// Index 0 (cash_amount) is special — it receives the rounding residual and
// the entire newTotal when the bill previously had no recorded payment
// (oldTotal == 0).
var cbTransPaymentFields = []string{
	"cash_amount",       // 0 — receives residual
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
//   - oldTotal == newTotal → only renames doc_no on header + detail rows
//     (in case the bill is being re-numbered).
//   - oldTotal == 0 and newTotal > 0 → assigns the entire newTotal to
//     cash_amount; zeroes other instruments. Logs would already be skewed
//     in this edge case.
//   - General case → proportional scaling of every payment field, then
//     absorb the rounding residual into cash_amount; same ratio is applied
//     to cb_trans_detail.amount / sum_amount.
//
// The function ALWAYS uses SELECT ... FOR UPDATE inside the caller's
// transaction. It NEVER blocks the caller — invariant violations or write
// failures bubble up as errors which the caller (ApplyChange) rolls back.
func (r *DocumentRepository) syncCbTransToTotal(
	ctx context.Context, tx pgx.Tx,
	oldDocNo, newDocNo string, newTotal float64,
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
			// Credit sale or any bill without a cb_trans companion — nothing to sync.
			return nil
		}
		return fmt.Errorf("cb_trans sync: lock header: %w", err)
	}

	// Determine the scaled values.
	scaled, ratio := scaleCbTransFields(fields, oldPay, newTotal)

	// Reconcile pay_cash_amount + money_change with the new cash_amount.
	newCash := scaled[0]
	newPayCash := payCash
	if newPayCash < newCash {
		newPayCash = newCash
	}
	newMoneyChange := newPayCash - newCash
	if newMoneyChange < 0 {
		newMoneyChange = 0
	}

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
		scaled[0], scaled[1], scaled[2], scaled[3], scaled[4],
		scaled[5], scaled[6], scaled[7], scaled[8], scaled[9],
		newTotal, oldDocNo, newDocNo, newPayCash, newMoneyChange,
		salesTransFlag,
	)
	if err != nil {
		return fmt.Errorf("cb_trans sync: update header: %w", err)
	}
	if n := tag.RowsAffected(); n != 1 {
		return fmt.Errorf("cb_trans sync: expected 1 header row affected, got %d", n)
	}

	// Scale detail rows by the same ratio so per-instrument totals stay
	// consistent. When ratio == 0 (oldPay was zero and we just rewrote to
	// cash), zero out any leftover detail rows — they no longer correspond
	// to a recorded non-cash payment.
	if ratio == 0 {
		if _, err := tx.Exec(ctx, `
			update cb_trans_detail
			set doc_no = $2,
				amount = 0,
				sum_amount = 0
			where doc_no = $1 and trans_flag = $3
		`, oldDocNo, newDocNo, salesTransFlag); err != nil {
			return fmt.Errorf("cb_trans sync: zero detail: %w", err)
		}
	} else if ratio != 1 {
		if _, err := tx.Exec(ctx, `
			update cb_trans_detail
			set doc_no = $2,
				amount = round(amount * $3::numeric, 2),
				sum_amount = round(sum_amount * $3::numeric, 2)
			where doc_no = $1 and trans_flag = $4
		`, oldDocNo, newDocNo, ratio, salesTransFlag); err != nil {
			return fmt.Errorf("cb_trans sync: scale detail: %w", err)
		}
	} else if oldDocNo != newDocNo {
		if _, err := tx.Exec(ctx, `
			update cb_trans_detail
			set doc_no = $2
			where doc_no = $1 and trans_flag = $3
		`, oldDocNo, newDocNo, salesTransFlag); err != nil {
			return fmt.Errorf("cb_trans sync: rename detail: %w", err)
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
	sumInstruments := vCash + vChq + vTranfer + vCard + vWallet + vCoupon + vPoint + vDeposit + vAdvance + vPetty
	const tol = 0.01
	if math.Abs(sumInstruments-newTotal) > tol ||
		math.Abs(vTotal-newTotal) > tol ||
		math.Abs(vTotalNet-newTotal) > tol ||
		math.Abs(vTotalPay-newTotal) > tol {
		return fmt.Errorf(
			"cb_trans sync invariant violated: doc_no=%s newTotal=%.4f sum=%.4f total=%.4f net=%.4f pay=%.4f",
			newDocNo, newTotal, sumInstruments, vTotal, vTotalNet, vTotalPay,
		)
	}
	return nil
}

// scaleCbTransFields returns the new payment-field values and the ratio used.
// Pure helper for unit tests.
//
// Rules:
//   - newTotal == oldPay → returns fields unchanged, ratio = 1.
//   - oldPay == 0 && newTotal > 0 → cash absorbs newTotal, others = 0, ratio = 0.
//   - otherwise → fields scaled by newTotal/oldPay, residual absorbed into
//     cash_amount so sum exactly equals newTotal.
func scaleCbTransFields(fields [10]float64, oldPay, newTotal float64) ([10]float64, float64) {
	var out [10]float64
	if math.Abs(newTotal-oldPay) < 0.005 {
		out = fields
		return out, 1
	}
	if oldPay <= 0.005 {
		out[0] = round2(newTotal)
		return out, 0
	}
	ratio := newTotal / oldPay
	var sum float64
	for i, v := range fields {
		out[i] = round2(v * ratio)
		sum += out[i]
	}
	residual := round2(newTotal - sum)
	out[0] = round2(out[0] + residual)
	return out, ratio
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
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
