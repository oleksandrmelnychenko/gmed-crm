import type { ReactNode } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { checkboxClass, inputClass } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { DARREICHUNGSFORM_OPTIONS, EINNAHMEFORM_OPTIONS } from "../../data/medication-options";
import { updateClinicalMedicationLifecycle, type ClinicalMedication } from "../../data/patient-clinical";
import { Field, PatientFormSection } from "../shared/patient-form-primitives";
import { MedicationNameFields } from "./medication-name-fields";

export const MEDICATION_EDITOR_CLASS_NAME =
  "data-[side=right]:sm:w-[calc(100vw-1.5rem)] data-[side=right]:sm:max-w-[960px] data-[side=right]:sm:bottom-auto sm:max-h-[calc(100dvh-1.5rem)]";

const controlClass = cn(inputClass, "w-full min-w-0");
const nullable = (value: string) => value === "" ? null : value;

export function MedicationEditorFields({ draft, onChange, lang, dateRangeValid, attribution }: {
  draft: ClinicalMedication;
  onChange: (patch: Partial<ClinicalMedication>) => void;
  lang: string;
  dateRangeValid: boolean;
  attribution: ReactNode;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const doses = [
    ["dose_morgens", tx("Утро", "Morgens"), tx("Доза утром", "Dosis morgens")],
    ["dose_mittags", tx("День", "Mittags"), tx("Доза в обед", "Dosis mittags")],
    ["dose_abends", tx("Вечер", "Abends"), tx("Доза вечером", "Dosis abends")],
    ["dose_nachts", tx("Ночь", "Zur Nacht"), tx("Доза на ночь", "Dosis zur Nacht")],
  ] as const;

  function flag(key: "apothekenpflichtig" | "rezeptpflichtig" | "btm" | "aut_idem_sperre" | "abgabebeschraenkung", label: string) {
    return <label className="flex min-w-0 items-start gap-2 text-sm text-foreground">
      <input type="checkbox" className={cn(checkboxClass, "mt-0.5 shrink-0")} checked={draft[key]} onChange={event => onChange({[key]:event.target.checked})} />
      <span>{label}</span>
    </label>;
  }

  return <div className="space-y-4">
    <PatientFormSection title={tx("Препарат", "Medikament")}>
      <MedicationNameFields value={draft} onChange={onChange} lang={lang} inputClassName={controlClass} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Категория", "Kategorie")}>
          <NativeComboboxSelect value={draft.category} aria-label={tx("Категория", "Kategorie")} className={controlClass} onChange={event => onChange({category:event.target.value as ClinicalMedication["category"]})}>
            <option value="dauer">{tx("Постоянная", "Dauermedikation")}</option>
            <option value="besondere">{tx("По особым показаниям", "Zu besonderen Zeiten")}</option>
            <option value="selbst">{tx("Самолечение", "Selbstmedikation")}</option>
          </NativeComboboxSelect>
        </Field>
        <Field label={tx("Статус", "Status")}>
          <NativeComboboxSelect value={draft.status} aria-label={tx("Статус", "Status")} className={controlClass} onChange={event => onChange(updateClinicalMedicationLifecycle(draft, {status:event.target.value as ClinicalMedication["status"]}))}>
            <option value="aktiv">{tx("Активный", "Aktiv")}</option>
            <option value="pausiert">{tx("Приостановлен", "Pausiert")}</option>
            <option value="abgesetzt">{tx("Отменён", "Abgesetzt")}</option>
            <option value="geplant">{tx("Запланирован", "Geplant")}</option>
          </NativeComboboxSelect>
        </Field>
        <Field required label={tx("Форма выпуска", "Darreichungsform")}>
          <NativeComboboxSelect value={draft.form ?? ""} required aria-label={tx("Форма выпуска", "Darreichungsform")} className={controlClass} onChange={event => onChange({form:nullable(event.target.value)})}>
            <option value="">—</option>
            {DARREICHUNGSFORM_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            {draft.form && !DARREICHUNGSFORM_OPTIONS.some(option => option.value === draft.form) ? <option value={draft.form}>{draft.form}</option> : null}
          </NativeComboboxSelect>
        </Field>
        <Field required label={tx("Способ применения", "Einnahmeform")}>
          <NativeComboboxSelect value={draft.einnahmeform ?? ""} required aria-label={tx("Способ применения", "Einnahmeform")} className={controlClass} onChange={event => onChange({einnahmeform:nullable(event.target.value)})}>
            <option value="">—</option>
            {EINNAHMEFORM_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </NativeComboboxSelect>
        </Field>
      </div>
    </PatientFormSection>

    <PatientFormSection title={tx("Дозировка и схема приёма", "Dosierung und Einnahme")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Дозировка", "Stärke")}><Input value={draft.staerke ?? ""} onChange={event => onChange({staerke:nullable(event.target.value)})} className={controlClass} placeholder="5 mg" /></Field>
        <Field label={tx("Единица", "Einheit")}><Input value={draft.einheit ?? ""} onChange={event => onChange({einheit:nullable(event.target.value)})} className={controlClass} placeholder={tx("шт.", "Stück")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {doses.map(([key, label, accessibleLabel]) => <Field key={key} label={label}>
          <Input value={draft[key] ?? ""} onChange={event => onChange({[key]:nullable(event.target.value)})} className={cn(controlClass, "text-center font-mono tabular-nums")} aria-label={accessibleLabel} />
        </Field>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Причина", "Grund")}><Input value={draft.grund ?? ""} onChange={event => onChange({grund:nullable(event.target.value)})} className={controlClass} /></Field>
        <Field label={tx("Указания", "Hinweise")}><Input value={draft.hinweis ?? ""} onChange={event => onChange({hinweis:nullable(event.target.value)})} className={controlClass} /></Field>
      </div>
    </PatientFormSection>

    <PatientFormSection title={tx("Назначение и сроки", "Verordnung und Zeitraum")}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={tx("Дата назначения", "Verordnet am")}><Input type="date" value={draft.verordnet_am ?? ""} onChange={event => onChange({verordnet_am:nullable(event.target.value)})} className={controlClass} /></Field>
        <Field label={tx("Приём с", "Einnahme von")}><Input type="date" value={draft.einnahme_von ?? ""} onChange={event => onChange({einnahme_von:nullable(event.target.value)})} className={controlClass} /></Field>
        <Field label={tx("Приём до", "Einnahme bis")}><Input type="date" min={draft.einnahme_von ?? undefined} aria-invalid={!dateRangeValid} value={draft.einnahme_bis ?? ""} onChange={event => onChange({einnahme_bis:nullable(event.target.value)})} className={cn(controlClass, !dateRangeValid && "border-destructive")} /></Field>
      </div>
      {!dateRangeValid ? <p role="alert" className="text-xs text-destructive">{tx("Дата окончания не может быть раньше даты начала.", "Das Enddatum darf nicht vor dem Startdatum liegen.")}</p> : null}
      {attribution}
    </PatientFormSection>

    <PatientFormSection title={tx("Отпуск и ограничения", "Abgabe und Einschränkungen")}>
      <fieldset className="min-w-0 space-y-3">
        <legend className="text-xs font-medium text-muted-foreground">{tx("Правовой статус", "Rechtlicher Status")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {flag("apothekenpflichtig", tx("Аптечный", "Apothekenpflichtig"))}
          {flag("rezeptpflichtig", tx("Рецептурный", "Rezeptpflichtig"))}
          {flag("btm", tx("Наркотическое (BTM)", "Betäubungsmittel (BTM)"))}
        </div>
      </fieldset>
      <fieldset className="min-w-0 space-y-3 border-t border-border/70 pt-3">
        <legend className="text-xs font-medium text-muted-foreground">{tx("Предупреждения", "Warnhinweise")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {flag("aut_idem_sperre", tx("Aut-Idem-блок", "Aut-Idem-Sperre"))}
          {flag("abgabebeschraenkung", tx("Огранич. отпуска", "Abgabebeschränkung"))}
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className={cn(checkboxClass, "mt-0.5 shrink-0")} checked={draft.sonstige_vermerke !== null} onChange={event => onChange({sonstige_vermerke:event.target.checked ? (draft.sonstige_vermerke ?? "") : null})} />
            {tx("Прочие пометки", "Sonstige Vermerke")}
          </label>
        </div>
        {draft.sonstige_vermerke !== null ? <Input value={draft.sonstige_vermerke} onChange={event => onChange({sonstige_vermerke:event.target.value})} className={controlClass} aria-label={tx("Прочие пометки", "Sonstige Vermerke")} /> : null}
      </fieldset>
    </PatientFormSection>
  </div>;
}
