// Minimal client telemetry: report uncaught errors and unhandled promise
// rejections to the backend so we can correlate frontend failures with
// server logs. Uses navigator.sendBeacon when available so reports survive
// page unloads. Falls back to fetch keepalive otherwise.

const ENDPOINT = "/api/v1/client-events";
const MAX_PAYLOAD_BYTES = 8 * 1024;

type ClientEvent = {
  kind: "error" | "rejection" | "vitals";
  message: string;
  url: string;
  ua: string;
  ts: string;
  detail?: Record<string, unknown>;
};

function send(event: ClientEvent) {
  try {
    const body = JSON.stringify(event);
    if (body.length > MAX_PAYLOAD_BYTES) return;
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    });
  } catch {
    // swallow — telemetry must never break the app
  }
}

function baseFields(): Pick<ClientEvent, "url" | "ua" | "ts"> {
  return {
    url: typeof window !== "undefined" ? window.location.pathname : "",
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    ts: new Date().toISOString(),
  };
}

export function initTelemetry() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    send({
      kind: "error",
      message: String(event.message || "uncaught error"),
      ...baseFields(),
      detail: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack ? String(event.error.stack).slice(0, 2000) : undefined,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send({
      kind: "rejection",
      message: reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection"),
      ...baseFields(),
      detail: reason instanceof Error && reason.stack ? { stack: reason.stack.slice(0, 2000) } : undefined,
    });
  });

  // Best-effort Core Web Vitals — LCP only, fires once.
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (!entries.length) return;
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
      send({
        kind: "vitals",
        message: "lcp",
        ...baseFields(),
        detail: { lcp_ms: Math.round(last.startTime) },
      });
      observer.disconnect();
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // PerformanceObserver not supported — skip silently
  }
}
