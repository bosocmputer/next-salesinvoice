import type { ApiResponse } from "../types";

export const authSessionKey = "next-salesinvoice-authenticated";
export const authExpiredEvent = "next-salesinvoice-auth-expired";

export const friendlyErrorMap: Record<string, string> = {
  ERR_UNAUTHORIZED: "กรุณาเข้าสู่ระบบใหม่",
  ERR_FORBIDDEN: "บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้",
  ERR_INVALID_INPUT: "ข้อมูลที่ส่งไม่ครบหรือไม่ถูกต้อง",
  ERR_VALIDATION: "ข้อมูลที่กรอกไม่ผ่านการตรวจสอบ",
  ERR_RATE_LIMITED: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่",
  ERR_DATABASE_VERIFICATION: "ฐานข้อมูลยังไม่พร้อมใช้งาน",
  ERR_DATABASE: "เกิดปัญหากับฐานข้อมูล กรุณาแจ้งผู้ดูแลระบบ",
  ERR_NOT_FOUND: "ไม่พบข้อมูลที่ร้องขอ",
  ERR_CONFLICT: "ข้อมูลขัดแย้งกับสถานะปัจจุบัน",
  ERR_INTERNAL: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง",
};

export function friendlyThaiError(code: string | undefined, status: number): string {
  if (code && friendlyErrorMap[code]) return friendlyErrorMap[code];
  if (status === 429) return friendlyErrorMap.ERR_RATE_LIMITED;
  if (status === 503) return friendlyErrorMap.ERR_DATABASE_VERIFICATION;
  if (status >= 500) return friendlyErrorMap.ERR_INTERNAL;
  return "";
}

function notifyAuthExpired(status: number, code = "") {
  if (status === 401 || code === "ERR_UNAUTHORIZED") {
    window.dispatchEvent(new Event(authExpiredEvent));
  }
}

export async function apiRequest<T>(url: string, init: RequestInit): Promise<ApiResponse<T>> {
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
      notifyAuthExpired(payload.error?.code === "ERR_UNAUTHORIZED" ? 401 : response.status, payload.error?.code);
      if (!payload.success && payload.error) {
        const friendly = friendlyThaiError(payload.error.code, response.status);
        if (friendly) {
          payload.error = { ...payload.error, detail: payload.error.detail || friendly };
        }
      }
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

export async function apiGet<T>(url: string): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { credentials: "include" });
}

export async function apiPost<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
}

export async function apiPut<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
}
