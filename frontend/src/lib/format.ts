import type {
  DocumentChangePreview,
  DocumentDetailLine,
  DocumentHistoryItem,
  DocumentSummary,
  LineChangeState,
  PageKey,
  PreviewChangeItem,
  AuditInvoiceDialogState,
} from "../types";

export const saleTypeLabels: Record<number, string> = {
  1: "ขายเงินเชื่อ",
  2: "ขายเงินสด",
  3: "ขายสินค้าเงินเชื่อ (สินค้าบริการ)",
  4: "ขายสินค้าเงินสด (สินค้าบริการ)",
};

export const taxTypeLabels: Record<number, string> = {
  0: "ภาษีแยกนอก",
  1: "ภาษีรวมใน",
  2: "ภาษีอัตราศูนย์",
  3: "ไม่กระทบภาษี",
};

export const documentCompareFields: Array<keyof DocumentSummary> = [
  "docNo",
  "docDate",
  "docTime",
  "docFormatCode",
  "customerCode",
  "contactor",
  "taxDocNo",
  "taxDocDate",
  "docRef",
  "docRefDate",
  "inquiryType",
  "vatType",
  "remark",
  "vatRate",
  "totalValue",
  "totalBeforeVat",
  "totalAmount",
  "totalVatValue",
  "totalDiscount",
  "totalAfterVat",
  "totalExceptVat",
];

export const lineCompareFields: Array<keyof DocumentDetailLine> = [
  "itemCode",
  "itemName",
  "whCode",
  "shelfCode",
  "unitCode",
  "qty",
  "price",
  "discount",
  "sumAmount",
  "totalVatValue",
];

export function appStatusLabel(status: string) {
  if (status === "audit_before") return "ข้อมูลเดิม";
  if (status === "audit_after") return "ข้อมูลใหม่";
  if (status === "processing") return "กำลังทำ";
  if (status === "done") return "เสร็จแล้ว";
  if (status === "failed") return "ผิดพลาด";
  if (status === "rolled_back") return "ย้อนกลับแล้ว";
  return "รอดำเนินการ";
}

export function appStatusTone(status: string): "neutral" | "success" | "danger" {
  if (status === "done" || status === "rolled_back") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

export function pageFromPath(pathname: string): PageKey {
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/system/status")) return "status";
  return "bulk";
}

export function titleFromPath(pathname: string) {
  if (pathname.includes("/edit")) return "แก้บิลที่เลือก";
  if (pathname.startsWith("/bulk-edit")) return "แก้ไขบิล";
  if (pathname.startsWith("/audit")) return "ประวัติและย้อนกลับ";
  if (pathname.startsWith("/system/status")) return "ตรวจระบบ";
  if (pathname === "/" || pathname === "") return "แก้ไขบิล";
  return "ไม่พบหน้า";
}

export function legacyPathFromPage(page: string) {
  if (page === "invoices") return "/bulk-edit";
  if (page === "edit") return "/bulk-edit";
  if (page === "bulk") return "/bulk-edit";
  if (page === "audit") return "/audit";
  if (page === "status") return "/system/status";
  return "";
}

export function formatDate(value: string) {
  return value ? value.slice(0, 10) : "-";
}

export function formatSmlDate(value: string) {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const parsedYear = Number(year);
  const displayYear = parsedYear < 2400 ? parsedYear + 543 : parsedYear;
  return `${Number(day)}/${Number(month)}/${displayYear}`;
}

export function formatDocumentTime(value: string) {
  if (!value) return "-";
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

const DATETIME_FORMATTER = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" });

export function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return DATETIME_FORMATTER.format(parsed);
}

/**
 * Singleton Intl.NumberFormat for money. Constructing the formatter is the
 * costly part; reusing one instance avoids re-creation per grid cell render.
 */
const MONEY_FORMATTER = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value || "-";
  return MONEY_FORMATTER.format(parsed);
}

export function changedPaperSx(changed: boolean, tone: "warning" | "success" = "warning") {
  if (!changed) return {};
  return {
    bgcolor: tone === "success" ? "rgba(46, 125, 91, 0.10)" : "rgba(161, 98, 7, 0.10)",
    borderColor: tone === "success" ? "success.main" : "warning.main",
    borderRadius: 1,
    borderStyle: "solid",
    borderWidth: 1,
    px: 1,
    py: 0.5,
  };
}

export function changedCellSx(changed: boolean) {
  if (!changed) return {};
  return { bgcolor: "rgba(161, 98, 7, 0.10)" };
}

function normalizeCompareValue(value: unknown) {
  return String(value ?? "").trim();
}

export function valueChanged(current: unknown, previous: unknown) {
  return normalizeCompareValue(current) !== normalizeCompareValue(previous);
}

export function moneyValueChanged(current: unknown, previous: unknown) {
  const currentNumber = Number(current || 0);
  const previousNumber = Number(previous || 0);
  if (Number.isFinite(currentNumber) && Number.isFinite(previousNumber)) return Math.abs(currentNumber - previousNumber) > 0.004;
  return valueChanged(current, previous);
}

export function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Mask internal staging/test markers that leak from automated rollback/test flows.
// Anything matching STAGING_*, REALWRITE_*, or ROLLBACK_<digits> is hidden from end users.
export function maskInternalRemark(value: string): string {
  if (!value) return value;
  const stripped = value
    .split(/\s+/)
    .filter((token) => !/^(STAGING|REALWRITE|ROLLBACK)[_A-Z0-9]*$/i.test(token))
    .join(" ")
    .trim();
  return stripped;
}

export function rawText(raw: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}

export function rawInt(raw: Record<string, unknown>, keys: string[], fallback = 0) {
  const value = rawText(raw, keys);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function productLineMeta(line: DocumentDetailLine) {
  const details = [
    line.barcode ? `บาร์โค้ด ${line.barcode}` : "",
  ].filter(Boolean);
  return details.join(" · ");
}

export function productLineTitle(line: DocumentDetailLine, meta = productLineMeta(line)) {
  return [line.itemCode, line.itemName, meta].filter(Boolean).join(" · ");
}

function sameLineIdentity(current: DocumentDetailLine, previous: DocumentDetailLine) {
  const currentCode = current.itemCode.trim();
  const previousCode = previous.itemCode.trim();
  if (currentCode && previousCode) return currentCode === previousCode;
  return current.lineNumber === previous.lineNumber;
}

function findComparableLine(line: DocumentDetailLine, index: number, compareLines: DocumentDetailLine[]) {
  const code = line.itemCode.trim();
  if (code) {
    const sameCode = compareLines.filter((candidate) => candidate.itemCode.trim() === code);
    if (sameCode.length === 1) return sameCode[0];
    const sameStorage = sameCode.find((candidate) => candidate.whCode === line.whCode && candidate.shelfCode === line.shelfCode && candidate.unitCode === line.unitCode);
    if (sameStorage) return sameStorage;
    return undefined;
  }
  return compareLines[index];
}

export function getLineChangeState(line: DocumentDetailLine, index: number, compareLines?: DocumentDetailLine[]): LineChangeState {
  if (!compareLines) return { status: "same", changedFields: new Set() };
  const previous = findComparableLine(line, index, compareLines);
  if (!previous) return { status: "added", changedFields: new Set(lineCompareFields) };
  const changedFields = new Set<keyof DocumentDetailLine>();
  lineCompareFields.forEach((field) => {
    const changed = field === "qty" || field === "price" || field === "sumAmount" || field === "totalVatValue"
      ? moneyValueChanged(line[field], previous[field])
      : valueChanged(line[field], previous[field]);
    if (changed) changedFields.add(field);
  });
  return { status: changedFields.size ? "changed" : "same", previous, changedFields };
}

export function getRemovedLines(currentLines: DocumentDetailLine[], previousLines: DocumentDetailLine[]) {
  return previousLines.filter((previous) => !currentLines.some((current) => sameLineIdentity(current, previous)));
}

export function countChangedDocumentFields(current: DocumentSummary, previous: DocumentSummary) {
  return documentCompareFields.filter((field) => {
    if (String(field).startsWith("total") || field === "vatRate") return moneyValueChanged(current[field], previous[field]);
    return valueChanged(current[field], previous[field]);
  }).length;
}

export function documentSummaryFromRawState(raw: Record<string, unknown>, fallbackDocNo: string, appStatus: string): DocumentSummary {
  return {
    docNo: rawText(raw, ["docNo", "doc_no"], fallbackDocNo),
    docDate: rawText(raw, ["docDate", "doc_date"]),
    docTime: rawText(raw, ["docTime", "doc_time"]),
    taxDocNo: rawText(raw, ["taxDocNo", "tax_doc_no"]),
    taxDocDate: rawText(raw, ["taxDocDate", "tax_doc_date"]),
    docRef: rawText(raw, ["docRef", "doc_ref"]),
    docRefDate: rawText(raw, ["docRefDate", "doc_ref_date"]),
    customerCode: rawText(raw, ["customerCode", "cust_code", "ar_code"]),
    contactor: rawText(raw, ["contactor"]),
    inquiryType: rawInt(raw, ["inquiryType", "inquiry_type"]),
    vatType: rawInt(raw, ["vatType", "vat_type"]),
    saleCode: rawText(raw, ["saleCode", "sale_code"]),
    saleGroup: rawText(raw, ["saleGroup", "sale_group"]),
    creditDay: rawText(raw, ["creditDay", "credit_day"]),
    creditDate: rawText(raw, ["creditDate", "credit_date"]),
    sendDay: rawText(raw, ["sendDay", "send_day"]),
    sendDate: rawText(raw, ["sendDate", "send_date"]),
    vatRate: rawText(raw, ["vatRate", "vat_rate"]),
    totalValue: rawText(raw, ["totalValue", "total_value"]),
    totalBeforeVat: rawText(raw, ["totalBeforeVat", "total_before_vat"]),
    totalAmount: rawText(raw, ["totalAmount", "total_amount"]),
    totalVatValue: rawText(raw, ["totalVatValue", "total_vat_value"]),
    totalDiscount: rawText(raw, ["totalDiscount", "total_discount"]),
    totalAfterVat: rawText(raw, ["totalAfterVat", "total_after_vat"]),
    totalExceptVat: rawText(raw, ["totalExceptVat", "total_except_vat"]),
    remark: rawText(raw, ["remark"]),
    docFormatCode: rawText(raw, ["docFormatCode", "doc_format_code"]),
    appStatus,
  };
}

export function documentLineFromRawState(raw: Record<string, unknown>, index: number): DocumentDetailLine {
  return {
    lineNumber: rawInt(raw, ["lineNumber", "line_number", "roworder"], index + 1),
    itemCode: rawText(raw, ["itemCode", "item_code"]),
    itemName: rawText(raw, ["itemName", "item_name"]),
    barcode: rawText(raw, ["barcode"]),
    whCode: rawText(raw, ["whCode", "wh_code"]),
    shelfCode: rawText(raw, ["shelfCode", "shelf_code"]),
    unitCode: rawText(raw, ["unitCode", "unit_code"]),
    qty: rawText(raw, ["qty"]),
    price: rawText(raw, ["price"]),
    discount: rawText(raw, ["discount"]),
    sumAmount: rawText(raw, ["sumAmount", "sum_amount"]),
    totalVatValue: rawText(raw, ["totalVatValue", "total_vat_value"]),
  };
}

export function buildAuditInvoiceDialog(item: DocumentHistoryItem, side: "before" | "after"): AuditInvoiceDialogState {
  const beforeDoc = documentSummaryFromRawState(item.before.icTrans, item.originalDocNo, "audit_before");
  const beforeLines = item.before.icTransDetail.map((line, index) => documentLineFromRawState(line, index));
  const state = item[side];
  const fallbackDocNo = side === "before" ? item.originalDocNo : item.currentDocNo || item.originalDocNo;
  return {
    doc: documentSummaryFromRawState(state.icTrans, fallbackDocNo, side === "before" ? "audit_before" : "audit_after"),
    lines: state.icTransDetail.map((line, index) => documentLineFromRawState(line, index)),
    comparison: side === "after" ? { beforeDoc, beforeLines } : undefined,
    title: side === "before" ? "รายละเอียดบิล: ข้อมูลเดิม" : "รายละเอียดบิล: ข้อมูลใหม่",
  };
}

export function buildPreviewChangeItems(preview: DocumentChangePreview): PreviewChangeItem[] {
  const beforeLineCount = preview.remainingLines.length + preview.removedLines.length;
  const afterLineCount = preview.totals.lineCount;
  const item = (
    key: string,
    label: string,
    before: string,
    after: string,
    changed: boolean,
    tone: "warning" | "danger" = "warning",
  ): PreviewChangeItem => ({ key, label, before: before || "-", after: after || "-", changed, tone });

  return [
    item("docNo", "เลขบิล", preview.before.docNo, preview.after.docNo, valueChanged(preview.after.docNo, preview.before.docNo)),
    item("docFormatCode", "ชุดเลข", preview.before.docFormatCode || "-", preview.after.docFormatCode || "-", valueChanged(preview.after.docFormatCode, preview.before.docFormatCode)),
    item("customerCode", "ลูกหนี้", preview.before.customerCode || "-", preview.after.customerCode || "-", valueChanged(preview.after.customerCode, preview.before.customerCode)),
    item(
      "inquiryType",
      "ประเภทขาย",
      saleTypeLabels[preview.before.inquiryType] || `${preview.before.inquiryType}`,
      saleTypeLabels[preview.after.inquiryType] || `${preview.after.inquiryType}`,
      valueChanged(preview.after.inquiryType, preview.before.inquiryType),
    ),
    item(
      "vatType",
      "ประเภทภาษี",
      taxTypeLabels[preview.before.vatType] || `${preview.before.vatType}`,
      taxTypeLabels[preview.after.vatType] || `${preview.after.vatType}`,
      valueChanged(preview.after.vatType, preview.before.vatType),
    ),
    item("remark", "หมายเหตุ", maskInternalRemark(preview.before.remark) || "ไม่มีหมายเหตุ", maskInternalRemark(preview.after.remark) || "ไม่มีหมายเหตุ", valueChanged(preview.after.remark, preview.before.remark)),
    item("totalAmount", "ยอดสุทธิ", formatMoney(preview.before.totalAmount), formatMoney(preview.totals.totalAmount), moneyValueChanged(preview.totals.totalAmount, preview.before.totalAmount)),
    item("lineCount", "สินค้าในบิล", `${beforeLineCount} รายการ`, `${afterLineCount} รายการ`, preview.removedLines.length > 0 || beforeLineCount !== afterLineCount, "danger"),
  ];
}
