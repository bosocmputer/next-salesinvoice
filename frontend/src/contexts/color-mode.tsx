/**
 * Color mode context.
 *
 * Exposes a three-state preference (`"light" | "dark" | "auto"`) persisted in
 * `localStorage`, plus the resolved palette mode (`"light" | "dark"`) computed
 * by honoring the OS `prefers-color-scheme` query when the preference is
 * `"auto"`. The provider listens for live OS changes so an open tab updates
 * without a reload.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PaletteMode } from "@mui/material";

export type ColorModePreference = "light" | "dark" | "auto";

interface ColorModeContextValue {
  preference: ColorModePreference;
  mode: PaletteMode;
  setPreference: (next: ColorModePreference) => void;
}

const STORAGE_KEY = "next-salesinvoice:color-mode";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function readStoredPreference(): ColorModePreference {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  return "auto";
}

function systemMode(): PaletteMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ColorModePreference>(() => readStoredPreference());
  const [system, setSystem] = useState<PaletteMode>(() => systemMode());

  // Track OS-level scheme so "auto" follows the system live.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MEDIA_QUERY);
    const handler = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Sync preference across tabs / windows.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue;
      if (next === "light" || next === "dark" || next === "auto") {
        setPreferenceState(next);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setPreference = useCallback((next: ColorModePreference) => {
    setPreferenceState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const mode: PaletteMode = preference === "auto" ? system : preference;

  // Keep <html data-color-mode> in sync so non-MUI styles (favicon, scrollbar)
  // can opt-in via CSS attribute selectors.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-color-mode", mode);
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo<ColorModeContextValue>(() => ({ preference, mode, setPreference }), [preference, mode, setPreference]);

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode(): ColorModeContextValue {
  const ctx = useContext(ColorModeContext);
  if (!ctx) throw new Error("useColorMode must be used within ColorModeProvider");
  return ctx;
}
