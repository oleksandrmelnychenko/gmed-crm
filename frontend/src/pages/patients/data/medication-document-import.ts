import type {
  ClinicalDocumentImportCandidate,
  ImportedMedicationPayload,
  MedicationImportHistoryEvent,
} from "./clinical-document-import";
import type {
  ClinicalMedication,
  MedicationCategory,
  MedicationStatus,
} from "./patient-clinical";
import { COUNTRY_CODES } from "@/components/ui/country-select";

const medicationStatuses = new Set<MedicationStatus>([
  "aktiv",
  "pausiert",
  "abgesetzt",
  "geplant",
]);
const medicationCategories = new Set<MedicationCategory>(["dauer", "besondere", "selbst"]);

export type MedicationReviewDecision = "include" | "exclude";

export type MedicationReviewDecisionSummary = {
  total: number;
  included: number;
  excluded: number;
  unresolved: number;
  unresolvedCandidates: ClinicalDocumentImportCandidate[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolean(value: unknown): boolean {
  return value === true || value === "true";
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalText(value: Record<string, unknown>, key: string): string | null | undefined {
  return hasOwn(value, key) ? text(value[key]) : undefined;
}

function optionalBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  return hasOwn(value, key) ? boolean(value[key]) : undefined;
}

function status(value: unknown): MedicationStatus {
  return typeof value === "string" && medicationStatuses.has(value as MedicationStatus)
    ? (value as MedicationStatus)
    : "aktiv";
}

function category(value: unknown): MedicationCategory {
  return typeof value === "string" && medicationCategories.has(value as MedicationCategory)
    ? (value as MedicationCategory)
    : "dauer";
}

function identifiersText(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    const values = value.map((item) => text(item)).filter((item): item is string => Boolean(item));
    return values.length > 0 ? values.join(", ") : null;
  }
  if (value && typeof value === "object") {
    const values = Object.entries(value)
      .map(([key, item]) => {
        const identifier = text(item);
        return identifier ? `${key}: ${identifier}` : null;
      })
      .filter((item): item is string => Boolean(item));
    return values.length > 0 ? values.join(", ") : null;
  }
  return null;
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (Array.isArray(value)) return { values: value };
  const item = text(value);
  return item ? { value: item } : {};
}

function confidenceObject(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0 && entry[1] <= 1,
    ),
  );
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

export function medicationCandidateWirkstoff(
  candidate: Pick<ClinicalDocumentImportCandidate, "normalized">,
): string {
  return text(candidate.normalized.wirkstoff) ?? "";
}

export function medicationCandidateNeedsWirkstoff(
  candidate: Pick<ClinicalDocumentImportCandidate, "normalized" | "target">,
): boolean {
  return candidate.target === "medication" && !medicationCandidateWirkstoff(candidate);
}

export function medicationCandidateReviewDecision(
  candidate: Pick<ClinicalDocumentImportCandidate, "normalized" | "target">,
): MedicationReviewDecision | null {
  if (candidate.target !== "medication") return null;
  const decision = candidate.normalized.medication_review_decision;
  return decision === "include" || decision === "exclude" ? decision : null;
}

export function setMedicationCandidateReviewDecision(
  candidate: ClinicalDocumentImportCandidate,
  decision: MedicationReviewDecision,
): ClinicalDocumentImportCandidate {
  return {
    ...candidate,
    selected: decision === "include",
    normalized: {
      ...candidate.normalized,
      medication_review_decision: decision,
    },
  };
}

export function medicationReviewDecisionSummary(
  candidates: ClinicalDocumentImportCandidate[],
): MedicationReviewDecisionSummary {
  const medications = candidates.filter((candidate) => candidate.target === "medication");
  const summary: MedicationReviewDecisionSummary = {
    total: medications.length,
    included: 0,
    excluded: 0,
    unresolved: 0,
    unresolvedCandidates: [],
  };

  for (const candidate of medications) {
    const decision = medicationCandidateReviewDecision(candidate);
    if (decision === "include" && candidate.selected) {
      summary.included += 1;
    } else if (decision === "exclude" && !candidate.selected) {
      summary.excluded += 1;
    } else {
      // Missing and inconsistent decision/selection pairs both fail closed.
      summary.unresolved += 1;
      summary.unresolvedCandidates.push(candidate);
    }
  }

  return summary;
}

export function medicationCandidateReviewBlockReason(
  candidate: Pick<ClinicalDocumentImportCandidate, "normalized" | "target">,
  matchingSeriesCount: number,
  matchingBatchCandidateCount = 1,
): "missing_wirkstoff" | "ambiguous_series" | null {
  if (medicationCandidateNeedsWirkstoff(candidate)) return "missing_wirkstoff";
  const seriesId = text(candidate.normalized.medication_series_id);
  const createsNewSeries = boolean(candidate.normalized.create_new_series);
  const requiresExplicitSeries = matchingSeriesCount > 1 || matchingBatchCandidateCount > 1;
  return candidate.target === "medication" && requiresExplicitSeries && !seriesId && !createsNewSeries
    ? "ambiguous_series"
    : null;
}

export function partitionMedicationReviewSelection(
  candidates: ClinicalDocumentImportCandidate[],
  matchingSeriesCount: (candidate: ClinicalDocumentImportCandidate) => number,
  matchingBatchCandidateCount: (candidate: ClinicalDocumentImportCandidate) => number = () => 1,
) {
  const selected = candidates.filter((candidate) => candidate.selected);
  const blockedSelected = selected.filter(
    (candidate) =>
      medicationCandidateReviewBlockReason(
        candidate,
        matchingSeriesCount(candidate),
        matchingBatchCandidateCount(candidate),
      ) !== null,
  );
  return { selected, blockedSelected };
}

export function medicationCandidateDisplay(normalized: Record<string, unknown>): string {
  const name = [text(normalized.handelsname), text(normalized.wirkstoff)]
    .filter((item): item is string => Boolean(item))
    .join(" · ");
  const product = [text(normalized.staerke), text(normalized.form), text(normalized.einnahmeform)]
    .filter((item): item is string => Boolean(item))
    .join(" · ");
  const dose = [
    text(normalized.dose_morgens) ?? "0",
    text(normalized.dose_mittags) ?? "0",
    text(normalized.dose_abends) ?? "0",
    text(normalized.dose_nachts) ?? "0",
  ].join("-");
  const hasDose = [
    normalized.dose_morgens,
    normalized.dose_mittags,
    normalized.dose_abends,
    normalized.dose_nachts,
  ].some((item) => Boolean(text(item)));
  const effectiveDate = text(normalized.source_date) ?? text(normalized.effective_date);
  return [
    name,
    product,
    hasDose ? `${dose}${text(normalized.einheit) ? ` ${text(normalized.einheit)}` : ""}` : null,
    effectiveDate ? `Datum: ${effectiveDate}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" | ");
}

export function updateMedicationCandidateField(
  candidate: ClinicalDocumentImportCandidate,
  field: string,
  value: string | boolean,
): Pick<ClinicalDocumentImportCandidate, "normalized" | "value"> {
  const normalized = { ...candidate.normalized, [field]: value };
  if (field === "wirkstoff" && typeof value === "string" && value.trim()) {
    const reviewReasons = Array.isArray(candidate.normalized.review_reasons)
      ? candidate.normalized.review_reasons.filter(
          (reason) =>
            reason !== "medication_brand_without_active_ingredient" &&
            reason !== "active_ingredient_requires_confirmation" &&
            reason !== "medication_name_requires_confirmation",
        )
      : [];
    normalized.review_reasons = reviewReasons;
  }
  return omitUndefined({
    normalized,
    value: medicationCandidateDisplay(normalized),
  });
}

export function medicationFieldConfidence(
  candidate: Pick<ClinicalDocumentImportCandidate, "normalized">,
  field: string,
): number | null {
  const values = candidate.normalized.field_confidence;
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const value = (values as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

export function medicationIdentifiers(candidate: Pick<ClinicalDocumentImportCandidate, "normalized">) {
  return identifiersText(candidate.normalized.identifiers);
}

export function medicationImportPayload(
  candidate: ClinicalDocumentImportCandidate,
  defaultSourceCountry: string,
): ImportedMedicationPayload | null {
  const normalized = candidate.normalized;
  const wirkstoff = medicationCandidateWirkstoff(candidate);
  if (!wirkstoff) return null;
  const normalizedHinweis = text(normalized.hinweis);
  const asNeeded = optionalBoolean(normalized, "as_needed");
  const hinweis = [
    normalizedHinweis,
    asNeeded && !/(?:prn|bei bedarf|за потреби)/i.test(normalizedHinweis ?? "")
      ? "Bei Bedarf (PRN)"
      : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
  const sourceCountry = COUNTRY_CODES.includes(defaultSourceCountry)
    ? defaultSourceCountry
    : "";
  const drugProductId = text(normalized.drug_product_id);
  const createNewSeries = optionalBoolean(normalized, "create_new_series");

  return omitUndefined({
    candidate_id: candidate.id,
    wirkstoff,
    handelsname: optionalText(normalized, "handelsname"),
    category: hasOwn(normalized, "category")
      ? normalized.category == null ? null : category(normalized.category)
      : undefined,
    staerke: optionalText(normalized, "staerke"),
    form: optionalText(normalized, "form"),
    einnahmeform: optionalText(normalized, "einnahmeform"),
    dose_morgens: optionalText(normalized, "dose_morgens"),
    dose_mittags: optionalText(normalized, "dose_mittags"),
    dose_abends: optionalText(normalized, "dose_abends"),
    dose_nachts: optionalText(normalized, "dose_nachts"),
    einheit: optionalText(normalized, "einheit"),
    hinweis: hasOwn(normalized, "hinweis") || asNeeded ? hinweis || null : undefined,
    grund: optionalText(normalized, "grund"),
    verordnet_am: optionalText(normalized, "verordnet_am"),
    einnahme_von: optionalText(normalized, "einnahme_von"),
    einnahme_bis: optionalText(normalized, "einnahme_bis"),
    source_date: hasOwn(normalized, "source_date")
      ? optionalText(normalized, "source_date")
      : optionalText(normalized, "effective_date"),
    status: hasOwn(normalized, "status")
      ? normalized.status == null ? null : status(normalized.status)
      : undefined,
    on_hold: optionalBoolean(normalized, "on_hold"),
    hold_from: optionalText(normalized, "hold_from"),
    hold_until: optionalText(normalized, "hold_until"),
    hold_note: optionalText(normalized, "hold_note"),
    apothekenpflichtig: optionalBoolean(normalized, "apothekenpflichtig"),
    rezeptpflichtig: optionalBoolean(normalized, "rezeptpflichtig"),
    btm: optionalBoolean(normalized, "btm"),
    aut_idem_sperre: optionalBoolean(normalized, "aut_idem_sperre"),
    abgabebeschraenkung: optionalBoolean(normalized, "abgabebeschraenkung"),
    sonstige_vermerke: optionalText(normalized, "sonstige_vermerke"),
    source_country: sourceCountry || null,
    source_page: candidate.source.page,
    source_raw_text: text(normalized.raw_text) ?? text(candidate.source.text),
    source_identifiers: metadataObject(normalized.identifiers),
    source_field_confidence: confidenceObject(normalized.field_confidence),
    drug_product_id: hasOwn(normalized, "drug_product_id") ? drugProductId : undefined,
    medication_series_id: createNewSeries ? undefined : optionalText(normalized, "medication_series_id"),
    create_new_series: createNewSeries,
  });
}

function snapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  return text(snapshot[key]);
}

function medicationIdentity(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

export type MedicationHistorySeries = {
  key: string;
  medicationSeriesId: string | null;
  identity: string;
  current: ClinicalMedication | null;
  events: MedicationImportHistoryEvent[];
};

export function groupMedicationImportHistory(
  currentMedications: ClinicalMedication[],
  events: MedicationImportHistoryEvent[],
): MedicationHistorySeries[] {
  const currentById = new Map(
    currentMedications.flatMap((item) => item.id ? [[item.id, item] as const] : []),
  );
  const groups = new Map<string, MedicationHistorySeries>();

  const ensure = (
    key: string,
    medicationSeriesId: string | null,
    identity: string,
    current: ClinicalMedication | null,
  ) => {
    const existing = groups.get(key);
    if (existing) {
      if (!existing.current && current) existing.current = current;
      if (!existing.identity && identity) existing.identity = identity;
      return existing;
    }
    const group: MedicationHistorySeries = {
      key,
      medicationSeriesId,
      identity,
      current,
      events: [],
    };
    groups.set(key, group);
    return group;
  };

  currentMedications.forEach((item, index) => {
    const seriesId = text(item.medication_series_id);
    const identity = item.wirkstoff?.trim() || item.handelsname.trim();
    const key = seriesId
      ? `series:${seriesId}`
      : item.id
        ? `medication:${item.id}`
        : `current:${medicationIdentity(identity)}:${index}`;
    ensure(key, seriesId, identity, item);
  });

  events.forEach((event) => {
    const current = event.patient_medication_id
      ? currentById.get(event.patient_medication_id) ?? null
      : null;
    const snapshotSeriesId = snapshotString(event.new_value, "medication_series_id");
    const seriesId = text(event.medication_series_id) ?? snapshotSeriesId ?? text(current?.medication_series_id);
    const identity =
      snapshotString(event.new_value, "wirkstoff") ??
      current?.wirkstoff?.trim() ??
      snapshotString(event.old_value ?? {}, "wirkstoff") ??
      "";
    const key = seriesId
      ? `series:${seriesId}`
      : current?.id
        ? `medication:${current.id}`
        : `identity:${medicationIdentity(identity) || event.patient_medication_id || event.id}`;
    ensure(key, seriesId, identity, current).events.push(event);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      events: [...group.events].sort((left, right) => {
        const leftDate = left.source_date ?? left.created_at;
        const rightDate = right.source_date ?? right.created_at;
        return rightDate.localeCompare(leftDate);
      }),
    }))
    .sort((left, right) =>
      (left.identity || left.current?.handelsname || "").localeCompare(
        right.identity || right.current?.handelsname || "",
        "de",
      ),
    );
}
