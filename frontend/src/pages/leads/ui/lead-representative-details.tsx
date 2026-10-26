import { useEffect, useId, useRef, useState } from "react";

import { inputClass, selectClass } from "@/components/ui-shell";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { PERSON_CITY_MAX } from "@/lib/person-fields";

import type { LeadRepresentative } from "../data/lead-portal-intake-api";
import type { RepresentativeDetails } from "../data/lead-representation-api";
import type { Tx } from "../model/lead-payer";
import {
  EMPTY_REPRESENTATIVE_DETAILS,
  fillEmptyRepresentativeDetails,
  mergeRepresentativeDetails,
  representativeDetailsChanged,
  representativeDetailsErrors,
  representativeDetailsOf,
} from "../model/lead-representative-details";

/**
 * Staff correct a representative's address, birth data and citizenships
 * (owner 2026-10-24): the parts the GwG sheet and the consent form print.
 * No own save button (QA 2026-10-25, V-A4): the contact dialog's «Сохранить»
 * writes them — the citizenships and birth data with the contact, the address
 * parts on their own endpoint — and only what staff changed since loading, so
 * a change made in the cabinet meanwhile stays.
 */
export function LeadRepresentativeDetailsForm({
  person,
  tx,
  lang,
  disabled,
  onDraftChange,
  prefill,
}: {
  person: LeadRepresentative;
  tx: Tx;
  lang: string;
  disabled: boolean;
  /**
   * The form's values and what they were loaded from, after every change:
   * the contact dialog's own «Сохранить» carries them (F-11, QA 2026-10-25:
   * they were dropped silently).
   */
  onDraftChange?: (draft: RepresentativeDetails, loaded: RepresentativeDetails) => void;
  /**
   * A person picked from the patients or leads in the dialog: their details
   * go into the empty fields (DEV 2026-10-26); `key` changes with each pick,
   * and a field still holding the previous pick's value takes the new one.
   */
  prefill?: { key: string; values: RepresentativeDetails } | null;
}) {
  const stored = representativeDetailsOf(person);
  const storedKey = JSON.stringify(stored);
  // What the draft was built from, per field: a save writes only what differs from it.
  const loadedRef = useRef<RepresentativeDetails>(stored);
  const [draft, setDraftState] = useState<RepresentativeDetails>(stored);
  const draftRef = useRef(draft);
  // The server changed this person while staff edit: "updated" when only
  // untouched fields were refreshed, "conflict" when a typed field changed too.
  const [meanwhile, setMeanwhile] = useState<"updated" | "conflict" | null>(null);
  const setDraft = (next: RepresentativeDetails) => {
    draftRef.current = next;
    setDraftState(next);
  };
  // A newer server state (the cabinet, another tab) replaces an untouched
  // form; while staff type, only the fields they left as loaded follow it,
  // and the typed ones keep their old base so the save writes them alone.
  useEffect(() => {
    const fresh = JSON.parse(storedKey) as RepresentativeDetails;
    const merged = mergeRepresentativeDetails(draftRef.current, loadedRef.current, fresh);
    loadedRef.current = merged.loaded;
    setDraft(merged.draft);
    if (merged.changedMeanwhile && representativeDetailsChanged(merged.draft, merged.loaded)) {
      setMeanwhile((current) => (merged.conflict || current === "conflict" ? "conflict" : "updated"));
    }
  }, [storedKey]);

  // A pick fills the empty fields once; the save writes them like typed ones.
  const prefillRef = useRef(prefill);
  useEffect(() => {
    prefillRef.current = prefill;
  }, [prefill]);
  const previousPrefillRef = useRef<RepresentativeDetails | null>(null);
  const prefillKey = prefill?.key ?? "";
  useEffect(() => {
    const current = prefillRef.current;
    if (!current) return;
    const { details } = fillEmptyRepresentativeDetails(draftRef.current, current.values, previousPrefillRef.current);
    previousPrefillRef.current = current.values;
    setDraft(details);
  }, [prefillKey]);

  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);
  useEffect(() => {
    onDraftChangeRef.current?.(draft, loadedRef.current);
  }, [draft]);

  const changed = representativeDetailsChanged(draft, loadedRef.current);
  const errors = representativeDetailsErrors(draft, loadedRef.current);
  const set = <K extends keyof RepresentativeDetails>(key: K, value: RepresentativeDetails[K]) => {
    setDraft({ ...draftRef.current, [key]: value });
  };
  return (
    <div className="space-y-3" data-testid={`lead-representative-details-${person.id}`}>
      <h4 className="text-xs font-semibold text-foreground">
        {tx("Адрес и данные для анкеты GwG", "Anschrift und Angaben für den GwG-Bogen")}
      </h4>
      <p className="text-[11.5px] leading-tight text-muted-foreground">
        {tx(
          "Сохраняются кнопкой «Сохранить» вместе с карточкой.",
          "Werden mit „Speichern“ zusammen mit der Karte gespeichert.",
        )}
      </p>
      <RepresentativeDetailsFields
        draft={draft}
        errors={errors}
        tx={tx}
        lang={lang}
        disabled={disabled}
        onChange={set}
      />
      {meanwhile && changed ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-amber-700 dark:text-amber-300" role="status" data-testid={`lead-representative-details-${person.id}-meanwhile`}>
            {meanwhile === "conflict"
              ? tx(
                  "Данные этого лица изменились тем временем (кабинет или другая вкладка), в том числе поле, которое вы правите: при сохранении запишется ваше значение",
                  "Die Angaben dieser Person wurden inzwischen geändert (Portal oder anderer Tab), auch ein Feld, das Sie bearbeiten: beim Speichern gilt Ihr Wert",
                )
              : tx(
                  "Данные этого лица изменились тем временем (кабинет или другая вкладка): нетронутые поля обновлены",
                  "Die Angaben dieser Person wurden inzwischen geändert (Portal oder anderer Tab): unberührte Felder wurden aktualisiert",
                )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same fields for a parent the server does not know yet (a new card, or
 * a lead not created yet, mode «Заполняю сам»): kept with the card and
 * written once the saved card is on file (walk-through 2026-10-24: the
 * contract asked for citizenship and address the card could not take).
 */
export function PendingRepresentativeDetailsForm({
  value,
  tx,
  lang,
  disabled,
  onChange,
}: {
  value: RepresentativeDetails;
  tx: Tx;
  lang: string;
  disabled: boolean;
  onChange: (next: RepresentativeDetails) => void;
}) {
  const errors = representativeDetailsErrors(value, EMPTY_REPRESENTATIVE_DETAILS);
  return (
    <div className="space-y-3" data-testid="lead-representative-details-pending">
      <h4 className="text-xs font-semibold text-foreground">
        {tx("Адрес и данные для анкеты GwG", "Anschrift und Angaben für den GwG-Bogen")}
      </h4>
      <p className="text-[11.5px] leading-tight text-muted-foreground">
        {tx(
          "Нужны для договора и анкеты GwG родителя. Сохраняются вместе с карточкой.",
          "Nötig für den Vertrag und den GwG-Bogen des Elternteils. Werden mit der Karte gespeichert.",
        )}
      </p>
      <RepresentativeDetailsFields
        draft={value}
        errors={errors}
        tx={tx}
        lang={lang}
        disabled={disabled}
        onChange={(key, next) => onChange({ ...value, [key]: next })}
      />
    </div>
  );
}

/**
 * The address, birth data and citizenship fields of a representative, shared
 * by the saved form and the form of a parent not yet on file.
 */
export function RepresentativeDetailsFields({
  draft,
  errors,
  tx,
  lang,
  disabled,
  onChange,
  onEnter,
}: {
  draft: RepresentativeDetails;
  errors: Partial<Record<keyof RepresentativeDetails, "too_long">>;
  tx: Tx;
  lang: string;
  disabled: boolean;
  onChange: <K extends keyof RepresentativeDetails>(key: K, value: RepresentativeDetails[K]) => void;
  /** Enter in a text field (never submits the contact form around it). */
  onEnter?: () => void;
}) {
  const id = useId();
  const tooLong = tx("Слишком длинное значение", "Zu lang");
  const field = (key: keyof RepresentativeDetails) => `${id}-${key}`;
  const text = (key: "street" | "zip" | "city" | "birth_place", label: string, maxLength: number, className?: string) => (
    <label className={className} htmlFor={field(key)}>
      <span className="mb-1 block font-mono text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        id={field(key)}
        name={key}
        className={inputClass}
        maxLength={maxLength}
        value={draft[key]}
        disabled={disabled}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(event) => onChange(key, event.target.value)}
        onKeyDown={(event) => {
          // Enter stores these details, never the contact form around them
          // (DEV 2026-10-24: the dialog closed and the typed details were lost).
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter?.();
        }}
      />
      {errors[key] ? <span className="mt-1 block text-xs text-destructive">{tooLong}</span> : null}
    </label>
  );
  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {text("street", tx("Улица и дом", "Straße und Hausnummer"), 200, "sm:col-span-2")}
      {text("zip", tx("Индекс", "PLZ"), 20)}
      {text("city", tx("Город", "Ort"), PERSON_CITY_MAX)}
      <div>
        <span className="mb-1 block font-mono text-xs font-medium text-muted-foreground">{tx("Страна", "Land")}</span>
        <CountrySelect
          value={draft.country || null}
          lang={lang}
          className={selectClass}
          aria-label={tx("Страна проживания", "Wohnsitzland")}
          disabled={disabled}
          onChange={(code) => onChange("country", code ?? "")}
        />
      </div>
      {text("birth_place", tx("Место рождения", "Geburtsort"), 200)}
      <div>
        <span className="mb-1 block font-mono text-xs font-medium text-muted-foreground">{tx("Страна рождения", "Geburtsland")}</span>
        <CountrySelect
          value={draft.birth_country || null}
          lang={lang}
          className={selectClass}
          aria-label={tx("Страна рождения", "Geburtsland")}
          disabled={disabled}
          onChange={(code) => onChange("birth_country", code ?? "")}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block font-mono text-xs font-medium text-muted-foreground" htmlFor={field("citizenships")}>
          {tx("Гражданства", "Staatsangehörigkeiten")}
        </label>
        <CitizenshipMultiSelect
          id={field("citizenships")}
          maxItems={5}
          value={draft.citizenships}
          lang={lang}
          disabled={disabled}
          placeholder={tx("Выберите страны", "Länder auswählen")}
          onChange={(next) => onChange("citizenships", next)}
        />
      </div>
    </div>
  );
}
