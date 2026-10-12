import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const CHIP_TONES = {
  neutral: "border-border/50 bg-muted/25 text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

export type StatusChipTone = keyof typeof CHIP_TONES;

/** Sentence-case status chip, matching the lead retention countdown. */
export function StatusChip({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: StatusChipTone }) {
  return <span {...props} className={cn(
    "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-5 [&>svg]:size-3.5 [&>svg]:shrink-0",
    CHIP_TONES[tone], className,
  )} />;
}
