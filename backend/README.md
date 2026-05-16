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

Compatibility/internal:

- `GET /api/v1/documents/selectable-doc-nos` still exists for compatibility, but the current UI does not expose server-side mass selection

## Document Search

`GET /api/v1/documents` and audit document search support:

- fuzzy search for normal text
- exact doc list: `INV26050025,INV26050026`
- inclusive doc range: `INV26050025:INV26050030`
- mixed list/range: `INV26050025:INV26050030,INV26050040`

Invalid range/list syntax falls back to the normal fuzzy search path.

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
