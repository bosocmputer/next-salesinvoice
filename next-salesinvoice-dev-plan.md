# Development Blueprint & Current Plan - next-salesinvoice

ระบบจัดการเอกสารขาย SML ERP สำหรับแก้ไขเอกสารขายสินค้าและบริการจาก PostgreSQL ของ SML อย่างระมัดระวัง โดยเน้น verify ข้อมูลจริง, preview ก่อนเขียน, transaction, audit log และการใช้ connection กับฐาน SML แบบไม่รบกวนระบบเดิม

เอกสารนี้ปรับสถานะตามโค้ดปัจจุบัน ณ วันที่ 2026-05-12 แยกชัดเจนระหว่างสิ่งที่ทำแล้วจริงกับสิ่งที่ยังเป็น production backlog

---

## 1. Project Purpose

`next-salesinvoice` คือเว็บแอปสำหรับช่วยผู้ใช้แก้ไขเอกสารขายสินค้าและบริการของ SML ERP ที่เก็บใน PostgreSQL โดยเฉพาะเอกสารจาก:

- Header: `public.ic_trans`
- Detail: `public.ic_trans_detail`
- Filter หลัก: `trans_flag = 44`

เป้าหมายของโปรแกรมคือให้ผู้ใช้เลือกเอกสารเดิมจาก SML แล้วแก้ค่าที่จำเป็น เช่น format เลขที่เอกสาร, ลูกหนี้, ประเภทขาย, ประเภทภาษี, หมายเหตุ และรายการสินค้าที่ต้องลบ จากนั้นให้ระบบคำนวณยอดใหม่ แสดง preview และ confirm เพื่อ update กลับฐานข้อมูลจริงใน transaction เดียว

---

## 2. Current Implementation Status

### สถานะรวม

MVP flow หลักใช้งานได้แล้ว:

1. Login ด้วยผู้ใช้จาก `erp_user`
2. Verify database และ auto-create app-owned tables
3. โหลดรายการเอกสารจาก `ic_trans` ด้วย `trans_flag=44`
4. เลือกเอกสารและโหลดรายละเอียดจาก `ic_trans_detail`
5. เลือก doc format จาก `erp_doc_format where screen_code='SI'`
6. Run เลขที่เอกสารใหม่ตาม format ที่เลือก
7. เลือกลูกหนี้จาก `ar_customer`
8. เลือกประเภทขายและประเภทภาษี
9. ค้นหาสินค้าจาก `ic_inventory` และเลือกรายการที่จะลบออกจาก detail
10. Preview การเปลี่ยนแปลงและยอดใหม่
11. Confirm เพื่อ update `ic_trans` และ `ic_trans_detail`
12. บันทึก audit log ลง `nsi_audit_logs`

### สิ่งที่ทำแล้ว

- Backend Go + Gin
- Frontend React + Vite
- Session cookie แบบ HttpOnly
- Role แยก `Admin` และ `User`
- Database pool จำกัด connection เพื่อไม่แย่ง SML
- Query timeout, lock timeout, idle transaction timeout
- Migration สำหรับตาราง `nsi_*`
- Auto-create table ระบบเมื่อเข้า database ใหม่
- App-owned tables ปัจจุบัน:
  - `nsi_schema_migrations`
  - `nsi_app_users`
  - `nsi_app_settings`
  - `nsi_audit_logs`
  - `nsi_reflow_batches`
  - `nsi_reflow_batch_items`
  - `nsi_document_snapshots`
  - `nsi_document_locks`
- Login/logout/me
- Document list แบบ pagination และ search โดยไม่ทำ `count(*)` หนัก ๆ
- Document details
- Master data:
  - doc formats
  - customers
  - products
  - sale types
  - tax types
- Running number แยกตาม `doc_format_code` ที่ user เลือก
- Preview change
- Apply change แบบ transaction
- Single apply และ bulk apply สร้าง batch/status/snapshot/lock
- Rollback จาก raw snapshot สำหรับ Admin
- Database config UI/API: save config, reconnect runtime DB, verify/migrate target DB ก่อน switch
- Document status จาก batch/snapshot/lock แสดงในรายการบิล
- Server-side selectable documents endpoint สำหรับเลือกตามเงื่อนไขสูงสุด 300 บิลต่อ batch
- Confirmation modal ก่อน bulk apply, rollback, save config, reconnect database
- Audit logs
- Responsive workbench UI ไม่มี sidebar เมนูหลอก
- Responsive mobile/tablet navigation
- Index สำหรับ performance ถูกสร้างผ่าน migration ได้
- Unit test และ integration test หลักผ่านแล้ว
- Frontend typecheck และ production build ผ่านแล้ว

### สิ่งที่ยังไม่ใช่สถานะปัจจุบัน

รายการต่อไปนี้ยังเป็น production backlog ไม่ใช่ของที่ทำครบแล้ว:

- Background job/progress สำหรับงานยาว
- User management UI
- Swagger/OpenAPI
- Docker/deploy scripts
- Full E2E test ที่กด write action ทุกแบบบน dataset ใหญ่จริง
- Rate limit login
- Session timeout warning
- Multi-user conflict/stress test บนฐานลูกค้าจริง
- Stress test กับข้อมูล production scale: 1,000 / 10,000 / 100,000 บิล

---

## 3. Current Verified SML Database

ใช้ database test:

- Host: `192.168.2.248`
- Port: `5432`
- Database: `sml1_2026`
- Schema: `public`
- User: `postgres`
- Status: verified on 2026-05-11

### Login Table

- Table: `public.erp_user`
- Login column: `code`
- Password column: `password`
- Display name: `name_1`, fallback `name_2`
- Dev user:
  - Code: `EMP001`
  - Password: `1234`
  - Role: Admin เมื่อ `erp_user.title = admin`
- Dev user:
  - Code: `EMP002`
  - Password: `1234`
  - Role: User เมื่อ `erp_user.title` ไม่ใช่ `admin`

### Sales Tables

- Header table: `public.ic_trans`
- Detail table: `public.ic_trans_detail`
- Sales/service document filter: `trans_flag = 44`
- Relation used by app: `doc_no` + `trans_flag`
- Existing SML unique/index references observed:
  - `ic_trans_ic_trans_pk_primary` on `(doc_no, trans_flag)`
  - `ic_trans_trans_flag_idx` on `trans_flag`
  - `ic_trans_detail_docno_trans_flag_idx` on `(doc_no, trans_flag)`
  - `ic_trans_detail_item_code_trans_flag_idx_idx` on `(item_code, trans_flag)`

### Master Tables

- Running format: `public.erp_doc_format where screen_code='SI'`
- Customer: `public.ar_customer`
- Product: `public.ic_inventory`

### Performance Indexes Added by App Migration

ระบบสร้าง index เหล่านี้แบบ idempotent เพื่อรองรับข้อมูลเยอะ เช่น สินค้า 10,000 รายการ, ลูกหนี้ 5,000 รายการ, บิลขาย 100,000 รายการ:

- `nsi_ic_trans_sales_date_doc_idx`
- `nsi_ic_trans_sales_format_date_doc_idx`
- `nsi_ic_trans_doc_no_trgm_idx`
- `nsi_ic_trans_cust_code_trgm_idx`
- `nsi_ic_trans_detail_doc_flag_line_idx`
- `nsi_ar_customer_code_trgm_idx`
- `nsi_ar_customer_name1_trgm_idx`

หมายเหตุ: product table มี trigram index อยู่แล้วจากฐานที่ตรวจพบ หากย้ายไป database อื่นต้อง verify ใหม่อีกครั้ง

---

## 4. Current Architecture

```text
next-salesinvoice/
├── backend/
│   ├── cmd/server/main.go
│   ├── internal/audit/
│   ├── internal/config/
│   ├── internal/db/
│   ├── internal/errorcode/
│   ├── internal/http/
│   ├── internal/migration/
│   ├── internal/model/
│   ├── internal/repository/
│   ├── internal/response/
│   ├── internal/service/
│   └── internal/session/
├── frontend/
│   ├── src/App.tsx
│   ├── src/main.tsx
│   └── src/styles.css
├── backend/README.md
├── frontend/README.md
├── README.md
├── next-salesinvoice-test-report.md
├── SESSION_HANDOFF.md
└── next-salesinvoice-dev-plan.md
```

### Backend Responsibility

- Connect PostgreSQL SML database
- Verify SML tables and app-owned tables
- Run app migration
- Authenticate users from `erp_user`
- Provide document/master/audit APIs
- Validate input before touching SML data
- Write changes in transaction
- Keep connection usage conservative

### Frontend Responsibility

- Login screen
- Database readiness display
- Workbench for document list, details, edit config, preview and confirm
- Search customers/products with backend limits
- Disable unsafe actions until state is valid
- Responsive layout for desktop/tablet/mobile

---

## 5. Current API Surface

### System

- `GET /api/v1/health`
- `GET /api/v1/system/database-status`
- `POST /api/v1/system/database-verify`
- `POST /api/v1/system/database-migrate` Admin
- `GET /api/v1/system/database-config` Admin
- `PUT /api/v1/system/database-config` Admin
- `POST /api/v1/system/database-reconnect` Admin

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Documents

- `GET /api/v1/documents?from=&to=&page=&pageSize=&q=`
- `GET /api/v1/documents/:docNo/details`
- `POST /api/v1/documents/:docNo/preview-change`
- `POST /api/v1/documents/:docNo/apply-change` Admin
- `GET /api/v1/documents/running-number?formatCode=`
- `GET /api/v1/documents/selectable-doc-nos?from=&to=&q=&limit=`
- Bulk preview/apply endpoints are implemented in backend and UI. See code/routes for exact path names before integrating external clients.

### Master Data

- `GET /api/v1/master/doc-formats`
- `GET /api/v1/master/customers?q=&limit=`
- `GET /api/v1/master/products?q=&limit=`
- `GET /api/v1/master/sale-types`
- `GET /api/v1/master/tax-types`

### Audit

- `GET /api/v1/audit-logs?resourceId=&limit=` Admin
- Rollback endpoint for Admin is implemented for snapshot restore. See code/routes for exact path before external integration.

---

## 6. Current Business Rules

### Running Number

- User ต้องเลือก `doc_format` เอง เช่น `INV`, `INV1`, `INV2`
- ระบบหาเลขเอกสารล่าสุดจาก `ic_trans` โดยใช้:
  - `trans_flag = 44`
  - `doc_format_code = selected format`
- ระบบ run เลขถัดไปตาม format ที่เลือก
- ถ้า format นั้นยังไม่เคยมีเอกสาร ระบบเริ่มจาก pattern ของ `erp_doc_format`

### Document Apply

Confirm ปัจจุบันเป็นการแก้เอกสารเดิม ไม่ใช่สร้างเอกสารใหม่:

- Update `ic_trans.doc_no` เป็นเลขใหม่
- Update `ic_trans_detail.doc_no` ตามเลขใหม่
- Update customer, sale type, tax type, remark, totals
- Delete detail rows ที่เลือกออก
- Recalculate totals จาก detail ที่เหลือ
- Validate ว่าเลขใหม่ยังไม่ชนเอกสารอื่น
- Validate ว่าสินค้าที่จะลบอยู่ในเอกสารนั้นจริง
- Validate ว่าเอกสารต้องเหลืออย่างน้อย 1 รายการ
- บันทึก audit log ด้วย resource id เป็นเลขเอกสารใหม่

### Search and Large Data

- Document list ใช้ pagination และ `hasMore`
- Document list ไม่ใช้ `count(*)` เพื่อเลี่ยง full scan หนัก
- Bulk select by condition จำกัดสูงสุด 300 documents ต่อรอบ เพื่อป้องกันกระทบ SML
- Customer/product search มี `limit`
- Product search ฝั่ง UI ต้องพิมพ์อย่างน้อย 2 ตัวอักษรก่อน query
- Query ต้องใช้ index และ timeout เพื่อไม่รบกวน SML เดิม

---

## 7. Data Safety Rules

กฎที่ต้องรักษาทุกครั้งที่พัฒนาเพิ่ม:

- ห้ามเขียน SML DB ก่อน validate input ครบ
- ทุก write ต้องอยู่ใน transaction
- Query ต้องมี timeout
- ห้าม concat SQL จาก user input
- ห้าม log password หรือ connection string เต็ม
- ห้ามส่ง password กลับ frontend
- SML table ห้ามถูก migrate/alter โดยไม่ตั้งใจ
- ตารางของระบบใช้ prefix `nsi_`
- ถ้า database SML เปลี่ยน ต้อง verify table และ auto-create `nsi_*` ใหม่
- งานที่กระทบข้อมูลจริงต้องมี preview และ audit log

---

## 8. Current Test Status

### Backend

- `go test ./...` ผ่าน
- Repository integration test ผ่านกับ temporary schema
- Test ไม่แตะ schema จริงของ SML โดยตรง ยกเว้นตั้ง env เฉพาะและมี guard

### Frontend

- `npm run build` ผ่าน

### Manual UI

- Local browser: `http://127.0.0.1:3000/`
- Flow หลักถูกตรวจผ่าน browser automation แล้ว
- UX ปัจจุบันเป็น responsive minimal workbench สำหรับพนักงานทั่วไป
- ทดสอบ desktop `1440x900`, mobile `390x844`, tablet `768x1024`
- Browser console errors: 0
- Horizontal overflow: 0
- รายงานล่าสุด: `next-salesinvoice-test-report.md`

---

## 9. Production Backlog

### Priority 1 - Data Safety

- เพิ่ม conflict check กรณีเอกสารถูกแก้จาก SML ระหว่างที่ user เปิดหน้าไว้
- เพิ่ม idempotency key หรือ confirm guard กันกดซ้ำ
- เพิ่ม E2E test ที่สามารถ seed/restore test data และกด apply/rollback จริงได้ครบ

### Priority 2 - Database Settings

- Encrypt password at rest
- Mask password ทุก response
- เพิ่ม connection profiles หลายร้าน ถ้าต้องจัดเก็บหลาย config พร้อมกัน
- เพิ่ม reconnect/runbook ที่ละเอียดขึ้นสำหรับ production

### Priority 3 - Operations

- Dockerfile backend/frontend
- Deployment scripts
- OpenAPI/Swagger docs
- Production logging/metrics
- Health check แยก app/db/migration status
- Backup/restore runbook สำหรับลูกค้า

### Priority 4 - UX Polish

- Better empty/error/loading states
- Keyboard-friendly search
- More compact table for very large datasets
- Further visual polish จาก feedback ของผู้ใช้จริง

---

## 10. Phase Status

| Phase | Scope | Current Status |
|---|---|---|
| Phase 0 | Setup, backend/frontend foundation, DB pool, migration | Mostly done |
| Phase 1 | Authentication | Done for SML user login and Admin/User role |
| Phase 2 | Dashboard | Folded into workbench, separate dashboard pending |
| Phase 3 | Document list | List/details/search/status done |
| Phase 4 | Reset/config | Edit config done, no destructive reset flow |
| Phase 5 | Calculate/preview | Single and bulk preview done |
| Phase 6 | Confirm/save | Single and bulk transaction apply done, background job pending |
| Phase 7 | Rollback | Admin rollback from snapshot done |
| Phase 8 | User/settings | DB settings done, user management pending |
| Phase 9 | Log system | Audit backend and UI done |
| Phase 10 | API docs/test/deploy | Unit/build/browser audit done, deploy/docs/full E2E pending |

---

## 11. Recommended Next Steps

1. ทดสอบกับข้อมูลลูกค้าจริงหลัง backup: 1,000 / 10,000 / 100,000 บิล
2. ทำ multi-user conflict/stress test บนฐานจริงหรือ staging ที่ clone จากฐานจริง
3. ทำ E2E test ครอบคลุม login, load document, preview, confirm, rollback, audit โดยมี seed/restore ชัดเจน
4. ทำ deploy package และ production runbook
5. ปรับ UX polish ต่อจาก feedback ของผู้ใช้จริง

---

## 12. Definition of Ready for Production

ระบบจะถือว่าพร้อม production เมื่อครบอย่างน้อย:

- ใช้ database ลูกค้าจริงหลัง backup แล้วเท่านั้น
- มี snapshot ก่อน write (done in current flow)
- มี rollback path ที่ test แล้ว (done on dev DB)
- มี lock/concurrency guard (apply-time lock done, multi-user stress pending)
- มี audit log ครบทุก write action
- มี database settings ที่ปลอดภัย (basic UI/reconnect done, password-at-rest hardening pending)
- มี E2E test สำหรับ flow สำคัญบน dataset production-like
- มี deploy/runbook ชัดเจน
- มี monitoring/logging พอให้ debug production ได้
