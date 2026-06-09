import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Slide,
  Stack,
  Table,
  TableBody,
  Tooltip,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, HelpCircle, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react";
import type {
  BulkApplyBatchProgress,
  BulkDocumentChangeItem,
  BulkDocumentChangeRequest,
  BulkDocumentChangeResult,
  DatabaseStatus,
  DocEdit,
  DocFormat,
  DocumentChangePreview,
  DocumentDetailLine,
  DocumentSummary,
  LineEdit,
  NewLineInput,
  Option,
  PagedDocuments,
  PreviewChangeItem,
  ProductOption,
  ProductUnit,
  UserClaims,
} from "../types";
import { apiGet, apiPost } from "../lib/api";
import {
  appStatusLabel,
  buildPreviewChangeItems,
  changedPaperSx,
  formatDate,
  formatDocumentTime,
  formatMoney,
  formatSmlDate,
  maskInternalRemark,
  moneyValueChanged,
  numericValue,
  saleTypeLabels,
  taxTypeLabels,
  valueChanged,
} from "../lib/format";
import { AppButton, EmptyState, PageLoading, StatusBadge } from "../components/ui";
import { DocCode, EmphasisText, Money, SectionTitle, compactActionButtonSx } from "../components/ui/typography";
import {
  DocumentFact,
  InvoiceDetailDialog,
  RiskConfirmDialog,
  SummaryLine,
  TotalLine,
} from "../components/invoice-dialog";
import { appTheme } from "../theme";
import { useToast } from "../contexts/toast";
import { LazyDataGrid, thaiGridLocaleText } from "../components/data-grid";

const isoDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function formatFilterDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function parseFilterDate(value: string) {
  const trimmed = value.trim();
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const compactMatch = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  const match = slashMatch || compactMatch;
  if (!match) return "";

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return "";
  }

  return isoDate(parsed);
}

function normalizeFilterDateInput(value: string) {
  return value.replace(/[^\d/]/g, "").slice(0, 10);
}

function DateFilterField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [displayValue, setDisplayValue] = useState(() => formatFilterDate(value));
  const nativeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDisplayValue(formatFilterDate(value));
  }, [value]);

  function commitDisplayValue(nextValue = displayValue) {
    const parsed = parseFilterDate(nextValue);
    if (!parsed) {
      setDisplayValue(formatFilterDate(value));
      return;
    }
    setDisplayValue(formatFilterDate(parsed));
    if (parsed !== value) onChange(parsed);
  }

  function updateDisplayValue(rawValue: string) {
    const nextValue = normalizeFilterDateInput(rawValue);
    setDisplayValue(nextValue);
    const parsed = parseFilterDate(nextValue);
    if (parsed) {
      setDisplayValue(formatFilterDate(parsed));
      if (parsed !== value) onChange(parsed);
    }
  }

  function openNativePicker() {
    const picker = nativeInputRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.click();
  }

  return (
    <TextField
      label={label}
      onBlur={() => commitDisplayValue()}
      onChange={(event) => updateDisplayValue(event.target.value)}
      placeholder="dd/MM/yyyy"
      size="small"
      value={displayValue}
      slotProps={{
        htmlInput: {
          inputMode: "numeric",
          pattern: "\\d{2}/\\d{2}/\\d{4}",
        },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Box component="span" sx={{ display: "inline-flex", position: "relative" }}>
                <IconButton
                  aria-label={`เปิดปฏิทิน${label}`}
                  edge="end"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openNativePicker}
                  size="small"
                >
                  <CalendarDays size={16} />
                </IconButton>
                <Box
                  component="input"
                  ref={nativeInputRef}
                  aria-hidden
                  tabIndex={-1}
                  type="date"
                  value={value}
                  onChange={(event) => {
                    onChange(event.target.value);
                    setDisplayValue(formatFilterDate(event.target.value));
                  }}
                  sx={{ height: 1, opacity: 0, pointerEvents: "none", position: "absolute", right: 0, top: 0, width: 1 }}
                />
              </Box>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
const today = new Date();
const initialFromDate = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));

type PerDocEditState = {
  removed: Set<string>;
  added: NewLineInput[];
  lineEdits: Map<number, LineEditDraft>;
  remark?: string;
};

type LineEditDraft = {
  qty?: string;
  price?: string;
  discount?: string;
};

const emptyPerDocEdit = (): PerDocEditState => ({ removed: new Set<string>(), added: [], lineEdits: new Map<number, LineEditDraft>() });
const initialToDate = isoDate(today);

// Silence unused import warnings for helpers re-exported for parity with previous inline implementation.
void numericValue;
void appStatusLabel;

function BulkInvoiceEditPage({ status: _status, user }: { status: DatabaseStatus | null; user: UserClaims }) {
  void _status;
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const isAdmin = user.role === "Admin";
  const toast = useToast();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inEditable = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<PagedDocuments | null>(null);
  const [docFormats, setDocFormats] = useState<DocFormat[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [docItems, setDocItems] = useState<ProductOption[]>([]);
  const [docItemsLoading, setDocItemsLoading] = useState(false);
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") || initialFromDate);
  const [toDate, setToDate] = useState(() => searchParams.get("to") || initialToDate);
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [selectedDocNos, setSelectedDocNos] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  // Per-doc line edits (remove existing + add new) authored in the preview screen.
  // Map key = original docNo (matches BulkDocumentChangeItem.docNo).
  const [perDocEdits, setPerDocEdits] = useState<Map<string, PerDocEditState>>(new Map());
  const [docNoOverrides, setDocNoOverrides] = useState<Record<string, string>>({});
  const [excludedDocNos, setExcludedDocNos] = useState<Set<string>>(new Set());
  // Sentinels for bulk-edit: -1 → "คงค่าเดิมของแต่ละบิล".
  const [inquiryType, setInquiryType] = useState(-1);
  const [vatType, setVatType] = useState(-1);
  const [preview, setPreview] = useState<BulkDocumentChangeResult | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewDialogDocNo, setPreviewDialogDocNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [finalApplyConfirmOpen, setFinalApplyConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [detailDocNo, setDetailDocNo] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [applyProgress, setApplyProgress] = useState<BulkApplyBatchProgress | null>(null);
  const [applyProgressOpen, setApplyProgressOpen] = useState(false);
  const handledApplyBatchesRef = useRef<Set<number>>(new Set());

  const items = documents?.items || [];
  const detailDocument = items.find((item) => item.docNo === detailDocNo) || items.find((item) => selectedDocNos.includes(item.docNo)) || items[0] || null;
  const selectedCustomerOption = customers.find((item) => item.code === selectedCustomer);
  const selectedCustomerValue = selectedCustomer
    ? selectedCustomerOption || { code: selectedCustomer, name: selectedCustomer }
    : null;
  // ผู้ใช้เลือกอย่างน้อย 1 อย่างก็พรีวิวได้ (ไม่บังคับลูกหนี้/format)
  const hasAnyChange =
    !!selectedCustomer ||
    !!selectedFormat ||
    inquiryType !== -1 ||
    vatType !== -1;
  const canPreview = selectedDocNos.length > 0;
  const workflowHint = canPreview
    ? `พร้อมพรีวิว ${selectedDocNos.length} บิล (ฟิลด์ที่เว้นว่าง = ใช้ค่าเดิมของแต่ละบิล)`
    : selectedDocNos.length
      ? "กดพรีวิวเพื่อแก้หมายเหตุรายบิล หรือเลือกการแก้ไขหัวบิลก่อน"
      : "เลือกบิลจากตารางก่อน แล้วค่อยตั้งค่าการแก้ไข";
  const autoExcludedPaymentDocNos = useMemo(() => {
    const next = new Set<string>();
    if (!preview) return next;
    preview.items.forEach((item) => {
      if ((item.status !== "ready" && item.status !== "warning") || !item.preview?.paymentBefore) return;
      const totals = recomputedTotalsForItem(item, perDocEdits);
      if (evaluatePaymentPreviewPolicy(item.preview.paymentBefore, totals.totalAmount).blockedReason) {
        next.add(item.docNo);
      }
    });
    return next;
  }, [preview, perDocEdits]);
  const effectiveExcludedDocNos = useMemo(() => {
    const next = new Set(excludedDocNos);
    autoExcludedPaymentDocNos.forEach((docNo) => next.add(docNo));
    return next;
  }, [excludedDocNos, autoExcludedPaymentDocNos]);
  const activePreviewItems = preview?.items.filter((item) => !effectiveExcludedDocNos.has(item.docNo)) || [];
  const readyPreviewCount = activePreviewItems.filter((item) => item.status === "ready").length || 0;
  const warningPreviewCount = activePreviewItems.filter((item) => item.status === "warning").length || 0;
  const missingCustomerWarningItems = activePreviewItems.filter((item) => item.status === "warning" && isMissingCustomerWarning(item.message));
  const blockedPreviewCount = activePreviewItems.filter((item) => item.status === "blocked" || item.status === "failed" || item.status === "skipped").length || 0;
  const writablePreviewCount = readyPreviewCount + warningPreviewCount;
  const excludedPreviewCount = preview?.items.filter((item) => effectiveExcludedDocNos.has(item.docNo)).length || 0;
  const hasActivePerDocChanges = Array.from(perDocEdits.keys()).some((docNo) => !effectiveExcludedDocNos.has(docNo));
  const hasApplyChanges = hasAnyChange || hasActivePerDocChanges;
  const applyIsActive = Boolean(applyProgress && isActiveBatchStatus(applyProgress.status));

  // Per-doc edit helpers
  function setPerDocEditEntry(
    docNo: string,
    updater: (current: PerDocEditState) => PerDocEditState,
  ) {
    setPerDocEdits((m) => {
      const next = new Map(m);
      const cur = next.get(docNo) ?? emptyPerDocEdit();
      const updated = updater(cur);
      if (updated.removed.size === 0 && updated.added.length === 0 && updated.lineEdits.size === 0 && updated.remark === undefined) {
        next.delete(docNo);
      } else {
        next.set(docNo, updated);
      }
      return next;
    });
  }
  function effectiveLineCount(item: BulkDocumentChangeItem): number {
    if (!item.preview) return 0;
    const edit = perDocEdits.get(item.docNo);
    const remainingCount = edit
      ? item.preview.remainingLines.filter((l) => !edit.removed.has(l.itemCode)).length
      : item.preview.remainingLines.length;
    const addedCount = edit ? edit.added.length : 0;
    return remainingCount + addedCount;
  }
  const hasEmptyAfterEdits = Boolean(preview && preview.items.some((item) => {
    if (effectiveExcludedDocNos.has(item.docNo)) return false;
    if (item.status !== "ready" && item.status !== "warning") return false;
    return effectiveLineCount(item) === 0;
  }));
  const hasInvalidLineEdits = Boolean(preview && preview.items.some((item) => {
    if (effectiveExcludedDocNos.has(item.docNo)) return false;
    if ((item.status !== "ready" && item.status !== "warning") || !item.preview) return false;
    const edit = perDocEdits.get(item.docNo);
    if (!edit) return false;
    return item.preview.remainingLines.some((line) => {
      if (edit.removed.has(line.itemCode)) return false;
      const lineEdit = edit.lineEdits.get(line.rowOrder);
      return Boolean(lineEdit && lineEditError(line, lineEdit));
    });
  }));
  const hasPaymentAfterEditsBlocked = Boolean(preview && preview.items.some((item) => {
    if (effectiveExcludedDocNos.has(item.docNo)) return false;
    if ((item.status !== "ready" && item.status !== "warning") || !item.preview?.paymentBefore) return false;
    const totals = recomputedTotalsForItem(item, perDocEdits);
    return Boolean(evaluatePaymentPreviewPolicy(item.preview.paymentBefore, totals.totalAmount).error);
  }));
  const readyToApply = Boolean(isAdmin && preview && hasApplyChanges && writablePreviewCount > 0 && blockedPreviewCount === 0 && busy === false && !hasEmptyAfterEdits && !hasInvalidLineEdits && !hasPaymentAfterEditsBlocked);
  const customerQuery = customerSearch.trim();
  const showCustomerEmpty = customerQuery.length >= 2 && !selectedCustomer && !customerSearching && customers.length === 0;
  const documentGridColumns = useMemo<GridColDef<DocumentSummary>[]>(() => [
    {
      field: "docDate",
      headerName: "วันที่เอกสาร",
      width: 112,
      renderCell: (params) => formatSmlDate(params.row.docDate),
    },
    {
      field: "docTime",
      headerName: "เวลา",
      width: 78,
      renderCell: (params) => formatDocumentTime(params.row.docTime),
    },
    {
      field: "docNo",
      headerName: "เลขที่เอกสาร",
      minWidth: 136,
      flex: 0.9,
      renderCell: (params) => <DocCode value={params.row.docNo} />,
    },
    {
      field: "customerCode",
      headerName: "รหัสลูกหนี้",
      width: 104,
      renderCell: (params) => params.row.customerCode || "-",
    },
    {
      field: "remark",
      headerName: "หมายเหตุ",
      minWidth: 160,
      flex: 1.4,
      renderCell: (params) => {
        const text = maskInternalRemark(params.row.remark || "");
        if (!text) return <Typography color="text.disabled" variant="body2">—</Typography>;
        return <Typography noWrap title={text} variant="body2">{text}</Typography>;
      },
    },
    {
      align: "right",
      field: "totalAmount",
      headerAlign: "right",
      headerName: "ยอดสุทธิ",
      width: 112,
      renderCell: (params) => <Money value={formatMoney(params.row.totalAmount)} />,
    },
    {
      align: "center",
      field: "actions",
      filterable: false,
      headerAlign: "center",
      headerName: "",
      sortable: false,
      width: 48,
      renderCell: (params) => (
        <Tooltip arrow title="ดูรายละเอียดบิล">
          <IconButton
            aria-label="ดูรายละเอียดบิล"
            onClick={(event) => {
              event.stopPropagation();
              setDetailDocNo(params.row.docNo);
              setDetailOpen(true);
            }}
            size="small"
          >
            <ChevronRight size={18} />
          </IconButton>
        </Tooltip>
      ),
    },
  ], []);
  const documentGridSelectionModel = useMemo<GridRowSelectionModel>(() => ({
    type: "include",
    ids: new Set(selectedDocNos),
  }), [selectedDocNos]);

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    const q = customerSearch.trim();
    if (selectedCustomer || q.length < 2) {
      setCustomerSearching(false);
      return;
    }
    const timer = window.setTimeout(() => void searchCustomers(q), 250);
    return () => window.clearTimeout(timer);
  }, [customerSearch, selectedCustomer]);

  useEffect(() => {
    if (!applyProgress || !isActiveBatchStatus(applyProgress.status)) return;
    const timer = window.setInterval(() => void refreshApplyProgress(applyProgress.batchId), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyProgress?.batchId, applyProgress?.status]);

  useEffect(() => {
    if (selectedDocNos.length === 0) {
      setDocItems([]);
      return;
    }
    let cancelled = false;
    setDocItemsLoading(true);
    (async () => {
      const response = await apiPost<{ items: ProductOption[] }>("/api/v1/documents/items", { docNos: selectedDocNos });
      if (cancelled) return;
      const items = response.success && response.data ? response.data.items : [];
      setDocItems(items);
      setDocItemsLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocNos]);

  async function loadInitial() {
    setLoading(true);
    const [docs, formats, customerList] = await Promise.all([
      apiGet<PagedDocuments>(documentsURL(fromDate, toDate, search)),
      apiGet<{ items: DocFormat[] }>("/api/v1/master/doc-formats"),
      apiGet<{ items: Option[] }>("/api/v1/master/customers?limit=12"),
    ]);
    if (docs.success && docs.data) setDocuments(docs.data);
    if (formats.success && formats.data) {
      setDocFormats(formats.data.items);
      // Do NOT auto-pick a default — leave as "" (= "ใช้ค่าเดิมของแต่ละบิล")
    }
    if (customerList.success && customerList.data) setCustomers(customerList.data.items);
    setLoading(false);
  }

  async function loadDocuments(nextSearch = search, nextFrom = fromDate, nextTo = toDate) {
    if (!nextFrom || !nextTo) return;
    if (nextFrom > nextTo) {
      setMessage("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด");
      return;
    }
    setLoading(true);
    setMessage("");
    setPreview(null);
    setDocNoOverrides({});
    const nextParams = new URLSearchParams();
    nextParams.set("from", nextFrom);
    nextParams.set("to", nextTo);
    if (nextSearch.trim()) nextParams.set("q", nextSearch.trim());
    setSearchParams(nextParams, { replace: true });
    const response = await apiGet<PagedDocuments>(documentsURL(nextFrom, nextTo, nextSearch));
    if (response.success && response.data) {
      setDocuments(response.data);
      setSelectedDocNos((current) => current.filter((docNo) => response.data?.items.some((item) => item.docNo === docNo)));
    } else {
      setDocuments(null);
      setMessage(response.error?.detail || response.message || "โหลดรายการบิลไม่สำเร็จ");
    }
    setLoading(false);
  }

  async function clearSearchText() {
    if (!search) return;
    setSearch("");
    resetPreview();
  }

  async function refreshDocumentsAfterApply(successMessage: string) {
    setLoading(true);
    const response = await apiGet<PagedDocuments>(documentsURL(fromDate, toDate, search));
    if (response.success && response.data) {
      setDocuments(response.data);
      setSelectedDocNos([]);
      setPreview(null);
      setPreviewDialogOpen(false);
      setPreviewDialogDocNo("");
      setDocNoOverrides({});
      setExcludedDocNos(new Set());
      setMessage(successMessage);
    } else {
      setMessage(`${successMessage} แต่โหลดรายการล่าสุดไม่สำเร็จ: ${response.error?.detail || response.message || "ไม่ทราบสาเหตุ"}`);
    }
    setLoading(false);
  }

  async function refreshApplyProgress(batchId: number) {
    const response = await apiGet<BulkApplyBatchProgress>(`/api/v1/documents/bulk/batches/${batchId}`);
    if (!response.success || !response.data) {
      setMessage(response.error?.detail || response.message || "โหลดสถานะส่งเข้า SML ไม่สำเร็จ");
      return;
    }
    setApplyProgress(response.data);
    if (!isActiveBatchStatus(response.data.status) && !handledApplyBatchesRef.current.has(response.data.batchId)) {
      handledApplyBatchesRef.current.add(response.data.batchId);
      setBusy(false);
      setPreview(response.data);
      setPreviewDialogDocNo(response.data.items.find((item) => item.status === "applied")?.docNo || response.data.items[0]?.docNo || "");
      const summary = `ส่งเข้า SML สำเร็จ ${response.data.appliedCount} บิล${response.data.failedCount ? `, ส่งไม่สำเร็จ ${response.data.failedCount} บิล` : ""}${response.data.skippedCount ? `, ยังไม่ดำเนินการ ${response.data.skippedCount} บิล` : ""}`;
      toast(summary, response.data.failedCount || response.data.skippedCount || response.data.blockedCount ? "warning" : "success");
      await refreshDocumentsAfterApply(summary);
    }
  }

  async function searchCustomers(q = customerSearch) {
    setCustomerSearching(true);
    const response = await apiGet<{ items: Option[] }>(`/api/v1/master/customers?q=${encodeURIComponent(q)}&limit=20`);
    if (response.success && response.data) setCustomers(response.data.items);
    else setCustomers([]);
    setCustomerSearching(false);
  }

  function selectCustomer(item: Option) {
    setSelectedCustomer(item.code);
    setCustomerSearch(`${item.code} - ${item.name}`);
    setCustomers([item]);
    resetPreview();
  }

  function clearCustomer() {
    setSelectedCustomer("");
    setCustomerSearch("");
    resetPreview();
  }

  function resetPreview() {
    setPreview(null);
    setPreviewDialogOpen(false);
    setPreviewDialogDocNo("");
    setDocNoOverrides({});
    setExcludedDocNos(new Set());
    setMessage("");
  }

  function toggleDoc(docNo: string) {
    resetPreview();
    setSelectedDocNos((current) => current.includes(docNo) ? current.filter((item) => item !== docNo) : [...current, docNo]);
  }

  function clearSelection() {
    resetPreview();
    setSelectedDocNos([]);
    setSelectedCustomer("");
    setCustomerSearch("");
    setPerDocEdits(new Map());
    setSelectedFormat("");
    setInquiryType(-1);
    setVatType(-1);
  }

  function updateSelectionFromGrid(model: GridRowSelectionModel) {
    resetPreview();
    const visibleDocNos = new Set(items.map((item) => item.docNo));
    const selectedVisibleDocNos = model.type === "include"
      ? Array.from(model.ids).map(String).filter((docNo) => visibleDocNos.has(docNo))
      : items.map((item) => item.docNo).filter((docNo) => !model.ids.has(docNo));

    setSelectedDocNos((current) => {
      const hiddenSelection = current.filter((docNo) => !visibleDocNos.has(docNo));
      return Array.from(new Set([...hiddenSelection, ...selectedVisibleDocNos]));
    });
  }

  function buildBulkRequest(overrides: Record<string, string> = docNoOverrides, excluded: Set<string> = effectiveExcludedDocNos): BulkDocumentChangeRequest {
    const activeDocNos = selectedDocNos.filter((docNo) => !excluded.has(docNo));
    const perDocEditsArr: DocEdit[] = [];
    perDocEdits.forEach((edits, docNo) => {
      if (!activeDocNos.includes(docNo)) return;
      const removed = Array.from(edits.removed);
      const lineEdits: LineEdit[] = Array.from(edits.lineEdits.entries())
        .map(([rowOrder, edit]) => {
          const payload: LineEdit = { rowOrder };
          if (edit.qty !== undefined) payload.qty = edit.qty.trim();
          if (edit.price !== undefined) payload.price = edit.price.trim();
          if (edit.discount !== undefined) payload.discount = edit.discount.trim();
          return payload;
        })
        .filter((edit) => edit.rowOrder > 0 && (edit.qty !== undefined || edit.price !== undefined || edit.discount !== undefined));
      if (removed.length === 0 && edits.added.length === 0 && lineEdits.length === 0 && edits.remark === undefined) return;
      perDocEditsArr.push({
        docNo,
        removeItemCodes: removed,
        addedLines: edits.added,
        ...(lineEdits.length > 0 ? { lineEdits } : {}),
        ...(edits.remark !== undefined ? { remark: edits.remark } : {}),
      });
    });
    const overrideEntries = Object.entries(overrides).filter(([docNo, newDocNo]) => activeDocNos.includes(docNo) && newDocNo);
    const filteredOverrides = Object.fromEntries(overrideEntries);
    return {
      docNos: activeDocNos,
      docFormatCode: selectedFormat,
      customerCode: selectedCustomer,
      inquiryType,
      vatType,
      remark: "",
      removeItemCodes: [],
      ...(perDocEditsArr.length > 0 ? { perDocEdits: perDocEditsArr } : {}),
      ...(overrideEntries.length > 0 ? { docNoOverrides: filteredOverrides } : {}),
    };
  }

  async function previewBulk() {
    if (!canPreview) {
      setMessage("เลือกบิลอย่างน้อย 1 บิลก่อนพรีวิว");
      return;
    }
    setBusy(true);
    setPreviewing(true);
    setMessage("");
    setDocNoOverrides({});
    try {
      const response = await apiPost<BulkDocumentChangeResult>("/api/v1/documents/bulk/preview-change", buildBulkRequest({}, new Set()));
      if (response.success && response.data) {
        // Reset per-doc edits so the new preview starts from a clean slate.
        setPerDocEdits(new Map());
        setExcludedDocNos(new Set());
        setPreview(response.data);
        setPreviewDialogDocNo(getInitialReviewDocNo(response.data.items));
        setPreviewDialogOpen(true);
      }
      else setMessage(response.error?.detail || response.message || "พรีวิวก่อนส่งเข้า SML ไม่สำเร็จ");
    }
    finally {
      setPreviewing(false);
      setBusy(false);
    }
  }

  // regenBlockedItem — re-preview เฉพาะบิลที่ blocked เพราะเลขซ้ำ
  // ดึง running-number ใหม่ก่อน แล้วส่งเป็น docNoOverrides เพื่อบังคับ
  // backend ใช้เลขนั้น (ไม่ให้ backend ออกเลขเองซ้ำอีก)
  async function regenBlockedItem(docNo: string, formatCode: string) {
    setBusy(true);
    setMessage("");
    try {
      // Step 1: get a fresh next doc_no from the DB (reads latest ic_trans)
      const rnResp = await apiGet<{ nextDocNo: string; latestDocNo: string; formatCode: string }>(
        `/api/v1/documents/running-number?formatCode=${encodeURIComponent(formatCode)}&sourceDocNo=${encodeURIComponent(docNo)}`,
      );
      if (!rnResp.success || !rnResp.data?.nextDocNo) {
        setMessage(rnResp.error?.detail || "ไม่สามารถออกเลขเอกสารใหม่ได้");
        return;
      }
      const nextDocNo = rnResp.data.nextDocNo;

      // Step 2: preview with the forced new doc_no so backend doesn't re-generate the same duplicate
      const base = buildBulkRequest();
      const req: BulkDocumentChangeRequest = {
        ...base,
        docNos: [docNo],
        docNoOverrides: { [docNo]: nextDocNo },
      };
      const prevResp = await apiPost<BulkDocumentChangeResult>("/api/v1/documents/bulk/preview-change", req);
      if (!prevResp.success || !prevResp.data) {
        setMessage(prevResp.error?.detail || "ตรวจสอบบิลใหม่ไม่สำเร็จ");
        return;
      }
      const updatedItem = prevResp.data.items[0];
      if (!updatedItem) return;
      // Merge item ที่ regen เข้า preview state เดิม (ไม่ reset บิลอื่น)
      setPreview((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((item) => (item.docNo === docNo ? updatedItem : item));
        const readyCount = items.filter((i) => i.status === "ready").length;
        const blockedCount = items.filter((i) => i.status === "blocked" || i.status === "failed").length;
        return { ...prev, items, readyCount, blockedCount };
      });
      if (updatedItem.status === "ready" || updatedItem.status === "warning") {
        setDocNoOverrides((current) => ({ ...current, [docNo]: updatedItem.newDocNo || nextDocNo }));
        toast(`ออกเลขใหม่ ${updatedItem.newDocNo} สำเร็จ`, "success");
      } else {
        setDocNoOverrides((current) => {
          const next = { ...current };
          delete next[docNo];
          return next;
        });
        toast(updatedItem.message || "ออกเลขใหม่แล้วแต่ยังมีปัญหา", "warning");
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk() {
    if (!preview || !readyToApply || !isAdmin) return;
    setBusy(true);
    setMessage("");
    const response = await apiPost<BulkApplyBatchProgress>("/api/v1/documents/bulk/apply-change/start", buildBulkRequest());
    if (response.success && response.data) {
      handledApplyBatchesRef.current.delete(response.data.batchId);
      setApplyProgress(response.data);
      setApplyProgressOpen(true);
      setConfirmApplyOpen(false);
      setFinalApplyConfirmOpen(false);
      toast(`เริ่มส่งเข้า SML ${response.data.totalCount} บิล`, "success");
    } else {
      const detail = response.error?.detail || response.message || "ส่งหลายบิลเข้า SML ไม่สำเร็จ";
      setMessage(detail);
      toast(detail, "error");
      setBusy(false);
    }
  }

  async function retryFailedBulk(batchId: number) {
    setBusy(true);
    setMessage("");
    const response = await apiPost<BulkApplyBatchProgress>(`/api/v1/documents/bulk/batches/${batchId}/retry-failed`, {});
    if (response.success && response.data) {
      handledApplyBatchesRef.current.delete(response.data.batchId);
      setApplyProgress(response.data);
      setApplyProgressOpen(true);
      toast(`เริ่มส่งซ้ำ ${response.data.totalCount} บิลที่ไม่สำเร็จ`, "success");
    } else {
      const detail = response.error?.detail || response.message || "ส่งซ้ำเฉพาะบิลที่ไม่สำเร็จไม่ได้";
      setMessage(detail);
      toast(detail, "error");
      setBusy(false);
    }
  }

  if (loading && !documents) return <PageLoading title="กำลังโหลดรายการบิลสำหรับแก้ไขบิล" />;

  return (
    <Stack spacing={1.5} sx={{ pb: selectedDocNos.length ? { xs: 11, sm: 8 } : 0 }}>
      {message ? <Alert severity={message.includes("สำเร็จ") || message.includes("เลือก") ? "success" : "warning"}>{message}</Alert> : null}

      <Box sx={{ alignItems: { sm: "flex-end" }, display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1, justifyContent: "space-between" }}>
        <Box>
          <Typography color="text.secondary" variant="body2">
            เลือกบิลในตารางด้านล่าง แล้วกด “ตั้งค่าและพรีวิว” เพื่อเปลี่ยนลูกค้า / ชุดเอกสาร หรือลบสินค้าพร้อมกันหลายใบ
          </Typography>
        </Box>
        <Typography color={loading ? "text.secondary" : "text.primary"} sx={{ fontWeight: 600, whiteSpace: "nowrap" }} variant="subtitle2">
          {loading ? "กำลังโหลด…" : `พบ ${(documents?.total ?? items.length).toLocaleString("th-TH")} บิล`}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ minWidth: 0, overflow: "hidden" }}>
        <Stack spacing={{ xs: 1.25, sm: 1.5 }} sx={{ p: { xs: 1.25, sm: 1.5 } }}>
          <Box sx={{ alignItems: "flex-start", display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", lg: "150px 150px minmax(220px, 1fr) auto" }, minWidth: 0 }}>
            <DateFilterField
              label="จากวันที่"
              onChange={(value) => { setFromDate(value); resetPreview(); }}
              value={fromDate}
            />
            <DateFilterField
              label="ถึงวันที่"
              onChange={(value) => { setToDate(value); resetPreview(); }}
              value={toDate}
            />
            <TextField
              inputRef={searchInputRef}
              label="ค้นหา"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void loadDocuments(); }}
              placeholder="เลขบิล / รหัสลูกค้า / หมายเหตุ  (กด Ctrl+K, Enter หรือปุ่มค้นหา)"
              size="small"
              sx={{ gridColumn: { xs: "1 / -1", lg: "auto" } }}
              value={search}
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
                  endAdornment: (
                    <InputAdornment position="end">
                      {search ? (
                        <IconButton
                          aria-label="ล้างคำค้นหา"
                          disabled={loading}
                          edge="end"
                          onClick={() => void clearSearchText()}
                          size="small"
                        >
                          <X size={16} />
                        </IconButton>
                      ) : null}
                      <Tooltip arrow placement="top" title="ค้นหาเลขบิลหลายใบหรือช่วงได้ เช่น เลขเริ่ม:เลขจบ,เลขเดี่ยว">
                        <IconButton aria-label="คำแนะนำการค้นหา" edge="end" size="small" sx={{ ml: 0.25 }}>
                          <HelpCircle size={16} />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", gridColumn: { xs: "1 / -1", lg: "auto" } }}>
              <AppButton disabled={loading} fullWidth={isMobile} onClick={() => void loadDocuments()} startIcon={<Search size={16} />} tone="primary">
                ค้นหา
              </AppButton>
            </Stack>
          </Box>
          {selectedDocNos.length ? (
            <SelectionActionBar
              busy={busy}
              canPreview={Boolean(canPreview)}
              selectedCount={selectedDocNos.length}
              selectedCustomer={selectedCustomer}
              selectedFormat={selectedFormat}
              onClear={clearSelection}
              onOpenSettings={() => setSettingsOpen(true)}
              onPreview={() => setSettingsOpen(true)}
              sticky
            />
          ) : null}
        </Stack>
        {isMobile ? (
          <Stack spacing={1.25} sx={{ p: 1.5, pb: selectedDocNos.length ? 2.5 : 1.5, pt: 0 }}>
            {items.map((item) => {
              const selected = selectedDocNos.includes(item.docNo);
              return (
                <Card
                  key={item.docNo}
                  onClick={() => toggleDoc(item.docNo)}
                  variant="outlined"
                  sx={{ borderColor: selected ? "primary.main" : "divider", cursor: "pointer" }}
                >
                  <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack spacing={1.25}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>
                          <Checkbox checked={selected} size="small" sx={{ p: 0.25 }} />
                          <Box sx={{ minWidth: 0 }}>
                            <DocCode value={item.docNo} noWrap sx={{ fontSize: "0.95rem" }} />
                            <Typography color="text.secondary" variant="caption">{formatSmlDate(item.docDate)} · {formatDocumentTime(item.docTime)}</Typography>
                          </Box>
                        </Stack>
                        <Money value={formatMoney(item.totalAmount)} noWrap />
                      </Stack>
                      <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "1fr 1fr" }}>
                        <SummaryLine label="ลูกหนี้" value={item.customerCode || "-"} />
                        <SummaryLine label="สถานะ" value={appStatusLabel(item.appStatus)} />
                      </Box>
                      <Typography color="text.secondary" sx={{ display: "-webkit-box", overflow: "hidden", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }} variant="body2">
                        {maskInternalRemark(item.remark || "") || "-"}
                      </Typography>
                      <AppButton
                        fullWidth
                        onClick={(event) => {
                          event.stopPropagation();
                          setDetailDocNo(item.docNo);
                          setDetailOpen(true);
                        }}
                        size="small"
                      >
                        ดูรายละเอียด
                      </AppButton>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
            {!items.length ? <EmptyState title="ไม่พบบิล" description="ลองเปลี่ยนช่วงวันที่หรือคำค้นหา" /> : null}
          </Stack>
        ) : (
        <Box sx={{ height: selectedDocNos.length ? "calc(100vh - 286px)" : "calc(100vh - 224px)", minHeight: 420, minWidth: 0, width: "100%" }}>
          <Suspense fallback={<LinearProgress />}>
            <LazyDataGrid
              checkboxSelection
              columns={documentGridColumns}
              columnHeaderHeight={44}
              density="standard"
              hideFooterSelectedRowCount
              hideFooterPagination={(documents?.total ?? items.length) <= 100}
              disableRowSelectionExcludeModel
              disableRowSelectionOnClick
              getRowId={(row) => row.docNo}
              keepNonExistentRowsSelected
              loading={loading}
              localeText={{
                ...thaiGridLocaleText,
                footerRowSelected: (count) => `เลือก ${count.toLocaleString()} บิลในหน้านี้`,
                noRowsLabel: "ไม่พบบิล",
              }}
              onRowClick={(params, event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button,a,input,[role='checkbox']")) return;
                toggleDoc(String(params.id));
              }}
              onRowSelectionModelChange={updateSelectionFromGrid}
              pageSizeOptions={[25, 50, 100]}
              rowHeight={50}
              rowSelectionModel={documentGridSelectionModel}
              rows={items}
              sx={{
                border: 0,
                "& .MuiDataGrid-cell": {
                  alignItems: "center",
                  display: "flex",
                  py: 0.5,
                },
                "& .MuiDataGrid-columnHeaderTitle": {
                  fontWeight: 700,
                },
                "& .MuiDataGrid-row": {
                  cursor: "pointer",
                },
                "& .MuiDataGrid-row:hover": {
                  bgcolor: "action.hover",
                },
                "& .MuiDataGrid-row.Mui-selected": {
                  bgcolor: "rgba(36, 90, 109, 0.18)",
                  boxShadow: "inset 3px 0 0 var(--mui-palette-primary-main)",
                },
                "& .MuiDataGrid-row.Mui-selected:hover": {
                  bgcolor: "rgba(36, 90, 109, 0.24)",
                },
                "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": {
                  outline: "none",
                },
                "& .MuiDataGrid-footerContainer": {
                  minHeight: 44,
                },
              }}
            />
          </Suspense>
        </Box>
        )}
      </Paper>

      {detailOpen && detailDocument ? (
        <InvoiceDetailDialog doc={detailDocument} onClose={() => setDetailOpen(false)} />
      ) : null}

      {settingsOpen ? (
        <Dialog fullScreen={isMobile} fullWidth maxWidth="md" open onClose={() => setSettingsOpen(false)}>
          <DialogTitle sx={{ py: 1.25 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
              <SectionTitle level="h2" noWrap>
                ตั้งค่าการแก้ไข
              </SectionTitle>
              <StatusBadge>{selectedDocNos.length} บิล</StatusBadge>
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1.5}>
              {!selectedDocNos.length ? <Alert severity="error">เลือกบิลอย่างน้อย 1 บิลก่อนตั้งค่าการแก้ไข</Alert> : null}
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1.15fr 0.85fr" } }}>
                <Autocomplete<Option, false, false, false>
                  filterOptions={(options) => options}
                  getOptionLabel={(option) => `${option.code} - ${option.name}`}
                  inputValue={customerSearch}
                  loading={customerSearching}
                  loadingText="กำลังค้นหาลูกหนี้..."
                  noOptionsText={customerQuery.length < 2 ? "พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาลูกหนี้" : showCustomerEmpty ? "ไม่พบลูกหนี้ที่ตรงกับคำค้นนี้" : "ไม่พบข้อมูล"}
                  onChange={(_, option) => {
                    if (option) selectCustomer(option);
                    else clearCustomer();
                  }}
                  onInputChange={(_, value, reason) => {
                    if (reason === "reset") return;
                    setCustomerSearch(value);
                    if (selectedCustomer) setSelectedCustomer("");
                    resetPreview();
                  }}
                  options={!selectedCustomer && customerQuery.length >= 2 ? customers : []}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      helperText="ค้นจากรหัสหรือคำใดก็ได้ในชื่อลูกหนี้"
                      label="ลูกหนี้ใหม่"
                      placeholder="พิมพ์รหัสหรือชื่อลูกหนี้"
                      size="small"
                      slotProps={{
                        ...params.slotProps,
                        input: {
                          ...params.slotProps?.input,
                          endAdornment: (
                            <>
                              {customerSearching ? <CircularProgress color="inherit" size={16} /> : null}
                              {params.slotProps?.input?.endAdornment}
                            </>
                          ),
                        },
                      }}
                    />
                  )}
                  renderOption={(props, option) => {
                    const { key, ...optionProps } = props;
                    return (
                      <Box component="li" key={key} {...optionProps}>
                        <Box>
                          <DocCode value={option.code} />
                          <Typography color="text.secondary" variant="caption">{option.name}</Typography>
                        </Box>
                      </Box>
                    );
                  }}
                  sx={{ gridColumn: "1 / -1" }}
                  value={selectedCustomerValue}
                />
                <TextField
                  helperText="เว้นว่างเพื่อใช้ชุดเลขเดิมของแต่ละบิล (ไม่ออกเลขใหม่)"
                  label="ชุดเลขเอกสารใหม่"
                  onChange={(event) => { setSelectedFormat(event.target.value); resetPreview(); }}
                  select
                  size="small"
                  slotProps={{ inputLabel: { shrink: true }, input: { notched: true }, select: { displayEmpty: true } }}
                  value={selectedFormat}
                >
                  <MenuItem value=""><Typography color="text.disabled" variant="body2">— กรุณาเลือก (ใช้ค่าเดิมของแต่ละบิล) —</Typography></MenuItem>
                  {docFormats.map((item) => <MenuItem key={item.code} value={item.code}>{item.code} - {item.name}</MenuItem>)}
                </TextField>
                <TextField
                  helperText="เว้นว่างเพื่อใช้ประเภทขายเดิม"
                  label="ประเภทการขาย"
                  onChange={(event) => { setInquiryType(Number(event.target.value)); resetPreview(); }}
                  select
                  size="small"
                  slotProps={{ inputLabel: { shrink: true }, input: { notched: true }, select: { displayEmpty: true } }}
                  value={inquiryType}
                >
                  <MenuItem value={-1}><Typography color="text.disabled" variant="body2">— กรุณาเลือก (ใช้ค่าเดิมของแต่ละบิล) —</Typography></MenuItem>
                  {[0, 1, 2, 3].map((value) => <MenuItem key={value} value={value}>{saleTypeLabels[value]}</MenuItem>)}
                </TextField>
                <TextField
                  helperText="เว้นว่างเพื่อใช้ประเภทภาษีเดิม"
                  label="ประเภทภาษี"
                  onChange={(event) => { setVatType(Number(event.target.value)); resetPreview(); }}
                  select
                  size="small"
                  slotProps={{ inputLabel: { shrink: true }, input: { notched: true }, select: { displayEmpty: true } }}
                  value={vatType}
                >
                  <MenuItem value={-1}><Typography color="text.disabled" variant="body2">— กรุณาเลือก (ใช้ค่าเดิมของแต่ละบิล) —</Typography></MenuItem>
                  {Object.entries(taxTypeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </TextField>
              </Box>
              <Alert severity={canPreview ? "info" : "warning"}>{canPreview ? "ระบบจะแสดงพรีวิวให้เลือกดูเอกสาร แล้วกดยืนยันส่งเข้า SML ได้ทันที" : workflowHint}</Alert>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ alignItems: { xs: "stretch", sm: "center" }, flexDirection: { xs: "column", sm: "row" } }}>
              <AppButton fullWidth={isMobile} onClick={() => setSettingsOpen(false)}>ปิด</AppButton>
              <AppButton disabled={!canPreview || busy} fullWidth={isMobile} onClick={() => { setSettingsOpen(false); void previewBulk(); }} tone="primary">{busy ? "กำลังพรีวิว" : "พรีวิวก่อนส่ง"}</AppButton>
          </DialogActions>
        </Dialog>
      ) : null}
      {previewing ? (
        <PreviewLoadingDialog
          docCount={selectedDocNos.length}
          selectedCustomer={selectedCustomer}
          selectedFormat={selectedFormat}
        />
      ) : null}

      {preview && previewDialogOpen ? (
        <BulkPreviewDialog
          busy={busy}
          canApply={isAdmin}
          readyToApply={readyToApply}
          hasEmptyAfterEdits={hasEmptyAfterEdits}
          hasInvalidLineEdits={hasInvalidLineEdits}
          hasPaymentAfterEditsBlocked={hasPaymentAfterEditsBlocked}
          hasApplyChanges={hasApplyChanges}
          result={preview}
          selectedDocNo={previewDialogDocNo}
          selectedFormat={selectedFormat}
          selectedCustomer={selectedCustomer}
          requestedVatType={vatType}
          perDocEdits={perDocEdits}
          excludedDocNos={effectiveExcludedDocNos}
          autoExcludedDocNos={autoExcludedPaymentDocNos}
          onUpdateEdit={setPerDocEditEntry}
          onToggleExcluded={(docNo) => setExcludedDocNos((current) => {
            const next = new Set(current);
            if (next.has(docNo)) next.delete(docNo);
            else next.add(docNo);
            return next;
          })}
          onClose={() => setPreviewDialogOpen(false)}
          onRequestApply={() => {
            setPreviewDialogOpen(false);
            setConfirmApplyOpen(true);
          }}
          onSelectDoc={(docNo) => setPreviewDialogDocNo(docNo)}
          onRegenItem={regenBlockedItem}
        />
      ) : null}
      {confirmApplyOpen && preview ? (
        <RiskConfirmDialog
          busy={busy}
          confirmLabel={busy ? "กำลังส่งเข้า SML" : "ยืนยันส่งเข้า SML"}
          detail={`ระบบจะเขียนข้อมูลจริงลง SML เฉพาะ ${writablePreviewCount} บิลที่ผ่านพรีวิว จากทั้งหมด ${preview.totalCount} บิล${excludedPreviewCount ? ` และไม่ส่ง ${excludedPreviewCount} บิล` : ""}`}
          title="ยืนยันส่งเข้า SML"
          tone="danger"
          onCancel={() => { setConfirmApplyOpen(false); setPreviewDialogOpen(true); }}
          onConfirm={() => setFinalApplyConfirmOpen(true)}
        >
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" } }}>
            <SummaryLine label="บิลที่เลือก" value={`${selectedDocNos.length} บิล`} />
            <SummaryLine label="บิลที่จะส่งเข้า SML" value={`${writablePreviewCount} บิล`} strong />
            <SummaryLine label="บิลเตือนลูกหนี้" value={`${missingCustomerWarningItems.length} บิล`} />
            <SummaryLine label="บิลที่ไม่ส่ง" value={`${excludedPreviewCount} บิล`} />
            <SummaryLine label="ชุดเลขใหม่" value={selectedFormat || "-"} />
            <SummaryLine label="ลูกหนี้ใหม่" value={selectedCustomer || "-"} />
          </Box>
          {missingCustomerWarningItems.length ? (
            <Alert severity="warning">
              {missingCustomerWarningItems.length} บิลไม่พบข้อมูลลูกหนี้ในแฟ้มลูกหนี้ ระบบจะใช้รหัสลูกหนี้เดิมจากเอกสารและยังส่งเข้า SML ได้:{" "}
              {formatWarningDocList(missingCustomerWarningItems)}
            </Alert>
          ) : null}
        </RiskConfirmDialog>
      ) : null}
      {finalApplyConfirmOpen && preview ? (
        <RiskConfirmDialog
          busy={busy}
          confirmLabel={busy ? "กำลังส่งเข้า SML" : "ส่งเข้า SML จริง"}
          detail="ยืนยันขั้นสุดท้าย: หลังจากกดส่ง ระบบจะเริ่มเขียนข้อมูลจริงลง SML และแสดง progress ของ batch"
          title="ยืนยันการส่งเข้า SML จริง"
          tone="danger"
          onCancel={() => setFinalApplyConfirmOpen(false)}
          onConfirm={() => void applyBulk()}
        >
          <Alert severity="error">
            โปรดตรวจเลขบิลใหม่ ลูกหนี้ ยอดเงิน และรายการสินค้าทุกบิลให้เรียบร้อยก่อนส่งจริง
          </Alert>
          {missingCustomerWarningItems.length ? (
            <Alert severity="warning">
              มีบิลที่ไม่พบข้อมูลลูกหนี้ {missingCustomerWarningItems.length} บิล แต่ระบบจะยังส่งโดยใช้รหัสลูกหนี้เดิม:{" "}
              {formatWarningDocList(missingCustomerWarningItems)}
            </Alert>
          ) : null}
        </RiskConfirmDialog>
      ) : null}
      {applyProgressOpen && applyProgress ? (
        <BulkApplyProgressDialog
          busy={busy}
          progress={applyProgress}
          onClose={() => setApplyProgressOpen(false)}
          onRetryFailed={() => void retryFailedBulk(applyProgress.batchId)}
        />
      ) : null}
    </Stack>
  );
}

function BulkPreviewDialog({
  busy,
  canApply,
  readyToApply,
  hasEmptyAfterEdits,
  hasInvalidLineEdits,
  hasPaymentAfterEditsBlocked,
  hasApplyChanges,
  result,
  selectedDocNo,
  selectedFormat,
  selectedCustomer,
  requestedVatType,
  perDocEdits,
  excludedDocNos,
  autoExcludedDocNos,
  onUpdateEdit,
  onToggleExcluded,
  onClose,
  onRequestApply,
  onSelectDoc,
  onRegenItem,
}: {
  busy: boolean;
  canApply: boolean;
  readyToApply: boolean;
  hasEmptyAfterEdits: boolean;
  hasInvalidLineEdits: boolean;
  hasPaymentAfterEditsBlocked: boolean;
  hasApplyChanges: boolean;
  result: BulkDocumentChangeResult;
  selectedDocNo: string;
  selectedFormat: string;
  selectedCustomer: string;
  requestedVatType: number;
  perDocEdits: Map<string, PerDocEditState>;
  excludedDocNos: Set<string>;
  autoExcludedDocNos: Set<string>;
  onUpdateEdit: (
    docNo: string,
    updater: (current: PerDocEditState) => PerDocEditState,
  ) => void;
  onToggleExcluded: (docNo: string) => void;
  onClose: () => void;
  onRequestApply: () => void;
  onSelectDoc: (docNo: string) => void;
  onRegenItem: (docNo: string, formatCode: string) => Promise<void>;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const reviewQueue = [...result.items].sort((a, b) => reviewQueuePriority(a) - reviewQueuePriority(b));
  const selectedItem = reviewQueue.find((item) => item.docNo === selectedDocNo) || reviewQueue[0] || result.items[0];
  const selectedPreview = selectedItem?.preview || null;
  const selectedIndex = Math.max(0, reviewQueue.findIndex((item) => item.docNo === selectedItem?.docNo));
  const canNavigate = reviewQueue.length > 1;
  const reviewableItems = result.items.filter((item) => !excludedDocNos.has(item.docNo) && (item.status === "ready" || item.status === "warning"));
  const writableCount = reviewableItems.length;
  const blockedCount = result.items.filter((item) => !excludedDocNos.has(item.docNo) && (item.status === "blocked" || item.status === "failed")).length;
  const skippedCount = result.items.filter((item) => !excludedDocNos.has(item.docNo) && item.status === "skipped").length;
  const nonWritableCount = blockedCount + skippedCount;
  const excludedCount = result.items.filter((item) => excludedDocNos.has(item.docNo)).length;
  const customerWarningItems = reviewableItems.filter((item) => isMissingCustomerWarning(item.message));
  const dialogMaxWidth = canNavigate ? "xl" : "lg";
  const canRequestApply = canApply && readyToApply && !busy;
  const selectedIsWritable = selectedItem?.status === "ready" || selectedItem?.status === "warning";
  const selectedDocKey = selectedItem?.docNo || "";
  const selectedEdit = perDocEdits.get(selectedDocKey);
  // Effective vat type used for client-side recompute: requested override, or original.
  const effectiveVatType = requestedVatType !== -1
    ? requestedVatType
    : (selectedPreview?.after.vatType ?? selectedPreview?.before.vatType ?? 0);
  const recomputed = selectedPreview && selectedEdit
    ? recomputeClientTotals(selectedPreview.remainingLines, selectedEdit.removed, selectedEdit.added, selectedEdit.lineEdits, effectiveVatType)
    : null;
  const displayLineCount = selectedPreview
    ? (selectedEdit
        ? selectedPreview.remainingLines.filter((l) => !selectedEdit.removed.has(l.itemCode)).length + selectedEdit.added.length
        : selectedPreview.totals.lineCount)
    : 0;
  const displayTotalValue = recomputed ? recomputed.totalValue : selectedPreview?.after.totalValue ?? "";
  const displayTotalVat = recomputed ? recomputed.totalVatValue : selectedPreview?.totals.totalVatValue ?? "";
  const displayTotalAmount = recomputed ? recomputed.totalAmount : selectedPreview?.totals.totalAmount ?? "";
  const displayRemark = selectedEdit?.remark ?? selectedPreview?.after.remark ?? "";
  const selectedBillIsEmpty = selectedIsWritable && selectedPreview ? displayLineCount === 0 : false;
	  const footerProgressText = !canApply
	    ? "สิทธิ์ User ดูพรีวิวได้เท่านั้น ต้องให้ Admin เป็นผู้ส่งเข้า SML"
	    : hasInvalidLineEdits
	      ? "มีจำนวน ราคา หรือส่วนลดไม่ถูกต้อง ต้องแก้ก่อนส่ง"
    : hasPaymentAfterEditsBlocked
      ? "มีบิลที่ยอดชำระเงินสดไม่พอ ต้องแก้ยอดหรือกดไม่ส่งบิลนี้ก่อน"
    : hasEmptyAfterEdits
      ? "มีบิลที่ไม่มีสินค้าเหลือ ต้องยกเลิกการลบก่อนส่ง"
    : !hasApplyChanges
      ? "ยังไม่มีการแก้ไข เลือกประเภท/ลูกหนี้/ชุดเลข หรือแก้หมายเหตุ/รายการสินค้าในพรีวิวก่อน"
      : writableCount
        ? `ส่งเข้า SML ได้ ${writableCount} บิล${nonWritableCount ? `, ต้องแก้/ไม่ส่ง ${nonWritableCount} บิล` : ""}${excludedCount ? `, ไม่ส่ง ${excludedCount} บิล` : ""}`
        : "ไม่มีบิลที่ระบบส่งเข้า SML ได้";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") selectByOffset(-1);
      if (event.key === "ArrowRight") selectByOffset(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, selectedIndex, reviewQueue]);

  function selectByOffset(offset: number) {
    if (!reviewQueue.length) return;
    const nextIndex = Math.min(Math.max(selectedIndex + offset, 0), reviewQueue.length - 1);
    onSelectDoc(reviewQueue[nextIndex].docNo);
  }

  return (
    <Dialog
      fullScreen={isMobile}
      fullWidth
      maxWidth={dialogMaxWidth}
      open
      onClose={busy ? undefined : onClose}
    >
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
            <SectionTitle level="h2" noWrap>พรีวิวก่อนส่งเข้า SML</SectionTitle>
            <EmphasisText noWrap primary>{result.totalCount === 1 ? selectedItem?.docNo || "1 บิล" : `${selectedIndex + 1}/${result.totalCount}`}</EmphasisText>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexShrink: 0 }}>
            <IconButton aria-label="ปิดพรีวิว" disabled={busy} onClick={onClose} type="button">
              <X size={16} />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ p: { xs: 1.25, sm: 1.5 } }}>
        <Stack spacing={1.25}>
          {nonWritableCount ? (
            <Alert severity="warning">
              มีเอกสารที่ระบบไม่ส่งเข้า SML {nonWritableCount} บิล ระบบจะส่งเฉพาะ {writableCount} บิลที่ผ่านการคำนวณพรีวิว
            </Alert>
          ) : null}

          {customerWarningItems.length ? (
            <Alert severity="warning">
              ไม่พบข้อมูลลูกหนี้ในแฟ้มลูกหนี้ {customerWarningItems.length} บิล ระบบจะใช้รหัสลูกหนี้เดิมจากเอกสารและยังส่งเข้า SML ได้:{" "}
              {formatWarningDocList(customerWarningItems)}
            </Alert>
          ) : null}

          {hasEmptyAfterEdits ? (
            <Alert severity="error">
              มีบิลที่ลบสินค้าจนไม่เหลือรายการแล้ว ต้องเพิ่มสินค้าหรือยกเลิกการลบก่อนจึงจะส่งเข้า SML ได้
            </Alert>
          ) : null}
	          {hasInvalidLineEdits ? (
	            <Alert severity="error">
	              จำนวน ราคา หรือส่วนลดในพรีวิวไม่ถูกต้อง กรุณาแก้ค่าที่เป็นกรอบแดงก่อนส่งเข้า SML
	            </Alert>
	          ) : null}
          {hasPaymentAfterEditsBlocked ? (
            <Alert severity="error">
              มีบิลที่ยอดชำระเงินสดไม่พอ ให้กด “ไม่ส่งบิลนี้” ในรายการซ้าย หรือปรับรายการสินค้าให้ยอดผ่านก่อนส่งเข้า SML
            </Alert>
          ) : null}

          <Box sx={{ alignItems: "stretch", display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: canNavigate ? "340px minmax(0, 1fr)" : "1fr" } }}>
            {canNavigate ? (
              <BulkReviewQueuePanel
                busy={busy}
                items={reviewQueue}
                perDocEdits={perDocEdits}
                excludedDocNos={excludedDocNos}
                autoExcludedDocNos={autoExcludedDocNos}
                onSelectDoc={onSelectDoc}
                onToggleExcluded={onToggleExcluded}
                onRegenItem={onRegenItem}
                selectedDocNo={selectedItem?.docNo || ""}
              />
            ) : null}

            <Stack spacing={1.25} sx={{ minWidth: 0 }}>
              {canNavigate ? (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                  <AppButton disabled={selectedIndex <= 0} onClick={() => selectByOffset(-1)} startIcon={<ChevronLeft size={16} />} type="button">
                    ก่อนหน้า
                  </AppButton>
                  <Typography color="text.secondary" sx={{ textAlign: "center" }} variant="body2">
                    เลือกดูเอกสาร {selectedIndex + 1} / {reviewQueue.length}
                  </Typography>
                  <AppButton disabled={selectedIndex >= reviewQueue.length - 1} endIcon={<ChevronRight size={16} />} onClick={() => selectByOffset(1)} type="button">
                    ถัดไป
                  </AppButton>
                </Stack>
              ) : null}

              {selectedItem && !selectedIsWritable ? (() => {
                const isDup = selectedItem.message.includes("ถูกใช้แล้ว");
                const fmtCode = selectedItem.preview?.after.docFormatCode || selectedItem.preview?.before.docFormatCode || selectedFormat;
                return (
                  <Alert
                    severity="warning"
                    action={isDup && fmtCode ? (
                      <AppButton
                        disabled={busy}
                        size="small"
                        startIcon={<RefreshCw size={14} />}
                        tone="danger"
                        type="button"
                        onClick={() => void onRegenItem(selectedItem.docNo, fmtCode)}
                      >
                        ออกเลขใหม่
                      </AppButton>
                    ) : undefined}
                  >
                    <EmphasisText>เอกสารนี้ระบบจะไม่ส่งเข้า SML</EmphasisText>
                    {selectedItem.message || "เลือกเอกสารถัดไปเพื่อดูรายการที่ส่งได้"}
                  </Alert>
                );
              })() : null}
              {selectedItem?.status === "warning" && selectedItem.message ? (
                <Alert severity="warning">
                  <EmphasisText>เอกสารนี้มีข้อควรตรวจสอบ แต่ยังส่งเข้า SML ได้</EmphasisText>
                  {selectedItem.message}
                </Alert>
              ) : null}

              {selectedPreview ? (
                <>
                  {/* PreviewChangeSummaryPanel hidden — จุดเปลี่ยนที่ต้องโฟกัส ซ่อนไว้ก่อน */}
                  <Box sx={{ display: "grid", columnGap: 2, rowGap: 0.75, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" } }}>
                    <DocumentFact label="เลขบิลเดิม" value={selectedPreview.before.docNo} strong />
                    <DocumentFact changed={valueChanged(selectedPreview.after.docNo, selectedPreview.before.docNo)} label="เลขบิลใหม่" previousValue={selectedPreview.before.docNo} value={selectedPreview.after.docNo} strong />
                    <DocumentFact changed={valueChanged(selectedPreview.after.docRef, selectedPreview.before.docRef)} label="เอกสารอ้างอิง" previousValue={selectedPreview.before.docRef || "-"} value={selectedPreview.after.docRef || "-"} />
                    <DocumentFact label="วันที่เอกสาร" value={formatDate(selectedPreview.after.docDate)} />
                    <DocumentFact label="เวลา" value={formatDocumentTime(selectedPreview.after.docTime)} />
                    <DocumentFact changed={valueChanged(selectedPreview.after.docFormatCode, selectedPreview.before.docFormatCode)} label="ชุดเลข" previousValue={selectedPreview.before.docFormatCode || "-"} value={selectedFormat || selectedPreview.after.docFormatCode || "-"} />
                    <DocumentFact changed={valueChanged(selectedPreview.after.customerCode, selectedPreview.before.customerCode)} label="ลูกหนี้ใหม่" previousValue={selectedPreview.before.customerCode || "-"} value={selectedPreview.after.customerCode || selectedCustomer || "-"} strong />
                    <DocumentFact changed={valueChanged(selectedPreview.after.inquiryType, selectedPreview.before.inquiryType)} label="ประเภทขาย" previousValue={saleTypeLabels[selectedPreview.before.inquiryType] || `${selectedPreview.before.inquiryType}`} value={saleTypeLabels[selectedPreview.after.inquiryType] || `${selectedPreview.after.inquiryType}`} />
                    <DocumentFact changed={valueChanged(selectedPreview.after.vatType, selectedPreview.before.vatType)} label="ประเภทภาษี" previousValue={taxTypeLabels[selectedPreview.before.vatType] || `${selectedPreview.before.vatType}`} value={taxTypeLabels[selectedPreview.after.vatType] || `${selectedPreview.after.vatType}`} />
                  </Box>

                  <EditableDocumentLinesPanel
                    docNo={selectedPreview.after.docNo}
                    lines={selectedPreview.remainingLines}
                    removed={selectedEdit?.removed}
                    lineEdits={selectedEdit?.lineEdits}
                    added={selectedEdit?.added || []}
                    onToggleRemove={(itemCode) => onUpdateEdit(selectedDocKey, (cur) => {
                      const next = new Set(cur.removed);
                      if (next.has(itemCode)) next.delete(itemCode);
                      else next.add(itemCode);
                      return { ...cur, removed: next };
                    })}
                    onLineFieldChange={(line, field, value) => onUpdateEdit(selectedDocKey, (cur) => updateLineEditDraft(cur, line, field, value))}
                    onRemoveAdded={(idx) => onUpdateEdit(selectedDocKey, (cur) => ({
                      ...cur,
                      added: cur.added.filter((_, i) => i !== idx),
                    }))}
                    onAdd={(line) => onUpdateEdit(selectedDocKey, (cur) => ({
                      ...cur,
                      added: [...cur.added, line],
                    }))}
                  />

                  {selectedBillIsEmpty ? (
                    <Alert severity="error">
                      บิลนี้ไม่มีสินค้าเหลือ ต้องยกเลิกการลบอย่างน้อย 1 รายการก่อนจะส่งเข้า SML ได้
                    </Alert>
                  ) : null}

                  <Stack spacing={1.5}>
                    <Paper variant="outlined" sx={{ ...changedPaperSx(valueChanged(displayRemark, selectedPreview.before.remark)), p: 1.25 }}>
                      <Stack spacing={0.75}>
                        <Typography color="text.secondary" variant="caption">หมายเหตุ</Typography>
                        <TextField
                          minRows={2}
                          multiline
                          onChange={(event) => onUpdateEdit(selectedDocKey, (cur) => {
                            const nextRemark = event.target.value;
                            if (nextRemark === selectedPreview.before.remark) {
                              const { remark: _remark, ...rest } = cur;
                              void _remark;
                              return rest;
                            }
                            return { ...cur, remark: nextRemark };
                          })}
                          placeholder="ไม่มีหมายเหตุ"
                          size="small"
                          value={displayRemark}
                        />
                      </Stack>
                      {valueChanged(displayRemark, selectedPreview.before.remark) ? (
                        <Typography color="text.secondary" sx={{ display: "block", mt: 0.75 }} variant="caption">
                          เดิม: {maskInternalRemark(selectedPreview.before.remark) || "ไม่มีหมายเหตุ"} → ใหม่: {maskInternalRemark(displayRemark) || "ไม่มีหมายเหตุ"}
                        </Typography>
                      ) : null}
                    </Paper>
                    <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" } }}>
                      <TotalLine changed={displayLineCount !== selectedPreview.remainingLines.length} label="รายการคงเหลือ" previousValue={`${selectedPreview.remainingLines.length + selectedPreview.removedLines.length} รายการ`} value={`${displayLineCount} รายการ`} />
                      <TotalLine label="มูลค่าสินค้า" value={formatMoney(displayTotalValue)} />
                      <TotalLine changed={moneyValueChanged(displayTotalVat, selectedPreview.before.totalVatValue)} label="มูลค่าภาษี" previousValue={formatMoney(selectedPreview.before.totalVatValue)} value={formatMoney(displayTotalVat)} />
                      <TotalLine changed={moneyValueChanged(displayTotalAmount, selectedPreview.before.totalAmount)} label="ยอดสุทธิใหม่" previousValue={formatMoney(selectedPreview.before.totalAmount)} value={formatMoney(displayTotalAmount)} strong />
                    </Box>
                  </Stack>

                  <PaymentChangePreviewPanel displayTotalAmount={displayTotalAmount} preview={selectedPreview} />
                </>
              ) : (
                <EmptyState
                  title="ไม่มีรายละเอียดพรีวิวสำหรับบิลนี้"
                  description="บิลนี้ไม่ผ่านพรีวิวหรือเกิดข้อผิดพลาด จึงไม่มีข้อมูลหลังแก้ไขให้แสดง"
                />
              )}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>

        <DialogActions sx={{ alignItems: "center", display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr auto auto" }, p: { xs: 1, sm: 2 } }}>
          <Typography color="text.secondary" sx={{ gridColumn: { xs: "1 / -1", sm: "auto" }, minWidth: 0 }} variant="caption">
            {footerProgressText}
          </Typography>
          <AppButton disabled={busy} fullWidth={isMobile} onClick={onClose}>ปิด</AppButton>
          {canApply ? <AppButton disabled={!canRequestApply} fullWidth={isMobile} onClick={onRequestApply} sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }} tone="danger">
            {busy ? "กำลังส่ง" : `ส่ง ${writableCount} บิลเข้า SML`}
          </AppButton> : null}
        </DialogActions>
    </Dialog>
  );
}

function BulkApplyProgressDialog({
  busy,
  progress,
  onClose,
  onRetryFailed,
}: {
  busy: boolean;
  progress: BulkApplyBatchProgress;
  onClose: () => void;
  onRetryFailed: () => void;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const active = isActiveBatchStatus(progress.status);
  const completedCount = progress.appliedCount + progress.failedCount + progress.skippedCount + progress.blockedCount;
  const pct = progress.totalCount ? Math.min(100, Math.round((completedCount / progress.totalCount) * 100)) : 0;
  const currentItem = progress.items.find((item) => item.status === "processing");
  const failedItems = progress.items.filter((item) => item.status === "failed" || item.status === "skipped");
  const canRetry = !active && failedItems.length > 0;
  const statusText = active
    ? `กำลังส่ง ${completedCount}/${progress.totalCount} บิล`
    : progress.failedCount || progress.skippedCount || progress.blockedCount
      ? `เสร็จบางส่วน ${progress.appliedCount}/${progress.totalCount} บิล`
      : `ส่งสำเร็จครบ ${progress.appliedCount}/${progress.totalCount} บิล`;

  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="sm" open onClose={active ? undefined : onClose}>
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <SectionTitle level="h2" noWrap>สถานะส่งเข้า SML</SectionTitle>
          <StatusBadge>{progress.batchNo || `Batch ${progress.batchId}`}</StatusBadge>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Alert severity={active ? "info" : canRetry ? "warning" : "success"}>{statusText}</Alert>
          <Box>
            <LinearProgress variant="determinate" value={pct} />
            <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="caption">{pct}%</Typography>
          </Box>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" } }}>
            <SummaryLine label="สำเร็จ" value={`${progress.appliedCount} บิล`} strong />
            <SummaryLine label="ไม่สำเร็จ" value={`${progress.failedCount} บิล`} />
            <SummaryLine label="รอดำเนินการ" value={`${progress.pendingCount} บิล`} />
            <SummaryLine label="ข้าม" value={`${progress.skippedCount + progress.blockedCount} บิล`} />
          </Box>
          {currentItem ? (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography color="text.secondary" variant="caption">กำลังดำเนินการ</Typography>
              <DocCode value={`${currentItem.docNo} → ${currentItem.newDocNo || "-"}`} />
            </Paper>
          ) : null}
          {failedItems.length ? (
            <Stack spacing={0.75}>
              <EmphasisText>รายการที่ไม่สำเร็จ</EmphasisText>
              <Stack spacing={0.75} sx={{ maxHeight: 220, overflow: "auto" }}>
                {failedItems.map((item) => (
                  <Paper key={`${item.docNo}-${item.newDocNo}`} variant="outlined" sx={{ p: 1 }}>
                    <DocCode value={`${item.docNo} → ${item.newDocNo || "-"}`} />
                    <Typography color="error.main" variant="caption">{friendlyApplyErrorMessage(item.message)}</Typography>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: { xs: 1, sm: 2 } }}>
        <AppButton disabled={active && busy} onClick={onClose}>ปิด</AppButton>
        {canRetry ? (
          <AppButton disabled={busy} onClick={onRetryFailed} startIcon={<RefreshCw size={16} />} tone="danger">
            ส่งซ้ำเฉพาะบิลที่ไม่สำเร็จ
          </AppButton>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

function PreviewLoadingDialog({
  docCount,
  selectedCustomer,
  selectedFormat,
}: {
  docCount: number;
  selectedCustomer: string;
  selectedFormat: string;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="xs" open>
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <SectionTitle level="h2" noWrap>กำลังสร้างพรีวิวก่อนส่ง</SectionTitle>
          <StatusBadge>{docCount} บิล</StatusBadge>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <LinearProgress />
          <Alert severity="info">
            ระบบกำลังอ่านข้อมูลบิล ออกเลขเอกสารใหม่ ตรวจรายการสินค้า และคำนวณผลลัพธ์ก่อนส่งเข้า SML
          </Alert>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "1fr 1fr" }}>
            <SummaryLine label="ชุดเลขใหม่" value={selectedFormat || "-"} />
            <SummaryLine label="ลูกหนี้ใหม่" value={selectedCustomer || "-"} />
            <SummaryLine label="บิลที่เลือก" value={`${docCount} บิล`} strong />
          </Box>
          <Typography color="text.secondary" variant="caption">
            ถ้าเลือกหลายสิบหรือหลายร้อยบิล ขั้นตอนนี้อาจใช้เวลานานตามจำนวนบิลและความเร็วฐานข้อมูล
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

const DUPLICATE_DOC_NO_PHRASE = "ถูกใช้แล้ว";

function friendlyApplyErrorMessage(message?: string) {
  const text = (message || "").trim();
  if (!text) return "ส่งเข้า SML ไม่สำเร็จ";
  if (text.includes("cb_trans sync invariant") || text.includes("cb_trans sync:") || text.includes("ตรวจสอบยอดชำระไม่ผ่าน")) {
    return "ยอดชำระของบิลนี้อยู่ในรูปแบบที่ระบบต้องตรวจสอบเพิ่มเติม ระบบยังไม่ส่งเข้า SML เพื่อป้องกันยอดชำระผิด";
  }
  if (text.includes("customer not found")) {
    return "ไม่พบข้อมูลลูกหนี้ในแฟ้มลูกหนี้ กรุณาตรวจสอบรหัสลูกหนี้";
  }
  return text;
}

function isMissingCustomerWarning(message?: string) {
  const text = (message || "").trim();
  return text.includes("ไม่พบข้อมูลลูกหนี้") || text.includes("ไม่พบ master ลูกหนี้");
}

function formatWarningDocList(items: Pick<BulkDocumentChangeItem, "docNo" | "message">[], limit = 5) {
  const shown = items.slice(0, limit).map((item) => {
    const customerCode = missingCustomerCodeFromMessage(item.message);
    return customerCode ? `${item.docNo} (${customerCode})` : item.docNo;
  });
  const remaining = items.length - shown.length;
  return `${shown.join(", ")}${remaining > 0 ? ` และอีก ${remaining} บิล` : ""}`;
}

function missingCustomerCodeFromMessage(message?: string) {
  const text = (message || "").trim();
  const match = text.match(/(?:ไม่พบข้อมูลลูกหนี้|ไม่พบ master ลูกหนี้)\s+([^\s]+)/);
  return match?.[1] || "";
}

function BulkReviewQueuePanel({
  busy,
  items,
  perDocEdits,
  excludedDocNos,
  autoExcludedDocNos,
  onSelectDoc,
  onToggleExcluded,
  onRegenItem,
  selectedDocNo,
}: {
  busy: boolean;
  items: BulkDocumentChangeItem[];
  perDocEdits: Map<string, PerDocEditState>;
  excludedDocNos: Set<string>;
  autoExcludedDocNos: Set<string>;
  onSelectDoc: (docNo: string) => void;
  onToggleExcluded: (docNo: string) => void;
  onRegenItem: (docNo: string, formatCode: string) => Promise<void>;
  selectedDocNo: string;
}) {
  return (
    <Paper
      aria-label="คิวเอกสาร"
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        height: { md: "100%" },
        maxHeight: { xs: 260, md: "none" },
        minHeight: { md: 420 },
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Stack spacing={1} sx={{ borderBottom: 1, borderColor: "divider", p: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <EmphasisText>เอกสารในชุดนี้</EmphasisText>
          <Typography color="text.secondary" variant="caption">{items.length} เอกสาร</Typography>
        </Stack>
      </Stack>
      <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1 }}>
        {items.map((item) => {
          const selected = item.docNo === selectedDocNo;
          const excluded = excludedDocNos.has(item.docNo);
          const autoExcluded = autoExcludedDocNos.has(item.docNo);
          const edit = perDocEdits.get(item.docNo);
          const effectiveVatType = item.preview?.after.vatType ?? item.preview?.before.vatType ?? 0;
          const displayTotals = item.preview && edit
            ? recomputeClientTotals(item.preview.remainingLines, edit.removed, edit.added, edit.lineEdits, effectiveVatType)
            : null;
          const rawTotalAmount = displayTotals?.totalAmount || item.preview?.totals.totalAmount || "";
          const totalAmount = item.preview ? formatMoney(rawTotalAmount) : "-";
          const originalTotalAmount = item.preview ? formatMoney(item.preview.before.totalAmount || item.preview.totals.totalAmount) : "-";
          const totalChanged = item.preview ? moneyValueChanged(rawTotalAmount, item.preview.before.totalAmount || item.preview.totals.totalAmount) : false;
          const autoExcludedReason = autoExcluded && item.preview?.paymentBefore
            ? evaluatePaymentPreviewPolicy(item.preview.paymentBefore, rawTotalAmount).blockedReason
            : "";
          const lineCount = item.preview
            ? (edit
                ? item.preview.remainingLines.filter((line) => !edit.removed.has(line.itemCode)).length + edit.added.length
                : item.preview.totals.lineCount)
            : 0;
          const customerCode = item.preview?.after.customerCode || "-";
          const isDuplicateBlocked = (item.status === "blocked" || item.status === "failed")
            && item.message.includes(DUPLICATE_DOC_NO_PHRASE);
          const formatCode = item.preview?.after.docFormatCode || item.preview?.before.docFormatCode || "";
          return (
            <Stack key={item.docNo} spacing={0.5}>
              <Button
                onClick={() => onSelectDoc(item.docNo)}
                type="button"
                variant="outlined"
                sx={{
                  alignItems: "stretch",
                  bgcolor: selected ? "rgba(36, 90, 109, 0.10)" : "background.paper",
                  borderColor: excluded ? "warning.main" : selected ? "primary.main" : isDuplicateBlocked ? "error.main" : "divider",
                  color: "text.primary",
                  display: "block",
                  minHeight: 78,
                  opacity: excluded ? 0.68 : 1,
                  p: 1,
                  textAlign: "left",
                }}
              >
                <Stack spacing={0.75}>
                  <DocCode value={`${item.docNo} → ${item.newDocNo || "-"}`} noWrap />
                  <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
                    <Typography color="text.secondary" noWrap variant="caption">ลูกหนี้ {customerCode}</Typography>
                    <Stack spacing={0.15} sx={{ alignItems: "flex-end", minWidth: 0 }}>
                      {totalChanged ? (
                        <Typography
                          color="text.secondary"
                          noWrap
                          sx={{ fontVariantNumeric: "tabular-nums", lineHeight: 1, textDecoration: "line-through" }}
                          variant="caption"
                        >
                          {originalTotalAmount}
                        </Typography>
                      ) : null}
                      <Typography
                        color={totalChanged ? "warning.main" : "primary.main"}
                        noWrap
                        sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, lineHeight: 1.1 }}
                        variant="caption"
                      >
                        {totalAmount}
                      </Typography>
                    </Stack>
                  </Stack>
                  {item.preview ? (
                    <Typography color="text.secondary" noWrap variant="caption">สินค้า {lineCount} รายการ</Typography>
                  ) : null}
                  {isDuplicateBlocked ? (
                    <Typography color="error.main" variant="caption" noWrap>เลขบิลซ้ำ — กด Regen</Typography>
                  ) : null}
                  {item.status === "warning" && item.message ? (
                    <Typography color="warning.main" variant="caption" noWrap>{item.message}</Typography>
                  ) : null}
                  {excluded ? (
                    <Typography color="warning.main" variant="caption" noWrap>
                      {autoExcluded ? "ไม่ส่งอัตโนมัติ: ยอดต่ำกว่าเงินสด" : "ไม่ส่งบิลนี้เข้า SML"}
                    </Typography>
                  ) : null}
                  {autoExcludedReason ? (
                    <Typography color="warning.main" variant="caption" noWrap>{autoExcludedReason}</Typography>
                  ) : null}
                </Stack>
              </Button>
              <AppButton
                disabled={busy || autoExcluded}
                fullWidth
                size="small"
                tone={excluded ? "primary" : "secondary"}
                type="button"
                onClick={() => onToggleExcluded(item.docNo)}
              >
                {autoExcluded ? "แก้ยอดให้ถึงเงินสดเดิม" : excluded ? "นำกลับมาส่ง" : "ไม่ส่งบิลนี้"}
              </AppButton>
              {isDuplicateBlocked && formatCode ? (
                <AppButton
                  disabled={busy}
                  fullWidth
                  size="small"
                  startIcon={<RefreshCw size={14} />}
                  tone="danger"
                  type="button"
                  onClick={() => void onRegenItem(item.docNo, formatCode)}
                >
                  ออกเลขใหม่
                </AppButton>
              ) : null}
            </Stack>
          );
        })}
        {!items.length ? <EmptyState title="ไม่มีเอกสารในชุดนี้" description="เลือกบิลใหม่แล้วพรีวิวอีกครั้ง" /> : null}
      </Stack>
    </Paper>
  );
}

function SelectionActionBar({
  busy,
  canPreview,
  selectedCount,
  selectedCustomer,
  selectedFormat,
  onClear,
  onOpenSettings,
  onPreview,
  sticky = false,
}: {
  busy: boolean;
  canPreview: boolean;
  selectedCount: number;
  selectedCustomer: string;
  selectedFormat: string;
  onClear: () => void;
  onOpenSettings: () => void;
  onPreview: () => void;
  sticky?: boolean;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const chips = canPreview ? [
    selectedCustomer ? `ลูกหนี้ใหม่ ${selectedCustomer}` : "",
    selectedFormat ? `ชุดเอกสารใหม่ ${selectedFormat}` : "",
  ].filter(Boolean) : [];

  const inner = (
    <Paper
      aria-label="ชุดคำสั่งบิลที่เลือก"
      elevation={sticky ? 8 : 0}
      variant={sticky ? "elevation" : "outlined"}
      sx={{
        bgcolor: sticky ? "background.paper" : "action.hover",
        p: sticky ? { xs: 1.25, md: 1.5 } : 1,
        borderRadius: sticky ? 0 : undefined,
        borderTop: sticky ? "2px solid" : undefined,
        borderTopColor: sticky ? (canPreview ? "success.main" : "primary.main") : undefined,
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.25}
        sx={{
          alignItems: { md: "center" },
          justifyContent: "space-between",
          minWidth: 0,
          mx: "auto",
          maxWidth: sticky ? 1400 : undefined,
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <EmphasisText>เลือก {selectedCount} บิล</EmphasisText>
          {canPreview ? <StatusBadge tone="success">พร้อมพรีวิว</StatusBadge> : <StatusBadge>ยังไม่ได้ตั้งค่า</StatusBadge>}
          {chips.length ? (
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
              {chips.map((label) => <Chip key={label} label={label} size="small" variant="outlined" />)}
            </Stack>
          ) : null}
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "stretch", flexShrink: 0 }}>
          {canPreview ? (
            <>
              <AppButton disabled={busy} fullWidth={isMobile} onClick={onPreview} sx={{ minWidth: { sm: 132 } }} tone="primary">
                {busy ? "กำลังพรีวิว" : "พรีวิวก่อนส่ง"}
              </AppButton>
              <AppButton disabled={busy} fullWidth={isMobile} onClick={onOpenSettings} sx={{ minWidth: { sm: 96 } }}>
                แก้ค่า
              </AppButton>
            </>
          ) : (
            <AppButton disabled={busy} fullWidth={isMobile} onClick={onOpenSettings} sx={{ minWidth: { sm: 148 } }} tone="primary">
              ตั้งค่าและพรีวิว
            </AppButton>
          )}
          <AppButton disabled={busy} fullWidth={isMobile} onClick={onClear} sx={{ minWidth: { sm: 76 } }} tone="ghost">
            ล้าง
          </AppButton>
        </Stack>
      </Stack>
    </Paper>
  );

  if (!sticky) return inner;

  return (
    <Slide direction="up" in mountOnEnter unmountOnExit>
      <Box
        sx={{
          position: "fixed",
          left: { xs: 0, md: "260px" },
          right: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          pointerEvents: "auto",
        }}
      >
        {inner}
      </Box>
    </Slide>
  );
}

function PreviewChangeSummaryPanel({ preview }: { preview: DocumentChangePreview }) {
  const changes = buildPreviewChangeItems(preview);
  const changedItems = changes.filter((item) => item.changed);
  const unchangedItems = changes.filter((item) => !item.changed);
  const changedCount = changedItems.length;
  const removedCount = preview.removedLines.length;

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <EmphasisText>จุดเปลี่ยนที่ต้องโฟกัส</EmphasisText>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
            <Chip color={changedCount ? "warning" : "default"} label={`${changedCount} จุดเปลี่ยน`} size="small" variant={changedCount ? "filled" : "outlined"} />
            {removedCount ? <Chip color="error" label={`ลบสินค้า ${removedCount} รายการ`} size="small" /> : null}
          </Stack>
        </Stack>
        {changedCount ? (
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" } }}>
            {changedItems.map((change) => <PreviewChangedFact change={change} key={change.key} />)}
          </Box>
        ) : (
          <Typography color="text.secondary" variant="body2">
            {removedCount ? `ไม่มีการเปลี่ยนแปลงระดับเอกสาร (มีเฉพาะการลบรายการสินค้า ${removedCount} รายการ)` : "ไม่มีการเปลี่ยนแปลง"}
          </Typography>
        )}
        {unchangedItems.length ? (
          <Typography color="text.disabled" variant="caption">
            คงเดิม: {unchangedItems.map((item) => item.label).join(", ")}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

function PreviewChangedFact({ change }: { change: PreviewChangeItem }) {
  const color = change.tone === "danger" ? "error" : "warning";
  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        bgcolor: change.changed ? (change.tone === "danger" ? "rgba(208, 68, 55, 0.08)" : "rgba(161, 98, 7, 0.08)") : "background.paper",
        borderColor: change.changed ? `${color}.main` : "divider",
        p: 1,
      }}
    >
      <Typography color="text.secondary" noWrap variant="caption">{change.label}</Typography>
      {change.changed ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", minWidth: 0 }}>
          <Typography color="text.secondary" noWrap sx={{ textDecoration: "line-through" }} variant="body2">{change.before}</Typography>
          <Typography color="text.secondary" variant="caption">→</Typography>
          <Typography color={change.tone === "danger" ? "error.main" : "text.primary"} noWrap sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }} variant="body2">{change.after}</Typography>
        </Stack>
      ) : (
        <EmphasisText noWrap>{change.after}</EmphasisText>
      )}
    </Paper>
  );
}

const CB_DOC_TYPE_LABELS: Record<number, string> = {
  1: "เงินโอน",
  2: "เช็ค",
  3: "บัตรเครดิต",
  4: "เงินสดย่อย",
  5: "เงินล่วงหน้า",
  9: "คูปอง",
  11: "จ่ายอื่น",
  12: "รับอื่น",
  19: "สกุลเงินอื่น",
  21: "eWallet",
};

// PaymentChangePreviewPanel แสดงข้อมูลการชำระเงิน (cb_trans + cb_trans_detail)
// ก่อนและหลังการ apply ตามที่ระบบจะ sync ให้ตรงกับยอดบิลใหม่
// displayTotalAmount คือยอดที่ user ปรับ client-side (อาจต่างจาก preview.paymentAfter
// ซึ่ง backend simulate จากยอดก่อน user toggle remove/add lines)
function PaymentChangePreviewPanel({ preview, displayTotalAmount }: { preview: DocumentChangePreview; displayTotalAmount?: string }) {
  const before = preview.paymentBefore;
  // Re-simulate ด้วย displayTotalAmount ถ้า user ปรับยอด client-side
  // ถ้าไม่มี displayTotalAmount ใช้ paymentAfter จาก backend ตามเดิม
  const simulated = before && displayTotalAmount != null
    ? simulatePaymentAfter(before, displayTotalAmount)
    : !before && preview.paymentAfter && displayTotalAmount != null
      ? { after: newCashPreviewPayment(preview.paymentAfter, displayTotalAmount), error: "" }
    : { after: preview.paymentAfter ?? null, error: "" };
  const after = simulated.after;
  if (!before) {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Stack spacing={1}>
          <EmphasisText>การชำระเงิน</EmphasisText>
          {after ? (
            <>
              <Typography color="text.secondary" variant="body2">
                จะสร้างข้อมูลรับเงินสดใหม่ใน cb_trans เมื่อส่งเข้า SML
              </Typography>
              <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" } }}>
                <TotalLine changed label="ยอดชำระรวม" previousValue="-" value={formatMoney(after.totalAmountPay)} strong />
                <TotalLine changed label="เงินสด" previousValue="-" value={formatMoney(after.cashAmount)} />
              </Box>
            </>
          ) : (
            <Typography color="text.secondary" variant="body2">
              บิลนี้ไม่มีข้อมูลใน cb_trans (เช่น ขายเชื่อ/ลูกหนี้) — ระบบจะไม่ปรับยอดชำระ
            </Typography>
          )}
        </Stack>
      </Paper>
    );
  }
  const fields: Array<{ key: keyof PaymentRow; label: string }> = [
    { key: "chqAmount", label: "เช็ค" },
    { key: "tranferAmount", label: "โอน" },
    { key: "cardAmount", label: "บัตรเครดิต" },
    { key: "walletAmount", label: "Wallet" },
    { key: "couponAmount", label: "คูปอง" },
    { key: "pointAmount", label: "พอยต์" },
    { key: "depositAmount", label: "มัดจำ" },
    { key: "advanceAmount", label: "เงินล่วงหน้า" },
    { key: "pettyCashAmount", label: "เงินสดย่อย" },
  ];
  // แสดงเฉพาะช่องที่ก่อนหรือหลังมียอด >0 เพื่อลด noise
  const visible = fields.filter((f) =>
    moneyValueNonZero(String(before[f.key] ?? "")) || (after && moneyValueNonZero(String(after[f.key] ?? "")))
  );
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={1}>
        <EmphasisText>การชำระเงิน</EmphasisText>
        {simulated.error ? (
          <Alert severity="error">{simulated.error}</Alert>
        ) : null}
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" } }}>
          <TotalLine
            changed={after ? moneyValueChanged(after.totalAmountPay, before.totalAmountPay) : false}
            label="ยอดชำระรวม"
            previousValue={formatMoney(before.totalAmountPay)}
            value={formatMoney(after?.totalAmountPay ?? before.totalAmountPay)}
            strong
          />
          {moneyValueNonZero(before.cashAmount) || moneyValueNonZero(after?.cashAmount) ? (
            <TotalLine
              changed={after ? moneyValueChanged(after.cashAmount, before.cashAmount) : false}
              label="เงินสด"
              previousValue={formatMoney(before.cashAmount)}
              value={formatMoney(after?.cashAmount ?? before.cashAmount)}
            />
          ) : null}
        </Box>
        {visible.length ? (
          <Box sx={{ display: "grid", gap: 0.75, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" } }}>
            {visible.map((f) => (
              <TotalLine
                key={f.key}
                changed={after ? moneyValueChanged(String(after[f.key] ?? ""), String(before[f.key] ?? "")) : false}
                label={f.label}
                previousValue={formatMoney(String(before[f.key] ?? ""))}
                value={formatMoney(after ? String(after[f.key] ?? "") : String(before[f.key] ?? ""))}
              />
            ))}
          </Box>
        ) : null}
        {(before.details ?? []).length ? (
          <Box>
            <Typography color="text.secondary" sx={{ display: "block", mb: 0.5 }} variant="caption">
              รายละเอียดการชำระ ({(before.details ?? []).length} รายการ)
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>ประเภทชำระ</TableCell>
                    <TableCell>เลขที่อ้างอิง</TableCell>
                    <TableCell>ธนาคาร / บัตร</TableCell>
                    <TableCell align="right">ยอดเดิม</TableCell>
                    <TableCell align="right">ยอดใหม่</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(before.details ?? []).map((row, idx) => {
                    const a = findPaymentDetailAfter(row, after?.details ?? [], idx);
                    const removed = Boolean(after) && !a;
                    const changed = removed || (a ? moneyValueChanged(a.amount, row.amount) : false);
                    const docTypeLabel = CB_DOC_TYPE_LABELS[row.docType] ?? `doc_type=${row.docType}`;
                    const rowNumber = row.rowOrder || row.lineNumber || idx + 1;
                    return (
                      <TableRow key={`${row.rowOrder || row.lineNumber}-${idx}`} sx={removed ? { bgcolor: "action.hover" } : undefined}>
                        <TableCell>{rowNumber}</TableCell>
                        <TableCell>{docTypeLabel}</TableCell>
                        <TableCell>{row.transNumber || "-"}</TableCell>
                        <TableCell>{[row.bankCode, row.creditCardType].filter(Boolean).join(" / ") || "-"}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", textDecoration: changed ? "line-through" : "none", color: changed ? "text.secondary" : "text.primary" }}>{formatMoney(row.amount)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: changed ? 800 : 500, color: changed ? "warning.main" : "text.primary" }}>{a ? formatMoney(a.amount) : "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

type PaymentRow = NonNullable<DocumentChangePreview["paymentBefore"]>;
type PaymentDetailRow = NonNullable<DocumentChangePreview["paymentBefore"]>["details"][number];

function findPaymentDetailAfter(beforeRow: PaymentDetailRow, afterDetails: PaymentDetailRow[], fallbackIndex: number): PaymentDetailRow | undefined {
  const rowOrderMatch = beforeRow.rowOrder
    ? afterDetails.find((detail) => detail.rowOrder === beforeRow.rowOrder)
    : undefined;
  if (rowOrderMatch) return rowOrderMatch;

  const identityMatch = afterDetails.find((detail) =>
    detail.lineNumber === beforeRow.lineNumber &&
    detail.docType === beforeRow.docType &&
    detail.transNumber === beforeRow.transNumber &&
    detail.bankCode === beforeRow.bankCode &&
    detail.creditCardType === beforeRow.creditCardType
  );
  if (identityMatch) return identityMatch;

  if (isCard3881PaymentDetail(beforeRow)) return undefined;
  return afterDetails[fallbackIndex];
}

function moneyValueNonZero(v: string | undefined | null): boolean {
  if (!v) return false;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) > 0.005;
}

function documentsURL(fromDate: string, toDate: string, q = "") {
  const params = new URLSearchParams({ from: fromDate, to: toDate, page: "1", pageSize: "100" });
  if (q.trim()) params.set("q", q.trim());
  return `/api/v1/documents?${params.toString()}`;
}

function reviewQueuePriority(item: BulkDocumentChangeItem) {
  if (item.preview) return 0;
  if (item.status === "blocked" || item.status === "failed" || item.status === "skipped") return 1;
  return 2;
}

function isActiveBatchStatus(status: BulkApplyBatchProgress["status"]) {
  return status === "pending" || status === "processing";
}

function getInitialReviewDocNo(items: BulkDocumentChangeItem[]) {
  const queue = [...items].sort((a, b) => reviewQueuePriority(a) - reviewQueuePriority(b));
  return queue.find((item) => item.preview)?.docNo
    || queue[0]?.docNo
    || "";
}

// ----- Phase C helpers / components -----

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseFloat2(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function evaluatePaymentPreviewPolicy(
  before: NonNullable<DocumentChangePreview["paymentBefore"]>,
  newTotalStr: string,
): { after: NonNullable<DocumentChangePreview["paymentBefore"]>; error: string; blockedReason: string } {
  const newTotal = parseFloat2(newTotalStr);
  if (newTotal < 0) return { after: before, error: "ยอดชำระใหม่ไม่ถูกต้อง", blockedReason: "ยอดชำระใหม่ไม่ถูกต้อง" };

  const FIELDS = ["cashAmount", "chqAmount", "tranferAmount", "cardAmount", "walletAmount", "couponAmount", "pointAmount", "depositAmount", "advanceAmount", "pettyCashAmount"] as const;
  const oldCard = parseFloat2(before.cardAmount);
  const payCash = parseFloat2(before.payCashAmount);
  const cardToCashAmount = paymentCard3881TransferAmount(before.details ?? []);
  const cardReduction = Math.min(oldCard, cardToCashAmount);
  const protectedPayment = protectedPaymentPreview(before, cardReduction);
  if (newTotal < protectedPayment.total - 0.01) {
    const blockedReason = `ยอดบิลใหม่ต่ำกว่า payment ที่ต้องคงเดิม (${protectedPayment.labels.join(", ")}) จึงยังไม่ส่งเข้า SML`;
    return { after: before, error: blockedReason, blockedReason };
  }
  const nextCash = round2(newTotal - protectedPayment.total);
  const nextCard = round2(oldCard - cardReduction);
  if (nextCash < -0.01) {
    const blockedReason = "ยอดบิลใหม่ทำให้เงินสดติดลบ จึงยังไม่ส่งเข้า SML";
    return { after: before, error: blockedReason, blockedReason };
  }

  const safeDetails = before.details ?? [];
  const details = safeDetails.filter((d) => !isCard3881PaymentDetail(d)).map((d) => ({ ...d }));
  const boundedCash = Math.max(0, nextCash);
  const nextPayCash = cardToCashAmount > 0.01 ? Math.max(payCash, boundedCash) : payCash;

  return { after: {
    ...before,
    totalAmount: newTotal.toFixed(2),
    totalNetAmount: newTotal.toFixed(2),
    totalAmountPay: newTotal.toFixed(2),
    payCashAmount: nextPayCash.toFixed(2),
    moneyChange: Math.max(0, round2(nextPayCash - boundedCash)).toFixed(2),
    cashAmount: boundedCash.toFixed(2),
    chqAmount: parseFloat2(before[FIELDS[1]]).toFixed(2),
    tranferAmount: parseFloat2(before[FIELDS[2]]).toFixed(2),
    cardAmount: Math.max(0, nextCard).toFixed(2),
    walletAmount: parseFloat2(before[FIELDS[4]]).toFixed(2),
    couponAmount: parseFloat2(before[FIELDS[5]]).toFixed(2),
    pointAmount: parseFloat2(before[FIELDS[6]]).toFixed(2),
    depositAmount: parseFloat2(before[FIELDS[7]]).toFixed(2),
    advanceAmount: parseFloat2(before[FIELDS[8]]).toFixed(2),
    pettyCashAmount: parseFloat2(before[FIELDS[9]]).toFixed(2),
    details,
  }, error: "", blockedReason: "" };
}

function protectedPaymentPreview(before: NonNullable<DocumentChangePreview["paymentBefore"]>, cardReduction: number): { total: number; labels: string[] } {
  const header = new Map<string, number>([
    ["เช็ค", parseFloat2(before.chqAmount)],
    ["เงินโอน", parseFloat2(before.tranferAmount)],
    ["บัตรเครดิต", Math.max(0, round2(parseFloat2(before.cardAmount) - cardReduction))],
    ["Wallet", parseFloat2(before.walletAmount)],
    ["คูปอง", parseFloat2(before.couponAmount)],
    ["พอยต์", parseFloat2(before.pointAmount)],
    ["มัดจำ", parseFloat2(before.depositAmount)],
    ["เงินล่วงหน้า", parseFloat2(before.advanceAmount)],
    ["เงินสดย่อย", parseFloat2(before.pettyCashAmount)],
  ]);
  const detail = new Map<string, number>();
  let otherDetail = 0;
  for (const row of before.details ?? []) {
    if (isCard3881PaymentDetail(row)) continue;
    const amount = parseFloat2(row.amount) || parseFloat2(row.sumAmount);
    if (amount <= 0) continue;
    const label = paymentDetailProtectedLabel(row.docType);
    if (label) detail.set(label, round2((detail.get(label) ?? 0) + amount));
    else otherDetail = round2(otherDetail + amount);
  }
  const order = ["เช็ค", "เงินโอน", "บัตรเครดิต", "Wallet", "คูปอง", "พอยต์", "มัดจำ", "เงินล่วงหน้า", "เงินสดย่อย"];
  let total = 0;
  const labels: string[] = [];
  for (const label of order) {
    const amount = Math.max(header.get(label) ?? 0, detail.get(label) ?? 0);
    if (amount <= 0.01) continue;
    total = round2(total + amount);
    labels.push(`${label} ${amount.toFixed(2)}`);
  }
  if (otherDetail > 0.01) {
    total = round2(total + otherDetail);
    labels.push(`รายการชำระอื่น ${otherDetail.toFixed(2)}`);
  }
  return { total, labels: labels.length ? labels : ["ไม่มี"] };
}

function paymentDetailProtectedLabel(docType: number): string {
  switch (docType) {
    case 1: return "เงินโอน";
    case 2: return "เช็ค";
    case 3: return "บัตรเครดิต";
    case 4: return "เงินสดย่อย";
    case 5: return "เงินล่วงหน้า";
    case 9: return "คูปอง";
    case 21: return "Wallet";
    default: return "";
  }
}

function isCard3881PaymentDetail(detail: NonNullable<DocumentChangePreview["paymentBefore"]>["details"][number]) {
  return detail.docType === 3 && (detail.transNumber.includes("3881") || detail.creditCardType.includes("3881"));
}

function paymentCard3881TransferAmount(details: NonNullable<DocumentChangePreview["paymentBefore"]>["details"]) {
  return round2(details.reduce((sum, detail) => {
    if (!isCard3881PaymentDetail(detail)) return sum;
    const amount = parseFloat2(detail.amount);
    return sum + (amount || parseFloat2(detail.sumAmount));
  }, 0));
}

// Mirror of backend payment policy: cash absorbs bill deltas, and 3881 credit-card details are converted to cash.
function simulatePaymentAfter(before: NonNullable<DocumentChangePreview["paymentBefore"]>, newTotalStr: string): { after: NonNullable<DocumentChangePreview["paymentBefore"]>; error: string } {
  const result = evaluatePaymentPreviewPolicy(before, newTotalStr);
  return { after: result.after, error: result.error };
}

function newCashPreviewPayment(template: NonNullable<DocumentChangePreview["paymentAfter"]>, newTotalStr: string): NonNullable<DocumentChangePreview["paymentAfter"]> {
  const total = parseFloat2(newTotalStr).toFixed(2);
  return {
    ...template,
    totalAmount: total,
    totalNetAmount: total,
    totalAmountPay: total,
    cashAmount: total,
    payCashAmount: "0.00",
    moneyChange: "0.00",
    chqAmount: "0.00",
    tranferAmount: "0.00",
    cardAmount: "0.00",
    walletAmount: "0.00",
    couponAmount: "0.00",
    pointAmount: "0.00",
    depositAmount: "0.00",
    advanceAmount: "0.00",
    pettyCashAmount: "0.00",
    details: [],
  };
}

// Mirror of backend computeTotalsFromLines: vat_type 0=excl 7%, 1=incl 7%, 2=zero VAT, 3=no VAT impact.
function recomputeClientTotals(
  remaining: DocumentDetailLine[],
  removed: Set<string>,
  added: NewLineInput[],
  lineEdits: Map<number, LineEditDraft>,
  vatType: number,
): { totalValue: string; totalBeforeVat: string; totalVatValue: string; totalAfterVat: string; totalExceptVat: string; totalAmount: string } {
  let sumAmount = 0;
  let storedVat = 0;
  let storedExcl = 0;
  for (const line of remaining) {
    if (removed.has(line.itemCode)) continue;
    const effectiveLine = applyLineEditToLine(line, lineEdits.get(line.rowOrder)).line;
    sumAmount += parseFloat2(effectiveLine.sumAmount);
    storedVat += parseFloat2(effectiveLine.totalVatValue);
    // line doesn't carry sum_amount_exclude_vat in client; fall back to sumAmount when vat_type=3
    storedExcl += parseFloat2(line.sumAmount);
  }
  for (const a of added) {
    const qty = parseFloat2(a.qty);
    const price = parseFloat2(a.price);
    const disc = computeSmlDiscountAmount(qty, price, a.discount).amount;
    const lineAmount = round2(qty * price - disc);
    sumAmount += lineAmount;
    storedExcl += lineAmount;
  }
  let totalValue = 0;
  let totalBeforeVat = 0;
  let totalVat = 0;
  let totalAfterVat = 0;
  let totalAmount = 0;
  switch (vatType) {
    case 0:
      totalValue = sumAmount;
      totalBeforeVat = sumAmount;
      totalVat = round2((sumAmount * 7) / 100);
      totalAfterVat = round2(sumAmount + totalVat);
      totalAmount = totalAfterVat;
      break;
    case 1:
      totalValue = sumAmount;
      totalBeforeVat = round2((sumAmount * 100) / 107);
      totalVat = round2(sumAmount - totalBeforeVat);
      totalAfterVat = sumAmount;
      totalAmount = sumAmount;
      break;
    case 2:
      totalValue = sumAmount;
      totalBeforeVat = 0;
      totalVat = 0;
      totalAfterVat = 0;
      totalAmount = sumAmount;
      break;
    case 3:
      totalValue = sumAmount;
      totalBeforeVat = 0;
      totalVat = 0;
      totalAfterVat = 0;
      totalAmount = sumAmount;
      break;
    default:
      totalValue = storedExcl;
      totalBeforeVat = storedExcl;
      totalVat = storedVat;
      totalAfterVat = round2(storedExcl + storedVat);
      totalAmount = totalAfterVat;
      break;
  }
  return {
    totalValue: totalValue.toFixed(2),
    totalBeforeVat: totalBeforeVat.toFixed(2),
    totalVatValue: totalVat.toFixed(2),
    totalAfterVat: totalAfterVat.toFixed(2),
    totalExceptVat: "0.00",
    totalAmount: totalAmount.toFixed(2),
  };
}

function recomputedTotalsForItem(item: BulkDocumentChangeItem, perDocEdits: Map<string, PerDocEditState>): { totalValue: string; totalBeforeVat: string; totalVatValue: string; totalAfterVat: string; totalExceptVat: string; totalAmount: string } {
  if (!item.preview) return { totalValue: "0", totalBeforeVat: "0", totalVatValue: "0", totalAfterVat: "0", totalExceptVat: "0", totalAmount: "0" };
  const edit = perDocEdits.get(item.docNo);
  if (!edit) {
    return {
      totalValue: item.preview.totals.totalValue,
      totalBeforeVat: item.preview.totals.totalBeforeVat ?? item.preview.after.totalBeforeVat,
      totalVatValue: item.preview.totals.totalVatValue,
      totalAfterVat: item.preview.totals.totalAfterVat ?? item.preview.after.totalAfterVat,
      totalExceptVat: item.preview.totals.totalExceptVat ?? item.preview.after.totalExceptVat,
      totalAmount: item.preview.totals.totalAmount,
    };
  }
  return recomputeClientTotals(
    item.preview.remainingLines,
    edit.removed,
    edit.added,
    edit.lineEdits,
    item.preview.after.vatType ?? item.preview.before.vatType ?? 0,
  );
}

function applyLineEditToLine(line: DocumentDetailLine, edit?: LineEditDraft): { line: DocumentDetailLine; error: string } {
  if (!edit) return { line, error: "" };
  const qty = edit.qty !== undefined ? Number(edit.qty) : parseFloat2(line.qty);
  if (!Number.isInteger(qty) || qty <= 0) return { line, error: "จำนวนไม่ถูกต้อง" };
  const price = edit.price !== undefined ? Number(edit.price) : parseFloat2(line.price);
  if (!Number.isFinite(price) || price < 0) return { line, error: "ราคาไม่ถูกต้อง" };
  const discount = edit.discount !== undefined ? edit.discount : line.discount;
  const discountResult = computeSmlDiscountAmount(qty, price, discount);
  if (discountResult.error) return { line, error: "ส่วนลดไม่ถูกต้อง" };
  const sumAmount = round2(qty * price - discountResult.amount);
  if (sumAmount < -0.005) return { line, error: "ส่วนลดมากกว่ายอดสินค้า" };
  return {
    line: {
      ...line,
      qty: qty.toFixed(2),
      price: price.toFixed(2),
      discount,
      sumAmount: Math.max(0, sumAmount).toFixed(2),
    },
    error: "",
  };
}

function lineEditError(line: DocumentDetailLine, edit: LineEditDraft): string {
  return applyLineEditToLine(line, edit).error;
}

function computeSmlDiscountAmount(qty: number, price: number, discountText: string): { amount: number; error: string } {
  const text = discountText.trim();
  if (!text) return { amount: 0, error: "" };
  let remaining = round2(qty * price);
  let total = 0;
  for (const rawPart of text.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    let amount = 0;
    if (part.endsWith("%")) {
      const percent = Number(part.slice(0, -1).trim());
      if (!Number.isFinite(percent) || percent < 0) return { amount: 0, error: "invalid percent" };
      amount = round2((remaining * percent) / 100);
    } else {
      const fixed = Number(part);
      if (!Number.isFinite(fixed) || fixed < 0) return { amount: 0, error: "invalid amount" };
      amount = round2(fixed * qty);
    }
    total = round2(total + amount);
    remaining = round2(remaining - amount);
    if (remaining < -0.005) return { amount: 0, error: "discount exceeds line amount" };
    if (remaining < 0) remaining = 0;
  }
  return { amount: total, error: "" };
}

function formatQtyInput(value: string) {
  const qty = parseFloat2(value);
  return qty > 0 ? String(Math.round(qty)) : "";
}

function formatPriceInput(value: string) {
  const price = parseFloat2(value);
  return price >= 0 ? String(price) : "";
}

function updateLineEditDraft(
  current: PerDocEditState,
  line: DocumentDetailLine,
  field: keyof LineEditDraft,
  value: string,
): PerDocEditState {
  const nextLineEdits = new Map(current.lineEdits);
  const existing = { ...(nextLineEdits.get(line.rowOrder) ?? {}) };
  const nextValue = value.trim();
  const originalValue = originalLineFieldValue(line, field);
  if (nextValue === originalValue) {
    delete existing[field];
  } else {
    existing[field] = nextValue;
  }
  if (existing.qty === undefined && existing.price === undefined && existing.discount === undefined) {
    nextLineEdits.delete(line.rowOrder);
  } else {
    nextLineEdits.set(line.rowOrder, existing);
  }
  return { ...current, lineEdits: nextLineEdits };
}

function originalLineFieldValue(line: DocumentDetailLine, field: keyof LineEditDraft): string {
  switch (field) {
    case "qty":
      return formatQtyInput(line.qty);
    case "price":
      return formatPriceInput(line.price);
    case "discount":
      return line.discount.trim();
    default:
      return "";
  }
}

function EditableDocumentLinesPanel({
  docNo,
  lines,
  removed,
  lineEdits,
  added,
  onToggleRemove,
  onLineFieldChange,
  onRemoveAdded,
  onAdd,
}: {
  docNo: string;
  lines: DocumentDetailLine[];
  removed?: Set<string>;
  lineEdits?: Map<number, LineEditDraft>;
  added: NewLineInput[];
  onToggleRemove: (itemCode: string) => void;
  onLineFieldChange: (line: DocumentDetailLine, field: keyof LineEditDraft, value: string) => void;
  onRemoveAdded: (index: number) => void;
  onAdd: (line: NewLineInput) => void;
}) {
  const removedSet = removed ?? new Set<string>();
  const lineEditMap = lineEdits ?? new Map<number, LineEditDraft>();
  const removedLineCount = lines.filter((line) => removedSet.has(line.itemCode)).length;
  const activeLineCount = lines.length - removedLineCount + added.length;
  // ซ่อนฟีเจอร์“เพิ่มสินค้า”ตามคำขอผู้ใช้: พรีวิวให้ใช้การลบ/ติดลบเท่านั้น.
  void onAdd;
  void onRemoveAdded;
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <EmphasisText>รายการสินค้าในบิล {docNo}</EmphasisText>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Chip label={`${activeLineCount} รายการ`} size="small" />
            {removedLineCount ? <Chip color="warning" label={`ลบ ${removedLineCount}`} size="small" /> : null}
            {added.length ? <Chip color="success" label={`เพิ่ม ${added.length}`} size="small" /> : null}
          </Stack>
        </Stack>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 36 }}></TableCell>
                <TableCell>รหัสสินค้า</TableCell>
                <TableCell>ชื่อสินค้า</TableCell>
                <TableCell align="right">จำนวน</TableCell>
                <TableCell>หน่วย</TableCell>
                <TableCell align="right">ราคา</TableCell>
                <TableCell align="right">ส่วนลด</TableCell>
                <TableCell align="right">รวม</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => {
                const isRemoved = removedSet.has(line.itemCode);
                const edit = lineEditMap.get(line.rowOrder);
                const qtyValue = edit?.qty ?? formatQtyInput(line.qty);
                const priceValue = edit?.price ?? formatPriceInput(line.price);
                const discountValue = edit && "discount" in edit ? edit.discount ?? "" : line.discount;
                const applied = applyLineEditToLine(line, edit);
                const effectiveLine = applied.line;
                const qtyInvalid = Boolean(edit?.qty !== undefined && (!Number.isInteger(Number(qtyValue)) || Number(qtyValue) <= 0));
                const priceInvalid = Boolean(edit?.price !== undefined && (!Number.isFinite(Number(priceValue)) || Number(priceValue) < 0));
                const discountInvalid = Boolean(edit?.discount !== undefined && applied.error);
                return (
                  <TableRow key={`l-${line.lineNumber}-${line.itemCode}`} sx={isRemoved ? { textDecoration: "line-through", opacity: 0.55, bgcolor: "action.hover" } : undefined}>
                    <TableCell>
                      {isRemoved ? (
                        <Tooltip title="ย้อนกลับ">
                          <IconButton aria-label="ย้อนกลับ" onClick={() => onToggleRemove(line.itemCode)} size="small">
                            <RotateCcw size={14} />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title="ลบรายการนี้">
                          <IconButton aria-label="ลบรายการ" color="error" onClick={() => onToggleRemove(line.itemCode)} size="small">
                            <Trash2 size={14} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell><DocCode value={line.itemCode} /></TableCell>
                    <TableCell>{line.itemName}</TableCell>
                    <TableCell align="right" sx={{ minWidth: 112 }}>
                      <TextField
                        error={qtyInvalid}
                        disabled={isRemoved}
                        onChange={(event) => onLineFieldChange(line, "qty", event.target.value)}
                        size="small"
                        slotProps={{ htmlInput: { min: "1", step: "1", style: { textAlign: "right" } } }}
                        type="number"
                        value={qtyValue}
                      />
                    </TableCell>
                    <TableCell>{line.unitCode}</TableCell>
                    <TableCell align="right" sx={{ minWidth: 116 }}>
                      <TextField
                        error={priceInvalid}
                        disabled={isRemoved}
                        onChange={(event) => onLineFieldChange(line, "price", event.target.value)}
                        size="small"
                        slotProps={{ htmlInput: { min: "0", step: "0.01", style: { textAlign: "right" } } }}
                        type="number"
                        value={priceValue}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ minWidth: 112 }}>
                      <TextField
                        error={discountInvalid}
                        disabled={isRemoved}
                        onChange={(event) => onLineFieldChange(line, "discount", event.target.value)}
                        size="small"
                        slotProps={{ htmlInput: { style: { textAlign: "right" } } }}
                        value={discountValue}
                      />
                    </TableCell>
                    <TableCell align="right"><Money value={formatMoney(effectiveLine.sumAmount)} /></TableCell>
                  </TableRow>
                );
              })}
              {added.map((a, idx) => {
                const qty = parseFloat2(a.qty);
                const price = parseFloat2(a.price);
                const disc = computeSmlDiscountAmount(qty, price, a.discount).amount;
                const lineAmount = round2(qty * price - disc);
                return (
                  <TableRow key={`a-${idx}-${a.itemCode}`} sx={{ bgcolor: "success.50" }}>
                    <TableCell>
                      <Tooltip title="ยกเลิกการเพิ่ม">
                        <IconButton aria-label="ลบรายการที่เพิ่ม" color="error" onClick={() => onRemoveAdded(idx)} size="small">
                          <Trash2 size={14} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                        <DocCode value={a.itemCode} />
                        <Chip color="success" label="ใหม่" size="small" />
                      </Stack>
                    </TableCell>
                    <TableCell>{a.itemName}</TableCell>
                    <TableCell align="right">{formatMoney(a.qty)}</TableCell>
                    <TableCell>{a.unitCode}</TableCell>
                    <TableCell align="right">{formatMoney(a.price)}</TableCell>
                    <TableCell align="right">{formatMoney(a.discount)}</TableCell>
                    <TableCell align="right"><Money value={formatMoney(lineAmount.toFixed(2))} /></TableCell>
                  </TableRow>
                );
              })}
              {activeLineCount === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography color="text.secondary" sx={{ textAlign: "center", py: 2 }} variant="body2">
                      บิลนี้ไม่มีรายการสินค้าเหลือ ต้องยกเลิกการลบอย่างน้อย 1 รายการก่อนส่งเข้า SML
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </Paper>
  );
}

function AddItemDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (line: NewLineInput) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("0");
  const [unitCode, setUnitCode] = useState("");
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) { setOptions([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const resp = await apiGet<{ items: ProductOption[] }>(`/api/v1/master/products?q=${encodeURIComponent(q)}&limit=20`);
      if (cancelled) return;
      setOptions(resp.success && resp.data ? resp.data.items : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => {
    if (!product) { setUnits([]); return; }
    let cancelled = false;
    setUnitsLoading(true);
    (async () => {
      const resp = await apiGet<{ items: ProductUnit[] }>(`/api/v1/master/product-units?code=${encodeURIComponent(product.code)}`);
      if (cancelled) return;
      const items = resp.success && resp.data ? resp.data.items : [];
      setUnits(items);
      setUnitsLoading(false);
      // Auto-pick: prefer product's standard unit if it's in the list, otherwise the first row, otherwise the product's standard unit as fallback.
      const fallback = product.unitCode || "";
      const hasFallback = items.some((u) => u.code === fallback);
      if (hasFallback) {
        setUnitCode(fallback);
      } else if (items.length > 0) {
        setUnitCode(items[0].code);
      } else {
        setUnitCode(fallback);
      }
    })();
    return () => { cancelled = true; };
  }, [product]);

  function handleAdd() {
    if (!product) { setError("เลือกสินค้าก่อน"); return; }
    const q = parseFloat(qty);
    if (!Number.isFinite(q) || q <= 0) { setError("จำนวนต้องมากกว่า 0"); return; }
    const p = parseFloat(price);
    if (!Number.isFinite(p) || p < 0) { setError("ราคาต้องเป็นตัวเลข ≥ 0"); return; }
    const d = parseFloat(discount || "0");
    if (!Number.isFinite(d) || d < 0) { setError("ส่วนลดต้องเป็นตัวเลข ≥ 0"); return; }
    onAdd({
      itemCode: product.code,
      itemName: product.name,
      unitCode: unitCode || product.unitCode || "",
      qty: q.toString(),
      price: p.toString(),
      discount: d.toString(),
      whCode: "",
      shelfCode: "",
    });
  }

  return (
    <Dialog fullWidth maxWidth="sm" open onClose={onClose}>
      <DialogTitle>เพิ่มสินค้าเข้าบิล</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Autocomplete
            filterOptions={(x) => x}
            getOptionLabel={(opt) => `${opt.code} — ${opt.name}`}
            isOptionEqualToValue={(a, b) => a.code === b.code}
            loading={loading}
            noOptionsText={query.trim() ? "ไม่พบสินค้า" : "พิมพ์เพื่อค้นหา"}
            onChange={(_, v) => { setProduct(v); }}
            onInputChange={(_, v) => setQuery(v)}
            options={options}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="ค้นหารหัส/ชื่อสินค้า"
                size="small"
              />
            )}
            value={product}
          />
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr 1fr 1fr" } }}>
            <TextField label="จำนวน" onChange={(e) => setQty(e.target.value)} size="small" type="number" value={qty} />
            <TextField
              disabled={!product || unitsLoading}
              helperText={product && !unitsLoading && units.length === 0 ? "ไม่มีหน่วยใน ic_unit_use" : " "}
              label="หน่วย"
              onChange={(e) => setUnitCode(e.target.value)}
              select={units.length > 0}
              size="small"
              value={unitCode}
            >
              {units.length > 0
                ? units.map((u) => (
                    <MenuItem key={u.code} value={u.code}>
                      {u.code}{u.name && u.name !== u.code ? ` — ${u.name}` : ""}
                    </MenuItem>
                  ))
                : null}
            </TextField>
            <TextField label="ราคา" onChange={(e) => setPrice(e.target.value)} size="small" type="number" value={price} />
            <TextField label="ส่วนลด" onChange={(e) => setDiscount(e.target.value)} size="small" type="number" value={discount} />
          </Box>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <AppButton onClick={onClose}>ยกเลิก</AppButton>
        <AppButton onClick={handleAdd} tone="primary">เพิ่ม</AppButton>
      </DialogActions>
    </Dialog>
  );
}

export default BulkInvoiceEditPage;
