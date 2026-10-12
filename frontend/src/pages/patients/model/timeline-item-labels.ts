import {
  localizeTimelineItemCategory,
  localizeTimelineSource,
  localizeTimelineStatus,
  localizeTimelineTitle,
} from "@/lib/timeline-labels";

import { darreichungsformLabel } from "../data/medication-options";
import { allergySeverityLabel } from "./allergy-severity";
import type { PatientTimelineItem } from "./detail-model";

type L = (key: string) => string;

/**
 * A medication row of the timeline is titled "<name> · <strength> · <form
 * code>" by the server (`TABL`): the form reads as in the medication table,
 * in the UI language ("Tabletten" / "Таблетки"), never as the code (QA
 * 2026-10-12 B-26b, B3-03).
 */
function localizeMedicationTitle(title: string, l: L, lang: "ru" | "de"): string {
  const parts = title.split(" · ");
  if (parts[0] === "Medication") parts[0] = localizeTimelineTitle("Medication", l);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^[A-Z]{2,6}$/.test(last.trim())) {
      parts[parts.length - 1] = darreichungsformLabel(last, lang);
    }
  }
  return parts.join(" · ");
}

/** The texts of one timeline row in the UI language. */
export function patientTimelineItemLabels(
  item: Pick<PatientTimelineItem, "entity_type" | "title" | "category" | "status" | "source_label">,
  l: L,
  statusLabel: (status: string) => string,
  lang: "ru" | "de" = "de",
) {
  const title =
    item.entity_type === "clinical" && item.category === "medication" && item.title
      ? localizeMedicationTitle(item.title, l, lang)
      : localizeTimelineTitle(item.title, l);
  // An allergy row carries its severity as the status (free text in older
  // entries): shown translated, or as entered — never "unknown value"
  // (QA 2026-10-12 B-26b).
  const allergySeverity =
    item.entity_type === "clinical" && item.category === "allergy" && item.status && item.status !== "active"
      ? allergySeverityLabel(item.status, lang)
      : "";
  return {
    title,
    status: allergySeverity || localizeTimelineStatus(item.status, l) || statusLabel(item.status),
    category: localizeTimelineItemCategory(item.entity_type, item.category, l),
    source: item.source_label ? localizeTimelineSource(item.source_label, l) : "",
  };
}
