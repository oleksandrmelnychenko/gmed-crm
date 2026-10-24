import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { inputClass, selectClass } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { PERSON_CITY_MAX } from "@/lib/person-fields";

import type { LeadRepresentation, LeadRepresentative } from "../data/lead-portal-intake-api";
import { updateLeadRepresentativeDetails, type RepresentativeDetails } from "../data/lead-representation-api";
import type { Tx } from "../model/lead-payer";
import { mergeRepresentativeDetails, representativeDetailsChanged, representativeDetailsErrors, representativeDetailsOf } from "../model/lead-representative-details";
import { leadErrorMessage } from "../model/leads-model";

/**
 * Staff correct a representative's address, birth data and citizenships
 * (owner 2026-10-24): the parts the GwG sheet and the consent form print.
 * Saved on its own; only what staff changed since loading is written, so a
 * change made in the cabinet meanwhile stays.
 */
export function LeadRepresentativeDetailsForm({
  leadId,
  person,
  tx,
  lang,
  disabled,
  onSaved,
}: {
  leadId: string;
  person: LeadRepresentative;
  tx: Tx;
  lang: string;
  disabled: boolean;
  onSaved: (representation: LeadRepresentation | null) => void;
}) {
  const id = useId();
  const stored = representativeDetailsOf(person);
  const storedKey = JSON.stringify(stored);
  // What the draft was built from, per field: a save writes only what differs from it.
  const loadedRef = useRef<RepresentativeDetails>(stored);
  const [draft, setDraftState] = useState<RepresentativeDetails>(stored);
  const draftRef = useRef(draft);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
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

  const changed = representativeDetailsChanged(draft, loadedRef.current);
  const errors = representativeDetailsErrors(draft, loadedRef.current);
  const canSave = !disabled && !busy && changed && Object.keys(errors).length === 0;
  const tooLong = tx("Слишком длинное значение", "Zu lang");
  const set = <K extends keyof RepresentativeDetails>(key: K, value: RepresentativeDetails[K]) => {
    setSaved(false);
    setDraft({ ...draftRef.current, [key]: value });
  };
  const save = async () => {
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError("");
    try {
      const representation = await updateLeadRepresentativeDetails(leadId, person.id, draftRef.current, loadedRef.current);
      const fresh = representation?.representatives.find((item) => item.id === person.id);
      if (fresh) {
        const next = representativeDetailsOf(fresh);
        loadedRef.current = next;
        setDraft(next);
      }
      setMeanwhile(null);
      setSaved(true);
      onSaved(representation);
    } catch (cause) {
      setError(leadErrorMessage(cause, tx));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof RepresentativeDetails) => `${id}-${key}`;
  const text = (key: "street" | "zip" | "city" | "birth_place", label: string, maxLength: number, className?: string) => (
    <label className={className} htmlFor={field(key)}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        id={field(key)}
        name={key}
        className={inputClass}
        maxLength={maxLength}
        value={draft[key]}
        disabled={disabled || busy}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(event) => set(key, event.target.value)}
        onKeyDown={(event) => {
          // Enter stores these details, never the contact form around them
          // (DEV 2026-10-24: the dialog closed and the typed details were lost).
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (canSave) void save();
        }}
      />
      {errors[key] ? <span className="mt-1 block text-xs text-destructive">{tooLong}</span> : null}
    </label>
  );
  return (
    <div className="space-y-3" data-testid={`lead-representative-details-${person.id}`}>
      <h4 className="text-xs font-semibold text-foreground">
        {tx("Адрес и данные для анкеты GwG", "Anschrift und Angaben für den GwG-Bogen")}
      </h4>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {text("street", tx("Улица и дом", "Straße und Hausnummer"), 200, "sm:col-span-2")}
        {text("zip", tx("Индекс", "PLZ"), 20)}
        {text("city", tx("Город", "Ort"), PERSON_CITY_MAX)}
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{tx("Страна", "Land")}</span>
          <CountrySelect
            value={draft.country || null}
            lang={lang}
            className={selectClass}
            aria-label={tx("Страна проживания", "Wohnsitzland")}
            disabled={disabled || busy}
            onChange={(code) => set("country", code ?? "")}
          />
        </div>
        {text("birth_place", tx("Место рождения", "Geburtsort"), 200)}
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{tx("Страна рождения", "Geburtsland")}</span>
          <CountrySelect
            value={draft.birth_country || null}
            lang={lang}
            className={selectClass}
            aria-label={tx("Страна рождения", "Geburtsland")}
            disabled={disabled || busy}
            onChange={(code) => set("birth_country", code ?? "")}
          />
        </div>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-muted-foreground" id={field("citizenships")}>
            {tx("Гражданства", "Staatsangehörigkeiten")}
          </span>
          <CitizenshipMultiSelect
            maxItems={5}
            value={draft.citizenships}
            lang={lang}
            disabled={disabled || busy}
            placeholder={tx("Выберите страны", "Länder auswählen")}
            onChange={(next) => set("citizenships", next)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {tx("Сохранить адрес и данные", "Anschrift und Angaben speichern")}
        </Button>
        {meanwhile && changed ? (
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
        ) : null}
        {saved && !changed ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`lead-representative-details-${person.id}-saved`}>
            <Check aria-hidden="true" className="size-3.5" />
            {tx("Сохранено", "Gespeichert")}
          </span>
        ) : null}
        {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
