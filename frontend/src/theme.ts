/**
 * Application theme for next-salesinvoice.
 *
 * Design tokens:
 * - Typography: Noto Sans Thai + Inter, base 14px. Variant scale is monotonic
 *   (h1 > h2 > ... > caption) so semantic level matches visual size.
 * - Font weight semantics (consume via `components/ui/typography.tsx`):
 *     400 — running text / disabled labels
 *     600 — emphasized body / inline value (non-monetary)
 *     700 — section title / field label / button
 *     800 — identifier or money amount (DocCode, Money primitives)
 *     900 — reserved for the single most important total per screen
 * - Tap targets: every interactive control resolves to ≥ 36px tall on desktop
 *   and ≥ 44px on touch breakpoints (xs/sm).
 * - Contrast: text.secondary darkened to #4b5563 (~6.6:1 on background.default)
 *   so caption-sized copy clears WCAG 2.1 AA for small text.
 *
 * Color modes:
 * - Light and dark palettes share brand hue (#245a6d teal). Dark variant lifts
 *   primary to #5fa3b8 so it carries enough contrast on the deep slate surface.
 * - Use `createAppTheme(mode)` to mint a theme; the legacy `appTheme` export is
 *   the light theme kept for modules that only need breakpoints / spacing.
 */
import { createTheme, type PaletteMode, type Theme } from "@mui/material/styles";

/**
 * Minimum tap-target height in pixels for touch breakpoints (xs, sm).
 * Matches Apple HIG (44pt) and Google Material accessibility guidance.
 */
export const TOUCH_TARGET_MIN_PX = 44;

/**
 * Default control height on desktop breakpoints (md and up).
 */
export const DESKTOP_CONTROL_HEIGHT_PX = 36;

const lightPalette = {
  mode: "light" as const,
  primary: { main: "#245a6d", contrastText: "#ffffff" },
  secondary: { main: "#5f6f7d" },
  success: { main: "#2e7d5b" },
  warning: { main: "#a16207" },
  error: { main: "#d04437" },
  background: { default: "#f6f8fa", paper: "#ffffff" },
  text: {
    primary: "#1f2937",
    // ~6.6:1 on background.default — WCAG AA small text.
    secondary: "#4b5563",
  },
  divider: "rgba(15, 23, 42, 0.12)",
};

const darkPalette = {
  mode: "dark" as const,
  primary: { main: "#5fa3b8", contrastText: "#06222b" },
  secondary: { main: "#9aa6b2" },
  success: { main: "#4ec38a" },
  warning: { main: "#e0a83a" },
  error: { main: "#ef6a5e" },
  background: { default: "#0f1419", paper: "#161d24" },
  text: {
    primary: "#e6edf3",
    secondary: "#a4b1bc",
  },
  divider: "rgba(230, 237, 243, 0.14)",
};

export function createAppTheme(mode: PaletteMode): Theme {
  const palette = mode === "dark" ? darkPalette : lightPalette;
  const focusRingColor = mode === "dark" ? "#7fb6c8" : "#245a6d";
  const tableHeadBg = mode === "dark" ? "#1c252d" : "#f8fafc";
  const tableHeadColor = mode === "dark" ? "#a4b1bc" : "#475467";

  return createTheme({
    typography: {
      fontFamily: '"Noto Sans Thai", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 14,
      h1: { fontWeight: 700, letterSpacing: 0 },
      h2: { fontWeight: 700, letterSpacing: 0 },
      h5: { fontSize: "1.35rem", fontWeight: 700, letterSpacing: 0 },
      h6: { fontSize: "1.05rem", fontWeight: 700, letterSpacing: 0 },
      subtitle1: { fontSize: "0.95rem", fontWeight: 700, letterSpacing: 0 },
      subtitle2: { fontSize: "0.875rem", fontWeight: 700, letterSpacing: 0 },
      body1: { fontSize: "0.875rem", letterSpacing: 0 },
      body2: { fontSize: "0.8125rem", letterSpacing: 0 },
      caption: { fontSize: "0.75rem", letterSpacing: 0 },
      button: { fontSize: "0.8125rem", fontWeight: 700, letterSpacing: 0, textTransform: "none" },
    },
    shape: { borderRadius: 8 },
    palette,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            textRendering: "optimizeLegibility",
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.001ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.001ms !important",
              scrollBehavior: "auto !important",
            },
          },
          ":focus-visible": {
            outline: `2px solid ${focusRingColor}`,
            outlineOffset: 2,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            minHeight: DESKTOP_CONTROL_HEIGHT_PX,
            [theme.breakpoints.down("sm")]: {
              minHeight: TOUCH_TARGET_MIN_PX,
            },
          }),
          sizeSmall: ({ theme }) => ({
            minHeight: 32,
            [theme.breakpoints.down("sm")]: {
              minHeight: TOUCH_TARGET_MIN_PX,
            },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            [theme.breakpoints.down("sm")]: {
              minHeight: TOUCH_TARGET_MIN_PX,
              minWidth: TOUCH_TARGET_MIN_PX,
            },
          }),
        },
      },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiAutocomplete: { defaultProps: { size: "small" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            [theme.breakpoints.down("sm")]: {
              minHeight: TOUCH_TARGET_MIN_PX,
            },
          }),
        },
      },
      MuiSelect: { defaultProps: { size: "small" } },
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
          root: { "&:last-child": { paddingBottom: 16 } },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 8, outline: "none" },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { padding: "12px 16px" } } },
      MuiDialogContent: { styleOverrides: { root: { padding: 16 } } },
      MuiDialogActions: { styleOverrides: { root: { padding: 16 } } },
      MuiTableCell: {
        styleOverrides: {
          body: { fontSize: 13 },
          head: {
            backgroundColor: tableHeadBg,
            color: tableHeadColor,
            fontSize: 13,
            fontWeight: 700,
          },
          sizeSmall: { padding: "8px 12px" },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            [theme.breakpoints.down("sm")]: {
              minHeight: TOUCH_TARGET_MIN_PX,
            },
          }),
        },
      },
    },
  });
}

/**
 * Light theme — kept as the default export for modules that only consume
 * breakpoints / spacing (those tokens are mode-invariant). For palette-aware
 * rendering, mount the theme via `createAppTheme(mode)` at `ThemeProvider`.
 */
export const appTheme = createAppTheme("light");
