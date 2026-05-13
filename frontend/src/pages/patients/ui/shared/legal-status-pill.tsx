import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  getPatientLegalStatusCompletion,
  type PatientLegalStatus,
} from "../../model/legal-status";

export function LegalStatusPill({ status }: { status: PatientLegalStatus }) {
  const { t } = useLang();
  const lp = (key: string) => t.uiText[key] ?? key;
  const completion = getPatientLegalStatusCompletion(status);

  let kind: "complete" | "partial" | "none";
  let text: string;
  if (status.complianceCompleted) {
    kind = "complete";
    text = lp("patients_legal_status_ready");
  } else if (completion.completed === 0) {
    kind = "none";
    text = lp("patients_legal_status_not_started");
  } else {
    kind = "partial";
    text = lp("patients_legal_status_done_count")
      .replace("{completed}", String(completion.completed))
      .replace("{total}", String(completion.total));
  }

  const pillClass = {
    complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
    partial: "border-amber-200 bg-amber-50 text-amber-700",
    none: "border-border bg-muted text-muted-foreground",
  }[kind];

  const dotClass = {
    complete: "bg-emerald-500",
    partial: "bg-amber-500",
    none: "bg-muted-foreground/60",
  }[kind];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]",
        pillClass
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {text}
    </span>
  );
}
