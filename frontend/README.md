# next-salesinvoice Frontend

React + Vite frontend for the SML ERP sales invoice workflow.

## Run locally

Start the backend first on port `8080`, then:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Routes

The frontend uses browser routes so links can be opened directly, refreshed, and shared.

- `/login` - sign in
- `/invoices` - search invoices, supports `from`, `to`, and `q` query params
- `/invoices/:docNo` - selected invoice in the search workbench
- `/invoices/:docNo/edit` - edit one invoice, supports `stage=setup|items|review|save`
- `/bulk-edit` - bulk invoice edit, supports `from`, `to`, and `q` query params
- `/audit` and `/audit/:docNo` - audit and rollback tools, Admin only
- `/system/status` - readiness checks
- `/system/database` - database connection settings, Admin only

Production deployments must route non-API paths back to `index.html` so direct links like
`/invoices/INV26050001/edit` load the SPA instead of returning 404.

Dev login:

- Code: `EMP001`
- Password: `1234`
