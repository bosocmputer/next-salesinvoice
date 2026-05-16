# next-salesinvoice Session Handoff

Last updated: 2026-05-16 Asia/Bangkok

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
- Current staging DB: `sml1_2026`
- Frontend URL: `http://127.0.0.1:3000/`
- Backend URL: `http://127.0.0.1:8080/`
- Backend dev server was restarted in this session after the latest backend migration-behavior change
- Latest health check: `GET /api/v1/health` returned healthy

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

- `EMP001 / 1234`: Admin when `erp_user.title = admin`
- Admin can apply changes, rollback, view audit, and run system setup actions
- Normal users can view/search but cannot perform protected write/admin actions

## Latest UX/UI State

`/login`:

- ฟอร์ม login มีแค่ รหัสพนักงาน + รหัสผ่าน + ปุ่มเข้าสู่ระบบ
- แสดง DB status badge (ฐานข้อมูลพร้อมใช้งาน / ฐานข้อมูลยังไม่พร้อม)
- ไม่มีปุ่ม "ตั้งค่าฐานข้อมูล" แล้ว — config บังคับผ่าน `.env` เท่านั้น

`/bulk-edit`:

- Compact MUI/DataGrid workbench
- Header redesigned as context bar with DB status chip
- Search supports text, list, and range syntax such as `INV26050025:INV26050030,INV26050040`
- Search input has clear text action
- Reload keeps current filters/search and refreshes data
- Bulk select-by-result button was removed from UI
- Selection action bar appears only after selecting rows
- Settings dialog uses compact one-row header and MUI controls
- Preview loading dialog appears while backend builds preview
- Preview dialog no longer requires user to mark each bill as read/checked
- User can choose documents in queue, inspect change summary, then send writable bills into SML
- Confirm dialog still appears before real write

`/audit`:

- Compact DataGrid-style history view
- Search follows the same document list/range behavior as `/bulk-edit`
- Old/new invoice detail dialogs use one-row header
- Changed fields are highlighted
- Technical dialog uses JSON view and highlights changed JSON paths

`/system/status`:

- Admin-only diagnostic/setup page
- `GET /api/v1/system/database-status` is read-only
- If `nsi_*` tables are missing and SML tables are ready, Admin sees `ติดตั้งตารางระบบ`
- If required SML tables are missing, install button is disabled and missing tables are shown
- Current `sml1_2026` status: connected, SML ready, app schema ready

## Latest Backend Behavior

- Runtime startup/reconnect verifies database with `Verify()` only
- It no longer silently creates `nsi_*` tables during status/startup
- Explicit Admin migration uses `POST /api/v1/system/database-migrate`
- Login/auth still depends on `nsi_app_users`; a brand-new SML database should be installed through Admin system action before normal use
- **Database connection config is env-only** (`SML_DB_*`); runtime APIs for changing DB config (`database-bootstrap`, `database-config`, `database-reconnect`, `database-verify`) have been removed
- Document search parser supports exact list/range syntax and falls back to fuzzy search for normal text
- Audit document search uses the same parser behavior

## Dirty Worktree Summary

Expected important modified/deleted files from current work:

- `backend/internal/appruntime/state.go`
- `backend/internal/http/router.go`
- `backend/internal/model/document.go`
- `backend/internal/repository/audit_repository.go`
- `backend/internal/repository/document_repository.go`
- `backend/internal/repository/document_repository_test.go`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/src/App.tsx`
- `frontend/src/styles.css`
- removed old custom UI/config files under `frontend/src/components/ui`, `frontend/src/lib/utils.ts`, `frontend/components.json`, `frontend/postcss.config.js`, `frontend/tailwind.config.ts`
- documentation cleanup updates these docs and deletes old root docs

Do not assume these changes are committed.

## Latest Verification

Passed in this session:

- `npm run build`
- `go test ./...`
- `GET http://127.0.0.1:8080/api/v1/health`
- Browser QA script for `/system/status`
  - desktop `1440x900`
  - mobile `390x844`
  - mock missing `nsi_*` tables
  - mock missing SML tables
  - horizontal overflow: false
  - console errors: 0

QA artifact:

- `/private/tmp/next-salesinvoice-system-status-qa/report.json`

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
- Stress test with production-like data sizes
- Multi-user conflict/stress test
- Full E2E seed/apply/rollback regression suite
