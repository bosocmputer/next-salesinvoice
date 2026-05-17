import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { CheckCircle2, ChevronLeft, ClipboardCheck, Database, RefreshCw, ShieldCheck } from "lucide-react";
import type { DatabaseStatus } from "../types";
import { apiPost } from "../lib/api";
import { AppButton, MetricCard, PageHeader, StatusBadge } from "../components/ui";

export default function SystemStatusPage({ status, onRefresh }: { status: DatabaseStatus | null; onRefresh: () => Promise<void> }) {
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
