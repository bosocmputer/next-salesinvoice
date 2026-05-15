import { Component, FormEvent, ReactNode, Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type CSSProperties } from "react";
import {
  Alert,
  AppBar,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
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
  ThemeProvider,
  Toolbar,
  Typography,
  type ButtonProps,
  createTheme,
  useMediaQuery,
} from "@mui/material";
import type { DataGridProps, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import JsonView, { type JsonViewProps, type SemicolonProps } from "@uiw/react-json-view";
import { lightTheme as jsonViewLightTheme } from "@uiw/react-json-view/light";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Database,
  FileText,
  History,
  LogOut,
  Menu as MenuIcon,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

type PageKey = "bulk" | "audit" | "status";
type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T | null;
  error: { code: string; detail: string } | null;
};

type DatabaseStatus = {
  connected: boolean;
  database: string;
  schema?: string;
  requiredSmlReady: boolean;
  appSchemaReady: boolean;
  missingSmlTables?: string[];
  missingAppTables?: string[];
};

type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  sslMode: string;
  schema: string;
  maxConns: number;
};

type UserClaims = {
  userCode: string;
  displayName: string;
  role: string;
};

type DocumentSummary = {
  docNo: string;
  docDate: string;
  docTime: string;
  taxDocNo: string;
  taxDocDate: string;
  docRef: string;
  docRefDate: string;
  customerCode: string;
  contactor: string;
  inquiryType: number;
  vatType: number;
  saleCode: string;
  saleGroup: string;
  creditDay: string;
  creditDate: string;
  sendDay: string;
  sendDate: string;
  vatRate: string;
  totalValue: string;
  totalBeforeVat: string;
  totalAmount: string;
  totalVatValue: string;
  totalDiscount: string;
  totalAfterVat: string;
  totalExceptVat: string;
  remark: string;
  docFormatCode: string;
  appStatus: "pending" | "processing" | "done" | "failed" | "rolled_back" | string;
};

const LazyDataGrid = lazy(async () => {
  const module = await import("@mui/x-data-grid");
  return { default: module.DataGrid as ComponentType<DataGridProps<any>> };
});

type PagedDocuments = {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

type DocFormat = {
  code: string;
  name: string;
  format: string;
};

type Option = {
  code: string;
  name: string;
};

type ProductOption = Option & {
  unitCode: string;
};

type DocumentDetailLine = {
  lineNumber: number;
  itemCode: string;
  itemName: string;
  barcode: string;
  whCode: string;
  shelfCode: string;
  unitCode: string;
  qty: string;
  price: string;
  discount: string;
  sumAmount: string;
  totalVatValue: string;
};

type RunningData = {
  formatCode: string;
  latestDocNo: string;
  nextDocNo: string;
};

type DocumentChangePreview = {
  docNo: string;
  before: DocumentSummary;
  after: DocumentSummary;
  totals: {
    totalValue: string;
    totalVatValue: string;
    totalAmount: string;
    lineCount: number;
  };
  removedLines: DocumentDetailLine[];
  remainingLines: DocumentDetailLine[];
};

type BulkDocumentChangeRequest = {
  docNos: string[];
  docFormatCode: string;
  customerCode: string;
  inquiryType: number;
  vatType: number;
  remark: string;
  removeItemCodes: string[];
};

type BulkDocumentChangeItem = {
  docNo: string;
  newDocNo: string;
  status: "ready" | "warning" | "blocked" | "applied" | "failed" | "skipped";
  message: string;
  preview: DocumentChangePreview | null;
  removeHits: string[];
};

type BulkDocumentChangeResult = {
  items: BulkDocumentChangeItem[];
  totalCount: number;
  readyCount: number;
  warningCount: number;
  blockedCount: number;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
};

type PreviewChangeItem = {
  key: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
  tone?: "warning" | "danger";
};

type BulkPreviewFilter = "all" | "writable" | "blocked";

type AuditLogItem = {
  id: number;
  userCode: string;
  action: string;
  resourceId: string;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  createdAt: string;
};

type DocumentRawState = {
  icTrans: Record<string, unknown>;
  icTransDetail: Array<Record<string, unknown>>;
};

type DocumentHistoryItem = {
  snapshotId: number;
  batchId: number;
  originalDocNo: string;
  currentDocNo: string;
  createdBy: string;
  createdAt: string;
  rolledBackAt?: string;
  before: DocumentRawState;
  after: DocumentRawState;
  afterSummary?: Record<string, unknown>;
  status: string;
  message: string;
};

type JsonDiffStatus = "changed" | "added" | "removed";
type JsonDiffMap = Map<string, JsonDiffStatus>;
type TechnicalJsonSection = {
  diff: JsonDiffMap;
  keyName: string;
  label: string;
  value: unknown;
};

type AuditInvoiceDialogState = {
  doc: DocumentSummary;
  lines: DocumentDetailLine[];
  title: string;
  comparison?: {
    beforeDoc: DocumentSummary;
    beforeLines: DocumentDetailLine[];
  };
};

type RollbackDocumentResult = {
  snapshotId: number;
  restored: DocumentSummary;
};

const saleTypeLabels: Record<number, string> = {
  1: "ขายเงินเชื่อ",
  2: "ขายเงินสด",
  3: "ขายสินค้าเงินเชื่อ (สินค้าบริการ)",
  4: "ขายสินค้าเงินสด (สินค้าบริการ)",
};

const taxTypeLabels: Record<number, string> = {
  0: "ภาษีแยกนอก",
  1: "ภาษีรวมใน",
  2: "ภาษีอัตราศูนย์",
  3: "ไม่กระทบภาษี",
};

const initialFromDate = "2026-01-01";
const initialToDate = "2026-12-31";
const authSessionKey = "next-salesinvoice-authenticated";
const authExpiredEvent = "next-salesinvoice-auth-expired";
const drawerWidth = 260;
const thaiGridLocaleText: NonNullable<DataGridProps<any>["localeText"]> = {
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

const appTheme = createTheme({
  typography: {
    fontFamily: '"Noto Sans Thai", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    h1: { fontWeight: 700, letterSpacing: 0 },
    h2: { fontWeight: 700, letterSpacing: 0 },
    h5: { fontSize: "1.35rem", fontWeight: 700, letterSpacing: 0 },
    h6: { fontSize: "1.05rem", fontWeight: 700, letterSpacing: 0 },
    subtitle1: { fontSize: "0.95rem", fontWeight: 700, letterSpacing: 0 },
    subtitle2: { fontSize: "0.875rem", fontWeight: 700, letterSpacing: 0 },
    body2: { fontSize: "0.8125rem", letterSpacing: 0 },
    caption: { fontSize: "0.75rem", letterSpacing: 0 },
    button: { fontSize: "0.8125rem", fontWeight: 700, letterSpacing: 0, textTransform: "none" },
  },
  shape: {
    borderRadius: 8,
  },
  palette: {
    primary: {
      main: "#245a6d",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#5f6f7d",
    },
    success: {
      main: "#2e7d5b",
    },
    warning: {
      main: "#a16207",
    },
    error: {
      main: "#d04437",
    },
    background: {
      default: "#f6f8fa",
      paper: "#ffffff",
    },
    text: {
      primary: "#1f2937",
      secondary: "#667085",
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          textRendering: "optimizeLegibility",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, minHeight: 36 },
        sizeSmall: { minHeight: 32 },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small" },
    },
    MuiAutocomplete: {
      defaultProps: { size: "small" },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontSize: 12, fontWeight: 700 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8 },
        message: { minWidth: 0 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          "&:last-child": { paddingBottom: 16 },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 8, outline: "none" },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { padding: "12px 16px" },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: { padding: 16 },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: { padding: 16 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        body: {
          fontSize: 13,
        },
        head: {
          backgroundColor: "#f8fafc",
          color: "#475467",
          fontSize: 13,
          fontWeight: 700,
        },
        sizeSmall: {
          padding: "8px 12px",
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
  },
});

const navItems: Array<{ key: PageKey; label: string; group: string; icon: typeof FileText; path: string; adminOnly?: boolean }> = [
  { key: "bulk", label: "แก้ไขบิล", group: "งานประจำ", icon: ListChecks, path: "/bulk-edit" },
  { key: "audit", label: "ประวัติและย้อนกลับ", group: "ตรวจสอบ", icon: History, path: "/audit", adminOnly: true },
  { key: "status", label: "ตรวจระบบ", group: "ระบบ", icon: Database, path: "/system/status", adminOnly: true },
];

export default function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <AuthShell>
        <Paper elevation={3} sx={{ display: "grid", gap: 2, p: 3, width: "min(420px, 100%)" }}>
          <BrandLockup title="ระบบหยุดทำงานชั่วคราว" subtitle="ลองโหลดหน้าใหม่อีกครั้ง หากยังพบปัญหาให้ส่งข้อความนี้ให้ผู้ดูแลระบบ" centered />
          <Alert severity="error">{this.state.error.message}</Alert>
          <AppButton tone="primary" onClick={() => window.location.reload()}>โหลดหน้าใหม่</AppButton>
        </Paper>
      </AuthShell>
    );
  }
}

function AppRoutes() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [user, setUser] = useState<UserClaims | null>(null);
  const [booting, setBooting] = useState(true);
  const [loginMessage, setLoginMessage] = useState("");
  const location = useLocation();
  const routerNavigate = useNavigate();

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      localStorage.removeItem(authSessionKey);
      setUser(null);
      if (location.pathname !== "/login") {
        routerNavigate("/login", { replace: true });
      }
    }

    window.addEventListener(authExpiredEvent, handleAuthExpired);
    return () => window.removeEventListener(authExpiredEvent, handleAuthExpired);
  }, [location.pathname, routerNavigate]);

  useEffect(() => {
    const legacyPage = window.location.hash.replace("#", "");
    if (!legacyPage) return;
    const legacyPath = legacyPathFromPage(legacyPage);
    if (legacyPath) {
      routerNavigate(legacyPath, { replace: true });
    }
  }, [routerNavigate]);

  async function refreshStatus() {
    const statusResponse = await apiGet<DatabaseStatus>("/api/v1/system/database-status");
    if (statusResponse.success && statusResponse.data) setStatus(statusResponse.data);
  }

  async function boot() {
    setBooting(true);
    const shouldCheckSession = localStorage.getItem(authSessionKey) === "1";
    await refreshStatus();
    if (shouldCheckSession) {
      const meResponse = await apiGet<{ user: UserClaims }>("/api/v1/auth/me");
      if (meResponse.success && meResponse.data) {
        setUser(meResponse.data.user);
      } else {
        localStorage.removeItem(authSessionKey);
        setUser(null);
      }
    }
    setBooting(false);
  }

  function navigate(nextPage: PageKey) {
    const path = navItems.find((item) => item.key === nextPage)?.path || "/bulk-edit";
    routerNavigate(path);
  }

  async function login(code: string, password: string) {
    setLoginMessage("");
    const response = await apiPost<{ user: UserClaims }>("/api/v1/auth/login", { code, password });
    if (!response.success || !response.data) {
      setLoginMessage(response.error?.detail || response.message || "เข้าสู่ระบบไม่สำเร็จ");
      return;
    }
    localStorage.setItem(authSessionKey, "1");
    setUser(response.data.user);
    await boot();
    routerNavigate("/bulk-edit", { replace: true });
  }

  async function logout() {
    await apiPost("/api/v1/auth/logout", {});
    localStorage.removeItem(authSessionKey);
    setUser(null);
    routerNavigate("/login", { replace: true });
  }

  const ready = Boolean(status?.connected && status.requiredSmlReady && status.appSchemaReady);
  const activePage = pageFromPath(location.pathname);

  if (booting) return <BootScreen />;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/bulk-edit" replace /> : <LoginScreen databaseReady={ready} message={loginMessage} status={status} onLogin={login} />}
      />
      <Route
        path="/*"
        element={
          user ? (
            <Shell activePage={activePage} activeTitle={titleFromPath(location.pathname)} databaseReady={ready} status={status} user={user} onLogout={logout} onNavigate={navigate}>
              <Routes>
                <Route index element={<Navigate to="/bulk-edit" replace />} />
                <Route path="invoices" element={<Navigate to="/bulk-edit" replace />} />
                <Route path="invoices/:docNo" element={<Navigate to="/bulk-edit" replace />} />
                <Route path="invoices/:docNo/edit" element={<Navigate to="/bulk-edit" replace />} />
                <Route path="bulk-edit" element={<BulkInvoiceEditPage status={status} user={user} />} />
                <Route path="audit" element={user.role === "Admin" ? <AuditLogRoute user={user} /> : <Navigate to="/bulk-edit" replace />} />
                <Route path="audit/:docNo" element={user.role === "Admin" ? <AuditLogRoute user={user} /> : <Navigate to="/bulk-edit" replace />} />
                <Route path="system/status" element={user.role === "Admin" ? <SystemStatusPage status={status} onRefresh={refreshStatus} /> : <Navigate to="/bulk-edit" replace />} />
                <Route path="system/database" element={<Navigate to="/system/status" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

function AuditLogRoute({ user }: { user: UserClaims }) {
  const { docNo } = useParams();
  const [searchParams] = useSearchParams();
  return <AuditLogPage selectedDocNo={docNo || searchParams.get("docNo") || ""} user={user} />;
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="main"
      sx={{
        alignItems: "center",
        bgcolor: "background.default",
        display: "grid",
        minHeight: "100vh",
        p: 2,
        placeItems: "center",
      }}
    >
      {children}
    </Box>
  );
}

function BrandLockup({ centered = false, subtitle, title }: { centered?: boolean; subtitle: string; title: string }) {
  return (
    <Stack direction={centered ? "column" : "row"} spacing={1.25} sx={{ alignItems: "center", textAlign: centered ? "center" : "left" }}>
      <Avatar sx={{ bgcolor: "primary.main", fontWeight: 800 }}>NS</Avatar>
      <Box>
        <Typography component={centered ? "h1" : "div"} sx={{ fontWeight: 800 }} variant={centered ? "h5" : "subtitle1"}>{title}</Typography>
        <Typography color="text.secondary" variant="body2">{subtitle}</Typography>
      </Box>
    </Stack>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 16, width }} />;
}

function BootScreen() {
  return (
    <AuthShell>
      <Paper elevation={2} sx={{ display: "grid", gap: 2, p: 3, width: "min(420px, 100%)" }}>
        <SkeletonLine width="70%" />
        <SkeletonLine width="45%" />
        <LinearProgress />
      </Paper>
    </AuthShell>
  );
}

function LoginScreen({
  databaseReady,
  message,
  status,
  onLogin,
}: {
  databaseReady: boolean;
  message: string;
  status: DatabaseStatus | null;
  onLogin: (code: string, password: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [databaseSetupOpen, setDatabaseSetupOpen] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    await onLogin(code, password);
    setSubmitting(false);
  }

  return (
    <AuthShell>
      <Paper component="form" elevation={3} onSubmit={submit} sx={{ display: "grid", gap: 2, p: 3, width: "min(420px, 100%)" }}>
        <BrandLockup title="next-salesinvoice" subtitle="ระบบจัดการเอกสารขาย" centered />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <StatusBadge tone={databaseReady ? "success" : "danger"}>
            {databaseReady ? "ฐานข้อมูลพร้อมใช้งาน" : "ฐานข้อมูลยังไม่พร้อม"}
          </StatusBadge>
          <Typography color="text.secondary" variant="body2">{status?.database || "ไม่พบฐานข้อมูล"}</Typography>
        </Stack>
        <TextField autoComplete="username" label="รหัสพนักงาน" value={code} onChange={(event) => setCode(event.target.value)} />
        <TextField
          autoComplete="current-password"
          label="รหัสผ่าน"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="กรอกรหัสผ่าน"
          type="password"
          value={password}
        />
        {message ? <Alert severity="error">{message}</Alert> : null}
        <AppButton disabled={!databaseReady || !code || !password || submitting} tone="primary" type="submit">
          {submitting ? "กำลังเข้าสู่ระบบ" : "เข้าสู่ระบบ"}
        </AppButton>
        <AppButton onClick={() => setDatabaseSetupOpen(true)} type="button">ตั้งค่าฐานข้อมูล</AppButton>
      </Paper>
      {databaseSetupOpen ? <LoginDatabaseSetupDialog status={status} onClose={() => setDatabaseSetupOpen(false)} /> : null}
    </AuthShell>
  );
}

function LoginDatabaseSetupDialog({ status, onClose }: { status: DatabaseStatus | null; onClose: () => void }) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const [form, setForm] = useState<DatabaseConfig>({
    host: "192.168.2.248",
    port: 5432,
    database: status?.database || "sml1_2026",
    user: "postgres",
    password: "",
    sslMode: "disable",
    schema: "public",
    maxConns: 3,
  });
  const [busy, setBusy] = useState(false);
  const [verifiedKey, setVerifiedKey] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [message, setMessage] = useState("");

  const databaseConfig = (): DatabaseConfig => ({
    ...form,
    sslMode: "disable",
    schema: "public",
    maxConns: 3,
  });
  const currentKey = JSON.stringify(databaseConfig());
  const canSubmit = Boolean(form.host && form.port && form.database && form.user && form.password);
  const verified = verifiedKey === currentKey;
  const canApply = canSubmit && verified && setupSecret.trim().length > 0;

  function updateForm(next: DatabaseConfig) {
    setForm(next);
    setVerifiedKey("");
    setMessage("");
  }

  async function verifyDatabaseSetup() {
    setBusy(true);
    setVerifiedKey("");
    setMessage("");
    const response = await apiPost<{ status: DatabaseStatus }>("/api/v1/system/database-verify", databaseConfig());
    if (response.success && response.data) {
      setVerifiedKey(currentKey);
      setMessage(`ทดสอบผ่าน เชื่อมต่อฐาน ${response.data.status.database} ได้แล้ว`);
    } else {
      setMessage(response.error?.detail || response.message || "ทดสอบการเชื่อมต่อไม่สำเร็จ");
    }
    setBusy(false);
  }

  async function applyDatabaseSetup() {
    if (!verified) {
      setMessage("กรุณาทดสอบการเชื่อมต่อให้ผ่านก่อนเริ่มใช้ค่าฐานนี้");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await apiPost<{ status: DatabaseStatus }>("/api/v1/system/database-bootstrap", {
      setupSecret: setupSecret.trim(),
      config: databaseConfig(),
    });
    if (response.success && response.data) {
      setMessage(`เริ่มใช้ฐาน ${response.data.status.database} แล้ว โหลดหน้าใหม่เพื่อเข้าสู่ระบบด้วยฐานนี้`);
    } else {
      setMessage(response.error?.detail || response.message || "เริ่มใช้ฐานข้อมูลไม่สำเร็จ");
    }
    setBusy(false);
  }

  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="md" open onClose={busy ? undefined : onClose}>
      <DialogTitle>
        <StackRow>
          <Box sx={{ display: "grid", gap: 0.25, minWidth: 0 }}>
            <Typography color="text.secondary" variant="body2">ฐานข้อมูลก่อนเข้าสู่ระบบ</Typography>
            <Typography variant="h6">ตั้งค่าการเชื่อมต่อฐานข้อมูล</Typography>
          </Box>
          <StatusBadge tone={status?.connected ? "success" : "danger"}>{status?.connected ? "ฐานเดิมพร้อม" : "ฐานเดิมไม่พร้อม"}</StatusBadge>
        </StackRow>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gap: 2 }}>
          <Alert severity="warning">ใช้เฉพาะผู้ดูแลระบบตอนเลือกฐานข้อมูลร้าน ระบบจะใช้ SSL disable และ schema public ให้อัตโนมัติ</Alert>
          {busy ? <LinearProgress /> : null}
          {message ? <Alert severity={message.includes("ผ่าน") || message.includes("แล้ว") ? "success" : "error"}>{message}</Alert> : null}
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            <TextField label="Host" value={form.host} onChange={(event) => updateForm({ ...form, host: event.target.value })} />
            <TextField label="Port" type="number" value={form.port} onChange={(event) => updateForm({ ...form, port: Number(event.target.value) })} />
            <TextField label="Database" value={form.database} onChange={(event) => updateForm({ ...form, database: event.target.value })} />
            <TextField label="User" value={form.user} onChange={(event) => updateForm({ ...form, user: event.target.value })} />
            <TextField label="Password" type="password" value={form.password || ""} onChange={(event) => updateForm({ ...form, password: event.target.value })} />
            <TextField
              autoComplete="off"
              label="รหัสยืนยันผู้ดูแลระบบ"
              onChange={(event) => {
                setSetupSecret(event.target.value);
                setMessage("");
              }}
              placeholder="กรอกรหัสยืนยันก่อนเริ่มใช้ฐานนี้"
              type="password"
              value={setupSecret}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ alignItems: { xs: "stretch", sm: "center" }, flexDirection: { xs: "column", sm: "row" } }}>
          <AppButton disabled={busy} fullWidth={isMobile} onClick={onClose}>ปิด</AppButton>
          <AppButton disabled={busy || !canSubmit} fullWidth={isMobile} onClick={() => void verifyDatabaseSetup()} startIcon={busy ? <CircularProgress color="inherit" size={16} /> : undefined}>
            {busy ? "กำลังทดสอบ" : verified ? "ทดสอบผ่านแล้ว" : "ทดสอบการเชื่อมต่อ"}
          </AppButton>
          <AppButton disabled={busy || !canApply} fullWidth={isMobile} onClick={() => void applyDatabaseSetup()} startIcon={busy ? <CircularProgress color="inherit" size={16} /> : undefined} tone="danger">
            {busy ? "กำลังเชื่อมต่อ" : "เริ่มใช้ค่าฐานนี้"}
          </AppButton>
      </DialogActions>
    </Dialog>
  );
}

function Shell({
  activePage,
  activeTitle,
  children,
  databaseReady,
  status,
  user,
  onLogout,
  onNavigate,
}: {
  activePage: PageKey;
  activeTitle?: string;
  children: React.ReactNode;
  databaseReady: boolean;
  status: DatabaseStatus | null;
  user: UserClaims;
  onLogout: () => void;
  onNavigate: (page: PageKey) => void;
}) {
  const title = activeTitle || navItems.find((item) => item.key === activePage)?.label || "next-salesinvoice";
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user.role === "Admin");
  const groups = Array.from(new Set(visibleNavItems.map((item) => item.group)));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navContent = (
    <>
      <BrandLockup title="next-salesinvoice" subtitle="Review Desk" />
      <Divider sx={{ my: 2 }} />
      <List component="nav" disablePadding sx={{ display: "grid", gap: 2 }}>
        {groups.map((group) => (
          <Box key={group}>
            <Typography color="text.secondary" sx={{ fontWeight: 700, mb: 0.75, px: 1 }} variant="caption">{group}</Typography>
            {visibleNavItems.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return (
                <ListItemButton
                  selected={activePage === item.key}
                  key={item.key}
                  onClick={() => {
                    onNavigate(item.key);
                    setMobileMenuOpen(false);
                  }}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}><Icon size={18} /></ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              );
            })}
          </Box>
        ))}
      </List>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mt: "auto", pt: 2 }}>
        <Avatar sx={{ bgcolor: "primary.light", color: "primary.contrastText" }}>{user.displayName.slice(0, 1).toUpperCase()}</Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 800 }} variant="body2">{user.displayName}</Typography>
          <Typography color="text.secondary" noWrap variant="caption">{user.userCode}</Typography>
        </Box>
      </Stack>
    </>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        open
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          flexShrink: 0,
          width: drawerWidth,
          "& .MuiDrawer-paper": {
            borderRightColor: "divider",
            boxSizing: "border-box",
            display: "flex",
            p: 2,
            width: drawerWidth,
          },
        }}
      >
        {navContent}
      </Drawer>
      <Drawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        variant="temporary"
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": {
            boxSizing: "border-box",
            display: "flex",
            p: 2,
            width: "min(82vw, 320px)",
          },
        }}
      >
        {navContent}
      </Drawer>

      <Box sx={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
        <ShellHeader
          databaseReady={databaseReady}
          onLogout={onLogout}
          onOpenMenu={() => setMobileMenuOpen(true)}
          status={status}
          title={title}
        />
        <Box component="main" sx={{ display: "grid", gap: 2, minWidth: 0, p: { xs: 1.5, md: 2 } }}>{children}</Box>
      </Box>
    </Box>
  );
}

function ShellHeader({
  databaseReady,
  onLogout,
  onOpenMenu,
  status,
  title,
}: {
  databaseReady: boolean;
  onLogout: () => void;
  onOpenMenu: () => void;
  status: DatabaseStatus | null;
  title: string;
}) {
  return (
    <AppBar color="inherit" elevation={0} position="sticky" sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar
        sx={{
          gap: 1,
          justifyContent: "space-between",
          minHeight: { xs: 54, sm: 56 },
          px: { xs: 1, sm: 2 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <IconButton
            aria-label="เปิดเมนู"
            edge="start"
            onClick={onOpenMenu}
            sx={{ display: { xs: "inline-flex", md: "none" } }}
          >
            <MenuIcon size={20} />
          </IconButton>
          <Typography
            component="h1"
            noWrap
            sx={{ fontWeight: 800, minWidth: 0 }}
            variant="subtitle1"
          >
            {title}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={{ xs: 0.5, sm: 0.75 }} sx={{ alignItems: "center", flexShrink: 0, minWidth: 0 }}>
          <DatabaseIndicator databaseReady={databaseReady} database={status?.database || "-"} />
          <IconButton aria-label="ออกจากระบบ" onClick={onLogout} sx={{ display: { xs: "inline-flex", sm: "none" } }}>
            <LogOut size={18} />
          </IconButton>
          <AppButton onClick={onLogout} startIcon={<LogOut size={16} />} sx={{ display: { xs: "none", sm: "inline-flex" } }} tone="ghost">
            ออกจากระบบ
          </AppButton>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}

function DatabaseIndicator({ databaseReady, database }: { databaseReady: boolean; database: string }) {
  const label = databaseReady ? "พร้อมใช้งาน" : "ฐานข้อมูลมีปัญหา";
  return (
    <Chip
      color={databaseReady ? "success" : "error"}
      label={
        <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
          <Typography component="span" sx={{ display: { xs: "none", sm: "inline" }, fontSize: 12, fontWeight: 800 }}>
            {label}
          </Typography>
          <Typography component="span" sx={{ display: { xs: "inline", sm: "none" }, fontSize: 12, fontWeight: 800 }}>
            {databaseReady ? "DB พร้อม" : "DB มีปัญหา"}
          </Typography>
          <Typography component="span" sx={{ display: { xs: "none", md: "inline" }, fontSize: 12, opacity: 0.72 }}>
            ·
          </Typography>
          <Typography component="span" noWrap sx={{ display: { xs: "none", md: "inline" }, fontSize: 12, maxWidth: 140 }}>
            {database}
          </Typography>
        </Stack>
      }
      size="small"
      sx={{ maxWidth: { xs: 92, sm: 170, md: 260 }, minWidth: 0 }}
    />
  );
}

function InvoiceDetailDialog({
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
            <Typography color="primary.main" noWrap sx={{ fontWeight: 800 }} variant="subtitle1">{doc.docNo}</Typography>
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
              <Typography sx={{ fontWeight: 700 }} variant="body2">{doc.remark || "ไม่มีหมายเหตุ"}</Typography>
              {fieldChanged("remark") ? <Typography color="text.secondary" variant="caption">เดิม: {beforeDoc?.remark || "ไม่มีหมายเหตุ"}</Typography> : null}
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

function DocumentLinesPanel({ compareLines, docNo, lines: providedLines }: { compareLines?: DocumentDetailLine[]; docNo: string; lines?: DocumentDetailLine[] }) {
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
        <Typography sx={{ fontWeight: 700 }}>รายการสินค้าในบิล <Typography color="text.secondary" component="span" variant="body2">{loading ? "กำลังโหลด" : `${lines.length} รายการ`}</Typography></Typography>
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
                      <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body2">{formatMoney(line.sumAmount)}</Typography>
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
            <Typography sx={{ fontWeight: 700 }}>รวมรายการสินค้า</Typography>
            <Typography>จำนวน {formatMoney(String(totalQty))}</Typography>
            <Typography color="primary.main" sx={{ fontWeight: 900 }}>ยอดรวม {formatMoney(String(totalAmount))}</Typography>
          </Stack>
        ) : null}
    </Paper>
    {removedLines.length ? <PreviewRemovedLinesPanel lines={removedLines} summaryLabel="รวมที่ถูกลบ" title="รายการที่ถูกลบจากบิลเดิม" /> : null}
    </Stack>
  );
}

function BulkInvoiceEditPage({ status, user }: { status: DatabaseStatus | null; user: UserClaims }) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const isAdmin = user.role === "Admin";
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
        <Typography noWrap title={params.row.remark || "-"} variant="body2">
          {params.row.remark || "-"}
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
    } else {
      setMessage(response.error?.detail || response.message || "ส่งหลายบิลเข้า SML ไม่สำเร็จ");
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
          <Box sx={{ alignItems: "flex-start", display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", md: "150px 150px minmax(220px, 1fr) auto" }, minWidth: 0 }}>
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
              label="ค้นหา"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="เลขบิล / รหัสลูกค้า / หมายเหตุ"
              size="small"
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
            <Stack direction="row" spacing={1} sx={{ alignItems: "stretch" }}>
              <AppButton disabled={loading} onClick={() => void loadDocuments()} size="small" sx={{ flex: { xs: 1, md: "0 0 auto" }, minHeight: 40, minWidth: { md: 112 } }} tone="primary">ค้นหา</AppButton>
              <AppButton disabled={loading} onClick={() => void loadDocuments()} size="small" startIcon={<RefreshCw size={15} />} sx={{ flex: { xs: 1, md: "0 0 auto" }, minHeight: 40, minWidth: { md: 112 } }}>โหลดใหม่</AppButton>
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
                        {item.remark || "-"}
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
          confirmDisabled={busy}
          confirmLabel={busy ? "กำลังส่งเข้า SML" : "ยืนยันส่งเข้า SML"}
          detail={`ระบบจะเขียนข้อมูลจริงลง SML เฉพาะ ${writablePreviewCount} บิลที่ผ่านพรีวิว จากทั้งหมด ${preview.totalCount} บิล`}
          title="ยืนยันส่งเข้า SML"
          tone="danger"
          onCancel={() => setConfirmApplyOpen(false)}
          onConfirm={() => void applyBulk()}
        >
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" } }}>
            <SummaryLine label="บิลที่เลือก" value={`${selectedDocNos.length} บิล`} />
            <SummaryLine label="บิลที่จะส่งเข้า SML" value={`${writablePreviewCount} บิล`} strong />
            <SummaryLine label="ชุดเลขใหม่" value={selectedFormat || "-"} />
            <SummaryLine label="ลูกหนี้ใหม่" value={selectedCustomer || "-"} />
            <SummaryLine label="สินค้าที่จะลบ" value={removeItemCodes.length ? removeItemCodes.join(", ") : "ไม่มี"} />
          </Box>
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
                      <Typography sx={{ fontWeight: 700 }} variant="body2">{selectedPreview.after.remark || "ไม่มีหมายเหตุ"}</Typography>
                      {valueChanged(selectedPreview.after.remark, selectedPreview.before.remark) ? (
                        <Typography color="text.secondary" sx={{ display: "block", mt: 0.25 }} variant="caption">เดิม: {selectedPreview.before.remark || "ไม่มีหมายเหตุ"}</Typography>
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

function PreviewRemovedLinesPanel({ lines, summaryLabel = "รวมที่จะลบ", title = "รายการสินค้าที่จะถูกลบ" }: { lines: DocumentDetailLine[]; summaryLabel?: string; title?: string }) {
  const isMobile = useMediaQuery(appTheme.breakpoints.down("sm"));
  const totalQty = lines.reduce((sum, line) => sum + numericValue(line.qty), 0);
  const totalAmount = lines.reduce((sum, line) => sum + numericValue(line.sumAmount), 0);

  return (
    <Paper variant="outlined" sx={{ bgcolor: "rgba(208, 68, 55, 0.04)", borderColor: "error.main", overflow: "hidden" }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", p: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
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
                    <Typography color="error.main" sx={{ fontWeight: 800 }} variant="body2">{formatMoney(line.sumAmount)}</Typography>
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
                <TableCell align="right"><Typography color="error.main" sx={{ fontWeight: 800 }} variant="body2">{formatMoney(line.sumAmount)}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      )}
      <Stack direction="row" spacing={3} sx={{ bgcolor: "action.hover", justifyContent: "flex-end", p: 1.5 }}>
        <Typography sx={{ fontWeight: 700 }}>{summaryLabel}</Typography>
        <Typography>จำนวน {formatMoney(String(totalQty))}</Typography>
        <Typography color="error.main" sx={{ fontWeight: 900 }}>ยอด {formatMoney(String(totalAmount))}</Typography>
      </Stack>
    </Paper>
  );
}

const auditActionButtonSx = { fontSize: 11.75, fontWeight: 700, minHeight: 30, minWidth: 56, px: 0.65, whiteSpace: "nowrap" } as const;

function AuditLogPage({ selectedDocNo, user }: { selectedDocNo: string; user: UserClaims }) {
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
      renderCell: (params) => <Typography sx={{ fontWeight: 700 }} variant="body2">#{params.row.snapshotId}</Typography>,
    },
    {
      field: "originalDocNo",
      headerName: "เลขเดิม",
      minWidth: 108,
      flex: 0.9,
      renderCell: (params) => <Typography sx={{ fontWeight: 700 }} variant="body2">{params.row.originalDocNo}</Typography>,
    },
    {
      field: "currentDocNo",
      headerName: "เลขใหม่",
      minWidth: 108,
      flex: 0.9,
      renderCell: (params) => <Typography color="primary.main" sx={{ fontWeight: 700 }} variant="body2">{params.row.currentDocNo || "-"}</Typography>,
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
            <Typography component="h2" sx={{ fontWeight: 700 }} variant="subtitle1">ประวัติการบันทึก</Typography>
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
                    fontSize: 13,
                    "& .MuiDataGrid-cell": {
                      alignItems: "center",
                      display: "flex",
                      py: 0.75,
                    },
                    "& .MuiDataGrid-columnHeaderTitle": {
                      fontSize: 13,
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
            <Typography component="h3" sx={{ fontWeight: 700 }} variant="subtitle2">{item.originalDocNo} → {item.currentDocNo || "-"}</Typography>
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
  const sections = useMemo(() => technicalJsonSections(item), [item]);
  const active = sections[tab] || sections[0];
  const jsonComponents = useMemo(() => createJsonDiffComponents(active.diff), [active.diff]);
  const hasDiff = active.diff.size > 0;

  async function copyActiveJson() {
    await navigator.clipboard?.writeText(formatJSON(active.value));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Dialog fullScreen={isMobile} fullWidth maxWidth="lg" open onClose={onClose}>
      <DialogTitle sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
          <Typography component="h2" noWrap sx={{ fontWeight: 700, minWidth: 0 }} variant="subtitle1">
            ข้อมูลเทคนิค • Snapshot #{item.snapshotId} • {item.originalDocNo} → {item.currentDocNo || "-"}
          </Typography>
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

function AuditEventDetails({ item }: { item: AuditLogItem }) {
  const data = item.afterData || {};
  const details = [
    { label: "เลขบิลใหม่", value: pickAuditValue(data, ["after.docNo", "newDocNo", "restored.docNo"]) },
    { label: "บิลทั้งหมด", value: pickAuditValue(data, ["totalCount"]) },
    { label: "ส่งเข้า SML สำเร็จ", value: pickAuditValue(data, ["appliedCount"]) },
    { label: "พร้อม", value: pickAuditValue(data, ["readyCount"]) },
    { label: "ไม่ผ่าน", value: pickAuditValue(data, ["blockedCount", "failedCount"]) },
    { label: "ยังไม่ดำเนินการ", value: pickAuditValue(data, ["skippedCount"]) },
  ].filter((detail) => detail.value);

  if (!details.length) return null;

  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
      {details.map((detail) => (
        <Typography key={detail.label} variant="caption">
          {detail.label}: <strong>{detail.value}</strong>
        </Typography>
      ))}
    </Stack>
  );
}

function SystemStatusPage({ status, onRefresh }: { status: DatabaseStatus | null; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<{ severity: "success" | "error"; text: string } | null>(null);
  const missingSmlTables = status?.missingSmlTables || [];
  const missingAppTables = status?.missingAppTables || [];
  const canInstallAppTables = Boolean(status?.connected && status.requiredSmlReady && !status.appSchemaReady && !installing);

  async function installAppTables() {
    if (!canInstallAppTables) return;
    setInstalling(true);
    setMessage(null);
    try {
      const response = await apiPost<DatabaseStatus>("/api/v1/system/database-migrate", {});
      if (response.success) {
        setMessage({ severity: "success", text: "ติดตั้งตารางระบบสำเร็จ ตรวจสอบสถานะล่าสุดแล้ว" });
        await onRefresh();
      } else {
        setMessage({ severity: "error", text: response.error?.detail || response.message || "ติดตั้งตารางระบบไม่สำเร็จ" });
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="สำหรับผู้ดูแลระบบ"
        title="ตั้งค่าและตรวจระบบ"
        description="ตรวจฐาน SML และติดตั้งตารางของ next-salesinvoice เมื่อย้ายไปฐานใหม่"
        actions={
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <AppButton onClick={() => navigate("/bulk-edit")} startIcon={<ChevronLeft size={16} />}>กลับไปแก้ไขบิล</AppButton>
            <AppButton disabled={installing} onClick={() => void onRefresh()} startIcon={<RefreshCw size={16} />}>ตรวจสอบใหม่</AppButton>
          </Stack>
        }
      />
      <SystemSetupAlert
        canInstall={canInstallAppTables}
        installing={installing}
        missingAppTables={missingAppTables}
        missingSmlTables={missingSmlTables}
        status={status}
        onInstall={() => void installAppTables()}
      />
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" } }}>
        <MetricCard icon={Database} label="ฐานข้อมูล" value={status?.database || "-"} />
        <MetricCard icon={CheckCircle2} label="เชื่อมต่อ" value={status?.connected ? "พร้อม" : "ไม่พร้อม"} tone={status?.connected ? "neutral" : "danger"} />
        <MetricCard icon={ShieldCheck} label="ตาราง SML" value={status?.requiredSmlReady ? "ครบ" : "ไม่ครบ"} tone={status?.requiredSmlReady ? "neutral" : "danger"} />
        <MetricCard icon={ClipboardCheck} label="ตารางระบบ" value={status?.appSchemaReady ? "พร้อม" : "ไม่พร้อม"} tone={status?.appSchemaReady ? "neutral" : "danger"} />
      </Box>
      <StatusChecklist status={status} />
      <MissingTablesPanel
        description="ต้องมีตารางหลักของ SML ก่อน ระบบจึงจะติดตั้งตาราง next-salesinvoice ได้"
        severity="error"
        tables={missingSmlTables}
        title="SML tables ที่ยังไม่ครบ"
      />
      <MissingTablesPanel
        description="ตารางเหล่านี้เป็นของ next-salesinvoice และติดตั้งได้จากปุ่มด้านบนเมื่อ SML พร้อม"
        severity="warning"
        tables={missingAppTables}
        title="ตารางระบบที่ยังไม่พบ"
      />
    </Stack>
  );
}

function SystemSetupAlert({
  canInstall,
  installing,
  missingAppTables,
  missingSmlTables,
  status,
  onInstall,
}: {
  canInstall: boolean;
  installing: boolean;
  missingAppTables: string[];
  missingSmlTables: string[];
  status: DatabaseStatus | null;
  onInstall: () => void;
}) {
  if (!status) return <Alert severity="info">กำลังตรวจสอบสถานะฐานข้อมูล</Alert>;

  if (!status.connected) {
    return <Alert severity="error">ยังเชื่อมต่อฐานข้อมูลไม่ได้ ตรวจสอบ host, port, user และ password ก่อนติดตั้งตารางระบบ</Alert>;
  }

  if (!status.requiredSmlReady) {
    return (
      <Alert
        action={<AppButton disabled startIcon={<ShieldCheck size={16} />} tone="primary">ติดตั้งตารางระบบ</AppButton>}
        severity="error"
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          "& .MuiAlert-action": { ml: { xs: 0, sm: "auto" }, pl: { xs: 0, sm: 2 }, pt: { xs: 1, sm: 0 } },
        }}
      >
        SML tables หลักยังไม่ครบ ต้องแก้โครงสร้างฐาน SML ก่อนติดตั้งตารางของ next-salesinvoice
        {missingSmlTables.length ? ` (${missingSmlTables.length} ตาราง)` : ""}
      </Alert>
    );
  }

  if (!status.appSchemaReady) {
    return (
      <Alert
        action={
          <AppButton disabled={!canInstall} onClick={onInstall} startIcon={installing ? <CircularProgress size={14} /> : <ShieldCheck size={16} />} tone="primary">
            {installing ? "กำลังติดตั้ง" : "ติดตั้งตารางระบบ"}
          </AppButton>
        }
        severity="warning"
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          "& .MuiAlert-action": { ml: { xs: 0, sm: "auto" }, pl: { xs: 0, sm: 2 }, pt: { xs: 1, sm: 0 } },
        }}
      >
        ฐานนี้ยังไม่มีตารางของ next-salesinvoice
        {missingAppTables.length ? ` (${missingAppTables.length} ตาราง)` : ""} กดติดตั้งเมื่อยืนยันว่าเป็นฐานที่ต้องใช้งานจริง
      </Alert>
    );
  }

  return <Alert severity="success">ตารางระบบพร้อมใช้งาน ฐานนี้สามารถใช้ flow แก้ไขบิลและ rollback ได้แล้ว</Alert>;
}

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Stack spacing={2.5}>
      <PageHeader
        eyebrow="ไม่พบหน้า"
        title="ลิงก์นี้ไม่มีในระบบ"
        description="ตรวจสอบ URL อีกครั้ง หรือกลับไปหน้าแก้ไขบิลเพื่อเริ่มงานใหม่"
        actions={<AppButton onClick={() => navigate("/bulk-edit")} startIcon={<ChevronLeft size={16} />}>กลับไปแก้ไขบิล</AppButton>}
      />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <EmptyState title="ไม่พบหน้าที่ต้องการ" description="ระบบอาจย้ายเส้นทางหรือ URL ไม่ครบถ้วน" />
      </Paper>
    </Stack>
  );
}

function StatusChecklist({ status }: { status: DatabaseStatus | null }) {
  const rows = [
    { label: "เชื่อมต่อฐานข้อมูล", ok: Boolean(status?.connected), detail: systemConnectionDetail(status) },
    { label: "ข้อมูล SML ที่จำเป็น", ok: Boolean(status?.requiredSmlReady), detail: status?.requiredSmlReady ? "ตารางหลักของ SML ครบ" : missingTablesText(status?.missingSmlTables) },
    { label: "ตารางของระบบแก้ไขบิล", ok: Boolean(status?.appSchemaReady), detail: status?.appSchemaReady ? "ตาราง next-salesinvoice พร้อมใช้งาน" : missingTablesText(status?.missingAppTables) },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
      <Box>
        <Typography color="text.secondary" variant="body2">ตรวจความพร้อม</Typography>
        <Typography component="h2" sx={{ fontWeight: 700 }} variant="h6">รายการตรวจสอบ</Typography>
      </Box>
      <Stack spacing={1}>
        {rows.map((row) => (
          <Paper key={row.label} variant="outlined" sx={{ alignItems: "center", display: "flex", gap: 1.5, p: 1.5 }}>
            <StatusBadge tone={row.ok ? "success" : "danger"}>{row.ok ? "ผ่าน" : "ต้องตรวจสอบ"}</StatusBadge>
            <Box>
              <Typography sx={{ fontWeight: 700 }} variant="body2">{row.label}</Typography>
              <Typography color="text.secondary" variant="caption">{row.detail}</Typography>
            </Box>
          </Paper>
        ))}
      </Stack>
      </Stack>
    </Paper>
  );
}

function MissingTablesPanel({ description, severity, tables, title }: { description: string; severity: "error" | "warning"; tables: string[]; title: string }) {
  if (!tables.length) return null;
  return (
    <Paper
      variant="outlined"
      sx={{
        borderColor: severity === "error" ? "error.light" : "warning.light",
        p: 2,
      }}
    >
      <Stack spacing={1}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography component="h2" sx={{ fontWeight: 700 }} variant="subtitle1">{title}</Typography>
            <Typography color="text.secondary" variant="caption">{description}</Typography>
          </Box>
          <StatusBadge tone={severity === "error" ? "danger" : "neutral"}>{tables.length} ตาราง</StatusBadge>
        </Stack>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
          {tables.map((table) => (
            <Chip key={table} label={table} size="small" variant="outlined" />
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function systemConnectionDetail(status: DatabaseStatus | null) {
  if (!status?.database) return "-";
  return status.schema ? `${status.database} · schema ${status.schema}` : status.database;
}

function missingTablesText(tables?: string[]) {
  if (!tables?.length) return "ไม่พบรายการที่ขาดจาก API";
  const preview = tables.slice(0, 4).join(", ");
  return tables.length > 4 ? `ขาด ${tables.length} ตาราง: ${preview}...` : `ขาด ${tables.length} ตาราง: ${preview}`;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}>
      <Box>
        {eyebrow ? <Typography color="text.secondary" variant="caption">{eyebrow}</Typography> : null}
        <Typography component="h1" sx={{ fontWeight: 700 }} variant="h5">{title}</Typography>
        {description ? <Typography color="text.secondary" variant="caption">{description}</Typography> : null}
      </Box>
      <Box>{actions}</Box>
    </Stack>
  );
}

function PageLoading({ title }: { title: string }) {
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ display: "grid", gap: 2, p: 2 }}>
        <Typography component="h2" variant="h6">{title}</Typography>
        <SkeletonLine width="60%" />
        <LinearProgress />
      </Paper>
    </Stack>
  );
}

function MetricCard({ icon: Icon, label, value, tone = "neutral" }: { icon: typeof FileText; label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <Paper variant="outlined" sx={{ display: "grid", gap: 0.75, p: 2 }}>
      <Icon size={18} />
      <Typography color="text.secondary" variant="body2">{label}</Typography>
      <Typography color={tone === "danger" ? "error.main" : "text.primary"} sx={{ fontWeight: 800 }} variant="h6">{value}</Typography>
    </Paper>
  );
}

function MetricValue({ compact = false, helper, label, value }: { compact?: boolean; helper: string; label: string; value: string }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: compact ? 1 : 2, textAlign: compact ? "center" : "left", "&:last-child": { pb: compact ? 1 : 2 } }}>
        <Typography color="text.secondary" noWrap variant={compact ? "caption" : "body2"}>{label}</Typography>
        <Typography sx={{ fontWeight: 800, my: compact ? 0 : 0.5 }} variant={compact ? "h5" : "h4"}>{value}</Typography>
        <Typography color="text.secondary" sx={{ display: compact ? "none" : "block" }} variant="caption">{helper}</Typography>
      </CardContent>
    </Card>
  );
}

function RiskConfirmDialog({
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
  children?: React.ReactNode;
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

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Paper
      variant="outlined"
      sx={{ alignItems: "center", display: "grid", gap: 1, justifyItems: "center", minHeight: 160, p: 3, textAlign: "center" }}
    >
      <AlertTriangle size={22} />
      <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
      <Typography color="text.secondary" variant="body2">{description}</Typography>
      {action}
    </Paper>
  );
}

function StackRow({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ alignItems: "flex-start", display: "flex", gap: 2, justifyContent: "space-between" }}>
      {children}
    </Box>
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

function AppButton({
  tone = "secondary",
  children,
  ...props
}: ButtonProps & { tone?: "primary" | "secondary" | "danger" | "ghost" }) {
  const color = tone === "danger" ? "error" : tone === "primary" ? "primary" : "inherit";
  const variant = tone === "primary" || tone === "danger" ? "contained" : tone === "ghost" ? "text" : "outlined";
  return (
    <Button color={color} variant={variant} {...props}>
      {children}
    </Button>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <Paper elevation={0} variant="outlined" sx={{ p: 1.25 }}>
      <Typography color="text.secondary" variant="caption">{label}</Typography>
      <Typography color={strong ? "primary.main" : "text.primary"} sx={{ fontWeight: strong ? 800 : 700 }}>{value}</Typography>
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

function DocumentFact({
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

function TotalLine({
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

function ChangedValue({
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

function StatusBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "danger" }) {
  const color = tone === "success" ? "success" : tone === "danger" ? "error" : "default";
  return <Chip color={color} label={children} size="small" variant={tone === "neutral" ? "outlined" : "filled"} />;
}

function documentsURL(fromDate: string, toDate: string, q = "") {
  const params = new URLSearchParams({ from: fromDate, to: toDate, page: "1", pageSize: "100" });
  if (q.trim()) params.set("q", q.trim());
  return `/api/v1/documents?${params.toString()}`;
}

function pickAuditValue(data: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = readAuditPath(data, path);
    if (value !== undefined && value !== null && value !== "") return formatAuditValue(value);
  }
  return "";
}

function readAuditPath(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

function formatAuditValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} รายการ`;
  if (value && typeof value === "object") return "มีข้อมูล";
  return "";
}

function formatJSON(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return `${value}`;
  }
}

function auditActionLabel(action: string) {
  if (action === "login_success") return "เข้าสู่ระบบสำเร็จ";
  if (action === "login_failed") return "เข้าสู่ระบบไม่สำเร็จ";
  if (action.includes("preview")) return "พรีวิวก่อนส่งเข้า SML";
  if (action.includes("apply")) return "ส่งเข้า SML";
  if (action.includes("rollback")) return "ย้อนกลับข้อมูล";
  if (action.includes("database_config")) return "บันทึกค่าฐานข้อมูล";
  return action;
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

function appStatusLabel(status: string) {
  if (status === "audit_before") return "ข้อมูลเดิม";
  if (status === "audit_after") return "ข้อมูลใหม่";
  if (status === "processing") return "กำลังทำ";
  if (status === "done") return "เสร็จแล้ว";
  if (status === "failed") return "ผิดพลาด";
  if (status === "rolled_back") return "ย้อนกลับแล้ว";
  return "รอดำเนินการ";
}

function appStatusTone(status: string): "neutral" | "success" | "danger" {
  if (status === "done" || status === "rolled_back") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

function pageFromPath(pathname: string): PageKey {
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/system/status")) return "status";
  return "bulk";
}

function titleFromPath(pathname: string) {
  if (pathname.includes("/edit")) return "แก้บิลที่เลือก";
  if (pathname.startsWith("/bulk-edit")) return "แก้ไขบิล";
  if (pathname.startsWith("/audit")) return "ประวัติและย้อนกลับ";
  if (pathname.startsWith("/system/status")) return "ตรวจระบบ";
  return "แก้ไขบิล";
}

function legacyPathFromPage(page: string) {
  if (page === "invoices") return "/bulk-edit";
  if (page === "edit") return "/bulk-edit";
  if (page === "bulk") return "/bulk-edit";
  if (page === "audit") return "/audit";
  if (page === "status") return "/system/status";
  return "";
}

function formatDate(value: string) {
  return value ? value.slice(0, 10) : "-";
}

function formatSmlDate(value: string) {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const parsedYear = Number(year);
  const displayYear = parsedYear < 2400 ? parsedYear + 543 : parsedYear;
  return `${Number(day)}/${Number(month)}/${displayYear}`;
}

function formatDocumentTime(value: string) {
  if (!value) return "-";
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

function formatMoney(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value || "-";
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed);
}

function changedPaperSx(changed: boolean, tone: "warning" | "success" = "warning") {
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

function changedCellSx(changed: boolean) {
  if (!changed) return {};
  return { bgcolor: "rgba(161, 98, 7, 0.10)" };
}

function normalizeCompareValue(value: unknown) {
  return String(value ?? "").trim();
}

function valueChanged(current: unknown, previous: unknown) {
  return normalizeCompareValue(current) !== normalizeCompareValue(previous);
}

function moneyValueChanged(current: unknown, previous: unknown) {
  const currentNumber = Number(current || 0);
  const previousNumber = Number(previous || 0);
  if (Number.isFinite(currentNumber) && Number.isFinite(previousNumber)) return Math.abs(currentNumber - previousNumber) > 0.004;
  return valueChanged(current, previous);
}

function buildPreviewChangeItems(preview: DocumentChangePreview): PreviewChangeItem[] {
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
    item("remark", "หมายเหตุ", preview.before.remark || "ไม่มีหมายเหตุ", preview.after.remark || "ไม่มีหมายเหตุ", valueChanged(preview.after.remark, preview.before.remark)),
    item("totalAmount", "ยอดสุทธิ", formatMoney(preview.before.totalAmount), formatMoney(preview.totals.totalAmount), moneyValueChanged(preview.totals.totalAmount, preview.before.totalAmount)),
    item("lineCount", "สินค้าในบิล", `${beforeLineCount} รายการ`, `${afterLineCount} รายการ`, preview.removedLines.length > 0 || beforeLineCount !== afterLineCount, "danger"),
  ];
}

const documentCompareFields: Array<keyof DocumentSummary> = [
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

function countChangedDocumentFields(current: DocumentSummary, previous: DocumentSummary) {
  return documentCompareFields.filter((field) => {
    if (String(field).startsWith("total") || field === "vatRate") return moneyValueChanged(current[field], previous[field]);
    return valueChanged(current[field], previous[field]);
  }).length;
}

type LineChangeState = {
  status: "same" | "changed" | "added";
  previous?: DocumentDetailLine;
  changedFields: Set<keyof DocumentDetailLine>;
};

const lineCompareFields: Array<keyof DocumentDetailLine> = [
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

function getLineChangeState(line: DocumentDetailLine, index: number, compareLines?: DocumentDetailLine[]): LineChangeState {
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

function getRemovedLines(currentLines: DocumentDetailLine[], previousLines: DocumentDetailLine[]) {
  return previousLines.filter((previous) => !currentLines.some((current) => sameLineIdentity(current, previous)));
}

function sameLineIdentity(current: DocumentDetailLine, previous: DocumentDetailLine) {
  const currentCode = current.itemCode.trim();
  const previousCode = previous.itemCode.trim();
  if (currentCode && previousCode) return currentCode === previousCode;
  return current.lineNumber === previous.lineNumber;
}

function productLineMeta(line: DocumentDetailLine) {
  const details = [
    line.barcode ? `บาร์โค้ด ${line.barcode}` : "",
  ].filter(Boolean);
  return details.join(" · ");
}

function productLineTitle(line: DocumentDetailLine, meta = productLineMeta(line)) {
  return [line.itemCode, line.itemName, meta].filter(Boolean).join(" · ");
}

function buildAuditInvoiceDialog(item: DocumentHistoryItem, side: "before" | "after"): AuditInvoiceDialogState {
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

function documentSummaryFromRawState(raw: Record<string, unknown>, fallbackDocNo: string, appStatus: string): DocumentSummary {
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

function documentLineFromRawState(raw: Record<string, unknown>, index: number): DocumentDetailLine {
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

function rawText(raw: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}

function rawInt(raw: Record<string, unknown>, keys: string[], fallback = 0) {
  const value = rawText(raw, keys);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function apiGet<T>(url: string): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { credentials: "include" });
}

async function apiPost<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
}

async function apiPut<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
}

async function apiRequest<T>(url: string, init: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    if (!text.trim()) {
      notifyAuthExpired(response.status);
      return {
        success: false,
        message: response.ok ? "empty response" : `HTTP ${response.status}`,
        data: null,
        error: {
          code: "HTTP_ERROR",
          detail: response.ok ? "เซิร์ฟเวอร์ตอบกลับโดยไม่มีข้อมูล" : "เชื่อมต่อ backend ไม่สำเร็จหรือ backend ยังไม่พร้อมใช้งาน",
        },
      };
    }
    try {
      const payload = JSON.parse(text) as ApiResponse<T>;
      notifyAuthExpired(0, payload.error?.code);
      return payload;
    } catch {
      return {
        success: false,
        message: "invalid json response",
        data: null,
        error: {
          code: "INVALID_JSON",
          detail: "เซิร์ฟเวอร์ตอบกลับมาไม่ใช่ JSON ที่ระบบอ่านได้",
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      message: "network error",
      data: null,
      error: {
        code: "NETWORK_ERROR",
        detail: error instanceof Error ? error.message : "เชื่อมต่อ backend ไม่สำเร็จ",
      },
    };
  }
}

function notifyAuthExpired(status: number, code = "") {
  if (status === 401 || code === "ERR_UNAUTHORIZED") {
    window.dispatchEvent(new Event(authExpiredEvent));
  }
}
