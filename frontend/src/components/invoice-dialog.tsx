import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { X } from "lucide-react";

import { apiGet } from "../lib/api";
import {
  appStatusLabel,
  appStatusTone,
  changedCellSx,
  changedPaperSx,
  countChangedDocumentFields,
  formatDate,
  formatMoney,
  getLineChangeState,
  getRemovedLines,
  maskInternalRemark,
  moneyValueChanged,
  numericValue,
  productLineMeta,
  productLineTitle,
  saleTypeLabels,
  taxTypeLabels,
  valueChanged,
} from "../lib/format";
import { appTheme } from "../theme";
import type {
  AuditInvoiceDialogState,
  DocumentDetailLine,
  DocumentSummary,
} from "../types";
import { AppButton, EmptyState, StatusBadge } from "./ui";

export function InvoiceDetailDialog({
  comparison,
  doc,
  lines,
  onClose,
  onEdit,
  title = "รายละเอียดบิล",
}: {
  comparison?: AuditInvoiceDialogState["comparison"];
  doc: DocumentSummary;
  lines?: DocumentDetailLine[];
  onClose: () => void;
  onEdit?: (docNo: string) => void;
  title?: string;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const beforeDoc = comparison?.beforeDoc;
  const fieldChanged = (field: keyof DocumentSummary) => Boolean(beforeDoc && valueChanged(doc[field], beforeDoc[field]));
  const moneyChanged = (field: keyof DocumentSummary) => Boolean(beforeDoc && moneyValueChanged(doc[field], beforeDoc[field]));
  const changedHeaderCount = beforeDoc ? countChangedDocumentFields(doc, beforeDoc) : 0;
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Dialog
      fullScreen={isMobile}
      fullWidth
      maxWidth="lg"
      open
      onClose={onClose}
    >
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography component="h2" noWrap sx={{ fontWeight: 700, minWidth: 0 }} variant="subtitle1">{title}</Typography>
            <Typography color="primary.main" noWrap sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }} variant="subtitle1">{doc.docNo}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
            {changedHeaderCount ? <StatusBadge tone="success">เปลี่ยน {changedHeaderCount} จุด</StatusBadge> : null}
            <StatusBadge tone={appStatusTone(doc.appStatus)}>{appStatusLabel(doc.appStatus)}</StatusBadge>
            <IconButton aria-label="ปิดรายละเอียดบิล" onClick={onClose} type="button">
              <X size={16} />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" } }}>
            <DocumentFact changed={fieldChanged("docDate")} label="วันที่เอกสาร" previousValue={beforeDoc ? formatDate(beforeDoc.docDate) : undefined} value={formatDate(doc.docDate)} />
            <DocumentFact changed={fieldChanged("docTime")} label="เวลา" previousValue={beforeDoc?.docTime || "-"} value={doc.docTime || "-"} />
            <DocumentFact changed={fieldChanged("docNo")} label="เลขที่เอกสาร" previousValue={beforeDoc?.docNo || "-"} value={doc.docNo} strong />
            <DocumentFact changed={fieldChanged("docFormatCode")} label="รูปแบบ" previousValue={beforeDoc?.docFormatCode || "-"} value={doc.docFormatCode || "-"} />
            <DocumentFact changed={fieldChanged("customerCode")} label="รหัสลูกหนี้" previousValue={beforeDoc?.customerCode || "-"} value={doc.customerCode || "-"} strong />
            <DocumentFact changed={fieldChanged("contactor")} label="ผู้ติดต่อ" previousValue={beforeDoc?.contactor || "-"} value={doc.contactor || "-"} />
            <DocumentFact changed={fieldChanged("taxDocDate")} label="วันที่ใบกำกับภาษี" previousValue={beforeDoc ? formatDate(beforeDoc.taxDocDate) : undefined} value={formatDate(doc.taxDocDate)} />
            <DocumentFact changed={fieldChanged("taxDocNo")} label="เลขที่ใบกำกับภาษี" previousValue={beforeDoc?.taxDocNo || "-"} value={doc.taxDocNo || "-"} />
            <DocumentFact changed={fieldChanged("docRef")} label="เอกสารอ้างอิง" previousValue={beforeDoc?.docRef || "-"} value={doc.docRef || "-"} />
            <DocumentFact changed={fieldChanged("docRefDate")} label="วันที่อ้างอิง" previousValue={beforeDoc ? formatDate(beforeDoc.docRefDate) : undefined} value={formatDate(doc.docRefDate)} />
            <DocumentFact changed={fieldChanged("inquiryType")} label="ประเภทขาย" previousValue={beforeDoc ? saleTypeLabels[beforeDoc.inquiryType] || `${beforeDoc.inquiryType}` : undefined} value={saleTypeLabels[doc.inquiryType] || `${doc.inquiryType}`} />
            <DocumentFact changed={fieldChanged("vatType")} label="ประเภทภาษี" previousValue={beforeDoc ? taxTypeLabels[beforeDoc.vatType] || `${beforeDoc.vatType}` : undefined} value={taxTypeLabels[doc.vatType] || `${doc.vatType}`} />
          </Box>
          <DocumentLinesPanel compareLines={comparison?.beforeLines} docNo={doc.docNo} lines={lines} />
          <Stack spacing={1.5}>
            <Paper variant="outlined" sx={{ ...changedPaperSx(fieldChanged("remark")), p: 1.5 }}>
              <Typography color="text.secondary" variant="caption">หมายเหตุ</Typography>
              <Typography sx={{ fontWeight: 700 }} variant="body2">{maskInternalRemark(doc.remark) || "ไม่มีหมายเหตุ"}</Typography>
              {fieldChanged("remark") ? <Typography color="text.secondary" variant="caption">เดิม: {maskInternalRemark(beforeDoc?.remark || "") || "ไม่มีหมายเหตุ"}</Typography> : null}
            </Paper>
            <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" } }}>
              <TotalLine changed={moneyChanged("vatRate")} label="อัตราภาษี" previousValue={beforeDoc ? formatMoney(beforeDoc.vatRate) : undefined} value={formatMoney(doc.vatRate)} />
              <TotalLine changed={moneyChanged("totalValue")} label="มูลค่าสินค้า" previousValue={beforeDoc ? formatMoney(beforeDoc.totalValue) : undefined} value={formatMoney(doc.totalValue)} />
              <TotalLine changed={moneyChanged("totalDiscount")} label="ส่วนลดรวม" previousValue={beforeDoc ? formatMoney(beforeDoc.totalDiscount) : undefined} value={formatMoney(doc.totalDiscount)} />
              <TotalLine changed={moneyChanged("totalBeforeVat")} label="มูลค่าก่อนภาษี" previousValue={beforeDoc ? formatMoney(beforeDoc.totalBeforeVat) : undefined} value={formatMoney(doc.totalBeforeVat)} />
              <TotalLine changed={moneyChanged("totalVatValue")} label="มูลค่าภาษี" previousValue={beforeDoc ? formatMoney(beforeDoc.totalVatValue) : undefined} value={formatMoney(doc.totalVatValue)} />
              <TotalLine changed={moneyChanged("totalExceptVat")} label="มูลค่ายกเว้นภาษี" previousValue={beforeDoc ? formatMoney(beforeDoc.totalExceptVat) : undefined} value={formatMoney(doc.totalExceptVat)} />
              <TotalLine changed={moneyChanged("totalAfterVat")} label="มูลค่าหลังภาษี" previousValue={beforeDoc ? formatMoney(beforeDoc.totalAfterVat) : undefined} value={formatMoney(doc.totalAfterVat)} />
              <TotalLine changed={moneyChanged("totalAmount")} label="ยอดสุทธิ" previousValue={beforeDoc ? formatMoney(beforeDoc.totalAmount) : undefined} value={formatMoney(doc.totalAmount)} strong />
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ alignItems: { xs: "stretch", sm: "center" }, flexDirection: { xs: "column", sm: "row" } }}>
        <AppButton fullWidth={isMobile} onClick={onClose}>ปิด</AppButton>
        {onEdit ? <AppButton fullWidth={isMobile} onClick={() => onEdit(doc.docNo)} tone="primary">แก้ไขบิลนี้</AppButton> : null}
      </DialogActions>
    </Dialog>
  );
}

export function DocumentLinesPanel({ compareLines, docNo, lines: providedLines }: { compareLines?: DocumentDetailLine[]; docNo: string; lines?: DocumentDetailLine[] }) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const [fetchedLines, setFetchedLines] = useState<DocumentDetailLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const lines = providedLines ?? fetchedLines;
  const totalQty = lines.reduce((sum, line) => sum + numericValue(line.qty), 0);
  const totalAmount = lines.reduce((sum, line) => sum + numericValue(line.sumAmount), 0);
  const lineStates = lines.map((line, index) => getLineChangeState(line, index, compareLines));
  const changedLineCount = lineStates.filter((state) => state.status !== "same").length;
  const removedLines = compareLines ? getRemovedLines(lines, compareLines) : [];

  useEffect(() => {
    if (providedLines) {
      setMessage("");
      setLoading(false);
      return;
    }
    void loadLines();
  }, [docNo, providedLines]);

  async function loadLines() {
    setLoading(true);
    setMessage("");
    const response = await apiGet<{ items: DocumentDetailLine[] }>(`/api/v1/documents/${encodeURIComponent(docNo)}/details`);
    if (response.success && response.data) {
      let nextLines = response.data.items;
      const mockLineCount = Math.min(Number(new URLSearchParams(window.location.search).get("mockLines") || "0"), 100);
      if (mockLineCount > nextLines.length && nextLines.length) {
        nextLines = Array.from({ length: mockLineCount }, (_, index) => ({
          ...nextLines[index % nextLines.length],
          lineNumber: index + 1,
        }));
      }
      setFetchedLines(nextLines);
    } else {
      setFetchedLines([]);
      setMessage(response.error?.detail || response.message || "โหลดรายการสินค้าไม่สำเร็จ");
    }
    setLoading(false);
  }

  return (
    <Stack spacing={1}>
    <Paper variant="outlined">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", p: 1.5 }}>
        <Typography sx={{ fontWeight: 700 }} variant="body2">รายการสินค้าในบิล <Typography color="text.secondary" component="span" variant="body2">{loading ? "กำลังโหลด" : `${lines.length} รายการ`}</Typography></Typography>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {compareLines ? <StatusBadge tone={changedLineCount ? "success" : "neutral"}>เปลี่ยน {changedLineCount}</StatusBadge> : null}
          {removedLines.length ? <StatusBadge tone="danger">ลบ {removedLines.length}</StatusBadge> : null}
          {lines.length > 8 ? <Typography color="text.secondary" variant="caption">เลื่อนดูรายการเพิ่มเติม</Typography> : null}
        </Stack>
      </Stack>
      {message ? <Alert severity="error">{message}</Alert> : null}
      {isMobile ? (
        <Stack spacing={1} sx={{ maxHeight: 440, overflow: "auto", p: 1.5, pt: 0 }}>
          {lines.map((line, index) => {
            const lineMeta = productLineMeta(line);
            const changeState = lineStates[index];
            const changed = changeState.status !== "same";
            return (
              <Card key={`${index}-${line.lineNumber}-${line.itemCode}`} variant="outlined" sx={changedPaperSx(changed, changeState.status === "added" ? "success" : "warning")}>
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Typography color="text.secondary" variant="caption">#{index + 1}</Typography>
                        {changed ? <StatusBadge tone={changeState.status === "added" ? "success" : "neutral"}>{changeState.status === "added" ? "เพิ่มใหม่" : "เปลี่ยน"}</StatusBadge> : null}
                      </Stack>
                      <Typography color="primary.main" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }} variant="body2">{formatMoney(line.sumAmount)}</Typography>
                    </Stack>
                    <Box>
                      <Typography sx={{ fontWeight: 800 }} variant="body2">{line.itemCode || "-"}</Typography>
                      <Typography color="text.secondary" variant="caption">{line.itemName || "-"}</Typography>
                      {lineMeta ? <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{lineMeta}</Typography> : null}
                      {changed && changeState.previous ? <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">เดิม: {changeState.previous.itemCode || "-"} {changeState.previous.itemName || ""}</Typography> : null}
                    </Box>
                    <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(2, 1fr)" }}>
                      <SummaryLine label="คลัง" value={line.whCode || "-"} />
                      <SummaryLine label="พื้นที่เก็บ" value={line.shelfCode || "-"} />
                      <SummaryLine label="จำนวน" value={`${formatMoney(line.qty)} ${line.unitCode || ""}`} />
                      <SummaryLine label="ราคา" value={formatMoney(line.price)} />
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
          {!loading && !lines.length && !message ? <EmptyState title="ไม่มีรายการสินค้า" description="ไม่พบข้อมูลจาก ic_trans_detail ของบิลนี้" /> : null}
          {loading ? <LinearProgress /> : null}
        </Stack>
      ) : (
      <TableContainer sx={{ maxHeight: 420 }}>
        <Table stickyHeader size="small" sx={{ minWidth: 820 }}>
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>รหัสสินค้า / ชื่อสินค้า</TableCell>
              <TableCell>คลัง</TableCell>
              <TableCell>พื้นที่เก็บ</TableCell>
              <TableCell>หน่วย</TableCell>
              <TableCell align="right">จำนวน</TableCell>
              <TableCell align="right">ราคา</TableCell>
              <TableCell>ส่วนลด</TableCell>
              <TableCell align="right">ยอดรวม</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line, index) => {
              const lineMeta = productLineMeta(line);
              const changeState = lineStates[index];
              const changed = changeState.status !== "same";
              const previous = changeState.previous;
              return (
                <TableRow key={`${index}-${line.lineNumber}-${line.itemCode}`} sx={changedPaperSx(changed, changeState.status === "added" ? "success" : "warning")}>
                  <TableCell>{index + 1} {changed ? <StatusBadge tone={changeState.status === "added" ? "success" : "neutral"}>{changeState.status === "added" ? "เพิ่มใหม่" : "เปลี่ยน"}</StatusBadge> : null}</TableCell>
                  <TableCell sx={changedCellSx(changeState.changedFields.has("itemCode") || changeState.changedFields.has("itemName"))} title={productLineTitle(line, lineMeta)}>
                    <Typography sx={{ fontWeight: 800 }} variant="body2">{line.itemCode || "-"}</Typography>
                    <Typography color="text.secondary" variant="caption">{line.itemName || "-"}</Typography>
                    {lineMeta ? <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{lineMeta}</Typography> : null}
                    {(changeState.changedFields.has("itemCode") || changeState.changedFields.has("itemName")) && previous ? (
                      <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">เดิม: {previous.itemCode || "-"} {previous.itemName || ""}</Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={changedCellSx(changeState.changedFields.has("whCode"))}><ChangedValue changed={changeState.changedFields.has("whCode")} previousValue={previous?.whCode || "-"} value={line.whCode || "-"} /></TableCell>
                  <TableCell sx={changedCellSx(changeState.changedFields.has("shelfCode"))}><ChangedValue changed={changeState.changedFields.has("shelfCode")} previousValue={previous?.shelfCode || "-"} value={line.shelfCode || "-"} /></TableCell>
                  <TableCell sx={changedCellSx(changeState.changedFields.has("unitCode"))}><ChangedValue changed={changeState.changedFields.has("unitCode")} previousValue={previous?.unitCode || "-"} value={line.unitCode || "-"} /></TableCell>
                  <TableCell align="right" sx={changedCellSx(changeState.changedFields.has("qty"))}><ChangedValue changed={changeState.changedFields.has("qty")} previousValue={previous ? formatMoney(previous.qty) : undefined} value={formatMoney(line.qty)} /></TableCell>
                  <TableCell align="right" sx={changedCellSx(changeState.changedFields.has("price"))}><ChangedValue changed={changeState.changedFields.has("price")} previousValue={previous ? formatMoney(previous.price) : undefined} value={formatMoney(line.price)} /></TableCell>
                  <TableCell sx={changedCellSx(changeState.changedFields.has("discount"))}><ChangedValue changed={changeState.changedFields.has("discount")} previousValue={previous?.discount || "-"} value={line.discount || "-"} /></TableCell>
                  <TableCell align="right" sx={changedCellSx(changeState.changedFields.has("sumAmount"))}><ChangedValue changed={changeState.changedFields.has("sumAmount")} color="primary.main" previousValue={previous ? formatMoney(previous.sumAmount) : undefined} strong value={formatMoney(line.sumAmount)} /></TableCell>
                </TableRow>
              );
            })}
            {!loading && !lines.length && !message ? (
              <TableRow>
                <TableCell colSpan={9}><EmptyState title="ไม่มีรายการสินค้า" description="ไม่พบข้อมูลจาก ic_trans_detail ของบิลนี้" /></TableCell>
              </TableRow>
            ) : null}
            {loading ? (
              <TableRow>
                <TableCell colSpan={9}><LinearProgress /></TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      )}
        {!loading && lines.length ? (
          <Stack direction="row" spacing={3} sx={{ bgcolor: "action.hover", justifyContent: "flex-end", p: 1.5 }}>
            <Typography sx={{ fontWeight: 700 }} variant="body2">รวมรายการสินค้า</Typography>
            <Typography variant="body2">จำนวน {formatMoney(String(totalQty))}</Typography>
            <Typography color="primary.main" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 900 }} variant="body1">ยอดรวม {formatMoney(String(totalAmount))}</Typography>
          </Stack>
        ) : null}
    </Paper>
    {removedLines.length ? <PreviewRemovedLinesPanel lines={removedLines} summaryLabel="รวมที่ถูกลบ" title="รายการที่ถูกลบจากบิลเดิม" /> : null}
    </Stack>
  );
}

export function PreviewRemovedLinesPanel({ lines, summaryLabel = "รวมที่จะลบ", title = "รายการสินค้าที่จะถูกลบ" }: { lines: DocumentDetailLine[]; summaryLabel?: string; title?: string }) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const totalQty = lines.reduce((sum, line) => sum + numericValue(line.qty), 0);
  const totalAmount = lines.reduce((sum, line) => sum + numericValue(line.sumAmount), 0);

  return (
    <Paper variant="outlined" sx={{ bgcolor: "rgba(208, 68, 55, 0.04)", borderColor: "error.main", overflow: "hidden" }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", p: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} variant="body2">{title}</Typography>
          <Typography color="text.secondary" variant="caption">รายการเหล่านี้จะไม่อยู่ในบิลใหม่หลังส่งเข้า SML</Typography>
        </Box>
        <StatusBadge tone="danger">{lines.length} รายการ</StatusBadge>
      </Stack>
      {isMobile ? (
        <Stack spacing={1} sx={{ p: 1.5, pt: 0 }}>
          {lines.map((line) => (
            <Card key={`${line.lineNumber}-${line.itemCode}`} variant="outlined" sx={{ borderColor: "error.light" }}>
              <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack spacing={0.75}>
                  <Typography sx={{ fontWeight: 800 }} variant="body2">{line.itemCode || "-"}</Typography>
                  <Typography color="text.secondary" variant="caption">{line.itemName || "-"}</Typography>
                  <Typography variant="caption">{line.whCode || "-"} / {line.shelfCode || "-"}</Typography>
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                    <Typography variant="body2">จำนวน {formatMoney(line.qty)} {line.unitCode || ""}</Typography>
                    <Typography color="error.main" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }} variant="body2">{formatMoney(line.sumAmount)}</Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : (
      <TableContainer>
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow>
              <TableCell>รหัสสินค้า</TableCell>
              <TableCell>ชื่อสินค้า</TableCell>
              <TableCell>คลัง/พื้นที่</TableCell>
              <TableCell align="right">จำนวน</TableCell>
              <TableCell align="right">ยอด</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.lineNumber}-${line.itemCode}`}>
                <TableCell><Typography sx={{ fontWeight: 800 }} variant="body2">{line.itemCode || "-"}</Typography></TableCell>
                <TableCell>{line.itemName || "-"}</TableCell>
                <TableCell>{line.whCode || "-"} / {line.shelfCode || "-"}</TableCell>
                <TableCell align="right">{formatMoney(line.qty)} {line.unitCode || ""}</TableCell>
                <TableCell align="right"><Typography color="error.main" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }} variant="body2">{formatMoney(line.sumAmount)}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      )}
      <Stack direction="row" spacing={3} sx={{ bgcolor: "action.hover", justifyContent: "flex-end", p: 1.5 }}>
        <Typography sx={{ fontWeight: 700 }} variant="body2">{summaryLabel}</Typography>
        <Typography variant="body2">จำนวน {formatMoney(String(totalQty))}</Typography>
        <Typography color="error.main" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 900 }} variant="body1">ยอด {formatMoney(String(totalAmount))}</Typography>
      </Stack>
    </Paper>
  );
}

export function RiskConfirmDialog({
  busy,
  children,
  confirmDisabled = false,
  confirmLabel,
  detail,
  title,
  tone,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  detail: string;
  title: string;
  tone: "danger" | "warning";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="xs" open onClose={busy ? undefined : onCancel}>
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <Typography component="h2" noWrap sx={{ fontWeight: 700, minWidth: 0 }} variant="subtitle1">{title}</Typography>
          <Box sx={{ display: { xs: "none", sm: "block" }, flexShrink: 0 }}>
            <StatusBadge tone={tone === "danger" ? "danger" : "neutral"}>{tone === "danger" ? "กระทบข้อมูลจริง" : "ตรวจสอบก่อน"}</StatusBadge>
          </Box>
          <IconButton aria-label="ปิดหน้าต่างยืนยัน" disabled={busy} onClick={onCancel} size="small" type="button">
            <X size={16} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gap: 1.5 }}>
          {busy ? <LinearProgress /> : null}
          <Alert severity={tone === "danger" ? "error" : "warning"}>{detail}</Alert>
          {children}
        </Box>
      </DialogContent>
      <DialogActions sx={{ alignItems: { xs: "stretch", sm: "center" }, flexDirection: { xs: "column", sm: "row" } }}>
          <AppButton disabled={busy} fullWidth={isMobile} onClick={onCancel}>ยกเลิก</AppButton>
          <AppButton
            disabled={busy || confirmDisabled}
            fullWidth={isMobile}
            onClick={onConfirm}
            startIcon={busy ? <CircularProgress color="inherit" size={16} /> : undefined}
            tone={tone === "danger" ? "danger" : "primary"}
          >
            {confirmLabel}
          </AppButton>
      </DialogActions>
    </Dialog>
  );
}

export function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <Paper elevation={0} variant="outlined" sx={{ p: 1.25 }}>
      <Typography color="text.secondary" variant="caption">{label}</Typography>
      <Typography color={strong ? "primary.main" : "text.primary"} sx={{ fontVariantNumeric: "tabular-nums", fontWeight: strong ? 800 : 700 }} variant="body2">{value}</Typography>
    </Paper>
  );
}

export function DocumentFact({
  changed = false,
  label,
  nowrap = true,
  previousValue,
  value,
  strong = false,
}: {
  changed?: boolean;
  label: string;
  nowrap?: boolean;
  previousValue?: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <Box sx={{ alignItems: "baseline", display: "grid", gap: 0.75, gridTemplateColumns: "max-content minmax(0, 1fr)", ...changedPaperSx(changed) }}>
      <Typography color="text.secondary" sx={{ textAlign: "right" }} variant="caption">{label}</Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography color={strong ? "primary.main" : "text.primary"} noWrap={nowrap} sx={{ fontWeight: strong ? 800 : 700, overflowWrap: "anywhere" }} variant="body2">{value || "-"}</Typography>
        {changed && previousValue ? <Typography color="text.secondary" noWrap variant="caption">เดิม: {previousValue}</Typography> : null}
      </Box>
    </Box>
  );
}

export function TotalLine({
  changed = false,
  label,
  previousValue,
  value,
  strong = false,
}: {
  changed?: boolean;
  label: string;
  previousValue?: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <Paper
      elevation={0}
      sx={{ alignItems: "baseline", display: "flex", gap: 1, justifyContent: "space-between", px: 1, py: 0.5, ...changedPaperSx(changed) }}
    >
      <Typography color="text.secondary" noWrap variant="caption">{label}</Typography>
      <Box sx={{ minWidth: 0, textAlign: "right" }}>
        <Typography color={strong ? "primary.main" : "text.primary"} noWrap sx={{ fontWeight: 800 }} variant={strong ? "body1" : "body2"}>{value || "-"}</Typography>
        {changed && previousValue ? <Typography color="text.secondary" noWrap variant="caption">เดิม: {previousValue}</Typography> : null}
      </Box>
    </Paper>
  );
}

export function ChangedValue({
  changed,
  color = "text.primary",
  previousValue,
  strong = false,
  value,
}: {
  changed?: boolean;
  color?: string;
  previousValue?: string;
  strong?: boolean;
  value: string;
}) {
  return (
      <Box>
      <Typography color={color} sx={{ fontWeight: strong ? 900 : 600 }} variant="body2">{value || "-"}</Typography>
      {changed && previousValue ? <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">เดิม: {previousValue}</Typography> : null}
    </Box>
  );
}
