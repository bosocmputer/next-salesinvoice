import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import JsonView, { type JsonViewProps, type SemicolonProps } from "@uiw/react-json-view";
import { lightTheme as jsonViewLightTheme } from "@uiw/react-json-view/light";
import { Copy, RefreshCw, Search, X } from "lucide-react";

import { useToast } from "../contexts/toast";
import { apiGet, apiPost } from "../lib/api";
import {
  buildAuditInvoiceDialog,
  formatDateTime,
  formatMoney,
} from "../lib/format";
import { appTheme } from "../theme";
import type {
  AuditInvoiceDialogState,
  DocumentHistoryItem,
  JsonDiffMap,
  JsonDiffStatus,
  RollbackDocumentResult,
  UserClaims,
} from "../types";
import { LazyDataGrid, thaiGridLocaleText } from "../components/data-grid";
import {
  DocumentFact,
  InvoiceDetailDialog,
  RiskConfirmDialog,
  SummaryLine,
} from "../components/invoice-dialog";
import { AppButton, EmptyState, StatusBadge } from "../components/ui";
import { DocCode, SectionTitle, compactActionButtonSx } from "../components/ui/typography";

/**
 * Local alias so existing call sites can continue using a stable name while we
 * migrate inline `sx` blocks to the shared primitive.
 */
const auditActionButtonSx = compactActionButtonSx;

export default function AuditLogPage({ selectedDocNo, user }: { selectedDocNo: string; user: UserClaims }) {
  void user;
  const isMobile = useMediaQuery(appTheme.breakpoints.down("md"));
  const [histories, setHistories] = useState<DocumentHistoryItem[]>([]);
  const [docNo, setDocNo] = useState(selectedDocNo);
  const [rollbackSnapshotId, setRollbackSnapshotId] = useState("");
  const [rollbackDocNo, setRollbackDocNo] = useState(selectedDocNo);
  const [technicalDialog, setTechnicalDialog] = useState<DocumentHistoryItem | null>(null);
  const [detailDialog, setDetailDialog] = useState<AuditInvoiceDialogState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackConfirmText, setRollbackConfirmText] = useState("");
  const auditGridHeight = histories.length ? Math.min(560, 44 + histories.length * 50) : 220;
  const auditGridColumns = useMemo<GridColDef<DocumentHistoryItem>[]>(() => [
    {
      field: "snapshotId",
      headerName: "#",
      width: 60,
      renderCell: (params) => <DocCode value={`#${params.row.snapshotId}`} />,
    },
    {
      field: "originalDocNo",
      headerName: "เลขเดิม",
      minWidth: 108,
      flex: 0.9,
      renderCell: (params) => <DocCode value={params.row.originalDocNo} />,
    },
    {
      field: "currentDocNo",
      headerName: "เลขใหม่",
      minWidth: 108,
      flex: 0.9,
      renderCell: (params) => <DocCode value={params.row.currentDocNo || "-"} tone="primary" />,
    },
    {
      field: "createdBy",
      headerName: "ผู้ทำ",
      width: 84,
      renderCell: (params) => params.row.createdBy || "-",
    },
    {
      field: "lineCount",
      headerName: "สินค้า",
      width: 56,
      align: "right",
      headerAlign: "right",
      valueGetter: (_, row) => Array.isArray(row.after.icTransDetail) ? row.after.icTransDetail.length : 0,
    },
    {
      field: "createdAt",
      headerName: "เวลา",
      width: 104,
      renderCell: (params) => formatDateTime(params.row.createdAt),
    },
    {
      field: "status",
      headerName: "สถานะ",
      width: 140,
      renderCell: (params) => (
        <StatusBadge tone={documentHistoryStatusTone(params.row)}>
          {documentHistoryStatusLabel(params.row)}
        </StatusBadge>
      ),
    },
    {
      field: "actions",
      headerName: "จัดการ",
      sortable: false,
      filterable: false,
      width: 260,
      renderCell: (params) => (
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "nowrap", gap: 0.5, overflow: "hidden", py: 0.5 }}>
          <AppButton onClick={(event) => { event.stopPropagation(); setDetailDialog(buildAuditInvoiceDialog(params.row, "before")); }} size="small" sx={auditActionButtonSx}>บิลเดิม</AppButton>
          <AppButton onClick={(event) => { event.stopPropagation(); setDetailDialog(buildAuditInvoiceDialog(params.row, "after")); }} size="small" sx={auditActionButtonSx}>บิลใหม่</AppButton>
          <AppButton onClick={(event) => { event.stopPropagation(); setTechnicalDialog(params.row); }} size="small" sx={auditActionButtonSx}>เทคนิค</AppButton>
          <Button color="error" disabled={Boolean(params.row.rolledBackAt)} onClick={(event) => { event.stopPropagation(); openRollbackConfirm(params.row); }} size="small" sx={auditActionButtonSx} variant="outlined">ย้อนกลับ</Button>
        </Stack>
      ),
    },
  ], []);

  useEffect(() => {
    void loadLogs();
  }, []);

  function openRollbackConfirm(item: DocumentHistoryItem) {
    setRollbackSnapshotId(`${item.snapshotId}`);
    setRollbackDocNo(item.currentDocNo || item.originalDocNo);
    setRollbackConfirmText("");
    setRollbackConfirmOpen(true);
  }

  async function loadLogs(nextDocNo = docNo) {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams({ limit: "10" });
    if (nextDocNo.trim()) params.set("docNo", nextDocNo.trim());
    const response = await apiGet<{ items: DocumentHistoryItem[] }>(`/api/v1/audit-documents?${params.toString()}`);
    if (response.success && response.data) setHistories(response.data.items);
    else setMessage(response.error?.detail || response.message || "โหลดประวัติเอกสารไม่สำเร็จ");
    setLoading(false);
  }

  async function clearAuditSearchText() {
    if (!docNo) return;
    setDocNo("");
    await loadLogs("");
  }

  async function rollbackDocument() {
    if (rollbackConfirmText.trim() !== rollbackDocNo.trim()) {
      setMessage("กรุณาพิมพ์เลขเอกสารให้ตรงก่อนกู้คืนข้อมูล");
      return;
    }
    setLoading(true);
    setMessage("");
    setRollbackConfirmOpen(false);
    const snapshotId = Number(rollbackSnapshotId);
    const response = await apiPost<RollbackDocumentResult>("/api/v1/documents/rollback", {
      snapshotId: Number.isFinite(snapshotId) && snapshotId > 0 ? snapshotId : 0,
      docNo: rollbackDocNo.trim(),
    });
    if (response.success && response.data) {
      setMessage(`ย้อนกลับสำเร็จ: ${response.data.restored.docNo}`);
      await loadLogs();
    } else {
      setMessage(response.error?.detail || response.message || "ย้อนกลับไม่สำเร็จ");
    }
    setLoading(false);
  }

  return (
    <Stack spacing={1.25}>
      {message ? <Alert severity={message.includes("สำเร็จ") ? "success" : "warning"}>{message}</Alert> : null}
      <Paper variant="outlined" sx={{ minWidth: 0, overflow: "hidden", p: 1.25 }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
            <SectionTitle level="h2">ประวัติการบันทึก</SectionTitle>
            <Box sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}>
              <StatusBadge>{loading ? "กำลังโหลด" : `${histories.length} รายการ`}</StatusBadge>
            </Box>
          </Stack>
        <Box sx={{ alignItems: "flex-start", display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", md: "minmax(260px, 1fr) auto" }, minWidth: 0 }}>
          <TextField
            helperText="ค้นหาเลขบิลหลายใบหรือช่วงได้ เช่น เลขเริ่ม:เลขจบ,เลขเดี่ยว"
            label="เลขเอกสารเดิมหรือเลขเอกสารใหม่"
            onChange={(event) => setDocNo(event.target.value)}
            placeholder="เลขบิลเดิม / เลขบิลใหม่"
            size="small"
            value={docNo}
            slotProps={{
              input: {
                endAdornment: docNo ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="ล้างคำค้นหา"
                      disabled={loading}
                      edge="end"
                      onClick={() => void clearAuditSearchText()}
                      size="small"
                    >
                      <X size={16} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
                startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
              },
            }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: "stretch" }}>
            <AppButton disabled={loading} onClick={() => void loadLogs()} size="small" sx={{ flex: { xs: 1, md: "0 0 auto" }, minHeight: 40, minWidth: { md: 112 } }} tone="primary">ค้นหา</AppButton>
            <AppButton disabled={loading} onClick={() => void loadLogs()} size="small" startIcon={<RefreshCw size={15} />} sx={{ flex: { xs: 1, md: "0 0 auto" }, minHeight: 40, minWidth: { md: 112 } }}>โหลดใหม่</AppButton>
          </Stack>
        </Box>
        {isMobile ? (
          <Stack spacing={1}>
            {histories.map((item) => (
              <DocumentHistoryCard
                item={item}
                key={item.snapshotId}
                onRollback={() => openRollbackConfirm(item)}
                onViewTechnical={() => setTechnicalDialog(item)}
                onViewAfter={() => setDetailDialog(buildAuditInvoiceDialog(item, "after"))}
                onViewBefore={() => setDetailDialog(buildAuditInvoiceDialog(item, "before"))}
              />
            ))}
            {!histories.length && !loading ? <EmptyState title="ยังไม่มีประวัติเอกสาร" description="ลองค้นหาด้วยเลขเอกสารเดิมหรือเลขเอกสารใหม่" /> : null}
          </Stack>
        ) : (
          <Stack spacing={1.25}>
            <Box sx={{ height: auditGridHeight, minWidth: 0, width: "100%" }}>
              <Suspense fallback={<LinearProgress />}>
                <LazyDataGrid
                  columnHeaderHeight={42}
                  columns={auditGridColumns}
                  density="standard"
                  disableColumnMenu
                  disableRowSelectionOnClick
                  getRowId={(row) => row.snapshotId}
                  hideFooter={histories.length <= 10}
                  loading={loading}
                  localeText={{ ...thaiGridLocaleText, noRowsLabel: "ยังไม่มีประวัติเอกสาร" }}
                  pageSizeOptions={[10, 25, 50]}
                  rowHeight={50}
                  rows={histories}
                  sx={{
                    border: 0,
                    "& .MuiDataGrid-cell": {
                      alignItems: "center",
                      display: "flex",
                      py: 0.75,
                    },
                    "& .MuiDataGrid-columnHeaderTitle": {
                      fontWeight: 700,
                    },
                    "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": {
                      outline: "none",
                    },
                  }}
                />
              </Suspense>
            </Box>
          </Stack>
        )}
        </Stack>
      </Paper>
      {rollbackConfirmOpen ? (
        <RiskConfirmDialog
          busy={loading}
          confirmDisabled={rollbackConfirmText.trim() !== rollbackDocNo.trim()}
          confirmLabel={loading ? "กำลังกู้คืน" : "ยืนยันกู้คืนจริง"}
          detail="ระบบจะนำจุดสำรองข้อมูลเดิมกลับไปเขียนทับข้อมูลบิลในฐานข้อมูล SML จริง"
          title="ยืนยันกู้คืนเอกสารจากจุดสำรอง"
          tone="danger"
          onCancel={() => setRollbackConfirmOpen(false)}
          onConfirm={() => void rollbackDocument()}
        >
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" } }}>
            <SummaryLine label="จุดสำรองข้อมูล ID" value={rollbackSnapshotId || "ใช้เลขเอกสาร"} />
            <SummaryLine label="เลขเอกสาร" value={rollbackDocNo || "-"} strong />
          </Box>
          <TextField
            label="พิมพ์เลขเอกสารเพื่อยืนยัน"
            onChange={(event) => setRollbackConfirmText(event.target.value)}
            placeholder={rollbackDocNo || "เลขเอกสาร"}
            value={rollbackConfirmText}
          />
        </RiskConfirmDialog>
      ) : null}
      {detailDialog ? (
        <InvoiceDetailDialog
          comparison={detailDialog.comparison}
          doc={detailDialog.doc}
          lines={detailDialog.lines}
          title={detailDialog.title}
          onClose={() => setDetailDialog(null)}
        />
      ) : null}
      {technicalDialog ? (
        <TechnicalJsonDialog item={technicalDialog} onClose={() => setTechnicalDialog(null)} />
      ) : null}
    </Stack>
  );
}

function DocumentHistoryCard({
  item,
  onRollback,
  onViewTechnical,
  onViewAfter,
  onViewBefore,
}: {
  item: DocumentHistoryItem;
  onRollback: () => void;
  onViewTechnical: () => void;
  onViewAfter: () => void;
  onViewBefore: () => void;
}) {
  const detailCount = Array.isArray(item.after.icTransDetail) ? item.after.icTransDetail.length : 0;
  return (
    <Paper component="article" variant="outlined" sx={{ p: 1 }}>
      <Stack spacing={1}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75} sx={{ justifyContent: "space-between" }}>
          <Box>
            <Typography color="text.secondary" variant="caption">Snapshot #{item.snapshotId}</Typography>
            <SectionTitle level="h3">{`${item.originalDocNo} → ${item.currentDocNo || "-"}`}</SectionTitle>
          </Box>
          <Stack direction="row" spacing={0.75}>
            <StatusBadge tone={documentHistoryStatusTone(item)}>{documentHistoryStatusLabel(item)}</StatusBadge>
            <StatusBadge>{formatDateTime(item.createdAt)}</StatusBadge>
          </Stack>
        </Stack>
        <Box sx={{ display: "grid", columnGap: 1.5, rowGap: 0.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" } }}>
          <DocumentFact label="เอกสารเดิม" nowrap={false} value={item.originalDocNo} />
          <DocumentFact label="เอกสารใหม่" nowrap={false} value={item.currentDocNo || "-"} strong />
          <DocumentFact label="ผู้ทำรายการ" value={item.createdBy || "-"} />
          <DocumentFact label="จำนวนสินค้า" value={`${detailCount}`} />
        </Box>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
          <AppButton onClick={onViewBefore} size="small" sx={auditActionButtonSx}>ดูบิลเดิม</AppButton>
          <AppButton onClick={onViewAfter} size="small" sx={auditActionButtonSx}>ดูบิลใหม่</AppButton>
          <AppButton onClick={onViewTechnical} size="small" sx={auditActionButtonSx}>ข้อมูลเทคนิค</AppButton>
          <Button color="error" disabled={Boolean(item.rolledBackAt)} onClick={onRollback} size="small" sx={auditActionButtonSx} variant="outlined">ย้อนกลับ</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function TechnicalJsonDialog({ item, onClose }: { item: DocumentHistoryItem; onClose: () => void }) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const sections = useMemo(() => technicalJsonSections(item), [item]);
  const active = sections[tab] || sections[0];
  const jsonComponents = useMemo(() => createJsonDiffComponents(active.diff), [active.diff]);
  const hasDiff = active.diff.size > 0;

  async function copyActiveJson() {
    try {
      await navigator.clipboard?.writeText(formatJSON(active.value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      toast("คัดลอก JSON เรียบร้อย", "success");
    } catch {
      toast("คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตเข้าถึงคลิปบอร์ด", "error");
    }
  }

  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="lg" open onClose={onClose}>
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <SectionTitle level="h2" noWrap>
            ข้อมูลเทคนิค • Snapshot #{item.snapshotId} • {item.originalDocNo} → {item.currentDocNo || "-"}
          </SectionTitle>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexShrink: 0 }}>
            <AppButton onClick={() => void copyActiveJson()} size="small" startIcon={<Copy size={14} />}>
              {copied ? "คัดลอกแล้ว" : "คัดลอก JSON"}
            </AppButton>
            <IconButton aria-label="ปิดข้อมูลเทคนิค" onClick={onClose} size="small" type="button">
              <X size={16} />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider", px: { xs: 1, sm: 2 } }}>
          <Tabs
            allowScrollButtonsMobile
            onChange={(_, value) => setTab(value)}
            scrollButtons="auto"
            value={tab}
            variant="scrollable"
          >
            {sections.map((section) => (
              <Tab key={section.label} label={section.label} />
            ))}
          </Tabs>
        </Box>
        <Box sx={{ bgcolor: "#fbfcfd", maxHeight: { xs: "calc(100vh - 154px)", sm: "70vh" }, overflow: "auto", p: { xs: 1.25, sm: 2 } }}>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", mb: 1 }}>
            {hasDiff ? (
              <>
                <DiffLegend status="changed" />
                <DiffLegend status="added" />
                <DiffLegend status="removed" />
              </>
            ) : (
              <Typography color="text.secondary" variant="caption">ชุดนี้ไม่มี field ที่เปลี่ยนจากข้อมูลก่อนหน้า</Typography>
            )}
          </Stack>
          <JsonView
            collapsed={1}
            components={jsonComponents}
            displayDataTypes={false}
            enableClipboard
            indentWidth={18}
            keyName={active.keyName}
            objectSortKeys
            shortenTextAfterLength={80}
            style={{
              ...jsonViewLightTheme,
              "--w-rjv-background-color": "transparent",
              "--w-rjv-font-family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 13,
              lineHeight: 1.55,
            } as CSSProperties}
            value={jsonViewObject(active.value)}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Typography color="text.secondary" variant="caption">
          แสดงข้อมูลดิบตาม JSON.stringify สำหรับตรวจสอบและดีบัก
        </Typography>
        <AppButton onClick={onClose}>ปิด</AppButton>
      </DialogActions>
    </Dialog>
  );
}

function technicalJsonSections(item: DocumentHistoryItem) {
  const beforeHeaderDiff = buildJsonDiff(item.before.icTrans, item.after.icTrans, "before");
  const afterHeaderDiff = buildJsonDiff(item.before.icTrans, item.after.icTrans, "after");
  const beforeDetailDiff = buildDetailJsonDiff(item.before.icTransDetail, item.after.icTransDetail, "before");
  const afterDetailDiff = buildDetailJsonDiff(item.before.icTransDetail, item.after.icTransDetail, "after");
  return [
    { diff: beforeHeaderDiff, label: "บิลเดิม", keyName: "before.ic_trans", value: item.before.icTrans },
    { diff: afterHeaderDiff, label: "บิลใหม่", keyName: "after.ic_trans", value: item.after.icTrans },
    { diff: beforeDetailDiff, label: "สินค้าเดิม", keyName: "before.ic_trans_detail", value: item.before.icTransDetail },
    { diff: afterDetailDiff, label: "สินค้าใหม่", keyName: "after.ic_trans_detail", value: item.after.icTransDetail },
    {
      diff: new Map(),
      label: "สรุป",
      keyName: "snapshot",
      value: {
        snapshotId: item.snapshotId,
        batchId: item.batchId,
        originalDocNo: item.originalDocNo,
        currentDocNo: item.currentDocNo,
        status: item.status,
        message: item.message,
        createdBy: item.createdBy,
        createdAt: item.createdAt,
        rolledBackAt: item.rolledBackAt || null,
        afterSummary: item.afterSummary || null,
      },
    },
  ];
}

function DiffLegend({ status }: { status: JsonDiffStatus }) {
  const label = status === "added" ? "เพิ่มใหม่" : status === "removed" ? "ค่าเดิม/ถูกลบ" : "แก้ไข";
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: jsonDiffColors[status].background,
        border: `1px solid ${jsonDiffColors[status].border}`,
        color: jsonDiffColors[status].text,
      }}
      variant="outlined"
    />
  );
}

function jsonViewObject(value: unknown): object {
  if (value && typeof value === "object") return value as object;
  return { value };
}

const jsonDiffPathSeparator = "\u001f";
const jsonDiffColors: Record<JsonDiffStatus, { background: string; border: string; text: string }> = {
  added: { background: "#ecfdf3", border: "#8bd5a4", text: "#166534" },
  changed: { background: "#fff8db", border: "#f0cf6a", text: "#713f12" },
  removed: { background: "#fff0ee", border: "#f2a69b", text: "#991b1b" },
};

type JsonViewComponents = NonNullable<JsonViewProps<object>["components"]>;
type JsonValueRenderer = NonNullable<JsonViewComponents["value"]>;

function createJsonDiffComponents(diff: JsonDiffMap): JsonViewComponents {
  const objectKey: NonNullable<SemicolonProps["render"]> = (props) => {
    const {
      children,
      className,
      highlightUpdates: _highlightUpdates,
      keyName: _keyName,
      label: _label,
      namespace,
      parentName: _parentName,
      quotes: _quotes,
      style,
      value: _value,
    } = props;
    const status = jsonDiffStatusForPath(diff, namespace);
    return (
      <span
        className={className}
        style={{
          ...style,
          ...(status ? jsonDiffInlineStyle(status) : null),
        }}
        title={status ? jsonDiffTitle(status) : undefined}
      >
        {children}
      </span>
    );
  };

  const value: JsonValueRenderer = (props) => {
    const {
      children,
      className,
      data: _data,
      keyName: _keyName,
      namespace,
      parentValue: _parentValue,
      quotes: _quotes,
      setValue: _setValue,
      style,
      type: _type,
      value: _value,
      visible: _visible,
    } = props;
    const status = jsonDiffStatusForPath(diff, namespace);
    return (
      <span
        className={className}
        style={{
          ...style,
          ...(status ? jsonDiffInlineStyle(status) : null),
        }}
        title={status ? jsonDiffTitle(status) : undefined}
      >
        {children}
      </span>
    );
  };

  return { objectKey, value };
}

function jsonDiffInlineStyle(status: JsonDiffStatus): CSSProperties {
  return {
    backgroundColor: jsonDiffColors[status].background,
    border: `1px solid ${jsonDiffColors[status].border}`,
    borderRadius: 4,
    color: jsonDiffColors[status].text,
    padding: "1px 3px",
  };
}

function jsonDiffTitle(status: JsonDiffStatus) {
  if (status === "added") return "เพิ่มใหม่หลังแก้ไข";
  if (status === "removed") return "ค่าเดิมหรือข้อมูลที่ถูกลบ";
  return "ค่าเปลี่ยนจากก่อนแก้ไข";
}

function buildJsonDiff(before: unknown, after: unknown, side: "before" | "after") {
  const diff: JsonDiffMap = new Map();
  collectJsonDiff(before, after, side, [], diff);
  return diff;
}

function buildDetailJsonDiff(before: Array<Record<string, unknown>>, after: Array<Record<string, unknown>>, side: "before" | "after") {
  const diff: JsonDiffMap = new Map();
  const beforeMap = indexedDetailMap(before);
  const afterMap = indexedDetailMap(after);
  const rows = side === "before" ? before : after;
  const comparison = side === "before" ? afterMap : beforeMap;
  const missingStatus: JsonDiffStatus = side === "before" ? "removed" : "added";

  rows.forEach((row, index) => {
    const identity = detailRowIdentity(row, index);
    const other = comparison.get(identity);
    if (!other) {
      markJsonSubtree(row, [index], missingStatus, diff);
      return;
    }
    if (side === "before") collectJsonDiff(row, other.row, side, [index], diff);
    else collectJsonDiff(other.row, row, side, [index], diff);
  });
  return diff;
}

function collectJsonDiff(before: unknown, after: unknown, side: "before" | "after", path: Array<string | number>, diff: JsonDiffMap) {
  if (jsonValuesEqual(before, after)) return;

  if (isJsonRecord(before) && isJsonRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    keys.forEach((key) => {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      if (!hasBefore && side === "after") {
        markJsonSubtree(after[key], [...path, key], "added", diff);
        return;
      }
      if (!hasAfter && side === "before") {
        markJsonSubtree(before[key], [...path, key], "removed", diff);
        return;
      }
      if (hasBefore && hasAfter) collectJsonDiff(before[key], after[key], side, [...path, key], diff);
    });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let index = 0; index < max; index += 1) {
      if (index >= before.length && side === "after") {
        markJsonSubtree(after[index], [...path, index], "added", diff);
        continue;
      }
      if (index >= after.length && side === "before") {
        markJsonSubtree(before[index], [...path, index], "removed", diff);
        continue;
      }
      collectJsonDiff(before[index], after[index], side, [...path, index], diff);
    }
    return;
  }

  if (path.length) diff.set(jsonDiffPathKey(path), "changed");
}

function markJsonSubtree(value: unknown, path: Array<string | number>, status: JsonDiffStatus, diff: JsonDiffMap) {
  diff.set(jsonDiffPathKey(path), status);
  if (Array.isArray(value)) {
    value.forEach((item, index) => markJsonSubtree(item, [...path, index], status, diff));
    return;
  }
  if (isJsonRecord(value)) {
    Object.entries(value).forEach(([key, child]) => markJsonSubtree(child, [...path, key], status, diff));
  }
}

function jsonDiffStatusForPath(diff: JsonDiffMap, namespace?: Array<string | number>) {
  if (!namespace?.length) return null;
  const key = jsonDiffPathKey(namespace);
  const exact = diff.get(key);
  if (exact) return exact;
  for (const [changedPath, status] of diff) {
    if (changedPath.startsWith(`${key}${jsonDiffPathSeparator}`)) return status;
  }
  return null;
}

function jsonDiffPathKey(path: Array<string | number>) {
  return path.map(String).join(jsonDiffPathSeparator);
}

function indexedDetailMap(rows: Array<Record<string, unknown>>) {
  const map = new Map<string, { row: Record<string, unknown>; index: number }>();
  rows.forEach((row, index) => map.set(detailRowIdentity(row, index), { row, index }));
  return map;
}

function detailRowIdentity(row: Record<string, unknown>, index: number) {
  const line = readJsonField(row, ["line_number", "lineNumber", "line_no", "lineNo"]);
  const item = readJsonField(row, ["item_code", "itemCode", "barcode"]);
  return `${line ?? index}:${item ?? ""}`;
}

function readJsonField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return formatJSON(left) === formatJSON(right);
}

function formatJSON(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return `${value}`;
  }
}

function documentHistoryStatusLabel(item: Pick<DocumentHistoryItem, "status" | "rolledBackAt">) {
  const status = (item.status || "").toLowerCase();
  if (item.rolledBackAt || status === "rolled_back" || status.includes("rollback")) return "ย้อนกลับแล้ว";
  if (status === "applied" || status === "done" || status.includes("apply")) return "ส่งเข้า SML แล้ว";
  if (status === "failed" || status.includes("fail") || status.includes("error")) return "ส่งไม่สำเร็จ";
  if (status === "processing" || status.includes("process")) return "กำลังส่ง";
  if (status === "skipped" || status.includes("skip")) return "ข้ามรายการ";
  if (status === "ready") return "พร้อมส่ง";
  return "บันทึกแล้ว";
}

function documentHistoryStatusTone(item: Pick<DocumentHistoryItem, "status" | "rolledBackAt">): "neutral" | "success" | "danger" {
  const status = (item.status || "").toLowerCase();
  if (item.rolledBackAt || status === "rolled_back" || status.includes("rollback") || status === "applied" || status === "done" || status.includes("apply")) return "success";
  if (status === "failed" || status.includes("fail") || status.includes("error")) return "danger";
  return "neutral";
}
