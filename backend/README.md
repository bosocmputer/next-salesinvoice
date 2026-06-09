# next-salesinvoice Backend

Go + Gin API สำหรับ workflow แก้ไขบิลขาย SML อย่างปลอดภัย

## Run Locally

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

## Current Behavior

- Startup/reconnect runs database verify only
- `GET /api/v1/system/database-status` is read-only
- Creating/updating `nsi_*` tables is an explicit Admin action via `POST /api/v1/system/database-migrate`
- All protected write/admin endpoints require authenticated Admin role
- App tables use prefix `nsi_`
- SML-owned tables are not migrated by this app
- Database connection config is **env-only** (`SML_DB_*`); there is no runtime API to change it
- Bulk apply ปัจจุบันใช้ async batch: insert `pending` items, process ทีละบิล, update progress/counts ลง `nsi_reflow_batches` และ `nsi_reflow_batch_items`
- Running number allocator ตรวจเลขซ้ำกับ `ic_trans.doc_no` ของ sales `trans_flag=44` แบบ global และกันเลขซ้ำใน request เดียวกัน
- Detail line payload ส่ง `rowOrder` กลับ frontend และ bulk `perDocEdits` รองรับ `lineQtyEdits` เพื่อแก้จำนวนเฉพาะบรรทัดจริง

## Main Endpoints

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
- `POST /api/v1/documents/items` — body `{ "docNos": ["..."] }` (≤ 500). ตอบ unique item_code + name + unitCode + docCount จาก `ic_trans_detail`
- `POST /api/v1/documents/bulk/preview-change`
- `POST /api/v1/documents/bulk/apply-change/start` — เริ่ม async batch แล้วคืน `batchId`, `batchNo`
- `GET /api/v1/documents/bulk/batches/:batchId` — คืน status, counts, และ items ล่าสุด
- `POST /api/v1/documents/bulk/batches/:batchId/retry-failed` — สร้าง batch ใหม่จาก failed/skipped items ของ batch เดิม
- `POST /api/v1/documents/bulk/apply-change` — sync compatibility endpoint
- `POST /api/v1/documents/rollback`
- `GET /api/v1/documents/running-number?formatCode=`

Master data:

- `GET /api/v1/master/doc-formats`
- `GET /api/v1/master/customers?q=&limit=`
- `GET /api/v1/master/products?q=&limit=`
- `GET /api/v1/master/product-units?code=<icCode>` — หน่วยของสินค้าจาก `ic_unit_use` left join `ic_unit` (order by `line_number`)
- `GET /api/v1/master/sale-types`
- `GET /api/v1/master/tax-types`

Audit:

- `GET /api/v1/audit-documents?q=&limit=`
- `GET /api/v1/audit-logs?resourceId=&limit=`

Compatibility/internal:

- `GET /api/v1/documents/selectable-doc-nos` still exists for compatibility, but the current UI does not expose server-side mass selection

## Document Search

`GET /api/v1/documents` and audit document search support:

- fuzzy search for normal text
- exact doc list: `INV26050025,INV26050026`
- inclusive doc range: `INV26050025:INV26050030`
- mixed list/range: `INV26050025:INV26050030,INV26050040`

Invalid range/list syntax falls back to the normal fuzzy search path.

## Per-Bill Row Editing

`bulk/preview-change` และ `bulk/apply-change` รับ `perDocEdits: map[docNo]{ removeItemCodes: []string, addedLines: []NewLineInput }` เพิ่มจาก legacy global `removeItemCodes`

- `removeItemCodes` ต่อบิล: ลบเฉพาะ row ของบิลนั้น
- `addedLines`: เพิ่มรายการสินค้าใหม่ (`itemCode`, `itemName`, `unitCode`, `qty`, `price`, `discount`, optional `whCode`/`shelfCode`)
- `lineQtyEdits`: แก้จำนวนด้วย `{ rowOrder, qty }`; backend validate `qty > 0`, recompute totals/VAT, และ apply เฉพาะ row นั้น
- Frontend ปัจจุบันส่งจริงผ่าน `bulk/apply-change/start` ด้วย payload เดียวกับ sync endpoint
- `retry-failed` โหลด request เดิมจาก batch, filter เฉพาะ failed/skipped docNos, filter `perDocEdits` ให้ตรงรายการที่จะ retry, และ clear `docNoOverrides` เพื่อให้ออกเลขใหม่รอบถัดไป

### Clone-template insert

`insertAddedDetailLines` ใช้ schema-agnostic strategy เพื่อหลีกเลี่ยงการ enumerate ~125 columns ของ `ic_trans_detail`:

1. ดึง `roworder` ของบรรทัดแรกในบิลเดียวกันเป็น template
2. Query `information_schema.columns` (ยกเว้น `roworder`) ได้ list คอลัมน์
3. `INSERT INTO ic_trans_detail (cols) SELECT cols FROM ic_trans_detail WHERE roworder=$template RETURNING roworder`
4. `UPDATE` เฉพาะฟิลด์ของบรรทัดใหม่ (line_number, item_code, qty, price, discount, sum_amount, costs/refs=0, create_date_time_now=now())
5. `ApplyChange` UPDATE ตามมาเพื่อ override vat_type/tax_type/cust_code/inquiry_type/doc_no ของทั้งบิล

ข้อดี: ครอบคลุม NOT NULL fields (เช่น `doc_date`, `doc_time`, `calc_flag=-1`) อัตโนมัติและทนต่อ schema upstream ที่อาจเพิ่มคอลัมน์ในอนาคต

## Tests

```bash
cd backend
GOCACHE="$PWD/.gocache" GOPATH="$PWD/.gopath" go test ./...
```

Integration tests are skipped unless `NSI_INTEGRATION_DATABASE_URL` is set. Use only a cloned/test database for integration runs.

## Production Notes

- Set `APP_ENV=production`
- Set a unique `SESSION_SECRET`
- Keep `SML_DB_MAX_CONNS` conservative, default `3`
- Database connection is configured entirely via `.env` / environment variables — no runtime UI to change it
- Do not log full connection strings or passwords
- Put the backend behind HTTPS
- Test write/rollback flows on a cloned SML database before live use
