# next-salesinvoice Session Handoff

Last updated: 2026-05-21 Asia/Bangkok (Phase 10: bulk edit UX feedback + row-level qty edits + audit comparison dialog)

ไฟล์นี้คือ checkpoint ล่าสุดสำหรับเปิด chat ใหม่หรือส่งต่อให้ AI ตัวอื่นทำงานต่อ อ่านคู่กับ `README.md` ก่อนแก้โค้ดเสมอ

## Phase 10 Summary (2026-05-21)

UI:
- Settings dialog layout widened/rebalanced; customer search remains server-side prefix search by code/name and does not load the full customer list.
- Preview dialog supports row-level qty edits for existing lines; totals and the left document queue update immediately from current edits and use 2-decimal display.
- Confirm apply flow no longer requires typing `ยืนยัน`; cancel returns to preview, and confirm opens a final warning dialog before starting async apply.
- `/bulk-edit` desktop table height is viewport-aware and leaves room for the sticky action bar.
- `/audit` combines `บิลเดิม`/`บิลใหม่` into `ดูการเปลี่ยนแปลง`, opening one comparison dialog showing original -> new values.

Backend:
- `DocumentDetailLine` now includes `rowOrder`.
- Bulk `perDocEdits` supports `lineQtyEdits: [{ rowOrder, qty }]`; backend validates `qty > 0`, applies qty updates to exact `ic_trans_detail.roworder`, recomputes totals/VAT, and keeps retry payloads intact.
- Added regression test for duplicate item codes where only the targeted rowOrder quantity changes.

Verification:
- `go test ./...`: Pass
- `npm run build`: Pass

## Phase 9 Summary (2026-05-20)

UI:
- `/bulk-edit` filter now loads only when user clicks `ค้นหา` or presses Enter; date changes and clear-search no longer auto-load.
- Bulk apply confirm starts an async batch and opens a progress dialog showing `กำลังส่ง X/Y`, applied/failed/pending counts, current processing bill, and recent failures.
- Partial failure exposes `ส่งซ้ำเฉพาะบิลที่ไม่สำเร็จ`; retry creates a new batch from failed/skipped items only and does not touch applied items.
- Regen doc number preview keeps `docNoOverrides` through confirm apply, so apply uses the same new doc number shown in preview.

Backend:
- New endpoints:
  - `POST /api/v1/documents/bulk/apply-change/start`
  - `GET /api/v1/documents/bulk/batches/:batchId`
  - `POST /api/v1/documents/bulk/batches/:batchId/retry-failed`
- Async v1 uses an in-process goroutine, processes one bill at a time, inserts `pending` items first, updates item status to `processing` then `applied`/`failed`/`skipped`, and refreshes batch counts after each bill.
- `retry-failed` loads the saved request from the original batch, filters failed/skipped docNos and matching `perDocEdits`, clears `docNoOverrides`, and starts a fresh batch so running numbers are recalculated.
- Running number allocator now checks candidate numbers against `ic_trans.doc_no` globally for sales `trans_flag=44` and reserves numbers in memory within the same request.
- Sale type validation allows preserving an existing non-standard `inquiry_type` from SML while still rejecting invalid changes.

Verification/deploy:
- `go test ./...`: Pass
- `npm run build`: Pass
- Deployed via `./deploy.sh`; latest quick tunnel: `https://households-selected-capability-readily.trycloudflare.com`
- Smoke checked `/bulk-edit`, `/api/v1/health`, direct readyz, and unauthenticated batch progress returns 401 as expected.

## Phase 8 Summary (2026-05-20)

UI:
- ตัด "ประเภทการขาย" ออกจาก dialog ตั้งค่าการแก้ไข — บังคับใช้ค่า inquiry_type เดิมของแต่ละบิล (frontend ส่ง `inquiryType=0` sentinel เสมอ; backend `ApplyBulkChange` ใช้ค่าจาก `Preview.After` ที่ resolve sentinel แล้ว)
- ซ่อนปุ่ม "เพิ่มสินค้า" + `<AddItemDialog>` ใน preview dialog (props ยังคงอยู่เพื่อความเข้ากันได้)
- เพิ่ม `<Alert severity="info">` แจ้งว่า cb_trans / cb_trans_detail จะถูกปรับให้ตรงกับยอดใหม่อัตโนมัติ

Backend:
- ใหม่: `backend/internal/repository/cb_trans_sync.go`
  - `syncCbTransToTotal(ctx, tx, oldDocNo, newDocNo, newTotal)` — lock cb_trans header (FOR UPDATE), scale 10 payment-instrument columns ตามสัดส่วน, รวม residual กลับเข้า `cash_amount`, reconcile `pay_cash_amount` + `money_change`, scale cb_trans_detail.amount/sum_amount ตาม ratio เดียวกัน, invariant check (sum/total/net/pay ≈ newTotal ภายใน 0.01) — ถ้า violate → return error → tx rollback
  - `scaleCbTransFields([10]float, oldPay, newTotal) ([10]float, ratio)` — pure helper สำหรับ unit test
  - `restoreCbTransFromSnapshot(ctx, tx, currentDocNo, originalDocNo, payload)` — รองรับ RollbackDocument
- แก้ `backend/internal/repository/document_repository.go`
  - ApplyChange เรียก `syncCbTransToTotal` หลัง update ic_trans header (parse `totals.TotalAmount` → float64 ก่อน)
  - `documentSnapshotPayload` เพิ่ม `CbTransRaw`, `CbTransDetailsRaw` (json.RawMessage)
  - `createDocumentSnapshot` snapshot cb_trans + cb_trans_detail เป็น jsonb ดิบ (coalesce-to-`'null'`/`'[]'`)
  - `RollbackDocument` เรียก `restoreCbTransFromSnapshot` — wipe + jsonb_populate_record(set) ถ้า snapshot ใหม่; no-op สำหรับ snapshot เก่า (backward compatible)
- ใหม่: `backend/internal/config/config.go` field `CbTransSyncEnabled` (env `NSI_CB_TRANS_SYNC`, default `true`) — สำหรับ emergency disable โดยไม่ต้อง redeploy
- Tests: `backend/internal/repository/cb_trans_sync_test.go` (TestScaleCbTransFields_* + TestRound2 + TestIsJSONNull) — `go test ./... -short` ผ่านทั้งหมด

Behaviour rules:
- บิลที่ไม่มี row ใน cb_trans (เครดิต/AR) → skip ทั้งหมด ไม่ block
- oldTotal == 0, newTotal > 0 → cash_amount รับเต็ม, instrument อื่น = 0, ratio=0
- ratio=0 + cb_trans_detail → zero amount/sum_amount + rename doc_no
- ratio!=1 → scale ทุก field × ratio, residual ทบใน cash_amount
- ratio==1 + oldDocNo!=newDocNo → rename อย่างเดียว
- Invariant fail → bubble error ขึ้นไป (caller rollback tx ทั้งก้อน — ic_trans + cb_trans กลับสู่สถานะเดิมพร้อมกัน)

Env: เพิ่ม `NSI_CB_TRANS_SYNC=true` ใน `backend/.env.example`

ไฟล์นี้คือ checkpoint ล่าสุดสำหรับเปิด chat ใหม่หรือส่งต่อให้ AI ตัวอื่นทำงานต่อ อ่านคู่กับ `README.md` ก่อนแก้โค้ดเสมอ

## AI Continuation Notes

1. อ่าน `README.md` ก่อนเพื่อเข้าใจระบบรวม
2. อ่านไฟล์นี้เพื่อรู้สถานะล่าสุดของ session และ dirty worktree
3. อย่าอ้างอิงเอกสารเก่า `genesis-DESIGN.md`, `next-salesinvoice-dev-plan.md`, `next-salesinvoice-test-report.md` เพราะถูกลบออกเพื่อกันข้อมูลล้าสมัย
4. ก่อนแก้โค้ด ให้ตรวจ `git status --short` เพราะ worktree มีงานที่ยังไม่ commit จากหลายรอบ
5. ห้าม revert ไฟล์ที่มีการแก้ไว้แล้ว เว้นแต่ user สั่งชัดเจน

## Current Environment

- Project: `next-salesinvoice`
- Purpose: safely edit SML ERP sales/service invoices in the connected PostgreSQL database
- Current staging DB: external SML server `demserver.3bbddns.com:47309/demo` (postgres/sml) — switched away from local `sml1_2026`
- Frontend URL (local dev): `http://127.0.0.1:3000/`
- Backend URL (local dev): `http://127.0.0.1:8080/`
- Customer-facing deploy: docker compose on `192.168.2.109` exposing port 3040 (frontend) + 8085 (backend) via cloudflared quick tunnel
- Latest tunnel URL (respawns each `./deploy.sh`): `https://households-selected-capability-readily.trycloudflare.com`
- Admin login on demo DB: code `001` / password `001` (erp_user.title=`admin` → maps to Admin role)

## Stack

- Backend: Go 1.24, Gin, pgx
- Frontend: React 18, Vite, TypeScript
- UI: Material UI (`@mui/material`, `@mui/x-data-grid`) with `sx` styling
- JSON audit dialog: `@uiw/react-json-view`
- Icons: `lucide-react`
- Legacy utility/custom UI stack has been removed from the current UI

## Core Data Model

SML tables:

- `erp_user`
- `ic_trans`
- `ic_trans_detail`
- `erp_doc_format`
- `ar_customer`
- `ic_inventory`

Main filter:

- `ic_trans.trans_flag = 44`

App-owned tables:

- `nsi_schema_migrations`
- `nsi_app_users`
- `nsi_app_settings`
- `nsi_audit_logs`
- `nsi_reflow_batches`
- `nsi_reflow_batch_items`
- `nsi_document_snapshots`
- `nsi_document_locks`

## Permissions

- Current demo admin login: `001 / 001` when `erp_user.title = admin`
- Admin can apply changes, rollback, view audit, and run system setup actions
- Normal users can view/search but cannot perform protected write/admin actions

## Frontend Module Layout (post-refactor, 2026-05-18)

- `frontend/src/App.tsx` — root component, ColorModeProvider → ThemedApp, AppErrorBoundary, AppRoutes, AuthShell, BrandLockup (uses `/logo-mark.svg`), BootScreen, LoginScreen (มีปุ่ม ColorModeToggle), Shell, ShellHeader (มี ColorModeToggle), DatabaseIndicator, ColorModeToggle
- `frontend/src/pages/` — lazy-loaded ทุกหน้า
  - `SystemStatusPage.tsx`, `NotFoundPage.tsx`, `AuditLogPage.tsx`, `BulkInvoiceEditPage.tsx`
- `frontend/src/components/`
  - `ui.tsx` — AppButton, EmptyState, MetricCard, MetricValue, PageHeader, PageLoading, SkeletonLine, StatusBadge, LiveRegion
  - `ui/typography.tsx` — SectionTitle, FieldLabel, DocCode, Money, MoneyTotal, EmphasisText, WEIGHT, `compactActionButtonSx`
  - `ui/index.ts` — barrel
  - `invoice-dialog.tsx` — InvoiceDetailDialog และชิ้นส่วนจอง dialog (shared chunk)
  - `data-grid.tsx` — LazyDataGrid + thaiGridLocaleText
- `frontend/src/contexts/toast.tsx` — ToastProvider/useToast (Alert role)
- `frontend/src/contexts/color-mode.tsx` — ColorModeProvider/useColorMode (light/dark/auto, localStorage persist, prefers-color-scheme live listener, cross-tab sync, sets `data-color-mode` + `color-scheme` on `<html>`)
- `frontend/src/theme.ts` — `createAppTheme(mode)` factory + light/dark palettes + design tokens (`TOUCH_TARGET_MIN_PX=44`, `DESKTOP_CONTROL_HEIGHT_PX=36`). `appTheme` = light, kept สำหรับโมดูลที่ใช้แค่ breakpoints
- `frontend/src/lib/` — `api.ts`, `format.ts` (singleton Intl formatters), `titleFromPath`
- `frontend/public/` — brand assets: `favicon.svg`, `favicon-16/32.png`, `apple-touch-icon.png`, `icon-192/512.png`, `logo-mark.svg`, `logo-mark-light.svg`, `logo-horizontal.svg`, `og-image.svg`+`.png`
- `frontend/tests/e2e/a11y.spec.ts` — Playwright + axe-core smoke (login + bulk-edit)

Bundle (vite build):

- `index` main chunk: ~34 kB
- `BulkInvoiceEditPage`: ~42 kB
- `AuditLogPage`: ~18 kB
- `SystemStatusPage`, `NotFoundPage`: < 5 kB each

Commit หลักรอบ UX/A11y ล่าสุด: typography primitives → mobile responsive (44px tap target, fullScreen dialog, card view) → a11y (skip-link, focus ring, prefers-reduced-motion, LiveRegion, axe smoke) → 404 title fix + SystemStatus responsive grid → StatusBadge ไม่รัน icon บน neutral tone → flat geometric "N" brand mark + favicon/OG icon set → light/dark/auto color-mode toggle (header + login) → คู่มือติดตั้ง Ubuntu (`docs/INSTALL_UBUNTU.md`)

## Latest UX/UI State

`/login`:

- ฟอร์ม login มีแค่ รหัสพนักงาน + รหัสผ่าน + ปุ่มเข้าสู่ระบบ
- แสดง DB status badge (ฐานข้อมูลพร้อมใช้งาน / ฐานข้อมูลยังไม่พร้อม)
- ไม่มีปุ่ม "ตั้งค่าฐานข้อมูล" แล้ว — config บังคับผ่าน `.env` เท่านั้น

`/bulk-edit` (UX redesign Phase 1-3, 2026-05-18; async bulk apply update 2026-05-20):

- Page header strip: title `แก้ไขบิลครั้งละหลายใบ` + 1-line description + bold counter `พบ N บิล` ขวาบน
- Date defaults narrowed to **current month → today** (was ±15 days)
- Filter row compact: `[จากวันที่] [ถึงวันที่] [ค้นหา + ? Tooltip + X clear] [ค้นหา button]` — date/search changes do not auto-load; Enter or button triggers search
- Search hint moved from caption text to HelpCircle Tooltip (always visible, hover for syntax help)
- Supports list/range syntax: `INV26050025:INV26050030,INV26050040`
- DataGrid: removed "ดูรายละเอียด" column → slim 48px chevron-icon column at far right (click opens detail dialog)
- Empty "—" in `หมายเหตุ` column rendered with `text.disabled` (muted)
- Row click selects checkbox + highlights row (inset 3px primary border) + opens sticky bottom action bar
- Sticky action bar (`SelectionActionBar`) renders fixed bottom (`left: { xs: 0, md: 260px }` to clear sidebar), `zIndex: appBar`
- `pageSizeOptions={[25, 50, 100]}`, `hideFooterSelectedRowCount`, `hideFooterPagination={total <= 100}` to remove footer noise when all bills fit on one page
- **Preview dialog focus panel** (`PreviewChangeSummaryPanel`, 2026-05-18 Phase 5):
  - Title "จุดเปลี่ยนที่ต้องโฟกัส" + `N จุดเปลี่ยน` warning Chip + optional `ลบสินค้า N รายการ` error Chip
  - **Only changed cards** shown in grid (filter out unchanged so panel matches its name)
  - Unchanged fields collapsed to caption `คงเดิม: ลูกค้า, ชุดเอกสาร, ...` below grid
  - If `changedCount === 0`: shows text "ไม่มีการเปลี่ยนแปลงระดับเอกสาร (มีเฉพาะการลบรายการสินค้า N รายการ)"
  - Removed redundant helper sentence "ช่องที่มีพื้นหลังสีอ่อนคือ..." (visual cues already self-explanatory)
- Settings dialog still uses compact one-row header, MUI controls
- Confirm dialog still required before real write; confirm starts async apply progress dialog and polls every 1s until batch finishes
- If batch ends partial, user can retry failed/skipped only; applied bills from the previous batch are not touched

- **Items-to-remove picker** (Phase 6, 2026-05-19):
  - เปลี่ยนจาก Autocomplete typeahead (ค้นจาก `ic_inventory` ทั้งระบบ) → `TextField select multiple` พื้นฐาน แสดงเฉพาะสินค้าที่มีในบิลที่ user เลือกไว้ (dedup’d จาก `ic_trans_detail`)
  - Endpoint ใหม่: `POST /api/v1/documents/items` body `{ docNos: [...] }` คืน `{ items: [{code, name, unitCode, docCount}] }` (limit 500 docs/call)
  - Empty state: disable + helper "เลือกบิลก่อน จึงจะเห็นรายการสินค้า"
  - Auto-prune: ถ้า user เปลี่ยนบิลที่เลือกหลังเลือกสินค้าไปแล้ว → `removeItemCodes` จะถูก prune อัตโนมัติ + toast แจ้ง
  - Backend `/api/v1/master/products` (typeahead จาก `ic_inventory`) ยังคงไว้เผื่อ future use — หน้า bulk-edit ไม่เรียกแล้ว

- **Per-bill row editing in preview dialog** (Phase 7, 2026-05-19):
  - ลบ global "สินค้าที่ต้องการลบในบิล" ออกจาก Settings dialog แล้ว (legacy `removeItemCodes` ยังคงรองรับใน API เพื่อ backward compat)
  - Preview dialog: แต่ละบิลแสดงตารางรายการสินค้าแบบ inline (`EditableDocumentLinesPanel`) พร้อม:
    - ปุ่ม trash/restore ต่อบรรทัด (toggle ลบ/กู้คืน) — แถวที่ถูกลบจะเป็น strikethrough
    - ปุ่ม "เพิ่มสินค้า" → เปิด `AddItemDialog` (product typeahead + qty + price + discount + unit)
    - ยอดรวมในตารางคำนวณใหม่แบบ live (client-side) ตาม `vat_type` ของบิล
    - ถ้าบิลใดถูกลบจนหมดบรรทัด → block apply (button disabled) + แสดง error
  - State store: `Map<docNo, PerDocEdits>` ที่ระดับ page (`perDocEdits`) — แต่ละ entry เก็บ `removedRoworders: Set<number>` + `addedLines: NewLineInput[]`
  - Backend payload: `bulk/preview-change` + `bulk/apply-change` รับ `perDocEdits: { [docNo]: { removeItemCodes:[], addedLines:[] } }` (เพิ่มเติมจาก legacy global fields)

- **Unit dropdown in AddItemDialog** (Phase 7, 2026-05-19):
  - เมื่อเลือกสินค้า → fetch `GET /api/v1/master/product-units?code=<icCode>` → ดึงหน่วยจาก `ic_unit_use` left join `ic_unit` (ordered by `line_number`)
  - Auto-select `product.unitCode` ถ้ามีอยู่ในรายการ มิฉะนั้นเลือกแถวแรก (fallback to product.unitCode literal)
  - ถ้าสินค้านั้นไม่มี row ใน `ic_unit_use` → field กลายเป็น plain TextField + helper "ไม่มีหน่วยใน ic_unit_use"

- **Clone-template insert strategy for new detail lines** (Phase 7, 2026-05-19):
  - `insertAddedDetailLines` (`document_repository.go` ~line 2227) **ไม่** ระบุคอลัมน์ของ `ic_trans_detail` แบบ hardcoded แล้ว (~125 คอลัมน์ — เสี่ยงตกหล่น NOT NULL/business fields)
  - กลยุทธ์: หา `roworder` ของบรรทัดแรกในบิลเดียวกัน → ใช้ `information_schema.columns` ดึงรายชื่อคอลัมน์ทั้งหมด (ยกเว้น `roworder`) → ทำ `INSERT INTO ic_trans_detail (cols) SELECT cols FROM ic_trans_detail WHERE roworder=$template RETURNING roworder` → จากนั้น `UPDATE` เฉพาะฟิลด์ที่ต่างของบรรทัดใหม่ (`line_number`, `item_code`, `item_name`, `unit_code`, `qty`, `price`, `discount`, `discount_amount`, `sum_amount`, `sum_amount_exclude_vat`, `total_vat_value=0`, `wh_code`, `shelf_code`, `vat_type`, `tax_type`, `cust_code`, `inquiry_type`, costs/refs=0/blank, `create_date_time_now=now()`)
  - กรณีที่ INSERT แบบเดิมตก (เช่น `doc_date` NOT NULL ไม่มี default, `calc_flag=-1` SML ใช้คำนวณยอดรวม) → แก้แบบ schema-agnostic ทนต่อการเพิ่มคอลัมน์ใหม่ของ SML
  - ฟิลด์ vat/cust_code/inquiry_type/doc_no จะถูก overwrite อีกครั้งโดย UPDATE ที่ตามมาใน `ApplyChange` (~line 519) สำหรับทุก row ของบิล (รวม row ใหม่)

`/audit` (UX redesign Phase 4-A, 2026-05-18):

- Same header strip pattern as `/bulk-edit`: title + description + `พบ N รายการ` counter ขวาบน
- Removed inner "ประวัติการบันทึก" SectionTitle + inline StatusBadge (relocated to page header)
- Search: Enter triggers `loadLogs()`, `helperText` removed, HelpCircle Tooltip in endAdornment
- Removed text buttons ("ค้นหา" + "โหลดใหม่") → single IconButton ↻ with Tooltip "โหลดข้อมูลใหม่"
- Row 4 action buttons (`บิลเดิม / บิลใหม่ / เทคนิค / ย้อนกลับ`) kept as-is (not converted to dropdown yet)

`/system/status` (UX redesign Phase 4-B, 2026-05-18):

- `PageHeader.actions`: primary "กลับไปแก้ไขบิล" (tone="primary") + IconButton ↻ "ตรวจสอบใหม่" (was both buttons primary tone)
- Layout unchanged otherwise; install/migrate flow still works

## Latest Backend Behavior

- Runtime startup/reconnect verifies database with `Verify()` only
- It no longer silently creates `nsi_*` tables during status/startup
- Explicit Admin migration uses `POST /api/v1/system/database-migrate`
- Login/auth still depends on `nsi_app_users`; a brand-new SML database should be installed through Admin system action before normal use. For the current `demserver` demo DB the `nsi_*` schema was bootstrapped manually via `/tmp/nsi_migrate.sql` because admin user `001` already existed in SML.
- **Database connection config is env-only** (`SML_DB_*`); runtime APIs for changing DB config (`database-bootstrap`, `database-config`, `database-reconnect`, `database-verify`) have been removed
- Document search parser supports exact list/range syntax and falls back to fuzzy search for normal text
- Audit document search uses the same parser behavior
- **Doc number generator** (`previewNextDocNo` / running-number allocator in `document_repository.go`) supports SML formats with `@` marker (e.g. `@-YYMM####`) and now skips candidates already present in `ic_trans.doc_no` for sales `trans_flag=44` regardless of `doc_format_code`. It also reserves generated numbers in memory within the same request so bulk preview/apply never returns duplicates in one batch. Tests in `document_repository_test.go`.
- **Per-doc edits endpoint payload** (`/bulk/preview-change`, `/bulk/apply-change`): นอกจาก legacy global `removeItemCodes` ยังรับ `perDocEdits: map[docNo]{ removeItemCodes, addedLines }` สำหรับลบ/เพิ่มรายการแบบต่อบิล (Phase 7).
- **Async bulk apply endpoints** (Phase 9): frontend uses `POST /bulk/apply-change/start` then polls `GET /bulk/batches/:batchId`. Existing sync `POST /bulk/apply-change` remains for compatibility.
- **Bulk apply progress storage**: `StartBulkApplyChange` creates a `nsi_reflow_batches` row and `pending` `nsi_reflow_batch_items`, then an in-process worker updates each item through `processing` → `applied`/`failed`/`skipped`, refreshing counts after every bill.
- **Retry failed only**: `POST /bulk/batches/:batchId/retry-failed` creates a new batch from failed/skipped items of the previous batch only, filters per-doc edits to those docs, and clears `docNoOverrides` so duplicate doc numbers are regenerated instead of reused.
- **Sale type validation**: bulk change can preserve an existing non-standard SML `inquiry_type` when the request uses the sentinel/preserved value, but still rejects changing a normal doc to an invalid sale type.
- **`GET /api/v1/master/product-units?code=<icCode>`** (Phase 7): คืนรายการหน่วยของสินค้านั้นจาก `ic_unit_use` left join `ic_unit` (order by `line_number`).
- **`tax_doc_no` is synced to `doc_no`** on both apply (line ~519) and rollback (line ~933) paths.
- **`Documents.List` returns total count** via separate `select count(*)` query (signature: `([]model.DocumentSummary, bool, int, error)`). Frontend `BulkInvoiceEditPage.tsx` displays `แสดง ${items.length} / ${total} บิล`.
- **VAT totals recomputation on vat_type change / item deletion**:
  - `calculateTotals(ctx, q, docNo, excludeItemCodes, vatType int16)` and `calculateTotalsByDocNo(..., vatType)` now derive per-line `sum_amount_exclude_vat` and `total_vat_value` via SQL `CASE` based on supplied `vatType`, using a fixed 7% rate (Thai standard — `ic_trans_detail` has NO `vat_rate` column on customer DB).
  - Conventions: `vat_type` 0 = no VAT (excl=sum_amount, vat=0); 1 = VAT included in `sum_amount` (excl = round(sum_amount × 100/107, 2), vat = sum_amount − excl); 2 = VAT excluded (excl=sum_amount, vat = round(sum_amount × 7/100, 2)). `total_amount`: type 0 → sum_amount; type 1 → sum_amount; type 2 → sum_amount + vat.
  - `ApplyChange` also PERSISTS the recomputed `sum_amount_exclude_vat` and `total_vat_value` to `ic_trans_detail` so saved rows stay consistent (single UPDATE combined with `vat_type`/`tax_type` change at line ~516).
  - Deletion path: lines deleted from `ic_trans_detail` first, then `calculateTotals` sums remaining rows with the new vat_type → header `ic_trans` updated correctly.

## Dirty Worktree Summary

Expected important modified/deleted files from current work:

- `backend/internal/http/router.go`
- `backend/internal/model/document.go`
- `backend/internal/repository/document_repository.go`
- `backend/internal/repository/document_repository_test.go`
- `frontend/src/pages/BulkInvoiceEditPage.tsx`
- `frontend/src/pages/AuditLogPage.tsx`
- `frontend/src/lib/format.ts`
- `frontend/src/types.ts`
- docs updated for current status: `README.md`, `SESSION_HANDOFF.md`, `backend/README.md`, `frontend/README.md`

Do not assume these changes are committed.

## Latest Verification

Passed in this session:

- `npm run build`
- `go test ./...`
- Cloudflare quick tunnel deploy: `https://households-selected-capability-readily.trycloudflare.com`
- `GET /bulk-edit`: 200
- `GET /api/v1/health`: healthy
- Direct ready check `http://192.168.2.109:8085/api/v1/readyz`: ready
- Unauthenticated batch progress endpoint returns 401 as expected

## Production Deploy Notes

- Dev deploy: `./deploy.sh` (rsync → 192.168.2.109 → docker compose up —build → cloudflared quick tunnel) — สำหรับ dev/QA เท่านั้น
- **Customer install (production)**: ทำตาม [`docs/INSTALL_UBUNTU.md`](docs/INSTALL_UBUNTU.md) — Docker engine + compose plugin → `/opt/next-salesinvoice` → `.env` (`SESSION_SECRET` ≥ 32 chars สุ่มใหม่ทุก deployment) → docker compose up → nginx reverse proxy + Let's Encrypt → ufw allow 22/80/443 เท่านั้น
- Backend auth cookie: `Secure: cfg.IsProduction()` — production ต้องเข้าผ่าน HTTPS เท่านั้น; HTTP plain login ไม่ติด (cookie ไม่ส่งกลับ)
- Cloudflare quick tunnel URL respawns ทุกรอบ `./deploy.sh` — ดู stdout
- Dev login on current demo DB: `001 / 001`

## Important Safety Rules

- Verify actual DB/schema before assuming
- Never write to SML without preview and confirm
- Keep writes in transactions
- Keep document lock at apply time
- Always snapshot before write
- Do not log or return database passwords
- Do not alter SML-owned tables except intended document updates
- Keep app tables under `nsi_`
- If moving to a new SML database, check `/system/status` and install `nsi_*` explicitly

## Remaining Work

- Run staging real-write + rollback after any risky backend change if user confirms staging write
- Manual QA async progress with 50/100-bill batches and retry failed/skipped cases
- Multi-user conflict/stress test
- Full E2E seed/apply/rollback regression suite
- If server restarts during async batch, v1 may leave an item in `processing`; progress will show current state and retry should be used only for not-applied items
- VAT rate is hardcoded 7% in `calculateTotals` / detail UPDATE; if customer ever needs different rate (e.g. 0% export, future rate changes), source it from `ic_trans.vat_rate` (header has the column) via subquery or pass as param
- Add unit/integration test for VAT recomputation (type 0/1/2 + deletion combinations) — existing tests cover doc-number generation only
- **Pre-PROD checklist (UX redesign deployed, awaiting user QA round):**
  - End-to-end manual: mix vat_type 0/1/2 bills, delete items, apply, audit + rollback verify
  - Cloudflare quick tunnel → migrate to named tunnel + custom domain for stable URL
  - PostgreSQL backup policy on `192.168.2.109`
  - Mobile responsive review at ≤ 600px on the 3 redesigned pages
  - Optional: convert `/audit` row 4 buttons into dropdown/kebab to compress that column
