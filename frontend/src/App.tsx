import { Component, CSSProperties, FormEvent, ReactNode, useEffect, useState } from "react";
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
  Database,
  FileText,
  History,
  LogOut,
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
  requiredSmlReady: boolean;
  appSchemaReady: boolean;
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

type PagedDocuments = {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

type SelectableDocuments = {
  docNos: string[];
  count: number;
  limit: number;
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

type SearchDropdownProps<T extends Option> = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: T[];
  loading: boolean;
  minLength?: number;
  loadingLabel: string;
  emptyLabel: string;
  shortLabel?: string;
  showEmpty: boolean;
  disabledDropdown?: boolean;
  className?: string;
  children?: ReactNode;
  onChange: (value: string) => void;
  onSelect: (item: T) => void;
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
  status: "ready" | "warning" | "blocked" | "applied" | "failed";
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
};

type BulkPreviewFilter = "all" | "ready" | "warning" | "blocked";

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

type AuditInvoiceDialogState = {
  doc: DocumentSummary;
  lines: DocumentDetailLine[];
  title: string;
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

const navItems: Array<{ key: PageKey; label: string; group: string; icon: typeof FileText; path: string; adminOnly?: boolean }> = [
  { key: "bulk", label: "แก้ไขบิล", group: "งานประจำ", icon: ListChecks, path: "/bulk-edit" },
  { key: "audit", label: "ประวัติและย้อนกลับ", group: "ตรวจสอบ", icon: History, path: "/audit", adminOnly: true },
  { key: "status", label: "ตรวจระบบ", group: "ระบบ", icon: Database, path: "/system/status" },
];

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppRoutes />
      </BrowserRouter>
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
      <main className="auth-page">
        <section className="login-card">
          <div className="brand-lockup">
            <div className="brand-mark">NS</div>
            <div>
              <h1>ระบบหยุดทำงานชั่วคราว</h1>
              <p>ลองโหลดหน้าใหม่อีกครั้ง หากยังพบปัญหาให้ส่งข้อความนี้ให้ผู้ดูแลระบบ</p>
            </div>
          </div>
          <div className="alert">{this.state.error.message}</div>
          <button className="btn primary" onClick={() => window.location.reload()}>โหลดหน้าใหม่</button>
        </section>
      </main>
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

  async function boot() {
    setBooting(true);
    const shouldCheckSession = localStorage.getItem(authSessionKey) === "1";
    const statusResponse = await apiGet<DatabaseStatus>("/api/v1/system/database-status");
    if (statusResponse.success && statusResponse.data) setStatus(statusResponse.data);
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
                <Route path="bulk-edit" element={<BulkInvoiceEditPage status={status} />} />
                <Route path="audit" element={user.role === "Admin" ? <AuditLogRoute user={user} /> : <Navigate to="/bulk-edit" replace />} />
                <Route path="audit/:docNo" element={user.role === "Admin" ? <AuditLogRoute user={user} /> : <Navigate to="/bulk-edit" replace />} />
                <Route path="system/status" element={<SystemStatusPage status={status} onRefresh={boot} />} />
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

function BootScreen() {
  return (
    <main className="auth-page">
      <div className="login-card skeleton-card">
        <div className="skeleton w-60" />
        <div className="skeleton w-36" />
        <div className="skeleton h-12" />
      </div>
    </main>
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
    <main className="auth-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lockup">
          <div className="brand-mark">NS</div>
          <div>
            <h1>next-salesinvoice</h1>
            <p>ระบบจัดการเอกสารขาย</p>
          </div>
        </div>
        <div className="system-strip">
          <StatusBadge tone={databaseReady ? "success" : "danger"}>
            {databaseReady ? "ฐานข้อมูลพร้อมใช้งาน" : "ฐานข้อมูลยังไม่พร้อม"}
          </StatusBadge>
          <span>{status?.database || "ไม่พบฐานข้อมูล"}</span>
        </div>
        <label>
          รหัสพนักงาน
          <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="username" />
        </label>
        <label>
          รหัสผ่าน
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="กรอกรหัสผ่าน"
          />
        </label>
        {message ? <div className="alert">{message}</div> : null}
        <button className="btn primary" disabled={!databaseReady || !code || !password || submitting} type="submit">
          {submitting ? "กำลังเข้าสู่ระบบ" : "เข้าสู่ระบบ"}
        </button>
        <button className="btn secondary" onClick={() => setDatabaseSetupOpen(true)} type="button">ตั้งค่าฐานข้อมูล</button>
      </form>
      {databaseSetupOpen ? <LoginDatabaseSetupDialog status={status} onClose={() => setDatabaseSetupOpen(false)} /> : null}
    </main>
  );
}

function LoginDatabaseSetupDialog({ status, onClose }: { status: DatabaseStatus | null; onClose: () => void }) {
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
    <div className="modal-backdrop">
      <section className="dialog">
        <div className="dialog-header">
          <div>
            <p>ฐานข้อมูลก่อนเข้าสู่ระบบ</p>
            <h2>ตั้งค่าการเชื่อมต่อฐานข้อมูล</h2>
          </div>
          <StatusBadge tone={status?.connected ? "success" : "danger"}>{status?.connected ? "ฐานเดิมพร้อม" : "ฐานเดิมไม่พร้อม"}</StatusBadge>
        </div>
        <div className="warning-box">ใช้เฉพาะผู้ดูแลระบบตอนเลือกฐานข้อมูลร้าน ระบบจะใช้ SSL disable และ schema public ให้อัตโนมัติ</div>
        {message ? <div className={message.includes("ผ่าน") || message.includes("แล้ว") ? "warning-box" : "alert"}>{message}</div> : null}
        <div className="form-grid">
          <label>
            Host
            <input value={form.host} onChange={(event) => updateForm({ ...form, host: event.target.value })} />
          </label>
          <label>
            Port
            <input type="number" value={form.port} onChange={(event) => updateForm({ ...form, port: Number(event.target.value) })} />
          </label>
          <label>
            Database
            <input value={form.database} onChange={(event) => updateForm({ ...form, database: event.target.value })} />
          </label>
          <label>
            User
            <input value={form.user} onChange={(event) => updateForm({ ...form, user: event.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={form.password || ""} onChange={(event) => updateForm({ ...form, password: event.target.value })} />
          </label>
          <label>
            รหัสยืนยันผู้ดูแลระบบ
            <input
              autoComplete="off"
              placeholder="กรอกรหัสยืนยันก่อนเริ่มใช้ฐานนี้"
              type="password"
              value={setupSecret}
              onChange={(event) => {
                setSetupSecret(event.target.value);
                setMessage("");
              }}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button className="btn secondary" disabled={busy} onClick={onClose}>ปิด</button>
          <button className="btn secondary" disabled={busy || !canSubmit} onClick={() => void verifyDatabaseSetup()}>
            {busy ? "กำลังทดสอบ" : verified ? "ทดสอบผ่านแล้ว" : "ทดสอบการเชื่อมต่อ"}
          </button>
          <button className="btn danger" disabled={busy || !canApply} onClick={() => void applyDatabaseSetup()}>
            {busy ? "กำลังเชื่อมต่อ" : "เริ่มใช้ค่าฐานนี้"}
          </button>
        </div>
      </section>
    </div>
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup compact">
          <div className="brand-mark">NS</div>
          <div>
            <strong>next-salesinvoice</strong>
            <p>Review Desk</p>
          </div>
        </div>
        <nav>
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span>{group}</span>
              {visibleNavItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={activePage === item.key ? "active" : ""}
                    key={item.key}
                    onClick={() => onNavigate(item.key)}
                    type="button"
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{user.displayName}</strong>
            <span>{user.userCode}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">next-salesinvoice / {title}</span>
            <select className="mobile-page-select" value={activePage} onChange={(event) => onNavigate(event.target.value as PageKey)}>
              {visibleNavItems.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="topbar-actions">
            <StatusBadge tone={databaseReady ? "success" : "danger"}>
              {databaseReady ? "ฐานข้อมูลพร้อมใช้งาน" : "ฐานข้อมูลมีปัญหา"}
            </StatusBadge>
            <span className="database-name">{status?.database || "-"}</span>
            <button className="btn ghost" onClick={onLogout}><LogOut size={16} /> ออกจากระบบ</button>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}

function InvoiceDetailDialog({
  doc,
  lines,
  onClose,
  onEdit,
  title = "รายละเอียดบิล",
}: {
  doc: DocumentSummary;
  lines?: DocumentDetailLine[];
  onClose: () => void;
  onEdit?: (docNo: string) => void;
  title?: string;
}) {
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
    <div className="modal-backdrop">
      <section className="dialog invoice-detail-dialog">
        <div className="dialog-header">
          <div className="invoice-dialog-title">
            <span>{title}</span>
            <h2>{doc.docNo}</h2>
          </div>
          <div className="dialog-header-actions">
            <StatusBadge tone={appStatusTone(doc.appStatus)}>{appStatusLabel(doc.appStatus)}</StatusBadge>
            <button aria-label="ปิดรายละเอียดบิล" className="dialog-icon-button" onClick={onClose} type="button">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="invoice-document-layout">
          <section className="invoice-document-header">
            <DocumentFact label="วันที่เอกสาร" value={formatDate(doc.docDate)} />
            <DocumentFact label="เวลา" value={doc.docTime || "-"} />
            <DocumentFact label="เลขที่เอกสาร" value={doc.docNo} strong />
            <DocumentFact label="รูปแบบ" value={doc.docFormatCode || "-"} />
            <DocumentFact label="รหัสลูกหนี้" value={doc.customerCode || "-"} strong />
            <DocumentFact label="ผู้ติดต่อ" value={doc.contactor || "-"} />
            <DocumentFact label="วันที่ใบกำกับภาษี" value={formatDate(doc.taxDocDate)} />
            <DocumentFact label="เลขที่ใบกำกับภาษี" value={doc.taxDocNo || "-"} />
            <DocumentFact label="เอกสารอ้างอิง" value={doc.docRef || "-"} />
            <DocumentFact label="วันที่อ้างอิง" value={formatDate(doc.docRefDate)} />
            <DocumentFact label="ประเภทขาย" value={saleTypeLabels[doc.inquiryType] || `${doc.inquiryType}`} />
            <DocumentFact label="ประเภทภาษี" value={taxTypeLabels[doc.vatType] || `${doc.vatType}`} />
          </section>
          <DocumentLinesPanel docNo={doc.docNo} lines={lines} />
          <section className="invoice-document-footer">
            <div className="invoice-document-meta">
              <div className="document-remark">
                <span>หมายเหตุ</span>
                <strong>{doc.remark || "ไม่มีหมายเหตุ"}</strong>
              </div>
            </div>
            <div className="document-total-block">
              <TotalLine label="อัตราภาษี" value={formatMoney(doc.vatRate)} />
              <TotalLine label="มูลค่าสินค้า" value={formatMoney(doc.totalValue)} />
              <TotalLine label="ส่วนลดรวม" value={formatMoney(doc.totalDiscount)} />
              <TotalLine label="มูลค่าก่อนภาษี" value={formatMoney(doc.totalBeforeVat)} />
              <TotalLine label="มูลค่าภาษี" value={formatMoney(doc.totalVatValue)} />
              <TotalLine label="มูลค่ายกเว้นภาษี" value={formatMoney(doc.totalExceptVat)} />
              <TotalLine label="มูลค่าหลังภาษี" value={formatMoney(doc.totalAfterVat)} />
              <TotalLine label="ยอดสุทธิ" value={formatMoney(doc.totalAmount)} strong />
            </div>
          </section>
        </div>
        <div className="dialog-actions sticky-actions">
          <button className="btn secondary" onClick={onClose}>ปิด</button>
          {onEdit ? <button className="btn primary" onClick={() => onEdit(doc.docNo)}>แก้ไขบิลนี้</button> : null}
        </div>
      </section>
    </div>
  );
}

function DocumentLinesPanel({ docNo, lines: providedLines }: { docNo: string; lines?: DocumentDetailLine[] }) {
  const [fetchedLines, setFetchedLines] = useState<DocumentDetailLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const lines = providedLines ?? fetchedLines;
  const totalQty = lines.reduce((sum, line) => sum + numericValue(line.qty), 0);
  const totalAmount = lines.reduce((sum, line) => sum + numericValue(line.sumAmount), 0);
  const visibleRows = loading ? 4 : Math.min(Math.max(lines.length, 2), 12);
  const hasMoreRows = lines.length > visibleRows;
  const panelStyle = { "--invoice-lines-panel-height": `${6.5 + visibleRows * 2.625}rem` } as CSSProperties;

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
    <div className="invoice-lines-panel" style={panelStyle}>
      <div className="subsection-header">
        <strong>รายการสินค้าในบิล <span>{loading ? "กำลังโหลด" : `${lines.length} รายการ`}</span></strong>
        {hasMoreRows ? <span className="table-scroll-hint">เลื่อนดูรายการเพิ่มเติม</span> : null}
      </div>
      {message ? <div className="alert">{message}</div> : null}
      <div className="invoice-product-list">
        <div className="invoice-product-grid invoice-product-head" aria-hidden="true">
          <span>#</span>
          <span>รหัสสินค้า / ชื่อสินค้า</span>
          <span>คลัง</span>
          <span>พื้นที่เก็บ</span>
          <span>หน่วย</span>
          <span>จำนวน</span>
          <span>ราคา</span>
          <span>ส่วนลด</span>
          <span>ยอดรวม</span>
        </div>
        <div className="invoice-product-scroll">
          {lines.map((line, index) => {
            const lineMeta = productLineMeta(line);
            return (
              <article className="invoice-product-grid invoice-product-row" key={`${index}-${line.lineNumber}-${line.itemCode}`}>
                <span className="invoice-product-line">{index + 1}</span>
                <div className="invoice-product-name" title={productLineTitle(line, lineMeta)}>
                  <strong>{line.itemCode || "-"}</strong>
                  <span>{line.itemName || "-"}</span>
                  {lineMeta ? <small>{lineMeta}</small> : null}
                </div>
                <span className="invoice-product-cell" title={line.whCode || "-"}>{line.whCode || "-"}</span>
                <span className="invoice-product-cell" title={line.shelfCode || "-"}>{line.shelfCode || "-"}</span>
                <span className="invoice-product-cell" title={line.unitCode || "-"}>{line.unitCode || "-"}</span>
                <span className="invoice-product-cell numeric">{formatMoney(line.qty)}</span>
                <span className="invoice-product-cell numeric">{formatMoney(line.price)}</span>
                <span className="invoice-product-cell">{line.discount || "-"}</span>
                <strong className="invoice-product-cell numeric amount">{formatMoney(line.sumAmount)}</strong>
              </article>
            );
          })}
          {!loading && !lines.length && !message ? <EmptyState title="ไม่มีรายการสินค้า" description="ไม่พบข้อมูลจาก ic_trans_detail ของบิลนี้" /> : null}
          {loading ? <div className="invoice-line-loading">กำลังโหลดรายการสินค้า...</div> : null}
        </div>
        {!loading && lines.length ? (
          <div className="invoice-product-grid invoice-product-total">
            <span className="product-total-label">รวมรายการสินค้า</span>
            <strong className="product-total-qty">จำนวน {formatMoney(String(totalQty))}</strong>
            <b className="product-total-amount">ยอดรวม {formatMoney(String(totalAmount))}</b>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BulkInvoiceEditPage({ status }: { status: DatabaseStatus | null }) {
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [productSearching, setProductSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailDocNo, setDetailDocNo] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  const items = documents?.items || [];
  const detailDocument = items.find((item) => item.docNo === detailDocNo) || items.find((item) => selectedDocNos.includes(item.docNo)) || items[0] || null;
  const selectedCustomerOption = customers.find((item) => item.code === selectedCustomer);
  const customerInputValue = customerSearch || (selectedCustomerOption ? `${selectedCustomerOption.code} - ${selectedCustomerOption.name}` : selectedCustomer);
  const canPreview = selectedDocNos.length > 0 && selectedFormat && selectedCustomer;
  const canOpenSettings = selectedDocNos.length > 0;
  const workflowHint = canPreview
    ? `พร้อมตรวจสอบ ${selectedDocNos.length} บิล, ลูกหนี้ใหม่ ${selectedCustomer}`
    : selectedDocNos.length
      ? "ตั้งค่าการแก้ไขให้ครบ โดยเฉพาะลูกหนี้ใหม่ ก่อนตรวจสอบ"
      : "เลือกบิลจากตารางก่อน แล้วค่อยตั้งค่าการแก้ไข";
  const readyToApply = Boolean(preview && (preview.readyCount + preview.warningCount) > 0 && busy === false);
  const visiblePreviewItems = preview?.items.filter((item) => {
    if (previewFilter === "all") return true;
    if (previewFilter === "blocked") return item.status === "blocked" || item.status === "failed";
    return item.status === previewFilter;
  }) || [];
  const customerQuery = customerSearch.trim();
  const productQuery = productSearch.trim();
  const showCustomerEmpty = customerQuery.length >= 2 && !selectedCustomer && !customerSearching && customers.length === 0;
  const showProductEmpty = productQuery.length >= 2 && !productSearching && products.length === 0;

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

  async function loadDocuments() {
    setLoading(true);
    setMessage("");
    setPreview(null);
    setPreviewFilter("all");
    const nextParams = new URLSearchParams();
    nextParams.set("from", fromDate);
    nextParams.set("to", toDate);
    if (search.trim()) nextParams.set("q", search.trim());
    setSearchParams(nextParams, { replace: true });
    const response = await apiGet<PagedDocuments>(documentsURL(fromDate, toDate, search));
    if (response.success && response.data) {
      setDocuments(response.data);
      setSelectedDocNos((current) => current.filter((docNo) => response.data?.items.some((item) => item.docNo === docNo)));
    } else {
      setMessage(response.error?.detail || response.message || "โหลดรายการบิลไม่สำเร็จ");
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

  function selectRemoveProduct(item: ProductOption) {
    resetPreview();
    setRemoveItemCodes((current) => current.includes(item.code) ? current : [...current, item.code]);
    setSelectedRemoveProducts((current) => current.some((product) => product.code === item.code) ? current : [...current, item]);
    setProductSearch("");
    setProducts([]);
  }

  function resetPreview() {
    setPreview(null);
    setMessage("");
  }

  function toggleDoc(docNo: string) {
    resetPreview();
    setSelectedDocNos((current) => current.includes(docNo) ? current.filter((item) => item !== docNo) : [...current, docNo]);
  }

  function selectVisibleDocs() {
    resetPreview();
    setSelectedDocNos(Array.from(new Set([...selectedDocNos, ...items.map((item) => item.docNo)])));
  }

  async function selectMatchingDocs() {
    resetPreview();
    setBusy(true);
    setMessage("");
    const response = await apiGet<SelectableDocuments>(selectableDocumentsURL(fromDate, toDate, search));
    if (response.success && response.data) {
      setSelectedDocNos(response.data.docNos);
      setMessage(response.data.hasMore
        ? `เลือก ${response.data.count} บิลแรกตามเงื่อนไขแล้ว ระบบจำกัดครั้งละ ${response.data.limit} บิลเพื่อป้องกันกระทบฐานข้อมูล SML`
        : `เลือกบิลตามเงื่อนไขแล้ว ${response.data.count} บิล`);
    } else {
      setMessage(response.error?.detail || response.message || "เลือกบิลตามเงื่อนไขไม่สำเร็จ");
    }
    setBusy(false);
  }

  function clearSelection() {
    resetPreview();
    setSelectedDocNos([]);
  }

  function toggleRemoveCode(code: string) {
    resetPreview();
    setRemoveItemCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
    setSelectedRemoveProducts((current) => current.filter((item) => item.code !== code));
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
      setMessage("เลือกบิล ชุดเลขเอกสาร และลูกหนี้ก่อนตรวจสอบ");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await apiPost<BulkDocumentChangeResult>("/api/v1/documents/bulk/preview-change", buildBulkRequest());
    if (response.success && response.data) {
      setPreview(response.data);
      setPreviewFilter("all");
    }
    else setMessage(response.error?.detail || response.message || "ตรวจสอบก่อนบันทึกไม่สำเร็จ");
    setBusy(false);
  }

  async function applyBulk() {
    if (!preview || !readyToApply) return;
    setBusy(true);
    setMessage("");
    setConfirmApplyOpen(false);
    const response = await apiPost<BulkDocumentChangeResult>("/api/v1/documents/bulk/apply-change", buildBulkRequest());
    if (response.success && response.data) {
      setPreview(response.data);
      setMessage(`บันทึกสำเร็จ ${response.data.appliedCount} บิล${response.data.failedCount ? `, ไม่สำเร็จ ${response.data.failedCount} บิล` : ""}`);
    } else {
      setMessage(response.error?.detail || response.message || "บันทึกหลายบิลไม่สำเร็จ");
    }
    setBusy(false);
  }

  if (loading && !documents) return <PageLoading title="กำลังโหลดรายการบิลสำหรับแก้ไขบิล" />;

  return (
    <div className="page-stack">
      <PageHeader
        title="รายการบิลขาย"
        actions={(
          <div className="page-actions">
            <button className="btn secondary" onClick={() => void loadDocuments()}><RefreshCw size={16} /> โหลดข้อมูลใหม่</button>
            <button className="btn primary" disabled={!canOpenSettings} onClick={() => setSettingsOpen(true)}>ตั้งค่าการแก้ไข</button>
          </div>
        )}
      />

      {message ? <div className="alert">{message}</div> : null}

      <section className="panel bulk-full-panel">
          <div className="panel-header">
            <div>
              <h2>{selectedDocNos.length ? `เลือกแล้ว ${selectedDocNos.length} บิล` : "รายการบิล"}</h2>
            </div>
            <StatusBadge>{loading ? "กำลังโหลด" : `${items.length}${documents?.hasMore ? "+" : ""} บิลที่แสดง`}</StatusBadge>
          </div>
          <div className="filters horizontal">
            <label>
              จากวันที่
              <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); resetPreview(); }} />
            </label>
            <label>
              ถึงวันที่
              <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); resetPreview(); }} />
            </label>
            <label className="search-field">
              ค้นหา
              <div className="input-with-icon">
                <Search size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="เลขบิล / รหัสลูกค้า / หมายเหตุ" />
              </div>
            </label>
            <button className="btn primary" disabled={loading} onClick={() => void loadDocuments()}>ค้นหา</button>
          </div>
          <div className="queue-actions bulk-toolbar">
            <button className="btn secondary" onClick={selectVisibleDocs}>เลือกทั้งหมดที่เห็น</button>
            <button className="btn secondary" disabled={busy} onClick={() => void selectMatchingDocs()}>เลือกผลค้นหาทั้งหมด สูงสุด 300 บิล</button>
            <button className="btn secondary" disabled={!canOpenSettings} onClick={() => setSettingsOpen(true)}>ตั้งค่าการแก้ไข</button>
            <button className="btn primary" disabled={!canPreview || busy} onClick={() => void previewBulk()}>{busy ? "กำลังตรวจสอบ" : "ตรวจสอบก่อนบันทึก"}</button>
            <button className="btn ghost" onClick={clearSelection}>ล้างที่เลือก</button>
          </div>
          <div className="bulk-doc-list">
            <div className="bulk-doc-row head">
              <span />
              <span>วันที่เอกสาร</span>
              <span>เวลา</span>
              <span>เลขที่เอกสาร</span>
              <span>รหัสลูกหนี้</span>
              <span>หมายเหตุ</span>
              <span>ยอดสุทธิ</span>
              <span>ดูรายละเอียด</span>
            </div>
            {items.map((item) => {
              const selected = selectedDocNos.includes(item.docNo);
              return (
              <div
                aria-pressed={selected}
                className={`bulk-doc-row ${selected ? "active" : ""}`}
                key={item.docNo}
                onClick={() => toggleDoc(item.docNo)}
                onDoubleClick={() => {
                  setDetailDocNo(item.docNo);
                  setDetailOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleDoc(item.docNo);
                  }
                }}
                role="button"
                tabIndex={0}
                title="ดับเบิลคลิกเพื่อดูรายละเอียดบิล"
              >
                <input checked={selected} readOnly tabIndex={-1} type="checkbox" />
                <span>{formatSmlDate(item.docDate)}</span>
                <span>{formatDocumentTime(item.docTime)}</span>
                <strong>{item.docNo}</strong>
                <span>{item.customerCode || "-"}</span>
                <span>{item.remark || "-"}</span>
                <b>{formatMoney(item.totalAmount)}</b>
                <button
                  className="row-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDetailDocNo(item.docNo);
                    setDetailOpen(true);
                  }}
                  type="button"
                >
                  ดูรายละเอียด
                </button>
              </div>
            );})}
            {!items.length ? <EmptyState title="ไม่พบบิล" description="ลองเปลี่ยนช่วงวันที่หรือคำค้นหา" /> : null}
          </div>
        </section>

      {detailOpen && detailDocument ? (
        <InvoiceDetailDialog doc={detailDocument} onClose={() => setDetailOpen(false)} />
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop">
          <section className="dialog bulk-settings-dialog">
          <div className="panel-header bulk-settings-header">
            <h2>
              <span>2. ตั้งค่าการแก้ไข</span>
              <strong>ค่าที่จะใช้กับบิลที่เลือก</strong>
            </h2>
            <StatusBadge>{selectedDocNos.length} บิลที่เลือก</StatusBadge>
          </div>
          {!selectedDocNos.length ? <div className="alert">เลือกบิลอย่างน้อย 1 บิลก่อนตั้งค่าการแก้ไข</div> : null}
          <div className="form-grid bulk-settings-grid">
            <label>
              ชุดเลขเอกสารใหม่
              <select value={selectedFormat} onChange={(event) => { setSelectedFormat(event.target.value); resetPreview(); }}>
                {docFormats.map((item) => <option key={item.code} value={item.code}>{item.code} - {item.name}</option>)}
              </select>
            </label>
            <SearchDropdown
              id="bulk-customer-search"
              label="ลูกหนี้ใหม่"
              value={customerSearch}
              placeholder="พิมพ์รหัสหรือชื่อลูกหนี้"
              options={!selectedCustomer && customerQuery.length >= 2 ? customers : []}
              loading={!selectedCustomer && customerSearching}
              loadingLabel="กำลังค้นหาลูกหนี้..."
              emptyLabel="ไม่พบลูกหนี้ที่ตรงกับคำค้นนี้"
              shortLabel="พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาลูกหนี้"
              showEmpty={showCustomerEmpty}
              disabledDropdown={Boolean(selectedCustomer)}
              onChange={(value) => {
                setCustomerSearch(value);
                if (selectedCustomer) setSelectedCustomer("");
                resetPreview();
              }}
              onSelect={selectCustomer}
            >
              <div className="selected-tags">
                {selectedCustomer ? <button onClick={clearCustomer} type="button">{customerInputValue} ×</button> : <span className="muted">ยังไม่ได้เลือกลูกหนี้ใหม่</span>}
              </div>
            </SearchDropdown>
            <label>
              ประเภทการขาย
              <select value={inquiryType} onChange={(event) => { setInquiryType(Number(event.target.value)); resetPreview(); }}>
                {Object.entries(saleTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              ประเภทภาษี
              <select value={vatType} onChange={(event) => { setVatType(Number(event.target.value)); resetPreview(); }}>
                {Object.entries(taxTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="wide">
              หมายเหตุใหม่
              <textarea value={remark} onChange={(event) => { setRemark(event.target.value); resetPreview(); }} />
            </label>
            <SearchDropdown
              id="bulk-product-search"
              label="ลบสินค้าเมื่อพบในบิล"
              value={productSearch}
              placeholder="พิมพ์รหัสหรือชื่อสินค้า"
              options={productQuery.length >= 2 ? products : []}
              loading={productSearching}
              loadingLabel="กำลังค้นหาสินค้า..."
              emptyLabel="ไม่พบสินค้าที่ตรงกับคำค้นนี้"
              shortLabel="พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาสินค้า"
              showEmpty={showProductEmpty}
              className="wide search-dropdown-up"
              onChange={(value) => {
                setProductSearch(value);
                resetPreview();
              }}
              onSelect={selectRemoveProduct}
            >
              <div className="selected-tags selected-tags-scroll">
                {removeItemCodes.map((code) => {
                  const item = selectedRemoveProducts.find((product) => product.code === code);
                  return <button key={code} onClick={() => toggleRemoveCode(code)} type="button">{item ? `${item.code} - ${item.name}` : code} ×</button>;
                })}
                {!removeItemCodes.length ? <span className="muted">ยังไม่ได้เลือกสินค้า ถ้าเว้นว่างจะเปลี่ยนเฉพาะหัวบิล</span> : null}
              </div>
            </SearchDropdown>
          </div>

          <div className="action-strip">
            <span>{canPreview ? "ตรวจสอบก่อนทุกครั้ง ระบบจะแยกบิลพร้อม บิลที่ต้องอ่านก่อนบันทึก และบิลที่บันทึกไม่ได้" : workflowHint}</span>
            <div>
              <button className="btn secondary" onClick={() => setSettingsOpen(false)}>ปิด</button>
              <button className="btn primary" disabled={!canPreview || busy} onClick={() => { setSettingsOpen(false); void previewBulk(); }}>{busy ? "กำลังตรวจสอบ" : "ตรวจสอบก่อนบันทึก"}</button>
            </div>
          </div>
          </section>
        </div>
      ) : null}

      {preview ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p>3. ตรวจสอบก่อนบันทึก</p>
              <h2>ผลตรวจสอบ {preview.totalCount} บิล</h2>
            </div>
            <div className="status-group">
              <StatusBadge tone="success">พร้อม {preview.readyCount}</StatusBadge>
              <StatusBadge>ต้องอ่าน {preview.warningCount}</StatusBadge>
              <StatusBadge tone="danger">ไม่ผ่าน {preview.blockedCount + preview.failedCount}</StatusBadge>
            </div>
          </div>
          <div className="bulk-risk-summary">
            <div>
              <span>จะถูกบันทึกจริง</span>
              <strong>{preview.readyCount + preview.warningCount}</strong>
              <small>บิลพร้อม + บิลที่ต้องอ่าน</small>
            </div>
            <div>
              <span>ต้องอ่านก่อนยืนยัน</span>
              <strong>{preview.warningCount}</strong>
              <small>บันทึกได้ แต่ควรตรวจข้อความรายบิล</small>
            </div>
            <div>
              <span>ไม่ถูกบันทึก</span>
              <strong>{preview.blockedCount + preview.failedCount}</strong>
              <small>บิลไม่ผ่านหรือผิดพลาด</small>
            </div>
          </div>
          <div className="filter-tabs">
            <button className={previewFilter === "all" ? "active" : ""} onClick={() => setPreviewFilter("all")}>ทั้งหมด {preview.totalCount}</button>
            <button className={previewFilter === "ready" ? "active" : ""} onClick={() => setPreviewFilter("ready")}>พร้อม {preview.readyCount}</button>
            <button className={previewFilter === "warning" ? "active" : ""} onClick={() => setPreviewFilter("warning")}>ต้องอ่าน {preview.warningCount}</button>
            <button className={previewFilter === "blocked" ? "active" : ""} onClick={() => setPreviewFilter("blocked")}>ไม่ผ่าน {preview.blockedCount + preview.failedCount}</button>
          </div>
          {preview.warningCount ? (
            <div className="bulk-warning-note">
              <AlertTriangle size={16} />
              <span>บิลกลุ่ม “ต้องอ่าน” จะรวมอยู่ในบิลที่จะบันทึกจริง หากข้อความรายบิลยังยอมรับได้จึงค่อยกดยืนยัน</span>
            </div>
          ) : null}
          <div className="bulk-preview-list">
            <div className="bulk-preview-row head">
              <span>สถานะ</span>
              <span>เลขบิลเดิม</span>
              <span>เลขบิลใหม่</span>
              <span>ลูกหนี้</span>
              <span>ลบสินค้า</span>
              <span>ยอดใหม่</span>
              <span>หมายเหตุ</span>
            </div>
            {visiblePreviewItems.map((item) => (
              <div className={`bulk-preview-row ${item.status}`} key={item.docNo}>
                <StatusBadge tone={item.status === "blocked" || item.status === "failed" ? "danger" : item.status === "ready" || item.status === "applied" ? "success" : "neutral"}>
                  {bulkStatusLabel(item.status)}
                </StatusBadge>
                <strong>{item.docNo}</strong>
                <span>{item.newDocNo || "-"}</span>
                <span>{item.preview?.after.customerCode || selectedCustomer || "-"}</span>
                <span>{(item.removeHits || []).length ? item.removeHits.join(", ") : "-"}</span>
                <b>{formatMoney(item.preview?.totals.totalAmount || "")}</b>
                <span>{item.message}</span>
              </div>
            ))}
            {!visiblePreviewItems.length ? <EmptyState title="ไม่มีรายการในตัวกรองนี้" description="ลองเลือกตัวกรองอื่นเพื่อดูผลตรวจสอบ" /> : null}
          </div>
          <div className="action-strip warning">
            <div>
              <strong>สรุปก่อนบันทึกจริง</strong>
              <span>จะบันทึกจริง {preview.readyCount + preview.warningCount} บิล จากทั้งหมด {preview.totalCount} บิล, ไม่ผ่าน {preview.blockedCount + preview.failedCount} บิล, ลูกหนี้ใหม่ {selectedCustomer || "-"}, ชุดเลข {selectedFormat || "-"}</span>
            </div>
            <button className="btn danger" disabled={!readyToApply || busy} onClick={() => setConfirmApplyOpen(true)}>{busy ? "กำลังบันทึก" : "บันทึกบิลที่พร้อม/ต้องอ่านลง SML"}</button>
          </div>
        </section>
      ) : null}
      {confirmApplyOpen && preview ? (
        <RiskConfirmDialog
          busy={busy}
          confirmLabel={busy ? "กำลังบันทึก" : "ยืนยันบันทึกจริงลง SML"}
          detail={`ระบบจะเขียนข้อมูลจริงลง SML เฉพาะบิลที่พร้อมหรืออยู่ในกลุ่มต้องอ่าน ${preview.readyCount + preview.warningCount} บิล จากทั้งหมด ${preview.totalCount} บิล`}
          title="ยืนยันบันทึกหลายบิล"
          tone="danger"
          onCancel={() => setConfirmApplyOpen(false)}
          onConfirm={() => void applyBulk()}
        >
          <div className="compare-grid">
            <SummaryLine label="บิลที่เลือก" value={`${selectedDocNos.length} บิล`} />
            <SummaryLine label="บิลที่จะบันทึก" value={`${preview.readyCount + preview.warningCount} บิล`} strong />
            <SummaryLine label="ลูกหนี้ใหม่" value={selectedCustomer || "-"} />
            <SummaryLine label="สินค้าที่จะลบ" value={removeItemCodes.length ? removeItemCodes.join(", ") : "ไม่มี"} />
          </div>
        </RiskConfirmDialog>
      ) : null}
    </div>
  );
}

function AuditLogPage({ selectedDocNo, user }: { selectedDocNo: string; user: UserClaims }) {
  const [histories, setHistories] = useState<DocumentHistoryItem[]>([]);
  const [docNo, setDocNo] = useState(selectedDocNo);
  const [rollbackSnapshotId, setRollbackSnapshotId] = useState("");
  const [rollbackDocNo, setRollbackDocNo] = useState(selectedDocNo);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<number | null>(null);
  const [detailDialog, setDetailDialog] = useState<AuditInvoiceDialogState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackConfirmText, setRollbackConfirmText] = useState("");

  useEffect(() => {
    void loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams({ limit: "10" });
    if (docNo.trim()) params.set("docNo", docNo.trim());
    const response = await apiGet<{ items: DocumentHistoryItem[] }>(`/api/v1/audit-documents?${params.toString()}`);
    if (response.success && response.data) setHistories(response.data.items);
    else setMessage(response.error?.detail || response.message || "โหลดประวัติเอกสารไม่สำเร็จ");
    setLoading(false);
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
    <div className="page-stack">
      <PageHeader
        eyebrow="ประวัติเอกสาร"
        title="ประวัติก่อนและหลังแก้ไขบิล"
        description="ตรวจสอบรายการที่เคยบันทึก และกู้คืนจากจุดสำรองเมื่อจำเป็น"
        actions={<button className="btn secondary" onClick={() => void loadLogs()}><RefreshCw size={16} /> โหลดใหม่</button>}
      />
      {message ? <div className="alert">{message}</div> : null}
      <section className="panel">
        <div className="panel-header">
          <div>
              <p>ประวัติการบันทึก</p>
            <h2>ประวัติเอกสารที่ถูกบันทึก</h2>
          </div>
          <StatusBadge>{loading ? "กำลังโหลด" : `${histories.length} รายการ`}</StatusBadge>
        </div>
        <div className="filters horizontal">
          <label className="search-field">
            เลขเอกสารเดิมหรือเลขเอกสารใหม่
            <div className="input-with-icon">
              <Search size={16} />
              <input value={docNo} onChange={(event) => setDocNo(event.target.value)} placeholder="เช่น INV26050001" />
            </div>
          </label>
          <button className="btn primary" disabled={loading} onClick={() => void loadLogs()}>ค้นหา</button>
        </div>
        <div className="document-history-list">
          {histories.map((item) => (
            <DocumentHistoryCard
              expanded={expandedSnapshotId === item.snapshotId}
              item={item}
              key={item.snapshotId}
              onRollback={() => {
	                setRollbackSnapshotId(`${item.snapshotId}`);
	                setRollbackDocNo(item.currentDocNo || item.originalDocNo);
	                setRollbackConfirmText("");
	                setRollbackConfirmOpen(true);
              }}
              onToggleJson={() => setExpandedSnapshotId(expandedSnapshotId === item.snapshotId ? null : item.snapshotId)}
              onViewAfter={() => setDetailDialog(buildAuditInvoiceDialog(item, "after"))}
              onViewBefore={() => setDetailDialog(buildAuditInvoiceDialog(item, "before"))}
            />
          ))}
          {!histories.length && !loading ? <EmptyState title="ยังไม่มีประวัติเอกสาร" description="ลองค้นหาด้วยเลขเอกสารเดิมหรือเลขเอกสารใหม่" /> : null}
        </div>
      </section>
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
          <div className="compare-grid">
            <SummaryLine label="จุดสำรองข้อมูล ID" value={rollbackSnapshotId || "ใช้เลขเอกสาร"} />
            <SummaryLine label="เลขเอกสาร" value={rollbackDocNo || "-"} strong />
          </div>
          <label>
            พิมพ์เลขเอกสารเพื่อยืนยัน
            <input value={rollbackConfirmText} onChange={(event) => setRollbackConfirmText(event.target.value)} placeholder={rollbackDocNo || "เลขเอกสาร"} />
          </label>
        </RiskConfirmDialog>
      ) : null}
      {detailDialog ? (
        <InvoiceDetailDialog
          doc={detailDialog.doc}
          lines={detailDialog.lines}
          title={detailDialog.title}
          onClose={() => setDetailDialog(null)}
        />
      ) : null}
    </div>
  );
}

function DocumentHistoryCard({
  expanded,
  item,
  onRollback,
  onToggleJson,
  onViewAfter,
  onViewBefore,
}: {
  expanded: boolean;
  item: DocumentHistoryItem;
  onRollback: () => void;
  onToggleJson: () => void;
  onViewAfter: () => void;
  onViewBefore: () => void;
}) {
  const detailCount = Array.isArray(item.after.icTransDetail) ? item.after.icTransDetail.length : 0;
  return (
    <article className="document-history-card">
      <div className="document-history-header">
        <div>
          <p>Snapshot #{item.snapshotId}</p>
          <h3>{item.originalDocNo} → {item.currentDocNo || "-"}</h3>
        </div>
        <div className="status-group">
          <StatusBadge tone={item.rolledBackAt ? "success" : "neutral"}>{item.rolledBackAt ? "ย้อนกลับแล้ว" : item.status || "บันทึกแล้ว"}</StatusBadge>
          <StatusBadge>{formatDateTime(item.createdAt)}</StatusBadge>
        </div>
      </div>
      <div className="history-summary-grid">
        <SummaryLine label="เอกสารเดิม" value={item.originalDocNo} />
        <SummaryLine label="เอกสารใหม่" value={item.currentDocNo || "-"} strong />
        <SummaryLine label="ผู้ทำรายการ" value={item.createdBy || "-"} />
        <SummaryLine label="จำนวนรายการสินค้า" value={`${detailCount}`} />
      </div>
      <div className="history-actions">
        <button className="btn secondary" onClick={onViewBefore}>ดูบิลเดิม</button>
        <button className="btn secondary" onClick={onViewAfter}>ดูบิลใหม่</button>
        <button className="btn secondary" onClick={onToggleJson}>{expanded ? "ซ่อนข้อมูลเทคนิค" : "ดูข้อมูลเทคนิคก่อน/หลัง"}</button>
        <button className="btn danger" disabled={Boolean(item.rolledBackAt)} onClick={onRollback}>ย้อนกลับรายการนี้</button>
      </div>
      {expanded ? (
        <div className="json-compare-grid">
          <JsonBlock title="ข้อมูลเดิม: ic_trans" value={item.before.icTrans} />
          <JsonBlock title="ข้อมูลใหม่: ic_trans" value={item.after.icTrans} />
          <JsonBlock title="ข้อมูลเดิม: ic_trans_detail" value={item.before.icTransDetail} />
          <JsonBlock title="ข้อมูลใหม่: ic_trans_detail" value={item.after.icTransDetail} />
        </div>
      ) : null}
    </article>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="json-block">
      <div className="json-block-header">
        <strong>{title}</strong>
      </div>
      <pre>{formatJSON(value)}</pre>
    </section>
  );
}

function AuditEventDetails({ item }: { item: AuditLogItem }) {
  const data = item.afterData || {};
  const details = [
    { label: "เลขบิลใหม่", value: pickAuditValue(data, ["after.docNo", "newDocNo", "restored.docNo"]) },
    { label: "บิลทั้งหมด", value: pickAuditValue(data, ["totalCount"]) },
    { label: "บันทึกสำเร็จ", value: pickAuditValue(data, ["appliedCount"]) },
    { label: "พร้อม", value: pickAuditValue(data, ["readyCount"]) },
    { label: "ไม่ผ่าน", value: pickAuditValue(data, ["blockedCount", "failedCount"]) },
  ].filter((detail) => detail.value);

  if (!details.length) return null;

  return (
    <div className="audit-event-details">
      {details.map((detail) => (
        <span key={detail.label}>
          {detail.label}: <strong>{detail.value}</strong>
        </span>
      ))}
    </div>
  );
}

function SystemStatusPage({ status, onRefresh }: { status: DatabaseStatus | null; onRefresh: () => Promise<void> }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ตรวจระบบ"
        title="ตรวจสอบความพร้อมของระบบ"
        description="ดูสถานะฐานข้อมูล SML และตารางของระบบ NEXT-SALES"
        actions={<button className="btn secondary" onClick={() => void onRefresh()}><RefreshCw size={16} /> ตรวจสอบใหม่</button>}
      />
      <div className="metrics-grid">
        <MetricCard icon={Database} label="ฐานข้อมูล" value={status?.database || "-"} />
        <MetricCard icon={CheckCircle2} label="เชื่อมต่อ" value={status?.connected ? "พร้อม" : "ไม่พร้อม"} tone={status?.connected ? "neutral" : "danger"} />
        <MetricCard icon={ShieldCheck} label="ตาราง SML" value={status?.requiredSmlReady ? "ครบ" : "ไม่ครบ"} tone={status?.requiredSmlReady ? "neutral" : "danger"} />
        <MetricCard icon={ClipboardCheck} label="ตารางระบบ" value={status?.appSchemaReady ? "พร้อม" : "ไม่พร้อม"} tone={status?.appSchemaReady ? "neutral" : "danger"} />
      </div>
      <StatusChecklist status={status} />
    </div>
  );
}

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ไม่พบหน้า"
        title="ลิงก์นี้ไม่มีในระบบ"
        description="ตรวจสอบ URL อีกครั้ง หรือกลับไปหน้าแก้ไขบิลเพื่อเริ่มงานใหม่"
        actions={<button className="btn secondary" onClick={() => navigate("/bulk-edit")}><ChevronLeft size={16} /> กลับไปแก้ไขบิล</button>}
      />
      <section className="panel">
        <EmptyState title="ไม่พบหน้าที่ต้องการ" description="ระบบอาจย้ายเส้นทางหรือ URL ไม่ครบถ้วน" />
      </section>
    </div>
  );
}

function StatusChecklist({ status }: { status: DatabaseStatus | null }) {
  const rows = [
    { label: "เชื่อมต่อฐานข้อมูล", ok: Boolean(status?.connected), detail: status?.database || "-" },
    { label: "ข้อมูล SML ที่จำเป็น", ok: Boolean(status?.requiredSmlReady), detail: "ผู้ใช้, บิลขาย, รายการสินค้า, ลูกหนี้, ชุดเลขเอกสาร" },
    { label: "ตารางของระบบแก้ไขบิล", ok: Boolean(status?.appSchemaReady), detail: "ประวัติ, ค่าเชื่อมต่อ, งานหลายบิล, สถานะ, ล็อก, จุดสำรองข้อมูล" },
  ];

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p>ตรวจความพร้อม</p>
          <h2>รายการตรวจสอบ</h2>
        </div>
      </div>
      <div className="check-list">
        {rows.map((row) => (
          <div className="check-row" key={row.label}>
            <StatusBadge tone={row.ok ? "success" : "danger"}>{row.ok ? "ผ่าน" : "ต้องตรวจสอบ"}</StatusBadge>
            <div>
              <strong>{row.label}</strong>
              <span>{row.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <span>{description}</span> : null}
      </div>
      <div>{actions}</div>
    </div>
  );
}

function PageLoading({ title }: { title: string }) {
  return (
    <div className="page-stack">
      <section className="panel skeleton-card">
        <h2>{title}</h2>
        <div className="skeleton w-60" />
        <div className="skeleton h-12" />
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, tone = "neutral" }: { icon: typeof FileText; label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
  return (
    <div className="modal-backdrop">
      <section className="dialog">
        <div className="dialog-header">
          <div>
            <p>ต้องยืนยันก่อนดำเนินการ</p>
            <h2>{title}</h2>
          </div>
          <StatusBadge tone={tone === "danger" ? "danger" : "neutral"}>{tone === "danger" ? "กระทบข้อมูลจริง" : "ตรวจสอบก่อน"}</StatusBadge>
        </div>
        <div className={tone === "danger" ? "alert" : "warning-box"}>{detail}</div>
        {children}
        <div className="dialog-actions">
          <button className="btn secondary" disabled={busy} onClick={onCancel}>ยกเลิก</button>
          <button className={tone === "danger" ? "btn danger" : "btn primary"} disabled={busy || confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function SearchDropdown<T extends Option>({
  id,
  label,
  value,
  placeholder,
  options,
  loading,
  minLength = 2,
  loadingLabel,
  emptyLabel,
  shortLabel,
  showEmpty,
  disabledDropdown = false,
  className = "",
  children,
  onChange,
  onSelect,
}: SearchDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const query = value.trim();
  const showShortHint = query.length > 0 && query.length < minLength;
  const shouldShowList = open && !disabledDropdown && (loading || showShortHint || options.length > 0 || showEmpty);
  const rootClassName = ["field-control", "search-dropdown", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName}>
      <label htmlFor={id}>{label}</label>
      <div className="search-dropdown-anchor">
        <input
          aria-autocomplete="list"
          aria-expanded={shouldShowList}
          id={id}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setOpen(true);
            onChange(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          value={value}
        />
        {shouldShowList ? (
          <div className="autocomplete-list search-dropdown-list" role="listbox">
            {loading ? <div className="autocomplete-status">{loadingLabel}</div> : null}
            {!loading && showShortHint ? <div className="autocomplete-status">{shortLabel || `พิมพ์อย่างน้อย ${minLength} ตัวอักษรเพื่อค้นหา`}</div> : null}
            {!loading && !showShortHint && options.map((item) => (
              <button
                key={item.code}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                <strong>{item.code}</strong>
                <span>{item.name}</span>
              </button>
            ))}
            {!loading && !showShortHint && !options.length && showEmpty ? <div className="autocomplete-status">{emptyLabel}</div> : null}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={22} />
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`summary-line ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DocumentFact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`document-fact ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function TotalLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`document-total-line ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function StatusBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "danger" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function documentsURL(fromDate: string, toDate: string, q = "") {
  const params = new URLSearchParams({ from: fromDate, to: toDate, page: "1", pageSize: "100" });
  if (q.trim()) params.set("q", q.trim());
  return `/api/v1/documents?${params.toString()}`;
}

function selectableDocumentsURL(fromDate: string, toDate: string, q = "") {
  const params = new URLSearchParams({ from: fromDate, to: toDate, limit: "300" });
  if (q.trim()) params.set("q", q.trim());
  return `/api/v1/documents/selectable-doc-nos?${params.toString()}`;
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
  if (action.includes("preview")) return "ตรวจสอบก่อนบันทึก";
  if (action.includes("apply")) return "บันทึกการแก้ไข";
  if (action.includes("rollback")) return "ย้อนกลับข้อมูล";
  if (action.includes("database_config")) return "บันทึกค่าฐานข้อมูล";
  return action;
}

function bulkStatusLabel(status: BulkDocumentChangeItem["status"]) {
  if (status === "ready") return "พร้อม";
  if (status === "warning") return "ต้องอ่าน";
  if (status === "blocked") return "ไม่ผ่าน";
  if (status === "applied") return "บันทึกแล้ว";
  if (status === "failed") return "ผิดพลาด";
  return status;
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
  const state = item[side];
  const fallbackDocNo = side === "before" ? item.originalDocNo : item.currentDocNo || item.originalDocNo;
  return {
    doc: documentSummaryFromRawState(state.icTrans, fallbackDocNo, side === "before" ? "audit_before" : "audit_after"),
    lines: state.icTransDetail.map((line, index) => documentLineFromRawState(line, index)),
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
