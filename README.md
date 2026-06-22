# next-salesinvoice

`next-salesinvoice` คือเว็บแอปสำหรับแก้ไขเอกสารขายสินค้าและบริการของ SML ERP ใน PostgreSQL อย่างระมัดระวัง โดยทำงานกับฐาน SML ที่เชื่อมต่ออยู่เท่านั้น เช่นฐานปลายทางหลังโอนข้อมูล ไม่ยุ่งกับ `data1` หรือกระบวนการโอนข้อมูลเดิมของ SML

เอกสารนี้เป็น overview หลักของ repo. ถ้าจะให้ AI ตัวอื่นทำงานต่อ ให้อ่าน `SESSION_HANDOFF.md` ถัดจากไฟล์นี้เสมอ

## สถานะล่าสุด

อัปเดตล่าสุด: 2026-06-22 Asia/Bangkok

- Backend: Go + Gin + pgx/PostgreSQL
- Frontend: React + Vite + Material UI v9 + `@uiw/react-json-view`
- UI หลักอยู่ที่ `/bulk-edit`, `/audit`, `/system/status` (ล่าสุด 2026-05-21: bulk preview แก้จำนวนสินค้าแบบ row-level ได้, ยอดซ้าย/ขวาอัปเดตตาม edits, confirm ส่งเข้า SML เป็นสองชั้น, audit ใช้ dialog เปรียบเทียบเดิม -> ใหม่)
- Typography primitives (`SectionTitle`, `DocCode`, `Money`, ...) รวมอยู่ที่ `frontend/src/components/ui/typography.tsx`
- Mobile responsive: 44px tap target, dialogs fullScreen บน xs, DataGrid ถูกแทนด้วย card view บน xs
- Accessibility: skip-link, focus ring, `prefers-reduced-motion`, axe-core smoke 0 violations
- **Color mode**: รองรับ light / dark / auto (ตาม OS) — สลับได้จาก header และหน้า login, persist ใน localStorage, ฟัง `prefers-color-scheme` แบบ live
- **Brand assets**: flat geometric "N" mark ใน `frontend/public/` (favicon SVG/PNG, apple-touch-icon, PWA 192/512, OG 1200×630)
- `GET /api/v1/system/database-status` เป็น read-only verify
- การสร้างตาราง `nsi_*` ทำได้ 2 ทาง: Admin action ผ่าน `POST /api/v1/system/database-migrate` หรือ bootstrap ครั้งแรก (ยังไม่มี admin) ผ่าน `POST /api/v1/system/database-migrate/bootstrap`
- การตั้งค่า database connection บังคับผ่าน `.env`/compose เท่านั้น ไม่มี UI สำหรับเปลี่ยน runtime
- Cookie `Secure` ควบคุมด้วย `COOKIE_SECURE` (default = `APP_ENV==production`); เมื่อเข้าผ่าน HTTP บน private network (Zerotier) ให้ตั้ง `COOKIE_SECURE=false` มิฉะนั้น login ไม่ติด — ดู [`backend/internal/config/config.go`](backend/internal/config/config.go)
- คู่มือติดตั้งฝั่งลูกค้า: [`docs/INSTALL_UBUNTU.md`](docs/INSTALL_UBUNTU.md) (generic) · บันทึก deploy จริงต่อไซต์: [`docs/DEPLOY_KRABIYANG_THONG.md`](docs/DEPLOY_KRABIYANG_THONG.md)
- Verification ล่าสุดใน session นี้:
  - `go test ./...`: Pass
  - Deploy krabiyang-thong (prod ลูกค้า) ผ่าน: health/db-status/login ทำงาน, index 7/7 valid, SML 13 service เดิมไม่กระทบ

## ใช้ทำอะไร

ระบบช่วยให้ Admin เลือกบิลขายจาก SML, ตั้งค่าการแก้ไขร่วมกัน, preview ผลลัพธ์, confirm แล้วส่งกลับเข้า SML โดยมี transaction, lock, snapshot, audit log และ rollback path

งานหลักที่รองรับ:

- Login ด้วย `erp_user`
- แสดงรายการบิลขายจาก `ic_trans` ที่ `trans_flag = 44`
- ค้นหาเลขบิล, ลูกหนี้, หมายเหตุ และค้นหาเลขบิลแบบ list/range
- เลือกบิลจากตารางใน `/bulk-edit`
- ตั้งค่าลูกหนี้ใหม่, ชุดเอกสารใหม่, ประเภทขาย, ประเภทภาษี, หมายเหตุต่อบิล (settings dialog)
- ลบ/เพิ่มรายการสินค้าแบบต่อบิลใน preview dialog (trash/restore + add line + unit dropdown จาก `ic_unit_use`)
- ปรับจำนวนสินค้าใน preview ต่อบรรทัดด้วย `rowOrder` เพื่อไม่แก้ผิดแถวเมื่อมี item code ซ้ำ
- Preview การเปลี่ยนแปลงก่อนส่งเข้า SML
- Confirm อีกชั้นก่อน real write และเห็น progress ระหว่างส่งเข้า SML
- Retry เฉพาะบิลที่ failed/skipped จาก batch เดิมได้ โดยไม่แตะบิลที่ applied แล้ว
- ออกเลขเอกสารใหม่โดยตรวจซ้ำกับ `ic_trans.doc_no` ของ sales `trans_flag=44` แบบ global และข้ามเลขที่ถูกใช้แล้วอัตโนมัติ
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
  -> Backend starts async reflow batch and inserts pending items
  -> UI polls progress while backend locks, snapshots, and writes each bill sequentially
  -> Batch/audit status updated; retry failed/skipped only if partial
  -> Admin can rollback from /audit
```

การ apply เป็นการแก้เอกสารเดิมใน SML ไม่ใช่สร้างเอกสารใหม่แยกชุด โดยระบบ update `doc_no` ใน `ic_trans` และ `ic_trans_detail` ให้เป็นเลขใหม่ตาม preview

Bulk apply v1 ใช้ polling แทน SSE/WebSocket เพื่อให้เสถียรผ่าน nginx และ Cloudflare quick tunnel. Endpoint sync เดิมยังอยู่เพื่อ backward compatibility แต่ frontend ปัจจุบันใช้ async batch เป็นหลัก

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
│   ├── public/             brand assets (logo, favicon, OG image)
│   └── src/App.tsx
├── docs/
│   └── INSTALL_UBUNTU.md   คู่มือติดตั้งบน Ubuntu สำหรับ server ลูกค้า
├── docker-compose.yml      backend + frontend (+ observability profile)
├── deploy.sh               dev rsync + docker compose + cloudflared quick tunnel
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

- Code: `001`
- Password: `001`

## API Surface หลัก

System:

- `GET /api/v1/health`
- `GET /api/v1/system/database-status`
- `POST /api/v1/system/database-migrate`

Auth:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Documents:

- `GET /api/v1/documents?from=&to=&page=&pageSize=&q=`
- `GET /api/v1/documents/:docNo/details`
- `POST /api/v1/documents/items` — รับ `{docNos:[...]}` คืนรายการสินค้า (unique item_code) ที่อยู่ในบิลที่ระบุ
- `POST /api/v1/documents/bulk/preview-change`
- `POST /api/v1/documents/bulk/apply-change/start` — เริ่ม async batch แล้วคืน `batchId`, `batchNo`
- `GET /api/v1/documents/bulk/batches/:batchId` — ดู progress/counts/items ล่าสุด
- `POST /api/v1/documents/bulk/batches/:batchId/retry-failed` — สร้าง batch ใหม่จาก failed/skipped items เท่านั้น
- `POST /api/v1/documents/bulk/apply-change` — sync compatibility endpoint
- `POST /api/v1/documents/rollback`
- `GET /api/v1/documents/running-number?formatCode=`

Master data:

- `GET /api/v1/master/doc-formats`
- `GET /api/v1/master/customers?q=&limit=`
- `GET /api/v1/master/products?q=&limit=`
- `GET /api/v1/master/product-units?code=<icCode>` — หน่วยของสินค้าจาก `ic_unit_use`
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
- Secret rotation/runbook สำหรับ `.env` และ production deploy
- Monitoring/alerting on production (prometheus/grafana profile พร้อมใน `docker-compose.yml`)

Deploy/runbook สำหรับฝั่งลูกค้า: ใช้ [`docs/INSTALL_UBUNTU.md`](docs/INSTALL_UBUNTU.md)
