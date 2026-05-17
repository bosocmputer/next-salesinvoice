# next-salesinvoice Frontend

React + Vite frontend สำหรับ workflow แก้ไขบิลขาย SML

## Stack

- React 18
- Vite (rolldown)
- TypeScript (strict)
- Material UI v9: `@mui/material`, `@mui/x-data-grid`
- JSON technical view: `@uiw/react-json-view` (lazy-chunked)
- Icons: `lucide-react`
- E2E: Playwright + `@axe-core/playwright`

## Run Locally

เริ่ม backend ที่ port `8080` ก่อน แล้วรัน:

```bash
cd frontend
npm install
npm run dev
```

เปิด:

```text
http://127.0.0.1:3000
```

## Build

```bash
cd frontend
npm run build
```

## E2E Tests

```bash
cd frontend
npx playwright test
npx playwright test tests/e2e/a11y.spec.ts  # axe-core smoke (login + bulk-edit)
```

## Routes

- `/login`: เข้าสู่ระบบ
- `/bulk-edit`: หน้าเลือกบิล ตั้งค่า preview และส่งเข้า SML
- `/audit`: ประวัติ/rollback/technical JSON สำหรับ Admin
- `/audit/:docNo`: เปิด audit โดยระบุเลขบิล
- `/system/status`: Admin diagnostic/setup สำหรับสถานะฐานและติดตั้ง `nsi_*`
- `/system/database`: legacy redirect ไป `/system/status`
- `*`: 404 (NotFoundPage — AppBar title แสดง "ไม่พบหน้า")

## UI Design System

### Source of truth

- `src/theme.ts` — design tokens ทั้งหมด: palette, typography scale, component overrides, breakpoints
- `src/components/ui/typography.tsx` — semantic primitives (`SectionTitle`, `FieldLabel`, `DocCode`, `Money`, `MoneyTotal`, `EmphasisText`, `WEIGHT` constants, `compactActionButtonSx`)
- `src/components/ui.tsx` — building blocks (`AppButton`, `StatusBadge`, `MetricCard`, `PageHeader`, `PageLoading`, `EmptyState`, `LiveRegion`, `SkeletonLine`)
- `src/components/ui/index.ts` — barrel

### Key tokens

- `TOUCH_TARGET_MIN_PX = 44` (xs ทุก interactive control)
- `DESKTOP_CONTROL_HEIGHT_PX = 36`
- `text.secondary = #4b5563` (≈6.6:1 AA on white)
- Brand primary `#245a6d` (teal) — ใช้เป็น focus-ring + selected

### Conventions

- ใช้ typography primitives แทน raw `<Typography variant=...>` ทุกครั้งที่ทำได้
- Money ที่มีสี ต้องผ่าน `<Money tone="positive|negative|neutral">` (ไม่ใช้สีล้วนตัวสื่อ state)
- DocCode ใช้ mono + bold; `tone="primary"` สำหรับ destination doc
- Status badge: `<StatusBadge tone="success|danger">` มี icon (Check/X) สื่อสถานะ; `neutral` ไม่มี icon (เป็น count chip)
- Mobile (xs): touch target 44px, dialogs fullScreen, DataGrid ถูกแทนด้วย card view
- Search fields ต้องมี clear action และคงพฤติกรรม reload current filter
- Dialog title ใช้ `SectionTitle level="h2"`

### Accessibility (WCAG 2.1 AA)

- Skip link `ข้ามไปยังเนื้อหา` (visible ตอน keyboard focus)
- Focus ring 2px brand teal บน input/button (`:focus-visible`)
- `@media (prefers-reduced-motion: reduce)` ปิด transition/animation
- StatusBadge ไม่พึ่งพาสี (mandatory icon สำหรับ state)
- Toast `Alert role="alert"|"status"`; `LiveRegion` สำหรับ SR-only announcement
- `axe-core` smoke spec (`tests/e2e/a11y.spec.ts`) — 0 violations

## Performance Notes

- `Intl.NumberFormat` / `Intl.DateTimeFormat` เป็น module-level singletons ใน `src/lib/format.ts` (ไม่สร้างใหม่ต่อ row ใน DataGrid)
- Pages ทุกหน้า lazy-loaded; `@uiw/react-json-view` แยก chunk แยก
- Bundle (vite build): index ~34 kB, BulkInvoiceEditPage ~42 kB, AuditLogPage ~18 kB

## Dev Login

- Code: `EMP001`
- Password: `1234`
