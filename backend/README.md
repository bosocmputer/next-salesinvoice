# next-salesinvoice Backend

Go + Gin backend for the SML ERP sales invoice workflow.

## Run locally

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

## Current endpoints

- `GET /api/v1/health`
- `GET /api/v1/system/database-status`
- `POST /api/v1/system/database-verify`
- `POST /api/v1/system/database-migrate`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/documents?from=&to=&page=&pageSize=&q=`
- `GET /api/v1/documents/:docNo/details`
- `POST /api/v1/documents/:docNo/preview-change`
- `POST /api/v1/documents/:docNo/apply-change`
- `POST /api/v1/documents/bulk/preview-change`
- `POST /api/v1/documents/bulk/apply-change`
- `POST /api/v1/documents/rollback`
- `GET /api/v1/documents/running-number?formatCode=`
- `GET /api/v1/master/doc-formats`
- `GET /api/v1/master/customers?q=&limit=`
- `GET /api/v1/master/products?q=&limit=`
- `GET /api/v1/master/sale-types`
- `GET /api/v1/master/tax-types`
- `GET /api/v1/audit-logs?resourceId=&limit=`

## Dev login

- Code: `EMP001`
- Password: `1234`

## Production hardening

- Set `APP_ENV=production`.
- Set a unique `SESSION_SECRET`; the development secret is rejected in production.
- Keep `SML_DB_MAX_CONNS` at `5` or lower. Default is `3`.
- Keep `SML_DB_MIN_CONNS=0` so the app does not hold idle connections to SML.
- Keep `NSI_AUTO_CREATE_PERFORMANCE_INDEXES=true` unless DBAs want to create and tune indexes manually.
- Use `REQUEST_BODY_LIMIT_BYTES=1048576` unless a larger payload is proven necessary.
- Put the backend behind HTTPS in production. Session cookies are `Secure`, `HttpOnly`, and `SameSite=Strict` when `APP_ENV=production`.
- Only `Admin` role can run DB-write and admin-sensitive endpoints:
  - `POST /api/v1/system/database-migrate`
  - `POST /api/v1/documents/:docNo/apply-change`
  - `POST /api/v1/documents/bulk/apply-change`
  - `POST /api/v1/documents/rollback`
  - `GET /api/v1/audit-logs`
- Always test with a copied SML database before connecting to a customer's live database.

## Integration tests

Normal `go test ./...` never touches SML. Database integration tests are skipped unless `NSI_INTEGRATION_DATABASE_URL` is set.

Use only a cloned/test PostgreSQL database. If the URL contains `sml1_2026`, the test requires `NSI_ALLOW_SML1_2026_INTEGRATION=1` to confirm that this database is not live production data.

```bash
cd backend
NSI_INTEGRATION_DATABASE_URL='postgres://postgres:password@127.0.0.1:5432/nsi_test?sslmode=disable' \
NSI_ALLOW_SML1_2026_INTEGRATION=0 \
GOCACHE="$PWD/.gocache" GOPATH="$PWD/.gopath" \
go test ./internal/repository -run Integration -count=1
```

The integration test creates a temporary schema, seeds minimal SML-shaped tables, verifies preview/apply/recalculate behavior, verifies invalid input does not mutate the document, then drops the schema.
