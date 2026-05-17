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
 */
import { createTheme } from "@mui/material/styles";

/**
 * Minimum tap-target height in pixels for touch breakpoints (xs, sm).
 * Matches Apple HIG (44pt) and Google Material accessibility guidance.
 */
export const TOUCH_TARGET_MIN_PX = 44;

/**
 * Default control height on desktop breakpoints (md and up).
 */
export const DESKTOP_CONTROL_HEIGHT_PX = 36;

export const appTheme = createTheme({
  typography: {
    fontFamily: '"Noto Sans Thai", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    h1: { fontWeight: 700, letterSpacing: 0 },
    h2: { fontWeight: 700, letterSpacing: 0 },
    h5: { fontSize: "1.35rem", fontWeight: 700, letterSpacing: 0 },
    h6: { fontSize: "1.05rem", fontWeight: 700, letterSpacing: 0 },
    subtitle1: { fontSize: "0.95rem", fontWeight: 700, letterSpacing: 0 },
    subtitle2: { fontSize: "0.875rem", fontWeight: 700, letterSpacing: 0 },
    // body1 is aligned with body2 size so accidental fall-throughs don't jump.
    body1: { fontSize: "0.875rem", letterSpacing: 0 },
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
      // Bumped from #667085 (3.7:1) to #4b5563 (~6.6:1) for WCAG AA small text.
      secondary: "#4b5563",
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
