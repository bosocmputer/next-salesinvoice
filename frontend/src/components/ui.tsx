import type { ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
  type ButtonProps,
} from "@mui/material";
import { AlertTriangle, type LucideIcon } from "lucide-react";

export function AppButton({
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

export function SkeletonLine({ width }: { width: string }) {
  return <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 16, width }} />;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "danger" }) {
  const color = tone === "success" ? "success" : tone === "danger" ? "error" : "default";
  return <Chip color={color} label={children} size="small" variant={tone === "neutral" ? "outlined" : "filled"} />;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
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

export function PageLoading({ title }: { title: string }) {
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ display: "grid", gap: 2, p: 2 }}>
        <Typography component="h2" variant="h6">{title}</Typography>
        <SkeletonLine width="60%" />
        <LinearProgress />
      </Paper>
      <Paper variant="outlined" sx={{ display: "grid", gap: 1.25, p: 2 }}>
        {Array.from({ length: 6 }).map((_, idx) => (
          <Stack direction="row" key={idx} spacing={1.5} sx={{ alignItems: "center" }}>
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 14, width: 28 }} />
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 14, width: "16%" }} />
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 14, width: "24%" }} />
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 14, width: "12%" }} />
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, flex: 1, height: 14 }} />
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, height: 14, width: "10%" }} />
          </Stack>
        ))}
      </Paper>
    </Stack>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
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

export function StackRow({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ alignItems: "flex-start", display: "flex", gap: 2, justifyContent: "space-between" }}>
      {children}
    </Box>
  );
}

export function MetricCard({ icon: Icon, label, value, tone = "neutral" }: { icon: LucideIcon; label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <Paper variant="outlined" sx={{ display: "grid", gap: 0.75, p: 2 }}>
      <Icon size={18} />
      <Typography color="text.secondary" variant="body2">{label}</Typography>
      <Typography color={tone === "danger" ? "error.main" : "text.primary"} sx={{ fontWeight: 800 }} variant="h6">{value}</Typography>
    </Paper>
  );
}

export function MetricValue({ compact = false, helper, label, value }: { compact?: boolean; helper: string; label: string; value: string }) {
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
