import { cn } from "@/lib/utils";

export const appointmentSchedulerToolbarShellClassName =
  "appointments-scheduler-divider w-full rounded-[6px] p-3";
export const appointmentSchedulerToolbarRowClassName =
  "appointments-scheduler-toolbar flex w-full flex-col gap-2 lg:flex-row lg:items-start";
export const appointmentSchedulerToolbarGroupClassName =
  "appointments-scheduler-search flex w-full items-center gap-2 lg:w-auto";
export const appointmentSchedulerToolbarIconButtonClassName =
  "h-8 w-8 shrink-0 rounded-full border-slate-200 bg-transparent hover:cursor-pointer hover:bg-transparent";
export const appointmentSchedulerToolbarSearchButtonClassName =
  "h-8 w-full justify-start rounded-full border-slate-200 bg-transparent px-3 text-xs font-normal text-slate-500 lg:w-[18rem] hover:cursor-pointer hover:bg-transparent";
export const appointmentSchedulerToolbarQueueButtonClassName =
  "h-8 shrink-0 rounded-full bg-transparent px-3 hover:cursor-pointer hover:bg-transparent";
export const appointmentMobileAgendaCardClassName =
  "rounded-lg border border-slate-200/80 bg-slate-50/85 p-4 shadow-sm";
export const appointmentMobileAgendaSearchInputClassName =
  "h-10 rounded-xl bg-slate-50";
export const appointmentMobileAgendaInfoBadgeClassName =
  "rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700";
export const appointmentMobileAgendaNeutralBadgeClassName =
  "rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600";
export const appointmentMobileAgendaWarningBadgeClassName =
  "rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700";

export function appointmentMobileAgendaStatToneClassName(
  tone: "sky" | "amber" | "slate",
) {
  switch (tone) {
    case "sky":
      return "bg-sky-100 text-sky-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function appointmentMobileAgendaQuickScopeClassName(active: boolean) {
  return cn(
    "h-8 rounded-full px-3 text-xs",
    active ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-white/80",
  );
}
