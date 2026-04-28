import { cn } from "@/lib/utils";

export const tokens = {
  radius: {
    sm: "rounded-lg",
    md: "rounded-xl",
    pill: "rounded-full",
  },
  surface: {
    card: "border border-border/50 bg-card",
    mutedCard: "border border-border/50 bg-muted/25",
    softCard: "border border-border/50 bg-card/40",
    dashed: "border border-dashed border-border/60 bg-muted/25",
  },
  text: {
    eyebrow:
      "text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80",
    label: "text-[11.5px] font-medium text-muted-foreground leading-tight",
    sectionTitle: "text-[13px] font-semibold tracking-tight text-foreground",
    body: "text-sm text-foreground",
    muted: "text-xs text-muted-foreground",
  },
  control: {
    inputHeight: "h-9",
    accessoryButton: "h-8 rounded-lg",
    primaryButton: "h-9 rounded-lg",
    iconButton: "size-3.5",
  },
} as const;

export const inputClass = cn(tokens.control.inputHeight, "rounded-lg bg-card");
export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const textareaClass =
  "min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const checkboxClass =
  "size-4 shrink-0 cursor-pointer rounded border-border/60 bg-card accent-[var(--brand)] text-[var(--brand)] focus:ring-[var(--brand)]/30 disabled:cursor-not-allowed disabled:opacity-50";
