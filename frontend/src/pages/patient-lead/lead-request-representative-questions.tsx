import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CountrySelect } from "@/components/ui/country-select";
import { inputClass, selectClass, textareaClass } from "@/components/record-workspace/primitives/design-tokens";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";

import { saveRepresentativeCountryQuestions, type LeadRequest, type RepresentativeCountryQuestions } from "./lead-request-api";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import { combinedSaveState, SANCTIONS_LINK_KINDS, STAY_REASONS, type SaveState } from "./lead-request-model";
import { LabeledField, YesNoSelect, errorBody, runDraftSave, useAutosave, type RequestQueue } from "./lead-request-parts";
import {
  REPRESENTATIVE_QUESTIONS, representativeCountryDraft, representativeCountryPatch, updateRepresentativeCountryDraft,
  type RepresentativeCountryDraft, type RepresentativeCountryField,
} from "./lead-request-representative-questions-model";
import { followUpFieldLabel, type LeadRequestText } from "./lead-request-text";

type Props = {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState: (state: SaveState) => void;
};

/** Each contracting representative keeps separate answers and an autosave. */
export function RepresentativeQuestionsBlock(props: Props) {
  const people = props.request.follow_up?.representatives ?? [];
  const states = useRef<Record<string, SaveState>>({});
  const onState = useCallback((id: string, state: SaveState) => {
    states.current[id] = state;
    props.onSaveState(combinedSaveState(people.map((person) => states.current[person.id] ?? "idle")));
  }, [people, props.onSaveState]);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{props.text.representativeQuestionsIntro}</p>
      {people.map((person) => <RepresentativeQuestionsForm key={person.id} {...props} person={person} onState={onState} />)}
    </div>
  );
}

function RepresentativeQuestionsForm({ request, person, text, lang, enqueue, onChange, onState }: Props & {
  person: RepresentativeCountryQuestions;
  onState: (id: string, state: SaveState) => void;
}) {
  const [draft, setDraft] = useState(() => representativeCountryDraft(person.fields));
  const savedRef = useRef(representativeCountryDraft(person.fields));
  const queuedRef = useRef(savedRef.current);
  const rejectedRef = useRef<Partial<RepresentativeCountryDraft>>({});
  const [rejected, setRejected] = useState<Partial<RepresentativeCountryDraft>>({});
  const failedRef = useRef(false);
  useEffect(() => {
    const incoming = representativeCountryDraft(person.fields);
    const saved = savedRef.current;
    const changed = Object.keys(representativeCountryPatch(saved, incoming));
    if (changed.length === 0) return;
    savedRef.current = incoming;
    queuedRef.current = mergeSavedDraft(queuedRef.current, saved, incoming, saved, changed);
    setDraft((current) => mergeSavedDraft(current, saved, incoming, saved, changed));
  }, [person.fields]);
  const save = useCallback((snapshot: RepresentativeCountryDraft) => {
    const fields = queuedDraftFields(representativeCountryPatch(savedRef.current, snapshot), representativeCountryPatch(queuedRef.current, snapshot));
    queuedRef.current = snapshot;
    return runDraftSave(enqueue, fields, async () => {
      const refused = Object.fromEntries(Object.entries(rejectedRef.current).filter(([field, value]) => snapshot[field as RepresentativeCountryField] === value)) as Partial<RepresentativeCountryDraft>;
      let saved = false;
      let failed = false;
      for (;;) {
        const patch = scopedDraftPatch(representativeCountryPatch(savedRef.current, snapshot), fields);
        for (const field of Object.keys(refused) as RepresentativeCountryField[]) delete patch[field];
        if (Object.keys(patch).length === 0) break;
        onState(person.id, "saving");
        try {
          const baseline = savedRef.current;
          const next = await saveRepresentativeCountryQuestions(request.lead_id, person.id, patch);
          const freshPerson = next.follow_up?.representatives?.find((value) => value.id === person.id);
          // A successful answer may close this block. Its acknowledged fields
          // are still saved; unmounting must not resend the older baseline.
          const fresh = freshPerson ? representativeCountryDraft(freshPerson.fields) : { ...baseline, ...Object.fromEntries(Object.keys(patch).map((field) => [field, snapshot[field as RepresentativeCountryField]])) };
          savedRef.current = fresh;
          queuedRef.current = mergeSavedDraft(queuedRef.current, snapshot, fresh, baseline, Object.keys(patch), fields);
          setDraft((current) => mergeSavedDraft(current, snapshot, fresh, baseline, Object.keys(patch), fields));
          onChange(next);
          saved = true;
          break;
        } catch (cause) {
          const body = errorBody(cause);
          const field = typeof body?.field === "string" ? body.field : "";
          if (!(field in patch)) { failed = true; break; }
          refused[field as RepresentativeCountryField] = snapshot[field as RepresentativeCountryField];
        }
      }
      rejectedRef.current = refused;
      setRejected(refused);
      const previousFailure = failedRef.current;
      failedRef.current = failed || Object.keys(refused).length > 0;
      if (failedRef.current) onState(person.id, "error");
      else if (saved || previousFailure) onState(person.id, "saved");
      return !failedRef.current;
    });
  }, [enqueue, onChange, onState, person.id, person.fields, request.lead_id]);
  useAutosave(draft, save);
  const update = (field: RepresentativeCountryField, value: string) => setDraft((current) => updateRepresentativeCountryDraft(current, field, value));
  const id = (field: RepresentativeCountryField) => `representative-${person.id}-${field}`;
  const error = (field: RepresentativeCountryField) => rejected[field] !== undefined && rejected[field] === draft[field] ? text.invalidField : undefined;
  const label = (field: RepresentativeCountryField) => (REPRESENTATIVE_QUESTIONS as readonly string[]).includes(field)
    ? text.payerLegalFields[field as (typeof REPRESENTATIVE_QUESTIONS)[number]]
    : followUpFieldLabel(text, field);
  const field = (key: RepresentativeCountryField, control: ReactNode, wide = false) => (
    <LabeledField id={id(key)} key={key} label={label(key)} required error={error(key)} question={(REPRESENTATIVE_QUESTIONS as readonly string[]).includes(key)} className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>{control}</LabeledField>
  );
  const input = (key: RepresentativeCountryField, maxLength = 2000) => field(key, <Input id={id(key)} className={inputClass} value={draft[key]} maxLength={maxLength} aria-invalid={Boolean(error(key)) || undefined} aria-describedby={error(key) ? `${id(key)}-error` : undefined} onChange={(event) => update(key, event.target.value)} />);
  const textarea = (key: RepresentativeCountryField) => field(key, <textarea id={id(key)} className={textareaClass} rows={2} value={draft[key]} maxLength={2000} aria-invalid={Boolean(error(key)) || undefined} onChange={(event) => update(key, event.target.value)} />, true);
  const choice = (key: "stay_reason" | "sanctions_link_kind", labels: Record<string, string>, options: readonly string[]) => field(key, (
    <NativeComboboxSelect id={id(key)} className={selectClass} value={draft[key]} aria-invalid={Boolean(error(key)) || undefined} onChange={(event) => update(key, event.target.value)}>
      <option value="">{text.choose}</option>{options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}
    </NativeComboboxSelect>
  ));
  const pep = draft.pep_self === "yes" || draft.pep_related === "yes";
  return (
    <fieldset className="min-w-0 rounded-xl border border-border bg-card p-4" data-testid={`lead-request-representative-questions-${person.id}`}>
      <legend className="max-w-full break-words px-2 text-sm font-semibold">{person.name}</legend>
      <div className="grid min-w-0 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {input("birth_place", 200)}
        {field("birth_country", <CountrySelect value={draft.birth_country || null} lang={lang} className={selectClass} aria-label={`${person.name}: ${label("birth_country")}`} onChange={(value) => update("birth_country", value ?? "")} />)}
        {input("residence_since", 60)}
        {choice("stay_reason", text.stayReasonOptions, STAY_REASONS)}
        {draft.stay_reason === "other" ? textarea("stay_reason_details") : null}
        {REPRESENTATIVE_QUESTIONS.map((key) => field(key, <YesNoSelect id={id(key)} value={draft[key]} text={text} invalid={Boolean(error(key))} onChange={(value) => update(key, value)} />, true))}
        {pep ? <>
          {input("pep_office")}
          {field("pep_country", <CountrySelect value={draft.pep_country || null} lang={lang} className={selectClass} aria-label={label("pep_country")} onChange={(value) => update("pep_country", value ?? "")} />)}
          {input("pep_period")}
          {draft.pep_related === "yes" ? input("pep_relationship") : null}
          {textarea("pep_wealth_origin")}
        </> : null}
        {draft.sanctions_links === "yes" ? <>
          {input("sanctions_link_name")}
          {choice("sanctions_link_kind", text.sanctionsLinkKindOptions, SANCTIONS_LINK_KINDS)}
          {textarea("sanctions_link_since_extent")}
        </> : null}
      </div>
    </fieldset>
  );
}
