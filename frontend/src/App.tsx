import { Component, FormEvent, ReactNode, Suspense, lazy, useEffect, useState } from "react";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Toolbar,
  Typography,
} from "@mui/material";
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
  Database,
  FileText,
  History,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
} from "lucide-react";
import type { DatabaseStatus, PageKey, UserClaims } from "./types";
import { apiGet, apiPost, authExpiredEvent, authSessionKey } from "./lib/api";
import { AppButton, PageLoading, SkeletonLine, StatusBadge } from "./components/ui";
import { EmphasisText, SectionTitle } from "./components/ui/typography";
import { legacyPathFromPage, pageFromPath, titleFromPath } from "./lib/format";

import { appTheme } from "./theme";
import { ToastProvider } from "./contexts/toast";

const SystemStatusPage = lazy(() => import("./pages/SystemStatusPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const BulkInvoiceEditPage = lazy(() => import("./pages/BulkInvoiceEditPage"));

const initialFromDate = "2026-01-01";
const initialToDate = "2026-12-31";
const drawerWidth = 260;

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
        <ToastProvider>
          <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
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
    if (!user) return;
    const idleLimitMs = 30 * 60 * 1000;
    let timer = window.setTimeout(() => {
      window.dispatchEvent(new Event(authExpiredEvent));
    }, idleLimitMs);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        window.dispatchEvent(new Event(authExpiredEvent));
      }, idleLimitMs);
    };
    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [user]);

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
              <Suspense fallback={<PageLoading title="กำลังโหลดหน้า" />}>
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
              </Suspense>
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
      <Box sx={{ minWidth: 0 }}>
        {centered ? (
          <Typography component="h1" sx={{ fontWeight: 800 }} variant="h5">{title}</Typography>
        ) : (
          <SectionTitle level="h2" noWrap>{title}</SectionTitle>
        )}
        <Typography color="text.secondary" variant="body2">{subtitle}</Typography>
      </Box>
    </Stack>
  );
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
      </Paper>
    </AuthShell>
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
          <EmphasisText noWrap>{user.displayName}</EmphasisText>
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
        <Box component="main" sx={{ display: "grid", gap: 2, minWidth: 0, p: { xs: 1.5, md: 2 }, pb: { xs: "calc(env(safe-area-inset-bottom) + 12px)", md: 2 } }}>{children}</Box>
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
          pl: { xs: "calc(env(safe-area-inset-left) + 8px)", sm: 2 },
          pr: { xs: "calc(env(safe-area-inset-right) + 8px)", sm: 2 },
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
          <SectionTitle level="h2" noWrap>{title}</SectionTitle>
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

/**
 * Database status chip shown in the app header. Three responsive variants:
 *   xs:  short text only ("DB พร้อม" / "DB มีปัญหา")
 *   sm:  full localized label
 *   md+: label · database name (truncated)
 *
 * Replaces four duplicated `Typography sx={{ fontSize: 12, fontWeight: 800 }}`
 * blocks with a single shared style fragment.
 */
const DB_INDICATOR_LABEL_SX = { fontSize: 12, fontWeight: 800 } as const;

function DatabaseIndicator({ databaseReady, database }: { databaseReady: boolean; database: string }) {
  const label = databaseReady ? "พร้อมใช้งาน" : "ฐานข้อมูลมีปัญหา";
  return (
    <Chip
      color={databaseReady ? "success" : "error"}
      label={
        <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
          <Typography component="span" sx={{ display: { xs: "none", sm: "inline" }, ...DB_INDICATOR_LABEL_SX }}>
            {label}
          </Typography>
          <Typography component="span" sx={{ display: { xs: "inline", sm: "none" }, ...DB_INDICATOR_LABEL_SX }}>
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

