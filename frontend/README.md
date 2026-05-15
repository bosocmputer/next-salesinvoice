# next-salesinvoice Frontend

React + Vite frontend สำหรับ workflow แก้ไขบิลขาย SML

## Stack

- React 18
- Vite
- TypeScript
- Material UI: `@mui/material`, `@mui/x-data-grid`
- JSON technical view: `@uiw/react-json-view`
- Icons: `lucide-react`

ระบบ utility/custom UI เก่าถูกถอดออกจาก frontend ปัจจุบันแล้ว

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

## Routes

- `/login`: เข้าสู่ระบบ
- `/bulk-edit`: หน้าเลือกบิล ตั้งค่า preview และส่งเข้า SML
- `/audit`: ประวัติ/rollback/technical JSON สำหรับ Admin
- `/audit/:docNo`: เปิด audit โดยระบุเลขบิล
- `/system/status`: Admin diagnostic/setup สำหรับสถานะฐานและติดตั้ง `nsi_*`
- `/system/database`: legacy redirect ไป `/system/status`

## UI Conventions

- ใช้ MUI components เป็นหลัก
- ใช้ `sx` เฉพาะจุดที่จำเป็น
- Table-heavy pages ใช้ compact typography
- Dialog สำคัญต้องมี one-row header เท่าที่ทำได้
- Mobile ต้องไม่ horizontal overflow แม้ workflow หลักจะเน้น desktop/internal staff
- Search fields ควรมี clear action และคงพฤติกรรม reload current filter

## Dev Login

- Code: `EMP001`
- Password: `1234`
