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
import { representativeDetailsChanged, representativeDetailsErrors, representativeDetailsOf } from "../model/lead-representative-details";
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
  const loadedRef = useRef<RepresentativeDetails>(stored);
  const [draft, setDraft] = useState<RepresentativeDetails>(stored);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // A newer server state (the cabinet, another tab) replaces an untouched form.
  useEffect(() => {
    const next = JSON.parse(storedKey) as RepresentativeDetails;
    setDraft((current) => (representativeDetailsChanged(current, loadedRef.current) ? current : next));
    loadedRef.current = next;
  }, [storedKey]);

  const changed = representativeDetailsChanged(draft, loadedRef.current);
  const errors = representativeDetailsErrors(draft, loadedRef.current);
  const tooLong = tx("Слишком длинное значение", "Zu lang");
  const set = <K extends keyof RepresentativeDetails>(key: K, value: RepresentativeDetails[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError("");
    try {
      const representation = await updateLeadRepresentativeDetails(leadId, person.id, draft, loadedRef.current);
      const fresh = representation?.representatives.find((item) => item.id === person.id);
      if (fresh) {
        const next = representativeDetailsOf(fresh);
        loadedRef.current = next;
        setDraft(next);
      }
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
          disabled={disabled || busy || !changed || Object.keys(errors).length > 0}
          onClick={() => void save()}
        >
          {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {tx("Сохранить адрес и данные", "Anschrift und Angaben speichern")}
        </Button>
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
