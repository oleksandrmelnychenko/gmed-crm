import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  getPatientLegalStatusCompletion,
  type PatientLegalStatus,
} from "../../model/legal-status";

export function LegalStatusPill({ status }: { status: PatientLegalStatus }) {
  const { lang } = useLang();
  const lp = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const completion = getPatientLegalStatusCompletion(status);

  let kind: "complete" | "partial" | "none";
  let text: string;
  if (status.complianceCompleted) {
    kind = "complete";
    text = lp("Bereit", "Готов", "Ready");
  } else if (completion.completed === 0) {
    kind = "none";
    text = lp("Nicht begonnen", "Не начат", "Not started");
  } else {
    kind = "partial";
    text = `${completion.completed}/${completion.total} ${lp(
      "erledigt",
      "выполнено",
      "done"
    )}`;
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
