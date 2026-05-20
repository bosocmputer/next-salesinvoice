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
  Tab,
  Table,
  TableBody,
  Tooltip,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, HelpCircle, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react";
import type {
  BulkDocumentChangeItem,
  BulkDocumentChangeRequest,
  BulkDocumentChangeResult,
  BulkPreviewFilter,
  DatabaseStatus,
  DocEdit,
  DocFormat,
  DocumentChangePreview,
  DocumentDetailLine,
  DocumentSummary,
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
import { AppButton, EmptyState, MetricValue, PageLoading, StatusBadge } from "../components/ui";
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
const today = new Date();
const initialFromDate = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
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
  const [perDocEdits, setPerDocEdits] = useState<Map<string, { removed: Set<string>; added: NewLineInput[] }>>(new Map());
  // Sentinel for bulk-edit: vatType=-1 → "คงค่าเดิมของแต่ละบิล".
  // inquiryType ถูกตัดออกจาก UI — ส่ง 0 (sentinel) ตลอด เพื่อให้ backend ใช้ค่าเดิมของแต่ละบิล.
  const inquiryType = 0;
  const [vatType, setVatType] = useState(-1);
  const [remark, setRemark] = useState("");
  const [preview, setPreview] = useState<BulkDocumentChangeResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<BulkPreviewFilter>("all");
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewDialogDocNo, setPreviewDialogDocNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [confirmApplyText, setConfirmApplyText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [detailDocNo, setDetailDocNo] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

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
    vatType !== -1 ||
    remark.trim() !== "";
  const canPreview = selectedDocNos.length > 0 && hasAnyChange;
  const workflowHint = canPreview
    ? `พร้อมพรีวิว ${selectedDocNos.length} บิล (ฟิลด์ที่เว้นว่าง = ใช้ค่าเดิมของแต่ละบิล)`
    : selectedDocNos.length
      ? "ระบุการแก้ไขอย่างน้อย 1 รายการ (ลูกหนี้ / ชุดเลข / ประเภทภาษี / หมายเหตุ)"
      : "เลือกบิลจากตารางก่อน แล้วค่อยตั้งค่าการแก้ไข";
  const readyPreviewCount = preview?.items.filter((item) => item.status === "ready").length || 0;
  const warningPreviewCount = preview?.items.filter((item) => item.status === "warning").length || 0;
  const blockedPreviewCount = preview?.items.filter((item) => item.status === "blocked" || item.status === "failed" || item.status === "skipped").length || 0;
  const writablePreviewCount = readyPreviewCount + warningPreviewCount;

  // Per-doc edit helpers
  function setPerDocEditEntry(
    docNo: string,
    updater: (current: { removed: Set<string>; added: NewLineInput[] }) => { removed: Set<string>; added: NewLineInput[] },
  ) {
    setPerDocEdits((m) => {
      const next = new Map(m);
      const cur = next.get(docNo) ?? { removed: new Set<string>(), added: [] };
      next.set(docNo, updater(cur));
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
    if (item.status !== "ready" && item.status !== "warning") return false;
    return effectiveLineCount(item) === 0;
  }));
  const readyToApply = Boolean(isAdmin && preview && writablePreviewCount > 0 && busy === false && !hasEmptyAfterEdits);
  const visiblePreviewItems = preview?.items.filter((item) => {
    if (previewFilter === "all") return true;
    if (previewFilter === "blocked") return item.status === "blocked" || item.status === "failed" || item.status === "skipped";
    return item.status === "ready" || item.status === "warning";
  }) || [];
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

  // เมื่อผู้ใช้เปลี่ยน "จากวันที่" หรือ "ถึงวันที่" ให้โหลดรายการใหม่ทันที
  // (debounce 250ms เผื่อ keyboard typing) — ข้าม run แรกเพราะ loadInitial
  // จัดการการโหลดครั้งแรกอยู่แล้ว
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (!fromDate || !toDate) return;
    const timer = window.setTimeout(() => void loadDocuments(search, fromDate, toDate), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

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
    setPreviewFilter("all");
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
    await loadDocuments("");
  }

  async function refreshDocumentsAfterApply(successMessage: string) {
    setLoading(true);
    const response = await apiGet<PagedDocuments>(documentsURL(fromDate, toDate, search));
    if (response.success && response.data) {
      setDocuments(response.data);
      setSelectedDocNos([]);
      setPreview(null);
      setPreviewFilter("all");
      setPreviewDialogOpen(false);
      setPreviewDialogDocNo("");
      setMessage(successMessage);
    } else {
      setMessage(`${successMessage} แต่โหลดรายการล่าสุดไม่สำเร็จ: ${response.error?.detail || response.message || "ไม่ทราบสาเหตุ"}`);
    }
    setLoading(false);
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
    setRemark("");
    setSelectedFormat("");
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

  function buildBulkRequest(): BulkDocumentChangeRequest {
    const perDocEditsArr: DocEdit[] = [];
    perDocEdits.forEach((edits, docNo) => {
      const removed = Array.from(edits.removed);
      if (removed.length === 0 && edits.added.length === 0) return;
      perDocEditsArr.push({
        docNo,
        removeItemCodes: removed,
        addedLines: edits.added,
      });
    });
    return {
      docNos: selectedDocNos,
      docFormatCode: selectedFormat,
      customerCode: selectedCustomer,
      inquiryType,
      vatType,
      remark,
      removeItemCodes: [],
      ...(perDocEditsArr.length > 0 ? { perDocEdits: perDocEditsArr } : {}),
    };
  }

  async function previewBulk() {
    if (!canPreview) {
      setMessage("เลือกบิล ชุดเลขเอกสาร และลูกหนี้ก่อนพรีวิว");
      return;
    }
    setBusy(true);
    setPreviewing(true);
    setMessage("");
    try {
      const response = await apiPost<BulkDocumentChangeResult>("/api/v1/documents/bulk/preview-change", buildBulkRequest());
      if (response.success && response.data) {
        // Reset per-doc edits so the new preview starts from a clean slate.
        setPerDocEdits(new Map());
        setPreview(response.data);
        setPreviewFilter("all");
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

  async function applyBulk() {
    if (!preview || !readyToApply || !isAdmin) return;
    setBusy(true);
    setMessage("");
    const response = await apiPost<BulkDocumentChangeResult>("/api/v1/documents/bulk/apply-change", buildBulkRequest());
    if (response.success && response.data) {
      setPreview(response.data);
      setPreviewDialogDocNo(response.data.items.find((item) => item.status === "applied")?.docNo || response.data.items[0]?.docNo || "");
      await refreshDocumentsAfterApply(`ส่งเข้า SML สำเร็จ ${response.data.appliedCount} บิล${response.data.failedCount ? `, ส่งไม่สำเร็จ ${response.data.failedCount} บิล` : ""}${response.data.skippedCount ? `, ยังไม่ดำเนินการ ${response.data.skippedCount} บิล` : ""}`);
      setConfirmApplyOpen(false);
      setConfirmApplyText("");
      toast(`ส่งเข้า SML สำเร็จ ${response.data.appliedCount} บิล`, response.data.failedCount ? "warning" : "success");
    } else {
      const detail = response.error?.detail || response.message || "ส่งหลายบิลเข้า SML ไม่สำเร็จ";
      setMessage(detail);
      toast(detail, "error");
    }
    setBusy(false);
  }

  if (loading && !documents) return <PageLoading title="กำลังโหลดรายการบิลสำหรับแก้ไขบิล" />;

  return (
    <Stack spacing={1.5} sx={{ pb: selectedDocNos.length ? { xs: 11, sm: 8 } : 0 }}>
      {message ? <Alert severity={message.includes("สำเร็จ") || message.includes("เลือก") ? "success" : "warning"}>{message}</Alert> : null}

      <Box sx={{ alignItems: { sm: "flex-end" }, display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1, justifyContent: "space-between" }}>
        <Box>
          <SectionTitle level="h2">แก้ไขบิลครั้งละหลายใบ</SectionTitle>
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
            <TextField
              label="จากวันที่"
              onChange={(event) => { setFromDate(event.target.value); resetPreview(); }}
              size="small"
              type="date"
              value={fromDate}
            />
            <TextField
              label="ถึงวันที่"
              onChange={(event) => { setToDate(event.target.value); resetPreview(); }}
              size="small"
              type="date"
              value={toDate}
            />
            <TextField
              inputRef={searchInputRef}
              label="ค้นหา"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void loadDocuments(); }}
              placeholder="เลขบิล / รหัสลูกค้า / หมายเหตุ  (กด Ctrl+K, Enter เพื่อค้นหา)"
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
              <Tooltip arrow title="โหลดข้อมูลใหม่">
                <span>
                  <IconButton aria-label="โหลดใหม่" disabled={loading} onClick={() => void loadDocuments()} size="medium" sx={{ border: 1, borderColor: "divider", borderRadius: 1, height: 40, width: 40 }}>
                    <RefreshCw size={16} />
                  </IconButton>
                </span>
              </Tooltip>
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
              onPreview={() => void previewBulk()}
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
        <Box sx={{ height: "calc(100vh - 244px)", minHeight: 430, minWidth: 0, width: "100%" }}>
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
        <Dialog fullScreen={isMobile} fullWidth maxWidth="sm" open onClose={() => setSettingsOpen(false)}>
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
              <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
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
                      helperText="เว้นว่างเพื่อใช้ลูกหนี้เดิมของแต่ละบิล"
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
                <TextField
                  label="หมายเหตุใหม่"
                  minRows={2}
                  multiline
                  onChange={(event) => { setRemark(event.target.value); resetPreview(); }}
                  size="small"
                  sx={{ gridColumn: "1 / -1" }}
                  value={remark}
                />
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

      {preview ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between" }}>
            <Box>
              <Typography color="text.secondary" variant="body2">3. พรีวิวก่อนส่ง</Typography>
              <SectionTitle level="h2">พรีวิว {preview.totalCount} บิล</SectionTitle>
            </Box>
          </Stack>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" } }}>
            <MetricValue label="เอกสารทั้งหมด" value={String(preview.totalCount)} helper="ผลจากชุดที่เลือก" />
            <MetricValue label="ส่งเข้า SML ได้" value={String(writablePreviewCount)} helper="ผ่านพรีวิวและจะอยู่ในรอบยืนยัน" />
            <MetricValue label="ระบบไม่ส่ง" value={String(blockedPreviewCount)} helper="มีสาเหตุที่ต้องแก้ก่อนส่งใหม่" />
          </Box>
          <Tabs value={previewFilter} onChange={(_, value) => setPreviewFilter(value)}>
            <Tab label={`ทั้งหมด ${preview.totalCount}`} value="all" />
            <Tab label={`ส่งได้ ${writablePreviewCount}`} value="writable" />
            <Tab label={`ระบบไม่ส่ง ${blockedPreviewCount}`} value="blocked" />
          </Tabs>
          {blockedPreviewCount ? (
            <Alert icon={<AlertTriangle size={16} />} severity="warning">มีเอกสารที่ระบบไม่ส่งเข้า SML {blockedPreviewCount} บิล ระบบจะส่งเฉพาะ {writablePreviewCount} บิลที่ผ่านพรีวิว</Alert>
          ) : null}
          {isMobile ? (
            <Stack spacing={1}>
              {visiblePreviewItems.map((item) => (
                <Card key={item.docNo} variant="outlined">
                  <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack spacing={1.25}>
                      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                        <DocCode value={item.docNo} noWrap />
                        <Money value={formatMoney(item.preview?.totals.totalAmount || "")} />
                      </Stack>
                      <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "1fr 1fr" }}>
                        <SummaryLine label="เลขเดิม" value={item.docNo} strong />
                        <SummaryLine label="เลขใหม่" value={item.newDocNo || "-"} strong />
                        <SummaryLine label="ลูกหนี้" value={item.preview?.after.customerCode || selectedCustomer || "-"} />
                        <SummaryLine label="ลบสินค้า" value={(item.removeHits || []).length ? item.removeHits.join(", ") : "-"} />
                      </Box>
                      <Typography color="text.secondary" variant="body2">{item.message}</Typography>
                      <AppButton
                        fullWidth
                        onClick={() => {
                          setPreviewDialogDocNo(item.docNo);
                          setPreviewDialogOpen(true);
                        }}
                        size="small"
                        type="button"
                      >
                        ดูพรีวิว
                      </AppButton>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
              {!visiblePreviewItems.length ? <EmptyState title="ไม่มีรายการในตัวกรองนี้" description="ลองเลือกตัวกรองอื่นเพื่อดูพรีวิว" /> : null}
            </Stack>
          ) : (
          <TableContainer component={Paper} variant="outlined">
              <Table size="small" sx={{ minWidth: 960 }}>
              <TableHead>
                <TableRow>
                  <TableCell>เลขบิลเดิม</TableCell>
                  <TableCell>เลขบิลใหม่</TableCell>
                  <TableCell>ลูกหนี้</TableCell>
                  <TableCell>ลบสินค้า</TableCell>
                  <TableCell align="right">ยอดใหม่</TableCell>
                  <TableCell>หมายเหตุ</TableCell>
                  <TableCell align="right">ดูพรีวิว</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visiblePreviewItems.map((item) => (
                  <TableRow key={item.docNo}>
                    <TableCell><DocCode value={item.docNo} /></TableCell>
                    <TableCell>{item.newDocNo || "-"}</TableCell>
                    <TableCell>{item.preview?.after.customerCode || selectedCustomer || "-"}</TableCell>
                    <TableCell>{(item.removeHits || []).length ? item.removeHits.join(", ") : "-"}</TableCell>
                    <TableCell align="right"><Money value={formatMoney(item.preview?.totals.totalAmount || "")} /></TableCell>
                    <TableCell>{item.message}</TableCell>
                    <TableCell align="right">
                      <AppButton
                        onClick={() => {
                          setPreviewDialogDocNo(item.docNo);
                          setPreviewDialogOpen(true);
                        }}
                        size="small"
                        type="button"
                      >
                        ดูพรีวิว
                      </AppButton>
                    </TableCell>
                  </TableRow>
                ))}
                {!visiblePreviewItems.length ? (
                  <TableRow>
                    <TableCell colSpan={7}><EmptyState title="ไม่มีรายการในตัวกรองนี้" description="ลองเลือกตัวกรองอื่นเพื่อดูพรีวิว" /></TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
          )}
          <Alert
            severity="warning"
            action={(
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                <AppButton fullWidth={isMobile} onClick={() => setPreviewDialogOpen(true)}>เปิดพรีวิว</AppButton>
                {isAdmin ? <AppButton disabled={!readyToApply || busy} fullWidth={isMobile} onClick={() => setPreviewDialogOpen(true)} tone="danger">{busy ? "กำลังส่ง" : "ส่งเข้า SML"}</AppButton> : null}
              </Stack>
            )}
            sx={{ "& .MuiAlert-action": { alignItems: "stretch", pl: { xs: 0, sm: 2 }, width: { xs: "100%", sm: "auto" } }, flexDirection: { xs: "column", sm: "row" } }}
          >
            <EmphasisText>{isAdmin ? "สรุปก่อนส่งเข้า SML" : "สรุปผลพรีวิว"}</EmphasisText>
            <Typography variant="body2">
              {isAdmin
                ? `ส่งเข้า SML ได้ ${writablePreviewCount} บิล จากทั้งหมด ${preview.totalCount} บิล${blockedPreviewCount ? `, ระบบไม่ส่ง ${blockedPreviewCount} บิล` : ""}, ลูกหนี้ใหม่ ${selectedCustomer || "-"}, ชุดเลข ${selectedFormat || "-"}`
                : `พรีวิวพบ ${preview.totalCount} บิล, ส่งจริงได้เฉพาะผู้ดูแลระบบ, ลูกหนี้ใหม่ ${selectedCustomer || "-"}, ชุดเลข ${selectedFormat || "-"}`}
            </Typography>
          </Alert>
          </Stack>
        </Paper>
      ) : null}
      {preview && previewDialogOpen ? (
        <BulkPreviewDialog
          busy={busy}
          canApply={isAdmin}
          readyToApply={readyToApply}
          hasEmptyAfterEdits={hasEmptyAfterEdits}
          result={preview}
          selectedDocNo={previewDialogDocNo}
          selectedFormat={selectedFormat}
          selectedCustomer={selectedCustomer}
          requestedVatType={vatType}
          perDocEdits={perDocEdits}
          onUpdateEdit={setPerDocEditEntry}
          onClose={() => setPreviewDialogOpen(false)}
          onRequestApply={() => {
            setPreviewDialogOpen(false);
            setConfirmApplyOpen(true);
          }}
          onSelectDoc={(docNo) => setPreviewDialogDocNo(docNo)}
        />
      ) : null}
      {confirmApplyOpen && preview ? (
        <RiskConfirmDialog
          busy={busy}
          confirmDisabled={busy || confirmApplyText.trim() !== "ยืนยัน"}
          confirmLabel={busy ? "กำลังส่งเข้า SML" : "ยืนยันส่งเข้า SML"}
          detail={`ระบบจะเขียนข้อมูลจริงลง SML เฉพาะ ${writablePreviewCount} บิลที่ผ่านพรีวิว จากทั้งหมด ${preview.totalCount} บิล`}
          title="ยืนยันส่งเข้า SML"
          tone="danger"
          onCancel={() => { setConfirmApplyOpen(false); setConfirmApplyText(""); }}
          onConfirm={() => void applyBulk()}
        >
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" } }}>
            <SummaryLine label="บิลที่เลือก" value={`${selectedDocNos.length} บิล`} />
            <SummaryLine label="บิลที่จะส่งเข้า SML" value={`${writablePreviewCount} บิล`} strong />
            <SummaryLine label="ชุดเลขใหม่" value={selectedFormat || "-"} />
            <SummaryLine label="ลูกหนี้ใหม่" value={selectedCustomer || "-"} />
          </Box>
          <TextField
            autoFocus
            label="พิมพ์คำว่า ยืนยัน เพื่อยืนยัน"
            onChange={(event) => setConfirmApplyText(event.target.value)}
            placeholder="ยืนยัน"
            size="small"
            value={confirmApplyText}
          />
        </RiskConfirmDialog>
      ) : null}
    </Stack>
  );
}

function BulkPreviewDialog({
  busy,
  canApply,
  readyToApply,
  hasEmptyAfterEdits,
  result,
  selectedDocNo,
  selectedFormat,
  selectedCustomer,
  requestedVatType,
  perDocEdits,
  onUpdateEdit,
  onClose,
  onRequestApply,
  onSelectDoc,
}: {
  busy: boolean;
  canApply: boolean;
  readyToApply: boolean;
  hasEmptyAfterEdits: boolean;
  result: BulkDocumentChangeResult;
  selectedDocNo: string;
  selectedFormat: string;
  selectedCustomer: string;
  requestedVatType: number;
  perDocEdits: Map<string, { removed: Set<string>; added: NewLineInput[] }>;
  onUpdateEdit: (
    docNo: string,
    updater: (current: { removed: Set<string>; added: NewLineInput[] }) => { removed: Set<string>; added: NewLineInput[] },
  ) => void;
  onClose: () => void;
  onRequestApply: () => void;
  onSelectDoc: (docNo: string) => void;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const reviewQueue = [...result.items].sort((a, b) => reviewQueuePriority(a) - reviewQueuePriority(b));
  const selectedItem = reviewQueue.find((item) => item.docNo === selectedDocNo) || reviewQueue[0] || result.items[0];
  const selectedPreview = selectedItem?.preview || null;
  const selectedIndex = Math.max(0, reviewQueue.findIndex((item) => item.docNo === selectedItem?.docNo));
  const canNavigate = reviewQueue.length > 1;
  const reviewableItems = result.items.filter((item) => item.status === "ready" || item.status === "warning");
  const writableCount = reviewableItems.length;
  const blockedCount = result.items.filter((item) => item.status === "blocked" || item.status === "failed").length;
  const skippedCount = result.items.filter((item) => item.status === "skipped").length;
  const nonWritableCount = blockedCount + skippedCount;
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
    ? recomputeClientTotals(selectedPreview.remainingLines, selectedEdit.removed, selectedEdit.added, effectiveVatType)
    : null;
  const displayLineCount = selectedPreview
    ? (selectedEdit
        ? selectedPreview.remainingLines.filter((l) => !selectedEdit.removed.has(l.itemCode)).length + selectedEdit.added.length
        : selectedPreview.totals.lineCount)
    : 0;
  const displayTotalValue = recomputed ? recomputed.totalValue : selectedPreview?.after.totalValue ?? "";
  const displayTotalVat = recomputed ? recomputed.totalVatValue : selectedPreview?.totals.totalVatValue ?? "";
  const displayTotalAmount = recomputed ? recomputed.totalAmount : selectedPreview?.totals.totalAmount ?? "";
  const selectedBillIsEmpty = selectedIsWritable && selectedPreview ? displayLineCount === 0 : false;
  const footerProgressText = !canApply
    ? "สิทธิ์ User ดูพรีวิวได้เท่านั้น ต้องให้ Admin เป็นผู้ส่งเข้า SML"
    : hasEmptyAfterEdits
      ? "มีบิลที่ไม่มีสินค้าเหลือ ต้องยกเลิกการลบก่อนส่ง"
      : writableCount
        ? `ส่งเข้า SML ได้ ${writableCount} บิล${nonWritableCount ? `, ระบบจะไม่ส่ง ${nonWritableCount} บิล` : ""}`
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

          {hasEmptyAfterEdits ? (
            <Alert severity="error">
              มีบิลที่ลบสินค้าจนไม่เหลือรายการแล้ว ต้องเพิ่มสินค้าหรือยกเลิกการลบก่อนจึงจะส่งเข้า SML ได้
            </Alert>
          ) : null}

          <Alert severity="info">
            ระบบจะปรับ <strong>cb_trans / cb_trans_detail</strong> ให้ตรงกับยอดบิลใหม่อัตโนมัติ (ยอดชำระ = ยอดบิลใหม่)
          </Alert>

          <Box sx={{ alignItems: "start", display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: canNavigate ? "340px minmax(0, 1fr)" : "1fr" } }}>
            {canNavigate ? (
              <BulkReviewQueuePanel
                items={reviewQueue}
                onSelectDoc={onSelectDoc}
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

              {selectedItem && !selectedIsWritable ? (
                <Alert severity="warning">
                  <EmphasisText>เอกสารนี้ระบบจะไม่ส่งเข้า SML</EmphasisText>
                  {selectedItem.message || "เลือกเอกสารถัดไปเพื่อดูรายการที่ส่งได้"}
                </Alert>
              ) : null}

              {selectedPreview ? (
                <>
                  <PreviewChangeSummaryPanel preview={selectedPreview} />
                  <Box sx={{ display: "grid", columnGap: 2, rowGap: 0.75, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" } }}>
                    <DocumentFact label="เลขบิลเดิม" value={selectedPreview.before.docNo} strong />
                    <DocumentFact changed={valueChanged(selectedPreview.after.docNo, selectedPreview.before.docNo)} label="เลขบิลใหม่" previousValue={selectedPreview.before.docNo} value={selectedPreview.after.docNo} strong />
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
                    added={selectedEdit?.added || []}
                    onToggleRemove={(itemCode) => onUpdateEdit(selectedDocKey, (cur) => {
                      const next = new Set(cur.removed);
                      if (next.has(itemCode)) next.delete(itemCode);
                      else next.add(itemCode);
                      return { ...cur, removed: next };
                    })}
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
                    <Paper variant="outlined" sx={{ ...changedPaperSx(valueChanged(selectedPreview.after.remark, selectedPreview.before.remark)), p: 1.25 }}>
                      <Typography color="text.secondary" variant="caption">หมายเหตุหลังแก้ไข</Typography>
                      <EmphasisText>{maskInternalRemark(selectedPreview.after.remark) || "ไม่มีหมายเหตุ"}</EmphasisText>
                      {valueChanged(selectedPreview.after.remark, selectedPreview.before.remark) ? (
                        <Typography color="text.secondary" sx={{ display: "block", mt: 0.25 }} variant="caption">เดิม: {maskInternalRemark(selectedPreview.before.remark) || "ไม่มีหมายเหตุ"}</Typography>
                      ) : null}
                    </Paper>
                    <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" } }}>
                      <TotalLine changed={displayLineCount !== selectedPreview.remainingLines.length} label="รายการคงเหลือ" previousValue={`${selectedPreview.remainingLines.length + selectedPreview.removedLines.length} รายการ`} value={`${displayLineCount} รายการ`} />
                      <TotalLine label="มูลค่าสินค้า" value={formatMoney(displayTotalValue)} />
                      <TotalLine changed={moneyValueChanged(displayTotalVat, selectedPreview.before.totalVatValue)} label="มูลค่าภาษี" previousValue={formatMoney(selectedPreview.before.totalVatValue)} value={formatMoney(displayTotalVat)} />
                      <TotalLine changed={moneyValueChanged(displayTotalAmount, selectedPreview.before.totalAmount)} label="ยอดสุทธิใหม่" previousValue={formatMoney(selectedPreview.before.totalAmount)} value={formatMoney(displayTotalAmount)} strong />
                    </Box>
                  </Stack>

                  <PaymentChangePreviewPanel preview={selectedPreview} />
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

function BulkReviewQueuePanel({
  items,
  onSelectDoc,
  selectedDocNo,
}: {
  items: BulkDocumentChangeItem[];
  onSelectDoc: (docNo: string) => void;
  selectedDocNo: string;
}) {
  return (
    <Paper
      aria-label="คิวเอกสาร"
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        maxHeight: { xs: 260, md: "calc(100vh - 245px)" },
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
      <Stack spacing={0.75} sx={{ overflow: "auto", p: 1 }}>
        {items.map((item) => {
          const selected = item.docNo === selectedDocNo;
          const totalAmount = item.preview ? formatMoney(item.preview.totals.totalAmount) : "-";
          const customerCode = item.preview?.after.customerCode || "-";
          return (
            <Button
              key={item.docNo}
              onClick={() => onSelectDoc(item.docNo)}
              type="button"
              variant="outlined"
              sx={{
                alignItems: "stretch",
                bgcolor: selected ? "rgba(36, 90, 109, 0.10)" : "background.paper",
                borderColor: selected ? "primary.main" : "divider",
                color: "text.primary",
                display: "block",
                minHeight: 78,
                p: 1,
                textAlign: "left",
              }}
            >
              <Stack spacing={0.75}>
                <DocCode value={`${item.docNo} → ${item.newDocNo || "-"}`} noWrap />
                <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                  <Typography color="text.secondary" noWrap variant="caption">ลูกหนี้ {customerCode}</Typography>
                  <Typography color="primary.main" noWrap sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }} variant="caption">{totalAmount}</Typography>
                </Stack>
              </Stack>
            </Button>
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
  1: "เงินสด",
  2: "เช็ค",
  3: "บัตรเครดิต",
  4: "เงินสดย่อย",
  5: "ตัดเงินล่วงหน้า",
  9: "คูปอง",
};

// PaymentChangePreviewPanel แสดงข้อมูลการชำระเงิน (cb_trans + cb_trans_detail)
// ก่อนและหลังการ apply ตามที่ระบบจะ sync ให้ตรงกับยอดบิลใหม่
function PaymentChangePreviewPanel({ preview }: { preview: DocumentChangePreview }) {
  const before = preview.paymentBefore;
  const after = preview.paymentAfter;
  if (!before) {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Stack spacing={0.5}>
          <EmphasisText>การชำระเงิน (cb_trans)</EmphasisText>
          <Typography color="text.secondary" variant="body2">
            บิลนี้ไม่มีข้อมูลใน cb_trans (เช่น ขายเชื่อ/ลูกหนี้) — ระบบจะไม่ปรับยอดชำระ
          </Typography>
        </Stack>
      </Paper>
    );
  }
  const fields: Array<{ key: keyof PaymentRow; label: string }> = [
    { key: "cashAmount", label: "เงินสด" },
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
        <EmphasisText>การชำระเงิน (cb_trans)</EmphasisText>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" } }}>
          <TotalLine
            changed={after ? moneyValueChanged(after.totalAmountPay, before.totalAmountPay) : false}
            label="ยอดชำระรวม"
            previousValue={formatMoney(before.totalAmountPay)}
            value={formatMoney(after?.totalAmountPay ?? before.totalAmountPay)}
            strong
          />
          <TotalLine
            changed={after ? moneyValueChanged(after.payCashAmount, before.payCashAmount) : false}
            label="รับเงินสด"
            previousValue={formatMoney(before.payCashAmount)}
            value={formatMoney(after?.payCashAmount ?? before.payCashAmount)}
          />
          <TotalLine
            changed={after ? moneyValueChanged(after.moneyChange, before.moneyChange) : false}
            label="เงินทอน"
            previousValue={formatMoney(before.moneyChange)}
            value={formatMoney(after?.moneyChange ?? before.moneyChange)}
          />
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
        {before.details.length ? (
          <Box>
            <Typography color="text.secondary" sx={{ display: "block", mb: 0.5 }} variant="caption">
              รายละเอียดการชำระ ({before.details.length} รายการ)
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
                  {before.details.map((row, idx) => {
                    const a = after?.details[idx];
                    const changed = a ? moneyValueChanged(a.amount, row.amount) : false;
                    const docTypeLabel = CB_DOC_TYPE_LABELS[row.docType] ?? `doc_type=${row.docType}`;
                    return (
                      <TableRow key={`${row.lineNumber}-${idx}`}>
                        <TableCell>{row.lineNumber}</TableCell>
                        <TableCell>{docTypeLabel}</TableCell>
                        <TableCell>{row.transNumber || "-"}</TableCell>
                        <TableCell>{[row.bankCode, row.creditCardType].filter(Boolean).join(" / ") || "-"}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", textDecoration: changed ? "line-through" : "none", color: changed ? "text.secondary" : "text.primary" }}>{formatMoney(row.amount)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: changed ? 800 : 500, color: changed ? "warning.main" : "text.primary" }}>{formatMoney(a ? a.amount : row.amount)}</TableCell>
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

// Mirror of backend computeTotalsFromLines: vat_type 0=no vat, 1=incl 7%, 2=excl 7%, else stored.
function recomputeClientTotals(
  remaining: DocumentDetailLine[],
  removed: Set<string>,
  added: NewLineInput[],
  vatType: number,
): { totalValue: string; totalVatValue: string; totalAmount: string } {
  let sumAmount = 0;
  let storedVat = 0;
  let storedExcl = 0;
  for (const line of remaining) {
    if (removed.has(line.itemCode)) continue;
    sumAmount += parseFloat2(line.sumAmount);
    storedVat += parseFloat2(line.totalVatValue);
    // line doesn't carry sum_amount_exclude_vat in client; fall back to sumAmount when vat_type=3
    storedExcl += parseFloat2(line.sumAmount);
  }
  for (const a of added) {
    const qty = parseFloat2(a.qty);
    const price = parseFloat2(a.price);
    const disc = parseFloat2(a.discount);
    const lineAmount = round2(qty * price - disc);
    sumAmount += lineAmount;
    storedExcl += lineAmount;
  }
  let totalValue = 0;
  let totalVat = 0;
  let totalAmount = 0;
  switch (vatType) {
    case 0:
      totalValue = sumAmount;
      totalVat = 0;
      totalAmount = sumAmount;
      break;
    case 1:
      totalValue = round2((sumAmount * 100) / 107);
      totalVat = round2(sumAmount - totalValue);
      totalAmount = sumAmount;
      break;
    case 2:
      totalValue = sumAmount;
      totalVat = round2((sumAmount * 7) / 100);
      totalAmount = round2(sumAmount + totalVat);
      break;
    default:
      totalValue = storedExcl;
      totalVat = storedVat;
      totalAmount = round2(storedExcl + storedVat);
      break;
  }
  return {
    totalValue: totalValue.toFixed(2),
    totalVatValue: totalVat.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}

function EditableDocumentLinesPanel({
  docNo,
  lines,
  removed,
  added,
  onToggleRemove,
  onRemoveAdded,
  onAdd,
}: {
  docNo: string;
  lines: DocumentDetailLine[];
  removed?: Set<string>;
  added: NewLineInput[];
  onToggleRemove: (itemCode: string) => void;
  onRemoveAdded: (index: number) => void;
  onAdd: (line: NewLineInput) => void;
}) {
  const removedSet = removed ?? new Set<string>();
  const totalRows = lines.length + added.length;
  // ซ่อนฟีเจอร์“เพิ่มสินค้า”ตามคำขอผู้ใช้: พรีวิวให้ใช้การลบ/ติดลบเท่านั้น.
  void onAdd;
  void onRemoveAdded;
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <EmphasisText>รายการสินค้าในบิล {docNo}</EmphasisText>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Chip label={`${totalRows - removedSet.size} รายการ`} size="small" />
            {removedSet.size ? <Chip color="warning" label={`ลบ ${removedSet.size}`} size="small" /> : null}
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
                    <TableCell align="right">{line.qty}</TableCell>
                    <TableCell>{line.unitCode}</TableCell>
                    <TableCell align="right">{formatMoney(line.price)}</TableCell>
                    <TableCell align="right">{formatMoney(line.discount)}</TableCell>
                    <TableCell align="right"><Money value={formatMoney(line.sumAmount)} /></TableCell>
                  </TableRow>
                );
              })}
              {added.map((a, idx) => {
                const qty = parseFloat2(a.qty);
                const price = parseFloat2(a.price);
                const disc = parseFloat2(a.discount);
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
                    <TableCell align="right">{a.qty}</TableCell>
                    <TableCell>{a.unitCode}</TableCell>
                    <TableCell align="right">{formatMoney(a.price)}</TableCell>
                    <TableCell align="right">{formatMoney(a.discount)}</TableCell>
                    <TableCell align="right"><Money value={formatMoney(lineAmount.toFixed(2))} /></TableCell>
                  </TableRow>
                );
              })}
              {totalRows === 0 ? (
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
