# next-salesinvoice

`next-salesinvoice` คือเว็บแอปสำหรับจัดการและแก้ไขเอกสารขายสินค้าและบริการของ SML ERP ที่ถูกโอนมาอยู่ใน database ปลายทาง เช่น `data2` โดยเน้นความปลอดภัยของข้อมูลจริงเป็นหลัก

โปรแกรมนี้ทำงานกับ database ที่เชื่อมต่ออยู่เท่านั้น โดยใน production ให้ชี้ไปที่ `data2` และไม่เกี่ยวข้องกับ `data1` หรือกระบวนการโอนข้อมูลอัตโนมัติเดิมของ SML

โปรเจคนี้ถูกออกแบบให้ทำงานกับเอกสารขายจาก SML ใน `data2`:

- Header: `ic_trans`
- Detail: `ic_trans_detail`
- เงื่อนไขเอกสารขายสินค้าและบริการ: `trans_flag = 44`

แนวคิดหลักคือให้ผู้ใช้เลือกเอกสารเดิมจาก SML แบบเดี่ยวหรือแบบ bulk, ปรับค่าที่จำเป็น, ดู preview ก่อนเขียนจริง แล้วจึง confirm เพื่อ update กลับฐานข้อมูล SML ผ่าน backend ที่ควบคุม transaction, validation, document lock, snapshot, rollback, audit log และ connection pool อย่างระมัดระวัง

---

## สถานะล่าสุด

อัปเดตล่าสุด: 2026-05-13

- หน้า `/bulk-edit` ปรับตารางรายการบิลขายให้ใกล้ SML มากขึ้น โดยใช้คอลัมน์ `วันที่เอกสาร`, `เวลา`, `เลขที่เอกสาร`, `รหัสลูกหนี้`, `หมายเหตุ`, `ยอดสุทธิ`, `ดูรายละเอียด`
- Dialog รายละเอียดบิลออกแบบใหม่เป็นมุมมองเอกสาร, ใช้ข้อมูลหัวบิลจาก `ic_trans` และรายการสินค้าจาก `ic_trans_detail`, รองรับปิดด้วย `ESC` และปุ่ม `X`
- หน้า audit สามารถ reuse dialog รายละเอียดบิลเพื่อดูข้อมูลเดิม/ข้อมูลใหม่จาก snapshot เมื่อมี history record
- Dialog ตั้งค่าการแก้ไขใช้ dropdown search แบบลอยสำหรับลูกหนี้และสินค้า เพื่อไม่ให้ dialog ขยับเมื่อค้นหา
- Verification ล่าสุด: frontend `npm run build` ผ่าน; backend `go test ./...` ผ่านก่อนหน้านี้ใน session เดียวกัน และไม่มี backend change หลังจากนั้น

รายละเอียด handoff สำหรับเปิดแชทใหม่อยู่ที่ `SESSION_HANDOFF.md`

---

## โปรแกรมนี้ใช้ทำอะไร

ระบบนี้ช่วยให้ผู้ใช้:

- Login ด้วย user จาก SML table `erp_user`
- ตรวจสอบว่า database SML พร้อมใช้งานหรือไม่
- Auto-create table ของระบบ `next-salesinvoice` ใน database SML ปัจจุบันเมื่อยังไม่มี
- ดูรายการเอกสารขายจาก `ic_trans`
- ค้นหาเอกสารด้วยเลขเอกสารหรือลูกหนี้
- เลือกเอกสารเดี่ยวหรือเลือกหลายเอกสารเพื่อแก้ไขพร้อมกัน
- ดูรายการสินค้าใน `ic_trans_detail`
- เลือก running format จาก `erp_doc_format where screen_code='SI'`
- ให้ระบบ run เลขเอกสารถัดไปตาม format ที่ user เลือก
- เลือกลูกหนี้จาก `ar_customer`
- เลือกประเภทขายและประเภทภาษี
- แก้หมายเหตุ
- ค้นหาสินค้าจาก `ic_inventory` และเลือกรายการที่ต้องการลบออกจากเอกสาร
- Preview ผลลัพธ์และยอดเงินใหม่ก่อนบันทึก
- Confirm เพื่อ update เอกสารเดิมกลับเข้า SML
- สร้าง batch/status ต่อรอบการทำงาน
- Lock เอกสารระหว่าง process เพื่อลดความเสี่ยง double process
- Snapshot ก่อนบันทึก เพื่อให้ Admin rollback ได้
- เก็บ audit log ของ action สำคัญ

---

## Concept ของระบบ

### 1. Verify First

ระบบไม่เดา schema จากความจำ แต่ตรวจ database จริงก่อนใช้งาน เช่น `erp_user`, `ic_trans`, `ic_trans_detail`, `erp_doc_format`, `ar_customer`, `ic_inventory`

### 2. Safety Before Write

ทุกการเขียนข้อมูลกลับ SML ต้องผ่าน validation และทำใน transaction เพื่อให้สำเร็จทั้งชุดหรือ rollback ทั้งชุด

### 3. Preview Before Confirm

ผู้ใช้ต้องเห็นผลลัพธ์ก่อน confirm เช่น เลขเอกสารใหม่, ลูกหนี้ใหม่, รายการสินค้าที่ถูกลบ, ยอดเงินก่อน/หลัง

### 4. Conservative SML Connection

Backend จำกัดจำนวน PostgreSQL connection, ตั้ง timeout และไม่ query หนักเกินจำเป็น เพื่อลดโอกาสรบกวนระบบ SML เดิม

### 5. App-Owned Tables

ตารางที่เป็นของระบบนี้ใช้ prefix `nsi_` และถูกสร้างใน database เดียวกับ SML เพื่อรองรับกรณีลูกค้าย้าย database หรือเปลี่ยนชื่อ database

### 6. Permission From SML

ระบบอ่านสิทธิ์จาก `erp_user.title`:

- `title = admin` คือ `Admin`
- ค่าว่างหรือค่าอื่นคือ `User`

---

## Flow การทำงานหลัก

```text
Login
  -> Verify database
  -> Load document list
  -> Select documents
  -> Configure doc format / customer / sale type / tax type / remark / remove items
  -> Preview changes per document
  -> Confirm batch
  -> Lock document
  -> Snapshot original data
  -> Update ic_trans + ic_trans_detail per document transaction
  -> Mark batch item status
  -> Write audit log
```

Confirm ปัจจุบันเป็นการแก้เอกสารเดิม ไม่ใช่สร้างเอกสารใหม่ โดยระบบจะ update `doc_no` ใหม่กลับเข้า `ic_trans` และ `ic_trans_detail`

---

## ส่วนประกอบของโปรเจค

```text
next-salesinvoice/
├── backend/                       Go + Gin API
│   ├── cmd/server/main.go
│   └── internal/
│       ├── audit/                 audit log writer
│       ├── config/                environment config
│       ├── db/                    PostgreSQL pool
│       ├── http/                  routes and middleware
│       ├── migration/             app-owned table migration
│       ├── repository/            SQL access to SML/app tables
│       ├── service/               auth and business services
│       └── session/               secure session cookie
├── frontend/                      React + Vite UI
│   └── src/
│       ├── App.tsx                main workbench
│       ├── main.tsx
│       └── styles.css
├── next-salesinvoice-dev-plan.md  current blueprint and backlog
├── next-salesinvoice-test-report.md latest verification report
├── SESSION_HANDOFF.md             latest session handoff for new chat
└── README.md                      project overview
```

---

## Database ที่เกี่ยวข้อง

### SML Tables

- `erp_user` - login user
- `ic_trans` - sales document header
- `ic_trans_detail` - sales document detail
- `erp_doc_format` - running/document format
- `ar_customer` - ลูกหนี้
- `ic_inventory` - สินค้า

### next-salesinvoice Tables

- `nsi_schema_migrations`
- `nsi_app_users`
- `nsi_app_settings`
- `nsi_audit_logs`
- `nsi_reflow_batches`
- `nsi_reflow_batch_items`
- `nsi_document_snapshots`
- `nsi_document_locks`

ระบบจะ verify และสร้าง `nsi_*` tables อัตโนมัติผ่าน migration ถ้ายังไม่มีใน database ที่ใช้งานอยู่

---

## API สำคัญ

### System

- `GET /api/v1/health`
- `GET /api/v1/system/database-status`
- `POST /api/v1/system/database-verify`
- `POST /api/v1/system/database-migrate`

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Documents

- `GET /api/v1/documents?from=&to=&page=&pageSize=&q=`
- `GET /api/v1/documents/:docNo/details`
- `POST /api/v1/documents/:docNo/preview-change`
- `POST /api/v1/documents/:docNo/apply-change`
- `GET /api/v1/documents/running-number?formatCode=`

### Master Data

- `GET /api/v1/master/doc-formats`
- `GET /api/v1/master/customers?q=&limit=`
- `GET /api/v1/master/products?q=&limit=`
- `GET /api/v1/master/sale-types`
- `GET /api/v1/master/tax-types`

### Audit

- `GET /api/v1/audit-logs?resourceId=&limit=`

---

## Run Local

### 1. Start Backend

```bash
cd backend
GOCACHE="$PWD/.gocache" GOPATH="$PWD/.gopath" \
SERVER_ADDR=:8080 \
SESSION_SECRET=dev-secret-change-me-at-least-32-chars \
SML_DB_HOST=192.168.2.248 \
SML_DB_PORT=5432 \
SML_DB_NAME=sml1_2026 \
SML_DB_USER=postgres \
SML_DB_PASSWORD=sml \
SML_DB_SSLMODE=disable \
SML_DB_SCHEMA=public \
go run ./cmd/server
```

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000/
```

### Dev Login

- Code: `EMP001`
- Password: `1234`

---

## Performance Notes

ระบบถูกปรับให้รองรับข้อมูลเยอะในระดับใช้งานจริงเบื้องต้น:

- สินค้า 10,000 รายการ: ใช้ search API พร้อม limit
- ลูกหนี้ 5,000 รายการ: ใช้ search API พร้อม limit
- บิลขาย 100,000 รายการ: ใช้ pagination และไม่ทำ `count(*)` ทุกครั้ง
- Product search ใน UI ต้องพิมพ์อย่างน้อย 2 ตัวอักษรก่อนยิง API
- Backend ใช้ connection pool ขนาดเล็กเพื่อไม่แย่ง connection จาก SML
- Migration มี performance indexes สำหรับ document/customer search

---

## Current Status

สถานะล่าสุด ณ 2026-05-12:

- Flow หลักใช้งานได้ครบใน local: login, รายการบิล, แก้ไขบิลเดียว, แก้ไขหลายบิล, preview, confirm, audit, rollback, database config/reconnect, status
- Database test ปัจจุบัน: `sml1_2026`
- UI ปัจจุบันเป็น responsive React/Vite workbench สำหรับพนักงานทั่วไป มีเมนูแยกตามหน้า ไม่ใช่ anchor scroll
- Bulk flow รองรับเลือกจากผลค้นหา และมี guardrail จำกัด batch เพื่อไม่รบกวน SML
- Database config เก็บใน `nsi_app_settings` และสามารถ save/reconnect ผ่าน UI โดยมี confirmation modal
- มี confirmation modal ก่อน action เสี่ยง: bulk apply, rollback, save config, reconnect database
- Backend tests ผ่าน: `go test ./...`
- Frontend production build ผ่าน: `npm run build`
- Browser usability/responsive audit ผ่าน ไม่มี console error และไม่มี horizontal overflow ในหน้าหลักที่ทดสอบ

เอกสารสถานะล่าสุดสำหรับเปิด chat ใหม่:

- [SESSION_HANDOFF.md](./SESSION_HANDOFF.md)
- [next-salesinvoice-test-report.md](./next-salesinvoice-test-report.md)

งานที่ยังควรทำก่อนใช้กับ production จริง:

- Stress test กับข้อมูลขนาด production/customer-size
- Multi-user conflict/stress test บน staging หรือ backup clone
- Full E2E tests ที่ seed/restore ข้อมูลและกด apply/rollback จริงได้อย่างปลอดภัย
- Password-at-rest hardening สำหรับ saved database config
- Deploy/runbook
- Production monitoring/logging

---

## Production Warning

ก่อนเชื่อม database ลูกค้าจริง ต้อง backup database ก่อนเสมอ และควรทดสอบบน cloned database ก่อน เพราะระบบนี้มี endpoint ที่ update `ic_trans` และ `ic_trans_detail` จริง

ปัจจุบัน snapshot, rollback และ apply-time document lock มีแล้วใน flow หลัก แต่ก่อน production ยังควรทดสอบซ้ำกับฐานที่ clone จากลูกค้าจริงและข้อมูลระดับ production scale
