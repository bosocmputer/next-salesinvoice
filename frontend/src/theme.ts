import { createTheme } from "@mui/material/styles";

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
