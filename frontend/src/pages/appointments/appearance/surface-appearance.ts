import {
  inputClass,
  selectClass,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

export const appointmentFilterControlClassName = inputClass;
export const appointmentSelectControlClassName = cn(
  selectClass,
  "h-10 rounded-xl",
);
export const appointmentTextareaControlClassName = cn(
  textareaClass,
  "min-h-[96px]",
);
export const appointmentSlateInputClassName = "h-10 rounded-xl bg-slate-50";
export const appointmentWhiteInputClassName = "h-10 rounded-xl bg-white";
export const appointmentElevatedSectionCardClassName =
  "rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.35)]";
export const appointmentSoftPanelClassName =
  "rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4";
export const appointmentPreviewInfoCardClassName = cn(
  "rounded-xl px-4 py-3",
  tokens.surface.card,
);
export const appointmentSoftRowClassName =
  "rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3";
export const appointmentWhiteRowClassName =
  "rounded-2xl border border-slate-200 bg-white px-4 py-3";
export const appointmentSoftSplitRowClassName =
  "flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between";
export const appointmentMetaPillClassName =
  "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600";
export const appointmentMiniPillClassName =
  "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600";
export const appointmentToggleCardClassName =
  "flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700";
export const appointmentWhiteSelectControlClassName =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
export const appointmentWhiteTextareaControlClassName =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
export const appointmentSlateTextareaControlClassName =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

export function appointmentSectionCardClassName(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70",
    tokens.surface.card,
    extra,
  );
}
