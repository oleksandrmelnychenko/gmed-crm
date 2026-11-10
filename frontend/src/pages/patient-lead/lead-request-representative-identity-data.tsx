import { useCallback, useEffect, useRef, useState } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";

import {
  saveLeadRepresentative,
  type LeadRequest,
  type LeadRequestRepresentative,
  type RepresentativePatch,
} from "./lead-request-api";
import { LeadRequestIdentityRecognition } from "./lead-request-identity-recognition";
import { CabinetHint, LabeledField, errorBody, useAutosave, type RequestQueue } from "./lead-request-parts";
import { identificationFieldLabel, type LeadRequestText } from "./lead-request-text";

// The data of a representative's identity document, typed next to the copy
// (owner 2026-11-10: parents and other representatives may enter them like
// the lead, with the reading of the scan). Optional; staff compare them with
// the copy in the wizard, and once staff saved them there they are read-only
// here.

export const REPRESENTATIVE_ID_FIELDS = [
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
] as const;
export type RepresentativeIdField = (typeof REPRESENTATIVE_ID_FIELDS)[number];
export type RepresentativeIdDraft = Record<RepresentativeIdField, string>;

export function representativeIdDraft(person: LeadRequestRepresentative | null | undefined): RepresentativeIdDraft {
  const value = (field: RepresentativeIdField) => (person?.[field] ?? "").trim();
  return {
    id_document_type: value("id_document_type"),
    id_document_number: value("id_document_number"),
    id_issuing_authority: value("id_issuing_authority"),
    id_issuing_country: value("id_issuing_country").toUpperCase(),
    id_issued_on: value("id_issued_on").slice(0, 10),
    id_valid_until: value("id_valid_until").slice(0, 10),
  };
}

type Refused = Partial<Record<RepresentativeIdField, { value: string; code: string }>>;

/** What changed since the last save, without the values the server refused. */
export function representativeIdPatch(
  saved: RepresentativeIdDraft,
  draft: RepresentativeIdDraft,
  refused: Refused = {},
): Partial<Record<RepresentativeIdField, string>> {
  const patch: Partial<Record<RepresentativeIdField, string>> = {};
  for (const field of REPRESENTATIVE_ID_FIELDS) {
    const value = draft[field].trim();
    if (value === saved[field]) continue;
    if (refused[field]?.value === value) continue;
    patch[field] = value;
  }
  return patch;
}

/** The fields nobody typed in follow the server; a typed one keeps its value. */
export function mergeIncomingRepresentativeId(
  draft: RepresentativeIdDraft,
  saved: RepresentativeIdDraft,
  incoming: RepresentativeIdDraft,
): RepresentativeIdDraft {
  const next = { ...draft };
  for (const field of REPRESENTATIVE_ID_FIELDS) {
    if (draft[field].trim() === saved[field]) next[field] = incoming[field];
  }
  return next;
}

export function RepresentativeIdentityData({
  request,
  slot,
  person,
  text,
  lang,
  enqueue,
  onChange,
}: {
  request: LeadRequest;
  slot: string;
  person: LeadRequestRepresentative;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
}) {
  const [draft, setDraft] = useState<RepresentativeIdDraft>(() => representativeIdDraft(person));
  const savedRef = useRef<RepresentativeIdDraft>(representativeIdDraft(person));
  const refusedRef = useRef<Refused>({});
  const [refused, setRefused] = useState<Refused>({});
  const byStaff = person.id_data_by_staff === true;

  // Saved elsewhere meanwhile (the other parent, GMED): untouched fields follow.
  const incomingKey = JSON.stringify(representativeIdDraft(person));
  useEffect(() => {
    const incoming = JSON.parse(incomingKey) as RepresentativeIdDraft;
    const saved = savedRef.current;
    if (JSON.stringify(saved) === incomingKey) return;
    savedRef.current = incoming;
    setDraft((current) => mergeIncomingRepresentativeId(current, saved, incoming));
  }, [incomingKey]);

  const save = useCallback(
    async (snapshot: RepresentativeIdDraft) => {
      let rejected: Refused = {};
      for (const field of REPRESENTATIVE_ID_FIELDS) {
        const known = refusedRef.current[field];
        if (known && known.value === snapshot[field].trim()) rejected[field] = known;
      }
      let failed = false;
      // Each round either saves or sets one more refused field aside.
      for (;;) {
        const patch = representativeIdPatch(savedRef.current, snapshot, rejected);
        if (Object.keys(patch).length === 0) break;
        try {
          const next = await enqueue(() => saveLeadRepresentative(request.lead_id, person.id, patch as RepresentativePatch));
          const stored = next.representation?.representatives.find((item) => item.id === person.id);
          if (stored) savedRef.current = representativeIdDraft(stored);
          onChange(next);
          break;
        } catch (cause) {
          const body = errorBody(cause);
          const field = typeof body?.field === "string" ? (body.field as RepresentativeIdField) : null;
          if (!field || !(field in patch)) {
            failed = true;
            break;
          }
          rejected = { ...rejected, [field]: { value: snapshot[field].trim(), code: typeof body?.code === "string" ? body.code : "" } };
        }
      }
      refusedRef.current = rejected;
      setRefused(rejected);
      return !failed && Object.keys(rejected).length === 0;
    },
    [enqueue, onChange, person.id, request.lead_id],
  );
  useAutosave(draft, save);

  const set = (field: RepresentativeIdField, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const errorFor = (field: RepresentativeIdField) => {
    const known = refused[field];
    if (!known || known.value !== draft[field].trim()) return undefined;
    if (known.code === "id_document_expired") return text.idDocumentExpired;
    if (known.code === "staff_only") return text.representativeIdDataStaff;
    return text.invalidField;
  };
  const idOf = (field: RepresentativeIdField) => `lead-request-${slot}_${field}`;
  const control = (field: RepresentativeIdField) => {
    const invalid = Boolean(errorFor(field));
    return {
      id: idOf(field),
      disabled: byStaff,
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? `${idOf(field)}-error` : undefined,
    };
  };
  const labeled = (field: RepresentativeIdField) => ({
    id: idOf(field),
    label: identificationFieldLabel(text, field),
    error: errorFor(field),
  });
  const pickerLang = lang === "de" || lang === "ru" || lang === "uk" || lang === "en" ? lang : undefined;
  const dateInput = (field: "id_issued_on" | "id_valid_until", bounds: { min?: string }) => (
    <Input
      key={`${field}-${lang}`}
      {...control(field)}
      className={inputClass}
      type="date"
      pickerLang={pickerLang}
      {...bounds}
      value={draft[field]}
      onChange={(event) => set(field, event.target.value)}
    />
  );
  const textInput = (field: "id_document_number" | "id_issuing_authority", maxLength: number) => (
    <Input
      {...control(field)}
      className={inputClass}
      autoComplete="off"
      maxLength={maxLength}
      value={draft[field]}
      onChange={(event) => set(field, event.target.value)}
    />
  );

  return (
    <div className="space-y-3" data-testid={`lead-request-${slot}-identity-data`}>
      {byStaff ? (
        <CabinetHint>{text.representativeIdDataStaff}</CabinetHint>
      ) : (
        <>
          <p className="text-sm leading-6 text-muted-foreground">{text.representativeIdDataIntro}</p>
          <LeadRequestIdentityRecognition
            leadId={request.lead_id}
            documents={person.identity_documents}
            draft={draft}
            onTake={set}
            text={text}
            lang={lang}
            testId={`lead-request-${slot}-recognition`}
          />
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledField {...labeled("id_document_type")}>
          <NativeComboboxSelect
            {...control("id_document_type")}
            className={selectClass}
            value={draft.id_document_type}
            onChange={(event) => set("id_document_type", event.target.value)}
          >
            <option value="">{text.choose}</option>
            {Object.entries(text.idDocumentTypeOptions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeComboboxSelect>
        </LabeledField>
        <LabeledField {...labeled("id_document_number")}>{textInput("id_document_number", 60)}</LabeledField>
        <LabeledField {...labeled("id_issuing_authority")}>{textInput("id_issuing_authority", 200)}</LabeledField>
        <LabeledField {...labeled("id_issuing_country")}>
          <CountrySelect
            value={draft.id_issuing_country || null}
            lang={lang}
            className={selectClass}
            disabled={byStaff}
            aria-label={identificationFieldLabel(text, "id_issuing_country")}
            onChange={(code) => set("id_issuing_country", code ?? "")}
          />
        </LabeledField>
        <LabeledField {...labeled("id_issued_on")}>{dateInput("id_issued_on", { min: "1900-01-01" })}</LabeledField>
        <LabeledField {...labeled("id_valid_until")}>{dateInput("id_valid_until", {})}</LabeledField>
      </div>
    </div>
  );
}
