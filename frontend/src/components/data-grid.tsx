import { lazy, type ComponentType } from "react";
import type { DataGridProps } from "@mui/x-data-grid";

export const LazyDataGrid = lazy(async () => {
  const module = await import("@mui/x-data-grid");
  return { default: module.DataGrid as ComponentType<DataGridProps<any>> };
});

export const thaiGridLocaleText: NonNullable<DataGridProps<any>["localeText"]> = {
  noRowsLabel: "ไม่พบข้อมูล",
  footerTotalRows: "จำนวนแถวทั้งหมด:",
  paginationRowsPerPage: "แถวต่อหน้า:",
  paginationDisplayedRows: ({ from, to, count }) => `${from.toLocaleString("th-TH")}-${to.toLocaleString("th-TH")} จาก ${count === -1 ? `มากกว่า ${to.toLocaleString("th-TH")}` : count.toLocaleString("th-TH")}`,
  paginationItemAriaLabel: (type) => {
    if (type === "first") return "หน้าแรก";
    if (type === "last") return "หน้าสุดท้าย";
    if (type === "next") return "หน้าถัดไป";
    return "หน้าก่อนหน้า";
  },
};
