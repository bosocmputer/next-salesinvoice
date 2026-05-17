/**
 * Typography primitives for next-salesinvoice.
 *
 * Why this file exists
 * --------------------
 * Pages were re-implementing the same `<Typography sx={{ fontWeight: 800 }}>`
 * patterns 50+ times with subtle drift (700 vs 800 vs 900, body1 vs body2),
 * producing inconsistent visual hierarchy. These primitives replace all such
 * inline patterns with semantically named building blocks.
 *
 * Naming conventions
 * ------------------
 *  - `SectionTitle`     — section heading bound to an h2/h3 element
 *  - `FieldLabel`       — caption-sized label above a field/value pair
 *  - `DocCode`          — document / customer / item identifier
 *  - `Money`            — currency amount with optional sentiment tone
 *  - `MoneyTotal`       — the single most prominent total on the screen
 *  - `EmphasisText`     — generic emphasized inline text (replaces ad-hoc `fontWeight: 700`)
 *
 * All primitives are pure presentational. They never reach into context,
 * router, or i18n; callers pass already-formatted strings. This keeps them
 * trivially memoizable and easy to render in isolation (Storybook, snapshots).
 */
import { memo, type CSSProperties, type ElementType, type ReactNode } from "react";
import { Typography, type TypographyProps } from "@mui/material";

/**
 * Numeric font weight aliased as semantic tokens. Use these instead of raw
 * numbers when composing new primitives so weight semantics stay aligned
 * with `theme.ts` docstring.
 */
export const WEIGHT = {
  regular: 400,
  emphasized: 600,
  strong: 700,
  identifier: 800,
  total: 900,
} as const;

/* ------------------------------------------------------------------ */
/* SectionTitle                                                        */
/* ------------------------------------------------------------------ */

export type SectionTitleLevel = "h2" | "h3" | "h4";

/**
 * Heading for a card/panel section. Semantic level and visual size are tied
 * together so screen readers and sighted users see the same hierarchy:
 *
 *   level="h2" → variant="h6"        (panel / page section)
 *   level="h3" → variant="subtitle1" (card inside a panel)
 *   level="h4" → variant="subtitle2" (sub-card / list item header)
 *
 * Use `noWrap` for header bars with limited width; the component already
 * applies `minWidth: 0` so flexbox truncation works without extra wrappers.
 */
export interface SectionTitleProps {
  /** Semantic heading level. Determines both the DOM tag and the visual size. */
  level?: SectionTitleLevel;
  /** Truncate with ellipsis when overflowing parent width. */
  noWrap?: boolean;
  /** Optional sx forwarded to the underlying `Typography`. */
  sx?: TypographyProps["sx"];
  /** Visible text. Must be non-empty; empty headings are an a11y anti-pattern. */
  children: ReactNode;
}

const LEVEL_TO_VARIANT: Record<SectionTitleLevel, TypographyProps["variant"]> = {
  h2: "h6",
  h3: "subtitle1",
  h4: "subtitle2",
};

export const SectionTitle = memo(function SectionTitle({
  level = "h2",
  noWrap = false,
  sx,
  children,
}: SectionTitleProps) {
  const variant = LEVEL_TO_VARIANT[level];
  return (
    <Typography
      component={level as ElementType}
      noWrap={noWrap}
      sx={[{ fontWeight: WEIGHT.strong, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
      variant={variant}
    >
      {children}
    </Typography>
  );
});

/* ------------------------------------------------------------------ */
/* FieldLabel                                                          */
/* ------------------------------------------------------------------ */

/**
 * Caption-sized label that appears above (or beside) a value. Uses
 * `text.secondary` so it doesn't compete with the value for attention.
 */
export interface FieldLabelProps {
  children: ReactNode;
  sx?: TypographyProps["sx"];
}

export const FieldLabel = memo(function FieldLabel({ children, sx }: FieldLabelProps) {
  return (
    <Typography
      color="text.secondary"
      sx={[{ fontWeight: WEIGHT.strong }, ...(Array.isArray(sx) ? sx : [sx])]}
      variant="caption"
    >
      {children}
    </Typography>
  );
});

/* ------------------------------------------------------------------ */
/* DocCode                                                             */
/* ------------------------------------------------------------------ */

/**
 * Document / customer / item identifier (e.g. `INV26050025`, `C0001`,
 * `ITEM-001`). Renders body2 weight 800 with `tabular-nums` so a column of
 * codes lines up. Optional `tone="primary"` highlights the "new" doc number
 * in transformation flows.
 */
export interface DocCodeProps {
  /** The identifier string. Falsy values render an em-dash placeholder. */
  value: string | null | undefined;
  /** Visual emphasis. `primary` paints `primary.main`; `default` is text.primary. */
  tone?: "default" | "primary";
  /** Truncate single-line with ellipsis when overflowing. */
  noWrap?: boolean;
  /** Optional sx forwarded to the underlying `Typography`. */
  sx?: TypographyProps["sx"];
}

const TABULAR_NUMS: CSSProperties["fontVariantNumeric"] = "tabular-nums";

export const DocCode = memo(function DocCode({ value, tone = "default", noWrap = false, sx }: DocCodeProps) {
  return (
    <Typography
      color={tone === "primary" ? "primary.main" : "text.primary"}
      noWrap={noWrap}
      sx={[
        { fontVariantNumeric: TABULAR_NUMS, fontWeight: WEIGHT.identifier },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      variant="body2"
    >
      {value || "-"}
    </Typography>
  );
});

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export type MoneyTone = "neutral" | "positive" | "negative";

/**
 * Currency amount. The default `neutral` tone uses `text.primary` so amounts
 * read like numbers, not links. Use `negative` for removed/decreased values
 * and `positive` for additions when comparison context exists.
 *
 * IMPORTANT: pass an already-formatted string (e.g. via `formatMoney`).
 * Components MUST NOT do locale formatting; that belongs in `lib/format.ts`.
 */
export interface MoneyProps {
  /** Pre-formatted amount string. Falsy renders an em-dash. */
  value: string | null | undefined;
  /** Sentiment hint. `negative` paints error.main, `positive` paints success.main. */
  tone?: MoneyTone;
  noWrap?: boolean;
  sx?: TypographyProps["sx"];
}

const MONEY_TONE_COLOR: Record<MoneyTone, string> = {
  neutral: "text.primary",
  positive: "success.main",
  negative: "error.main",
};

export const Money = memo(function Money({ value, tone = "neutral", noWrap = false, sx }: MoneyProps) {
  return (
    <Typography
      color={MONEY_TONE_COLOR[tone]}
      noWrap={noWrap}
      sx={[
        { fontVariantNumeric: TABULAR_NUMS, fontWeight: WEIGHT.identifier },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      variant="body2"
    >
      {value || "-"}
    </Typography>
  );
});

/* ------------------------------------------------------------------ */
/* MoneyTotal                                                          */
/* ------------------------------------------------------------------ */

/**
 * The single most prominent total per screen (e.g. "ยอดรวม"). Reserved weight
 * is 900; using two MoneyTotal on the same screen weakens the hierarchy and
 * should be avoided. For secondary totals use `Money` with `sx={{ fontWeight }}`.
 */
export interface MoneyTotalProps {
  /** Pre-formatted amount string. */
  value: string;
  /** `negative` is used for "amount to be removed" summaries. */
  tone?: Extract<MoneyTone, "neutral" | "negative">;
  sx?: TypographyProps["sx"];
}

export const MoneyTotal = memo(function MoneyTotal({ value, tone = "neutral", sx }: MoneyTotalProps) {
  return (
    <Typography
      color={tone === "negative" ? "error.main" : "primary.main"}
      sx={[
        { fontVariantNumeric: TABULAR_NUMS, fontWeight: WEIGHT.total },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      variant="body1"
    >
      {value}
    </Typography>
  );
});

/* ------------------------------------------------------------------ */
/* EmphasisText                                                        */
/* ------------------------------------------------------------------ */

/**
 * Generic body2 with `fontWeight: 700` for inline emphasis (form labels,
 * paragraph leads). Prefer SectionTitle / FieldLabel / DocCode where one of
 * those fits semantically.
 */
export interface EmphasisTextProps {
  children: ReactNode;
  /** Set `true` to color with `primary.main`. */
  primary?: boolean;
  noWrap?: boolean;
  sx?: TypographyProps["sx"];
}

export const EmphasisText = memo(function EmphasisText({ children, primary = false, noWrap = false, sx }: EmphasisTextProps) {
  return (
    <Typography
      color={primary ? "primary.main" : "text.primary"}
      noWrap={noWrap}
      sx={[{ fontWeight: WEIGHT.strong }, ...(Array.isArray(sx) ? sx : [sx])]}
      variant="body2"
    >
      {children}
    </Typography>
  );
});

/* ------------------------------------------------------------------ */
/* CompactActionButton size token                                      */
/* ------------------------------------------------------------------ */

/**
 * sx fragment for in-row action buttons (e.g. row "ย้อนกลับ" / "JSON" buttons
 * inside a data grid). Honors the touch target floor on small screens.
 *
 * Usage:
 *   <Button size="small" sx={compactActionButtonSx}>...</Button>
 */
export const compactActionButtonSx = {
  fontSize: 12,
  fontWeight: WEIGHT.strong,
  minHeight: { xs: 44, sm: 32 },
  minWidth: 56,
  px: 0.75,
  whiteSpace: "nowrap" as const,
};
