# next-salesinvoice

`next-salesinvoice` คือเว็บแอปสำหรับแก้ไขเอกสารขายสินค้าและบริการของ SML ERP ใน PostgreSQL อย่างระมัดระวัง โดยทำงานกับฐาน SML ที่เชื่อมต่ออยู่เท่านั้น เช่นฐานปลายทางหลังโอนข้อมูล ไม่ยุ่งกับ `data1` หรือกระบวนการโอนข้อมูลเดิมของ SML

เอกสารนี้เป็น overview หลักของ repo. ถ้าจะให้ AI ตัวอื่นทำงานต่อ ให้อ่าน `SESSION_HANDOFF.md` ถัดจากไฟล์นี้เสมอ

## สถานะล่าสุด

อัปเดตล่าสุด: 2026-05-16 Asia/Bangkok

- Backend: Go + Gin + pgx/PostgreSQL
- Frontend: React + Vite + Material UI (`@mui/material`, `@mui/x-data-grid`) และ `@uiw/react-json-view`
- UI หลักอยู่ที่ `/bulk-edit`, `/audit`, `/system/status`
- ใช้ Material UI components เป็นหลัก และถอดระบบ utility/custom UI เก่าออกจาก flow ปัจจุบันแล้ว
- `GET /api/v1/system/database-status` เป็น read-only verify
- การสร้างตาราง `nsi_*` ต้องเป็น Admin action ผ่าน `POST /api/v1/system/database-migrate`
- การตั้งค่า database connection บังคับผ่าน `.env` เท่านั้น ไม่มี UI สำหรับเปลี่ยน runtime
- Verification ล่าสุดใน session นี้:
  - `npm run build`: Pass
  - `go test ./...`: Pass
  - Browser QA `/system/status` desktop/mobile/mock missing tables: Pass

## ใช้ทำอะไร

ระบบช่วยให้ Admin เลือกบิลขายจาก SML, ตั้งค่าการแก้ไขร่วมกัน, preview ผลลัพธ์, confirm แล้วส่งกลับเข้า SML โดยมี transaction, lock, snapshot, audit log และ rollback path

งานหลักที่รองรับ:

- Login ด้วย `erp_user`
- แสดงรายการบิลขายจาก `ic_trans` ที่ `trans_flag = 44`
- ค้นหาเลขบิล, ลูกหนี้, หมายเหตุ และค้นหาเลขบิลแบบ list/range
- เลือกบิลจากตารางใน `/bulk-edit`
- ตั้งค่าลูกหนี้ใหม่, ชุดเอกสารใหม่, ประเภทขาย, ประเภทภาษี, หมายเหตุ และสินค้าที่ต้องลบ
- Preview การเปลี่ยนแปลงก่อนส่งเข้า SML
- Confirm อีกชั้นก่อน real write
- บันทึก snapshot/audit และ rollback ได้โดย Admin
- ดู history และ technical JSON diff ใน `/audit`
- ตรวจฐานและติดตั้งตารางระบบใน `/system/status` สำหรับ Admin

## SML Tables ที่ใช้

- Login: `erp_user`
- Sales header: `ic_trans`
- Sales detail: `ic_trans_detail`
- Sales/service filter: `trans_flag = 44`
- Document format: `erp_doc_format where screen_code = 'SI'`
- Customer: `ar_customer`
- Product: `ic_inventory`

## App-Owned Tables

ตารางของระบบนี้ใช้ prefix `nsi_` และอยู่ในฐาน SML ที่เชื่อมต่ออยู่:

- `nsi_schema_migrations`
- `nsi_app_users`
- `nsi_app_settings`
- `nsi_audit_logs`
- `nsi_reflow_batches`
- `nsi_reflow_batch_items`
- `nsi_document_snapshots`
- `nsi_document_locks`

หมายเหตุสำคัญ: ระบบไม่สร้างตารางจากการกดตรวจสถานะหรือ startup แบบเงียบ ๆ แล้ว ถ้าฐานใหม่ยังไม่มี `nsi_*` ให้ Admin เข้า `/system/status` แล้วกด `ติดตั้งตารางระบบ`

## Flow หลัก

```text
Login
  -> Verify database readiness
  -> Open /bulk-edit
  -> Search/filter documents
  -> Select documents in table
  -> Configure changes in settings dialog
  -> Backend preview-change validates and calculates per bill
  -> Preview dialog shows document queue and change summary
  -> Confirm send to SML
  -> Backend locks document, snapshots original rows, writes in transaction
  -> Batch/audit status updated
  -> Admin can rollback from /audit
```

การ apply เป็นการแก้เอกสารเดิมใน SML ไม่ใช่สร้างเอกสารใหม่แยกชุด โดยระบบ update `doc_no` ใน `ic_trans` และ `ic_trans_detail` ให้เป็นเลขใหม่ตาม preview

## Search Syntax

ช่องค้นหาเอกสารรองรับทั้งข้อความทั่วไปและ syntax สำหรับเลขบิล:

- ค้นหาเดี่ยว: `INV26050025`
- ค้นหาหลายใบ: `INV26050025,INV26050026`
- ค้นหาแบบช่วง: `INV26050025:INV26050030`
- ผสมช่วงกับเลขเดี่ยว: `INV26050025:INV26050030,INV26050040`

ข้อจำกัด v1:

- range ต้องเขียนเลขเต็มทั้งสองฝั่ง
- prefix ต้องตรงกัน และเลขท้ายควรยาวเท่ากัน
- ถ้าไม่เข้า pattern ระบบ fallback ไปค้นหาแบบเดิมจากเลขบิล/ลูกหนี้/หมายเหตุ

## Admin System Setup

หน้า `/system/status` เป็นหน้า Admin diagnostic/setup:

- แสดงสถานะการเชื่อมต่อฐาน
- แสดงว่า SML tables หลักครบหรือไม่
- แสดงว่า `nsi_*` tables พร้อมหรือไม่
- ถ้า SML พร้อมแต่ `nsi_*` ยังไม่ครบ จะแสดงปุ่ม `ติดตั้งตารางระบบ`
- ถ้า SML tables หลักไม่ครบ ปุ่มติดตั้งจะ disabled และต้องแก้ฐาน SML ก่อน

API ที่เกี่ยวข้อง:

- `GET /api/v1/system/database-status`: read-only
- `POST /api/v1/system/database-migrate`: Admin only, explicit install/migrate

## Repository Structure

```text
next-salesinvoice/
├── backend/                Go + Gin API
│   ├── cmd/server/main.go
│   └── internal/
├── frontend/               React + Vite + MUI app
│   └── src/App.tsx
├── README.md               canonical overview
├── SESSION_HANDOFF.md      latest checkpoint for another AI/session
├── backend/README.md       backend quickstart
└── frontend/README.md      frontend quickstart
```

## Run Local

### Backend

```bash
cd backend
GOCACHE="$PWD/.gocache" GOPATH="$PWD/.gopath" \
SERVER_ADDR=:8080 \
SESSION_SECRET=dev-secret-change-me-at-least-32-chars \
SML_DB_HOST=192.168.2.248 \
SML_DB_PORT=5432 \
SML_DB_NAME=sml1_2026 \
SML_DB_USER=postgres \
SML_DB_PASSWORD=<dev-db-password> \
SML_DB_SSLMODE=disable \
SML_DB_SCHEMA=public \
go run ./cmd/server
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000/
```

Dev login ในฐาน staging ปัจจุบัน:

- Code: `EMP001`
- Password: `1234`

## API Surface หลัก

System:

- `GET /api/v1/health`
- `GET /api/v1/system/database-status`
- `POST /api/v1/system/database-verify`
- `POST /api/v1/system/database-migrate`
- `GET /api/v1/system/database-config`
- `PUT /api/v1/system/database-config`
- `POST /api/v1/system/database-reconnect`

Auth:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Documents:

- `GET /api/v1/documents?from=&to=&page=&pageSize=&q=`
- `GET /api/v1/documents/:docNo/details`
- `POST /api/v1/documents/bulk/preview-change`
- `POST /api/v1/documents/bulk/apply-change`
- `POST /api/v1/documents/rollback`
- `GET /api/v1/documents/running-number?formatCode=`

Master data:

- `GET /api/v1/master/doc-formats`
- `GET /api/v1/master/customers?q=&limit=`
- `GET /api/v1/master/products?q=&limit=`
- `GET /api/v1/master/sale-types`
- `GET /api/v1/master/tax-types`

Audit:

- `GET /api/v1/audit-documents?q=&limit=`
- `GET /api/v1/audit-logs?resourceId=&limit=`

## Safety Rules

- ห้ามเขียนเข้า SML ก่อน preview และ confirm
- ทุก write ต้องอยู่ใน transaction
- ต้อง snapshot ก่อน write เพื่อ rollback ได้
- ต้องใช้ document lock ตอน apply
- ห้าม log หรือส่ง password กลับ frontend
- ห้าม migrate/alter SML-owned tables โดยไม่ตั้งใจ
- `nsi_*` tables ต้องถูกสร้างด้วย Admin action เท่านั้นเมื่อฐานใหม่ยังไม่พร้อม
- ก่อน production ต้องทดสอบกับฐาน clone/backup ของลูกค้าจริง

## Verification Commands

```bash
cd frontend
npm run build
```

```bash
cd backend
GOCACHE="$PWD/.gocache" GOPATH="$PWD/.gopath" go test ./...
```

## Production Gaps ที่ยังควรทำ

- Staging/production-scale test กับข้อมูล 1,000 / 10,000 / 100,000 บิล
- Multi-user conflict/stress test
- Full E2E seed/apply/rollback test ที่ repeat ได้
- Password-at-rest hardening สำหรับ saved DB config
- Deploy/runbook และ monitoring/logging สำหรับ production
