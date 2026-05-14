# next-salesinvoice Session Handoff

Last updated: 2026-05-13 20:31 Asia/Bangkok

This file is the short context snapshot for starting a new Codex chat session.

## Project Identity

- Project name: `next-salesinvoice`
- Purpose: web app for safely editing SML ERP sales/service invoices in the target SML PostgreSQL database.
- Current concept: work only on the connected target database, normally the transferred `data2` database. Do not touch `data1` or the SML transfer process.
- Current dev/test DB: `sml1_2026`
- Local app URL: `http://127.0.0.1:3000/`
- Backend URL: `http://127.0.0.1:8080/`

## Stack

- Backend: Go + Gin
- Frontend: React + Vite
- Main frontend files:
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
- Main docs:
  - `README.md`
  - `next-salesinvoice-dev-plan.md`
  - `next-salesinvoice-test-report.md`

## Core SML Tables

- Login: `erp_user`
- Sales header: `ic_trans`
- Sales detail: `ic_trans_detail`
- Sales/service filter: `trans_flag = 44`
- Document format: `erp_doc_format where screen_code = 'SI'`
- Customer: `ar_customer`
- Product: `ic_inventory`

## App-Owned Tables

All app tables use prefix `nsi_` and are created in the connected SML database:

- `nsi_schema_migrations`
- `nsi_app_users`
- `nsi_app_settings`
- `nsi_audit_logs`
- `nsi_reflow_batches`
- `nsi_reflow_batch_items`
- `nsi_document_snapshots`
- `nsi_document_locks`

## Users / Permission

- `EMP001 / 1234`: Admin when `erp_user.title = admin`
- `EMP002 / 1234`: User when `erp_user.title` is not `admin`
- Admin can apply changes, rollback, view audit, and manage DB config.
- User can view/search but cannot perform protected Admin actions.

## Current Completed Flow

- Login/logout/session
- Database readiness check and migration
- Document list with search/pagination and SML-style sales invoice grid
- Single document edit:
  - choose document format
  - run next document number
  - choose customer
  - choose sale type/tax type
  - edit remark
  - choose products to remove
  - preview
  - confirm apply
- Bulk edit:
  - select visible rows
  - select matching results from server up to 300 documents
  - choose shared config
  - preview per document
  - confirm apply only ready documents
- Apply writes to `ic_trans` and `ic_trans_detail` in transaction.
- Apply creates lock, batch/status, raw snapshot, and audit log.
- Admin rollback restores from snapshot.
- Database config UI saves to `nsi_app_settings`.
- Reconnect verifies/migrates target DB before switching runtime connection.
- Confirmation modals exist before risky actions:
  - bulk apply
  - rollback
  - save database config
  - reconnect database
- Invoice detail dialog is reusable and can receive document/detail-line data directly.
- Audit history can open invoice detail dialogs for before/after snapshots when history rows exist.

## Latest UX/UI State

- Minimal clean workbench for general staff.
- Menus are separate pages, not scroll anchors.
- Responsive mobile/tablet navigation.
- Font system uses `Noto Sans Thai`.
- The database config page spacing issue between the action strip and summary grid was fixed in `frontend/src/styles.css`.
- Invoice detail dialog was redesigned around SML familiarity:
  - full-width document-style dialog
  - header/footer use plain text rather than inputs
  - item lines use `ic_trans_detail`
  - shows `wh_code` and `shelf_code`
  - supports ESC and header X to close
  - reused by audit before/after dialogs
- Bulk edit settings dialog search fields were stabilized:
  - shared dropdown-search component for customer and product
  - customer dropdown floats below the input
  - product dropdown opens upward to avoid being clipped near the dialog footer
  - selected products are capped in a scrollable chip area
- `/bulk-edit` sales invoice list now follows SML-style columns:
  - `ic_trans.doc_date` -> `วันที่เอกสาร` shown as Buddhist year date, for example `12/5/2569`
  - `ic_trans.doc_time` -> `เวลา`
  - `ic_trans.doc_no` -> `เลขที่เอกสาร`
  - `ic_trans.cust_code` -> `รหัสลูกหนี้`
  - `ic_trans.remark` -> `หมายเหตุ`
  - `ic_trans.total_amount` -> `ยอดสุทธิ`
  - `ดูรายละเอียด` button opens the invoice detail dialog
- Current known UX direction: keep layout close to SML where staff familiarity matters, while keeping the next-salesinvoice visual language.

## Latest Verification

Last verified on 2026-05-13:

- Frontend `npm run build`: Pass after latest table/dialog changes.
- Backend `go test ./...`: Pass earlier in this session; no backend code changed after that.
- Browser preview:
  - `/bulk-edit` displayed the SML-style sales invoice list.
  - Invoice detail dialog opened from invoice rows.
  - Settings dialog customer/product dropdown behavior was manually previewed.
- Current local URLs:
  - Frontend: `http://127.0.0.1:3000/`
  - Backend: `http://127.0.0.1:8080/`

Audit artifacts:

- `/private/tmp/next-salesinvoice-usability-audit/`
- `/private/tmp/next-salesinvoice-usability-audit/report.json`
- `/private/tmp/next-salesinvoice-responsive-audit/`
- `/private/tmp/next-salesinvoice-responsive-audit/report.json`

## Important Safety Rules

- Verify actual DB/schema before assuming.
- Do not write to SML before preview/validation.
- Keep writes in transactions.
- Keep connection pool conservative.
- Do not log or return database passwords.
- Do not alter SML-owned tables except intended document updates.
- App tables must stay under `nsi_`.
- If DB changes, verify/migrate `nsi_*` tables in the new DB before use.

## Open Work / Production Before-Go-Live

- Stress test with production-scale/customer-size data:
  - 1,000 bills
  - 10,000 bills
  - 100,000 bills
- Multi-user conflict/stress test on staging or backup clone.
- Full E2E test that safely seeds/restores test data and clicks apply/rollback actions.
- Production deploy/runbook.
- Password-at-rest hardening for saved DB config.
- Further UX polish from real staff feedback.
