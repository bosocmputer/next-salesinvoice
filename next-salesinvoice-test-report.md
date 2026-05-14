# next-salesinvoice Test Report

Date: 2026-05-12
Database: `sml1_2026`
Target: `http://127.0.0.1:3000/`

## Scope Tested

- Login and session
- Database readiness
- Document list and document detail
- Master data search: customer, product, document format
- Single document preview validation
- Bulk preview validation
- Bulk apply one document
- Rollback after apply
- UI smoke test for every menu
- UI bulk preview flow
- DB verification for locks and rollback state

## Automated API Test Result

Report JSON: `/private/tmp/next-salesinvoice-api-test-report.json`

Summary:

- Total API cases: 18
- Passed: 18
- Failed: 0
- Admin role source: `erp_user.title = admin`
- Apply test document: `INV26050021`
- Applied temporary new document: `INV26050023`
- Rollback restored: `INV26050021`
- Document locks after test: `0`

Important cases passed:

| Case | Result |
|---|---|
| Invalid password rejected | Pass |
| Login `EMP001` | Pass |
| Database status | Pass |
| Document list | Pass |
| Document detail | Pass |
| Running number | Pass |
| Customer search | Pass |
| Product search | Pass |
| Single preview valid | Pass |
| Invalid customer blocked | Pass |
| Remove all lines blocked | Pass |
| Bulk preview two documents | Pass |
| Bulk preview mixed remove item | Pass |
| Bulk over 300 docs blocked | Pass |
| Bulk apply one doc | Pass |
| Rollback applied doc | Pass |

## UI Test Result

Screenshots:

- `/private/tmp/next-salesinvoice-ui-matrix/invoices.png`
- `/private/tmp/next-salesinvoice-ui-matrix/bulk.png`
- `/private/tmp/next-salesinvoice-ui-matrix/edit.png`
- `/private/tmp/next-salesinvoice-ui-matrix/audit.png`
- `/private/tmp/next-salesinvoice-ui-matrix/database.png`
- `/private/tmp/next-salesinvoice-ui-matrix/status.png`
- `/private/tmp/next-salesinvoice-ui-matrix/bulk-preview.png`

Result:

- Every menu opened successfully
- Brand shows `next-salesinvoice`
- No blank page found after latest fixes
- Console errors: 0
- Bulk preview displayed `พร้อม 11`, `เตือน 0`, `ไม่ผ่าน 0`

## Bugs Found And Fixed During Testing

### 1. Wrong Product Name / Project Name Drift

Symptom:

- UI and README used `sml-reflow`

Fix:

- Renamed visible UI/docs back to `next-salesinvoice`

Status: Fixed

### 2. Bulk Preview Blank Page

Symptom:

- After clicking bulk preview, screen became blank

Root cause:

- Backend returned `removeHits: null`
- Frontend expected `removeHits.length`

Fix:

- Backend now returns `[]` when there are no remove hits
- Frontend guards with `(item.removeHits || [])`

Status: Fixed

### 3. Running Number Collision

Symptom:

- First bulk preview generated `INV26050022`, which already existed

Root cause:

- Latest document number query sorted by `doc_date desc, doc_no desc`
- If highest document number has an older date, running number can be wrong

Fix:

- Running number now uses `order by doc_no desc` for the selected `doc_format_code`

Status: Fixed

### 4. Rollback Could Not Restore SML Detail Rows

Symptom:

- Rollback failed with `null value in column doc_date of relation ic_trans_detail`

Root cause:

- Snapshot stored only simplified detail model, not full SML table row

Fix:

- Snapshot now stores raw `ic_trans` and raw `ic_trans_detail` JSON
- Rollback can restore raw rows via PostgreSQL record population
- Existing old snapshots still use fallback rollback path

Status: Fixed for new snapshots

### 5. Main List Missing Document App Status

Symptom:

- User could not see which bills were already processed, failed, processing, or rolled back from the main list.

Fix:

- Backend document list now returns `appStatus` from `nsi_reflow_batch_items`, `nsi_document_snapshots`, and `nsi_document_locks`.
- Frontend shows status in both the single-document list and bulk-selection list.

Status: Fixed

### 6. Bulk Selection Did Not Support Large Result Sets Ergonomically

Symptom:

- UI could only select documents currently rendered on screen.
- This would be difficult when a user searches 1,000+ bills and wants to select many matching bills without loading every row.

Fix:

- Added server-side endpoint `/api/v1/documents/selectable-doc-nos`.
- Bulk UI now has `เลือกตามเงื่อนไขสูงสุด 300`, selecting matching documents from the server without rendering all rows.
- Limit remains 300 per apply batch to reduce risk against the live SML database.

Status: Fixed for current production guardrail

### 7. Single Document Apply Had No Rollback Snapshot

Symptom:

- Single document apply could update SML successfully, but rollback failed with `load rollback snapshot: no rows in result set`.

Root cause:

- Snapshot/lock/batch records were created by bulk apply only.
- Single apply used the low-level update path directly.

Fix:

- Added single apply path that creates batch, document lock, raw snapshot, batch item, and releases lock after apply.
- Router now uses the snapshot-aware single apply method.

Status: Fixed

### 8. Database Config Was Not Editable

Symptom:

- UI showed database config but could not save it.

Decision:

- Store editable config in `nsi_app_settings` with key `database.connection`.
- Keep current active connection stable until backend reconnect/restart, so saving config does not interrupt active users.

Fix:

- Added Admin-only `GET /api/v1/system/database-config`.
- Added Admin-only `PUT /api/v1/system/database-config`.
- UI can edit host, port, database, user, password, SSL mode, schema, and max connections.
- Password is not returned to the browser; leaving it blank keeps the previous password.

Status: Fixed

## Remaining Gaps / Need More Information

### 1. Non-admin User Permission Test

Current DB has:

- `EMP001`, title `admin`, active
- `EMP002`, title `User`, active

Verified:

- `EMP002 / 1234` logs in as `User`.
- User can load document list.
- User cannot apply document changes.
- User cannot view audit logs.
- User cannot view/save database config.

Status: Tested and passed.

### 2. Apply Remove Item Then Rollback

Test bill created:

- `INV26050002`
- Items: `HENNA001`, `CON-01020`
- Starting total: `736.79`

Verified:

- Preview removing `HENNA001` leaves `CON-01020`.
- Preview total becomes `439.33`.
- Apply changed document temporarily to `INV26050023`.
- Rollback restored `INV26050002`.
- Restored details are `HENNA001, CON-01020`.

Status: Tested and passed after fixing single apply snapshot.

### 3. Larger Than 300 Documents Per Batch

Current UI supports:

- Select visible rows.
- Select matching search results from the server up to 300 documents.

Need decision:

- Keep 300 documents per batch for safety, or allow larger batches with queue/background processing.

### 4. Immediate Document Lock On Selection

Decision:

- Keep document lock at apply time.

Reason:

- Apply-time lock avoids stale preview locks that block other staff.
- Backend revalidates before apply and locks each document while writing to SML.
- This reduces contention with the existing SML ERP.

### 5. Mobile/Tablet Deep Verification

Viewports tested:

- Mobile: `390x844`
- Tablet portrait: `768x1024`
- Tablet landscape: `1024x768`

Pages tested:

- `invoices`
- `bulk`
- `edit`
- `audit`
- `database`
- `status`

Issue found:

- At `1024x768`, sidebar was still visible and document rows were clipped inside the content area.

Fix:

- Added mobile page selector in the top bar.
- Changed responsive breakpoint so tablet landscape uses mobile navigation instead of sidebar.

Verification:

- 18 screenshots generated under `/private/tmp/next-salesinvoice-mobile-audit/`.
- Report JSON: `/private/tmp/next-salesinvoice-mobile-audit/report.json`
- Horizontal body overflow: 0
- Visible element overflow offenders: 0
- Console errors after auth bootstrap: 0
- Mobile navigation visible on all tested mobile/tablet pages.

Status: Tested and passed.

### 6. Database Reconnect From UI

Decision:

- Save database config in `nsi_app_settings`.
- Admin can click `Reconnect` to create a new DB pool, verify/migrate the target DB, then switch runtime state.
- If the target connection/migration fails, the current DB connection remains active.

Verification:

- Started on `sml1_2026`.
- Saved config database as `sml1`.
- Reconnected successfully.
- Verified active database became `sml1`.
- Saved config database back to `sml1_2026`.
- Reconnected successfully.
- Verified active database returned to `sml1_2026`.

Status: Tested and passed.

## Recommendation Before Production

Do not open production usage yet until these are complete:

- Active User permission test
- Larger seeded dataset test: 1,000 / 10,000 documents must be performed against customer-size data.

## Latest Follow-up Verification

Date: 2026-05-12

- `go test ./...`: Pass
- `npm run build`: Pass
- Login `EMP001`: Pass
- Database status `sml1_2026`: Pass
- Document list with `appStatus`: Pass
- Server-side selectable documents endpoint: Pass, returned 11 test documents
- Browser preview bulk page: Pass
- Browser console errors: 0
- Created multi-line test bill `INV26050002`: Pass
- Single preview remove one item: Pass
- Single apply remove one item: Pass
- Single rollback after remove item: Pass
- Restored test bill detail count: 2
- API test suite after fixes: 18/18 Pass
- Document locks after tests: 0
- `EMP002 / 1234` User permission matrix: Pass
- Database config saved to `nsi_app_settings`: Pass
- Database config UI save button visible/enabled for Admin: Pass
- Database config browser console errors: 0
- Runtime database reconnect `sml1_2026 -> sml1 -> sml1_2026`: Pass
- Mobile/tablet deep audit across 18 viewport/page combinations: Pass

## Minimal UX/UI Refresh Verification

Date: 2026-05-12

Changed:

- Standardized the visual system around `Noto Sans Thai`, smaller production-style font scale, neutral background, reduced shadows, tighter spacing, and restrained green accent.
- Simplified sidebar/menu wording for general staff: `รายการบิลขาย`, `แก้ไขหลายบิล`, `แก้ไขบิลเดียว`.
- Made buttons, panels, tables, dialogs, badges, empty states, and form controls more consistent and less heavy.
- Removed the initial unauthenticated `/auth/me` call when no prior session exists, eliminating noisy browser 401 console errors.
- Restored saved database config to `sml1_2026` so active DB and saved config match after reconnect testing.

Verification:

- `npm run build`: Pass
- `go test ./...`: Pass
- API test suite: 18/18 Pass
- Browser UX audit: Pass
- Viewports tested: large desktop `2048x1350`, desktop `1440x900`, tablet `768x1024`, mobile `390x844`
- Pages tested in every viewport: `invoices`, `bulk`, `edit`, `audit`, `database`, `status`
- Horizontal overflow: 0
- Browser console errors: 0
- Expected page text found: 18/18

Artifacts:

- Screenshot folder: `/private/tmp/next-salesinvoice-ux-audit/`
- Report JSON: `/private/tmp/next-salesinvoice-ux-audit/report.json`

## Large Screen Layout Follow-up

Date: 2026-05-12

Changed:

- Added spacing between config form sections, especially below `หมายเหตุใหม่` before the `สินค้า` panel.
- Added desktop workbench heights for list/config/edit/settings layouts so large screens do not leave excessive unused space below the main working area.
- Kept tablet/mobile layouts natural-height to avoid forcing cramped panels on small devices.
- Main document tables and bulk document lists now scroll inside the working panel on larger screens.

Verification:

- `npm run build`: Pass
- Browser UX audit: Pass
- Large desktop `2048x1350`: Pass
- Horizontal overflow: 0
- Browser console errors: 0

## Usability / User Error Audit

Date: 2026-05-12

Method:

- Tested through browser automation as `EMP001 / 1234`.
- Tested main user flows without writing final changes back to SML.
- Actions tested: login, document search, open single edit, move through edit stages, preview before save, select multiple bills, bulk preview, audit search, database/status inspection.
- Destructive actions intentionally not clicked: apply, rollback, database reconnect.

Artifacts:

- Screenshot folder: `/private/tmp/next-salesinvoice-usability-audit/`
- Report JSON: `/private/tmp/next-salesinvoice-usability-audit/report.json`

Result:

- Browser console errors: 0
- Horizontal overflow: 0
- Main flows are coherent, but some screens still need clearer guardrails for general staff.

Screen scores:

| Screen | Score | User error risk | Notes |
|---|---:|---|---|
| Login | 8.5/10 | Low | Clear enough, database readiness is visible. |
| รายการบิลขาย | 8/10 | Low-Medium | Search works. After fixed-height change, table rows now stay at top instead of stretching. Empty space still exists when only one result is shown. |
| แก้ไขบิลเดียว | 8/10 | Medium | Step flow works and preview is clear. Risk: users may click preview without realizing no product is selected for removal. |
| แก้ไขหลายบิล | 7/10 | Medium-High | Core flow works. Risk: many controls on one screen, customer autocomplete/datalist is not obvious, and final apply button is visible after preview. |
| ประวัติการแก้ไข | 7.5/10 | Medium | Search works. Risk: rollback area is visually prominent for Admin and could be clicked too easily. |
| ตั้งค่าฐานข้อมูล | 7/10 | High for non-technical users | Functionally clear for Admin/DevOps, but risky for general staff. Needs stronger confirmation/help text before save/reconnect. |
| สถานะระบบ | 9/10 | Low | Clear and safe. |

Recommended next UX fixes:

- Add a stronger empty/selected state on edit and bulk preview so users know exactly what will change.
- Add a confirm modal for rollback/reconnect/save database config.
- Consider hiding database settings from normal staff entirely.
- Improve bulk customer selector so it behaves like a real searchable dropdown instead of a datalist text input.
- Add a pre-apply summary strip: selected bills, customer, doc format, products to remove, ready/blocked count.

## Usability Guardrail Follow-up

Date: 2026-05-12

Changed:

- Added confirmation modal before bulk apply. The modal summarizes selected bills, bills that are ready to save, new customer, and products to remove.
- Added confirmation modal before rollback from Snapshot.
- Added confirmation modal before saving database config.
- Added confirmation modal before reconnecting/switching runtime database.
- Changed bulk customer input from a free text/datalist style to an explicit customer select with a search box, reducing accidental invalid customer entry.
- Added a pre-apply bulk summary strip showing ready/blocked count, selected customer, document format, and product removal scope.
- Improved audit action labels such as `database_config` and `rollback` into staff-readable Thai wording.
- Added/verified spacing around the database config action area so the reconnect/save instruction is no longer visually cramped.

Verification:

- `npm run build`: Pass
- `go test ./...`: Pass
- Browser usability audit: Pass
- Browser responsive audit: Pass
- Desktop tested: `1440x900`
- Mobile tested: `390x844`
- Tablet tested: `768x1024`
- Pages tested: `invoices`, `bulk`, `edit`, `audit`, `database`, `status`
- Modal screenshots tested: bulk apply, rollback, save database config, reconnect database
- Browser console errors: 0
- Horizontal overflow: 0
- Destructive confirmation buttons were not clicked during this audit.

Artifacts:

- Usability screenshots: `/private/tmp/next-salesinvoice-usability-audit/`
- Usability report JSON: `/private/tmp/next-salesinvoice-usability-audit/report.json`
- Responsive screenshots: `/private/tmp/next-salesinvoice-responsive-audit/`
- Responsive report JSON: `/private/tmp/next-salesinvoice-responsive-audit/report.json`

Updated screen scores:

| Screen | Score | User error risk | Notes |
|---|---:|---|---|
| Login | 8.5/10 | Low | Clear and stable. |
| รายการบิลขาย | 8.5/10 | Low | Search and row layout are clear. Remaining issue is mostly visual empty space when the result set is tiny. |
| แก้ไขบิลเดียว | 8.5/10 | Low-Medium | Step flow and preview are clear. Still worth improving the "no product selected" state later. |
| แก้ไขหลายบิล | 8.5/10 | Medium | Bulk customer selection, pre-apply summary, and final confirmation now reduce accidental bulk writes. |
| ประวัติการแก้ไข | 8.5/10 | Medium | Rollback now requires a confirmation modal. Risk remains because rollback is inherently high-impact. |
| ตั้งค่าฐานข้อมูล | 8.5/10 | Medium-High | Save/reconnect are now protected by confirmation modals and clearer spacing. Still a technical Admin/DevOps screen. |
| สถานะระบบ | 9/10 | Low | Clear and safe. |

Remaining recommendation:

- For production, keep database config visible only to Admin users.
- For customer-size production data, run stress testing against real scale: 1,000 / 10,000 / 100,000 bills.

## Documentation / Session Handoff Update

Date: 2026-05-12

Changed:

- Updated `README.md` to match the current React + Vite frontend, current `nsi_*` tables, latest flow status, and remaining production work.
- Updated `next-salesinvoice-dev-plan.md` so completed items such as snapshot, rollback, apply-time lock, database config UI, reconnect, audit UI, and browser audits are no longer listed as pending.
- Updated `frontend/README.md` from old Next.js wording to React + Vite.
- Added `SESSION_HANDOFF.md` as the short context file for a new chat session.

Verification:

- Searched docs for stale wording such as `Next.js`, `App Router`, `Rollback Pending`, `lock pending`, and outdated snapshot/rollback backlog text: no matches in the core docs.
- `npm run build`: Pass
- `go test ./...`: Pass
