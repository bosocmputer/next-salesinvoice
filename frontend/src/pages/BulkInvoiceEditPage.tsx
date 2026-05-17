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
  Stack,
  Tab,
  Table,
  TableBody,
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
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import type {
  BulkDocumentChangeItem,
  BulkDocumentChangeRequest,
  BulkDocumentChangeResult,
  BulkPreviewFilter,
  DatabaseStatus,
  DocFormat,
  DocumentChangePreview,
  DocumentSummary,
  Option,
  PagedDocuments,
  PreviewChangeItem,
  ProductOption,
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
import {
  DocumentFact,
  DocumentLinesPanel,
  InvoiceDetailDialog,
  PreviewRemovedLinesPanel,
  RiskConfirmDialog,
  SummaryLine,
  TotalLine,
} from "../components/invoice-dialog";
import { appTheme } from "../theme";
import { useToast } from "../contexts/toast";
import { LazyDataGrid, thaiGridLocaleText } from "../components/data-grid";

const initialFromDate = "2026-01-01";
const initialToDate = "2026-12-31";

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
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") || initialFromDate);
  const [toDate, setToDate] = useState(() => searchParams.get("to") || initialToDate);
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [selectedDocNos, setSelectedDocNos] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [removeItemCodes, setRemoveItemCodes] = useState<string[]>([]);
  const [selectedRemoveProducts, setSelectedRemoveProducts] = useState<ProductOption[]>([]);
  const [inquiryType, setInquiryType] = useState(1);
  const [vatType, setVatType] = useState(0);
  const [remark, setRemark] = useState("");
  const [preview, setPreview] = useState<BulkDocumentChangeResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<BulkPreviewFilter>("all");
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewDialogDocNo, setPreviewDialogDocNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [productSearching, setProductSearching] = useState(false);
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
  const selectedRemoveProductValues = removeItemCodes.map((code) => (
    selectedRemoveProducts.find((product) => product.code === code) || { code, name: code, unitCode: "" }
  ));
  const canPreview = selectedDocNos.length > 0 && selectedFormat && selectedCustomer;
  const workflowHint = canPreview
    ? `พร้อมพรีวิว ${selectedDocNos.length} บิล, ลูกหนี้ใหม่ ${selectedCustomer}`
    : selectedDocNos.length
      ? "ตั้งค่าการแก้ไขให้ครบ โดยเฉพาะลูกหนี้ใหม่ ก่อนพรีวิว"
      : "เลือกบิลจากตารางก่อน แล้วค่อยตั้งค่าการแก้ไข";
  const readyPreviewCount = preview?.items.filter((item) => item.status === "ready").length || 0;
  const warningPreviewCount = preview?.items.filter((item) => item.status === "warning").length || 0;
  const blockedPreviewCount = preview?.items.filter((item) => item.status === "blocked" || item.status === "failed" || item.status === "skipped").length || 0;
  const writablePreviewCount = readyPreviewCount + warningPreviewCount;
  const readyToApply = Boolean(isAdmin && preview && writablePreviewCount > 0 && busy === false);
  const visiblePreviewItems = preview?.items.filter((item) => {
    if (previewFilter === "all") return true;
    if (previewFilter === "blocked") return item.status === "blocked" || item.status === "failed" || item.status === "skipped";
    return item.status === "ready" || item.status === "warning";
  }) || [];
  const customerQuery = customerSearch.trim();
  const productQuery = productSearch.trim();
  const showCustomerEmpty = customerQuery.length >= 2 && !selectedCustomer && !customerSearching && customers.length === 0;
  const showProductEmpty = productQuery.length >= 2 && !productSearching && products.length === 0;
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
      renderCell: (params) => <Typography sx={{ fontWeight: 700 }} variant="body2">{params.row.docNo}</Typography>,
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
      renderCell: (params) => (
        <Typography noWrap title={maskInternalRemark(params.row.remark || "") || "-"} variant="body2">
          {maskInternalRemark(params.row.remark || "") || "-"}
        </Typography>
      ),
    },
    {
      align: "right",
      field: "totalAmount",
      headerAlign: "right",
      headerName: "ยอดสุทธิ",
      width: 112,
      renderCell: (params) => <Typography sx={{ fontWeight: 700 }} variant="body2">{formatMoney(params.row.totalAmount)}</Typography>,
    },
    {
      align: "right",
      field: "actions",
      filterable: false,
      headerAlign: "right",
      headerName: "รายละเอียด",
      sortable: false,
      width: 112,
      renderCell: (params) => (
        <AppButton
          onClick={(event) => {
            event.stopPropagation();
            setDetailDocNo(params.row.docNo);
            setDetailOpen(true);
          }}
          size="small"
          sx={{ fontSize: 12, fontWeight: 700, minHeight: 30, px: 0.75 }}
          type="button"
        >
          ดูรายละเอียด
        </AppButton>
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
    const q = productSearch.trim();
    if (q.length < 2) {
      setProducts([]);
      setProductSearching(false);
      return;
    }
    const timer = window.setTimeout(() => void searchProducts(q), 250);
    return () => window.clearTimeout(timer);
  }, [productSearch]);

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
      setSelectedFormat((current) => current || formats.data?.items[0]?.code || "");
    }
    if (customerList.success && customerList.data) setCustomers(customerList.data.items);
    setLoading(false);
  }

  async function loadDocuments(nextSearch = search) {
    setLoading(true);
    setMessage("");
    setPreview(null);
    setPreviewFilter("all");
    const nextParams = new URLSearchParams();
    nextParams.set("from", fromDate);
    nextParams.set("to", toDate);
    if (nextSearch.trim()) nextParams.set("q", nextSearch.trim());
    setSearchParams(nextParams, { replace: true });
    const response = await apiGet<PagedDocuments>(documentsURL(fromDate, toDate, nextSearch));
    if (response.success && response.data) {
      setDocuments(response.data);
      setSelectedDocNos((current) => current.filter((docNo) => response.data?.items.some((item) => item.docNo === docNo)));
    } else {
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

  async function searchProducts(q = productSearch) {
    if (q.trim().length < 2) {
      setProducts([]);
      setMessage("พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาสินค้า");
      return;
    }
    setProductSearching(true);
    const response = await apiGet<{ items: ProductOption[] }>(`/api/v1/master/products?q=${encodeURIComponent(q)}&limit=20`);
    if (response.success && response.data) setProducts(response.data.items);
    else setProducts([]);
    setProductSearching(false);
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
    setRemoveItemCodes([]);
    setSelectedRemoveProducts([]);
    setProductSearch("");
    setProducts([]);
    setRemark("");
    setSelectedFormat(docFormats[0]?.code || "");
    setInquiryType(1);
    setVatType(0);
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
    return {
      docNos: selectedDocNos,
      docFormatCode: selectedFormat,
      customerCode: selectedCustomer,
      inquiryType,
      vatType,
      remark,
      removeItemCodes,
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
    <Stack spacing={1.5}>
      {message ? <Alert severity={message.includes("สำเร็จ") || message.includes("เลือก") ? "success" : "warning"}>{message}</Alert> : null}

      <Paper variant="outlined" sx={{ minWidth: 0, overflow: "hidden" }}>
        <Stack spacing={{ xs: 1.25, sm: 1.5 }} sx={{ p: { xs: 1.25, sm: 1.5 } }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
	            <Typography component="h2" sx={{ fontWeight: 700 }} variant="h6">รายการบิล</Typography>
            <StatusBadge>{loading ? "กำลังโหลด" : `${items.length}${documents?.hasMore ? "+" : ""} บิลที่แสดง`}</StatusBadge>
          </Stack>
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
              helperText="ค้นหาเลขบิลหลายใบหรือช่วงได้ เช่น เลขเริ่ม:เลขจบ,เลขเดี่ยว"
              inputRef={searchInputRef}
              label="ค้นหา"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="เลขบิล / รหัสลูกค้า / หมายเหตุ  (กด Ctrl+K)"
              size="small"
              sx={{ gridColumn: { xs: "1 / -1", lg: "auto" } }}
              value={search}
              slotProps={{
                input: {
                  endAdornment: search ? (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="ล้างคำค้นหา"
                        disabled={loading}
                        edge="end"
                        onClick={() => void clearSearchText()}
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
            <Stack direction="row" spacing={1} sx={{ alignItems: "stretch", gridColumn: { xs: "1 / -1", lg: "auto" } }}>
              <AppButton disabled={loading} onClick={() => void loadDocuments()} size="small" sx={{ flex: { xs: 1, lg: "0 0 auto" }, minHeight: 40, minWidth: { lg: 112 } }} tone="primary">ค้นหา</AppButton>
              <AppButton disabled={loading} onClick={() => void loadDocuments()} size="small" startIcon={<RefreshCw size={15} />} sx={{ flex: { xs: 1, lg: "0 0 auto" }, minHeight: 40, minWidth: { lg: 112 } }}>โหลดใหม่</AppButton>
            </Stack>
          </Box>
          {selectedDocNos.length ? (
            <SelectionActionBar
              busy={busy}
              canPreview={Boolean(canPreview)}
              removeCount={removeItemCodes.length}
              selectedCount={selectedDocNos.length}
              selectedCustomer={selectedCustomer}
              selectedFormat={selectedFormat}
              onClear={clearSelection}
              onOpenSettings={() => setSettingsOpen(true)}
              onPreview={() => void previewBulk()}
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
                            <Typography noWrap sx={{ fontWeight: 800 }} variant="body1">{item.docNo}</Typography>
                            <Typography color="text.secondary" variant="caption">{formatSmlDate(item.docDate)} · {formatDocumentTime(item.docTime)}</Typography>
                          </Box>
                        </Stack>
                        <Typography color="primary.main" sx={{ fontWeight: 800, whiteSpace: "nowrap" }} variant="body2">{formatMoney(item.totalAmount)}</Typography>
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
                fontSize: 13,
                "& .MuiDataGrid-cell": {
                  alignItems: "center",
                  display: "flex",
                  py: 0.5,
                },
                "& .MuiDataGrid-columnHeaderTitle": {
                  fontSize: 13,
                  fontWeight: 700,
                },
                "& .MuiDataGrid-row": {
                  cursor: "pointer",
                },
                "& .MuiDataGrid-row:hover": {
                  bgcolor: "action.hover",
                },
                "& .MuiDataGrid-row.Mui-selected": {
                  bgcolor: "rgba(36, 90, 109, 0.09)",
                },
                "& .MuiDataGrid-row.Mui-selected:hover": {
                  bgcolor: "rgba(36, 90, 109, 0.12)",
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
              <Typography component="h2" noWrap sx={{ fontWeight: 700, minWidth: 0 }} variant="subtitle1">
                ตั้งค่าการแก้ไข
              </Typography>
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
                      label="ลูกหนี้ใหม่"
                      placeholder="พิมพ์รหัสหรือชื่อลูกหนี้"
                      required
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
                          <Typography sx={{ fontWeight: 800 }} variant="body2">{option.code}</Typography>
                          <Typography color="text.secondary" variant="caption">{option.name}</Typography>
                        </Box>
                      </Box>
                    );
                  }}
                  value={selectedCustomerValue}
                />
                <TextField
                  label="ชุดเลขเอกสารใหม่"
                  onChange={(event) => { setSelectedFormat(event.target.value); resetPreview(); }}
                  select
                  size="small"
                  value={selectedFormat}
                >
                  {docFormats.map((item) => <MenuItem key={item.code} value={item.code}>{item.code} - {item.name}</MenuItem>)}
                </TextField>
                <TextField
                  label="ประเภทการขาย"
                  onChange={(event) => { setInquiryType(Number(event.target.value)); resetPreview(); }}
                  select
                  size="small"
                  value={inquiryType}
                >
                  {Object.entries(saleTypeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </TextField>
                <TextField
                  label="ประเภทภาษี"
                  onChange={(event) => { setVatType(Number(event.target.value)); resetPreview(); }}
                  select
                  size="small"
                  value={vatType}
                >
                  {Object.entries(taxTypeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </TextField>
                <Autocomplete<ProductOption, true, false, false>
                  filterOptions={(options) => options}
                  getOptionLabel={(option) => `${option.code} - ${option.name}`}
                  inputValue={productSearch}
                  loading={productSearching}
                  loadingText="กำลังค้นหาสินค้า..."
                  multiple
                  noOptionsText={productQuery.length < 2 ? "พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาสินค้า" : showProductEmpty ? "ไม่พบสินค้าที่ตรงกับคำค้นนี้" : "ไม่พบข้อมูล"}
                  onChange={(_, values) => {
                    resetPreview();
                    setSelectedRemoveProducts(values);
                    setRemoveItemCodes(values.map((item) => item.code));
                    setProductSearch("");
                    setProducts([]);
                  }}
                  onInputChange={(_, value, reason) => {
                    if (reason === "reset") return;
                    setProductSearch(value);
                    resetPreview();
                  }}
                  options={productQuery.length >= 2 ? products.filter((product) => !removeItemCodes.includes(product.code)) : []}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      helperText="เลือกได้มากกว่า 1 รายการ ถ้าเว้นว่างจะเปลี่ยนเฉพาะหัวบิล"
                      label="สินค้าที่ต้องการลบในบิล"
                      placeholder="พิมพ์รหัสหรือชื่อสินค้า"
                      size="small"
                      slotProps={{
                        ...params.slotProps,
                        input: {
                          ...params.slotProps?.input,
                          endAdornment: (
                            <>
                              {productSearching ? <CircularProgress color="inherit" size={16} /> : null}
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
                          <Typography sx={{ fontWeight: 800 }} variant="body2">{option.code}</Typography>
                          <Typography color="text.secondary" variant="caption">{option.name}</Typography>
                        </Box>
                      </Box>
                    );
                  }}
                  sx={{ gridColumn: { xs: "auto", sm: "1 / -1" } }}
                  value={selectedRemoveProductValues}
                />
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
          removeCount={removeItemCodes.length}
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
              <Typography component="h2" sx={{ fontWeight: 700 }} variant="h6">พรีวิว {preview.totalCount} บิล</Typography>
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
                        <Typography noWrap sx={{ fontWeight: 800 }} variant="body2">{item.docNo}</Typography>
                        <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body2">{formatMoney(item.preview?.totals.totalAmount || "")}</Typography>
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
                    <TableCell><Typography sx={{ fontWeight: 800 }} variant="body2">{item.docNo}</Typography></TableCell>
                    <TableCell>{item.newDocNo || "-"}</TableCell>
                    <TableCell>{item.preview?.after.customerCode || selectedCustomer || "-"}</TableCell>
                    <TableCell>{(item.removeHits || []).length ? item.removeHits.join(", ") : "-"}</TableCell>
                    <TableCell align="right"><Typography sx={{ fontWeight: 800 }} variant="body2">{formatMoney(item.preview?.totals.totalAmount || "")}</Typography></TableCell>
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
            <Typography sx={{ fontWeight: 700 }} variant="body2">{isAdmin ? "สรุปก่อนส่งเข้า SML" : "สรุปผลพรีวิว"}</Typography>
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
          result={preview}
          selectedDocNo={previewDialogDocNo}
          selectedFormat={selectedFormat}
          selectedCustomer={selectedCustomer}
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
            <SummaryLine label="สินค้าที่จะลบ" value={removeItemCodes.length ? removeItemCodes.join(", ") : "ไม่มี"} />
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
  result,
  selectedDocNo,
  selectedFormat,
  selectedCustomer,
  onClose,
  onRequestApply,
  onSelectDoc,
}: {
  busy: boolean;
  canApply: boolean;
  readyToApply: boolean;
  result: BulkDocumentChangeResult;
  selectedDocNo: string;
  selectedFormat: string;
  selectedCustomer: string;
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
  const footerProgressText = !canApply
    ? "สิทธิ์ User ดูพรีวิวได้เท่านั้น ต้องให้ Admin เป็นผู้ส่งเข้า SML"
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
            <Typography component="h2" noWrap sx={{ fontWeight: 700, minWidth: 0 }} variant="subtitle1">พรีวิวก่อนส่งเข้า SML</Typography>
            <Typography color="primary.main" noWrap sx={{ fontWeight: 800 }} variant="subtitle1">{result.totalCount === 1 ? selectedItem?.docNo || "1 บิล" : `${selectedIndex + 1}/${result.totalCount}`}</Typography>
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
                  <Typography sx={{ fontWeight: 700 }} variant="body2">เอกสารนี้ระบบจะไม่ส่งเข้า SML</Typography>
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

                  <DocumentLinesPanel docNo={selectedPreview.after.docNo} lines={selectedPreview.remainingLines} />

                  {selectedPreview.removedLines.length ? (
                    <PreviewRemovedLinesPanel lines={selectedPreview.removedLines} />
                  ) : null}

                  <Stack spacing={1.5}>
                    <Paper variant="outlined" sx={{ ...changedPaperSx(valueChanged(selectedPreview.after.remark, selectedPreview.before.remark)), p: 1.25 }}>
                      <Typography color="text.secondary" variant="caption">หมายเหตุหลังแก้ไข</Typography>
                      <Typography sx={{ fontWeight: 700 }} variant="body2">{maskInternalRemark(selectedPreview.after.remark) || "ไม่มีหมายเหตุ"}</Typography>
                      {valueChanged(selectedPreview.after.remark, selectedPreview.before.remark) ? (
                        <Typography color="text.secondary" sx={{ display: "block", mt: 0.25 }} variant="caption">เดิม: {maskInternalRemark(selectedPreview.before.remark) || "ไม่มีหมายเหตุ"}</Typography>
                      ) : null}
                    </Paper>
                    <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" } }}>
                      <TotalLine changed={selectedPreview.removedLines.length > 0} label="รายการคงเหลือ" previousValue={`${selectedPreview.remainingLines.length + selectedPreview.removedLines.length} รายการ`} value={`${selectedPreview.totals.lineCount} รายการ`} />
                      <TotalLine label="มูลค่าสินค้า" value={formatMoney(selectedPreview.after.totalValue)} />
                      <TotalLine changed={moneyValueChanged(selectedPreview.totals.totalVatValue, selectedPreview.before.totalVatValue)} label="มูลค่าภาษี" previousValue={formatMoney(selectedPreview.before.totalVatValue)} value={formatMoney(selectedPreview.totals.totalVatValue)} />
                      <TotalLine changed={moneyValueChanged(selectedPreview.totals.totalAmount, selectedPreview.before.totalAmount)} label="ยอดสุทธิใหม่" previousValue={formatMoney(selectedPreview.before.totalAmount)} value={formatMoney(selectedPreview.totals.totalAmount)} strong />
                    </Box>
                  </Stack>
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
  removeCount,
  selectedCustomer,
  selectedFormat,
}: {
  docCount: number;
  removeCount: number;
  selectedCustomer: string;
  selectedFormat: string;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="xs" open>
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <Typography component="h2" noWrap sx={{ fontWeight: 700, minWidth: 0 }} variant="subtitle1">กำลังสร้างพรีวิวก่อนส่ง</Typography>
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
            <SummaryLine label="สินค้าที่จะลบ" value={removeCount ? `${removeCount} รายการ` : "ไม่มี"} />
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
          <Typography sx={{ fontWeight: 700 }} variant="body2">เอกสารในชุดนี้</Typography>
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
                <Typography noWrap sx={{ fontWeight: 800 }} variant="body2">{item.docNo} → {item.newDocNo || "-"}</Typography>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                  <Typography color="text.secondary" noWrap variant="caption">ลูกหนี้ {customerCode}</Typography>
                  <Typography color="primary.main" noWrap sx={{ fontWeight: 800 }} variant="caption">{totalAmount}</Typography>
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
  removeCount,
  selectedCount,
  selectedCustomer,
  selectedFormat,
  onClear,
  onOpenSettings,
  onPreview,
}: {
  busy: boolean;
  canPreview: boolean;
  removeCount: number;
  selectedCount: number;
  selectedCustomer: string;
  selectedFormat: string;
  onClear: () => void;
  onOpenSettings: () => void;
  onPreview: () => void;
}) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const chips = canPreview ? [
    selectedCustomer ? `ลูกหนี้ใหม่ ${selectedCustomer}` : "",
    selectedFormat ? `ชุดเอกสารใหม่ ${selectedFormat}` : "",
    removeCount ? `ลบสินค้า ${removeCount} รายการ` : "",
  ].filter(Boolean) : [];

  return (
    <Paper
      aria-label="ชุดคำสั่งบิลที่เลือก"
      variant="outlined"
      sx={{
        bgcolor: "action.hover",
        p: 1,
      }}
    >
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ alignItems: { md: "center" }, justifyContent: "space-between", minWidth: 0 }}>
        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">เลือก {selectedCount} บิลแล้ว</Typography>
            {canPreview ? <StatusBadge tone="success">พร้อมพรีวิว</StatusBadge> : <StatusBadge>ยังไม่ได้ตั้งค่า</StatusBadge>}
          </Stack>
          {chips.length ? (
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
              {chips.map((label) => <Chip key={label} label={label} size="small" variant="outlined" />)}
            </Stack>
          ) : (
            <Typography color="text.secondary" variant="caption">กดตั้งค่าเพื่อเลือกลูกหนี้ใหม่ ชุดเอกสาร และเงื่อนไขก่อนพรีวิว</Typography>
          )}
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
}

function PreviewChangeSummaryPanel({ preview }: { preview: DocumentChangePreview }) {
  const changes = buildPreviewChangeItems(preview);
  const changedCount = changes.filter((item) => item.changed).length;
  const removedCount = preview.removedLines.length;

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700 }} variant="body2">จุดเปลี่ยนที่ต้องโฟกัส</Typography>
            <Typography color="text.secondary" variant="caption">ช่องที่มีพื้นหลังสีอ่อนคือข้อมูลที่ระบบจะเปลี่ยนก่อนส่งเข้า SML</Typography>
          </Box>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
            <Chip color={changedCount ? "warning" : "default"} label={`${changedCount} จุดเปลี่ยน`} size="small" variant={changedCount ? "filled" : "outlined"} />
            {removedCount ? <Chip color="error" label={`ลบสินค้า ${removedCount} รายการ`} size="small" /> : null}
          </Stack>
        </Stack>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" } }}>
          {changes.map((change) => <PreviewChangedFact change={change} key={change.key} />)}
        </Box>
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
          <Typography color={change.tone === "danger" ? "error.main" : "text.primary"} noWrap sx={{ fontWeight: 800 }} variant="body2">{change.after}</Typography>
        </Stack>
      ) : (
        <Typography color="text.primary" noWrap sx={{ fontWeight: 700 }} variant="body2">{change.after}</Typography>
      )}
    </Paper>
  );
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

export default BulkInvoiceEditPage;
