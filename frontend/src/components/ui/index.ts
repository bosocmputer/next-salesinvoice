/**
 * Barrel for UI primitives. Re-exports the existing `components/ui.tsx`
 * (legacy single-file primitives) and the new typography primitives so
 * callers can do `import { Money, AppButton } from "@/components/ui"`.
 */
export * from "../ui";
export * from "./typography";
