import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { selectClass, textareaClass } from "@/components/ui-shell";
import type { LeadDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import type { DoctorOption } from "@/pages/cases/model/types";
import {
  CaseClinicalEditorSection,
  CaseClinicalField,
} from "@/pages/cases/ui/case-clinical-editor-section";
import { LeadQuestionnaireFacts } from "@/pages/leads/ui/lead-questionnaire-facts";
import { leadIntakeTypeFromLead } from "@/pages/leads/model/leads-model";
import {
  DARREICHUNGSFORM_OPTIONS,
  EINNAHMEFORM_OPTIONS,
} from "@/pages/patients/data/medication-options";

export type LeadDiagnosisDraft = {
  id: string;
  label: string;
  diagnosedOn: string;
  note: string;
  kind: "main" | "secondary";
  icdCode: string;
  certainty: "" | "verdacht" | "bestaetigt" | "zustand_nach";
  chronification: "" | "akut" | "chronisch" | "rezidivierend";
};

export type LeadMedicationDraft = {
  id: string;
  name: string;
  activeIngredient: string;
  dose: string;
  schedule: string;
  form: string;
  route: string;
  doseUnit: string;
  unit: string;
  note: string;
  reason: string;
  since: string;
  prescriberId: string;
  prescriber: string;
  medicationType: string;
  expiryDate: string;
  category: "dauer" | "besondere" | "selbst";
  status: "aktiv" | "pausiert" | "abgesetzt" | "geplant";
  doseMorning: string;
  doseNoon: string;
  doseEvening: string;
  doseNight: string;
  prescribedOn: string;
  pharmacyOnly: boolean;
  prescriptionOnly: boolean;
  btm: boolean;
  autIdemBlocked: boolean;
  dispensingRestricted: boolean;
  otherNotes: string;
};

export type LeadAllergyDraft = {
  id: string;
  label: string;
  reaction: string;
  severity: string;
  note: string;
};

export type LeadCaveDraft = { id: string; label: string; note: string };

type Tx = (ru: string, de: string) => string;

type LeadMedicalIntakeFormProps = {
  lead: LeadDetail;
  tx: Tx;
  anamneseId: string;
  anamnese: string;
  diagnoses: LeadDiagnosisDraft[];
  medications: LeadMedicationDraft[];
  allergies: LeadAllergyDraft[];
  caves: LeadCaveDraft[];
  doctors: DoctorOption[];
  validationAttempted: boolean;
  onAnamneseChange: (value: string) => void;
  onDiagnosesChange: (value: LeadDiagnosisDraft[]) => void;
  onMedicationsChange: (value: LeadMedicationDraft[]) => void;
  onAllergiesChange: (value: LeadAllergyDraft[]) => void;
  onCavesChange: (value: LeadCaveDraft[]) => void;
};

function clinicalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function yesNoValue(value: boolean | null | undefined, tx: Tx) {
  if (value == null) return tx("Не указано", "Nicht angegeben");
  return value ? tx("Да", "Ja") : tx("Нет", "Nein");
}

function optionValue(value: string | null, tx: Tx) {
  if (!value) return tx("Не указано", "Nicht angegeben");
  const labels: Record<string, [string, string]> = {
    yes: ["Да", "Ja"],
    no: ["Нет", "Nein"],
    unknown: ["Неизвестно", "Unbekannt"],
    not_sure: ["Не уверен", "Nicht sicher"],
  };
  const label = labels[value.trim().toLowerCase()];
  return label ? tx(label[0], label[1]) : value;
}

function doctorLabel(doctor: DoctorOption) {
  return [doctor.title, doctor.name, doctor.provider_name].filter(Boolean).join(" · ");
}

const inputClass = "h-10 rounded-xl bg-white";

export function LeadMedicalIntakeForm({
  lead,
  tx,
  anamneseId,
  anamnese,
  diagnoses,
  medications,
  allergies,
  caves,
  doctors,
  validationAttempted,
  onAnamneseChange,
  onDiagnosesChange,
  onMedicationsChange,
  onAllergiesChange,
  onCavesChange,
}: LeadMedicalIntakeFormProps) {
  const itemsLabel = tx("записей", "Einträge");
  const addLabel = tx("Добавить", "Hinzufügen");
  const emptyTitle = tx("Записей пока нет", "Noch keine Einträge");
  const emptyText = tx("Добавьте данные при необходимости.", "Fügen Sie bei Bedarf Daten hinzu.");
  const requiredError = validationAttempted && !anamnese.trim()
    ? tx("Обязательное поле", "Pflichtfeld")
    : "";

  return (
    <section className="space-y-4">
      {leadIntakeTypeFromLead(lead) === "questionnaire" ? (
        <LeadQuestionnaireFacts
          items={[
            { label: tx("Сейчас проходит лечение", "Derzeit in Behandlung"), value: yesNoValue(lead.currently_in_treatment, tx) },
            { label: tx("Риск для поездки", "Gesundheitsrisiko für die Reise"), value: yesNoValue(lead.has_health_risk_for_travel, tx) },
            { label: tx("Есть медицинские документы", "Medizinische Unterlagen vorhanden"), value: optionValue(lead.has_medical_records, tx) },
            { label: tx("Документы на принятом языке", "Unterlagen in akzeptierter Sprache"), value: yesNoValue(lead.records_in_accepted_language, tx) },
            { label: tx("Есть страховка", "Krankenversicherung vorhanden"), value: yesNoValue(lead.has_insurance, tx) },
            { label: tx("Страховка покрывает лечение в Германии", "Versicherungsschutz in Deutschland"), value: optionValue(lead.insurance_covers_germany, tx) },
          ]}
        />
      ) : null}

      <CaseClinicalEditorSection
        title={tx("Анамнез", "Anamnese")}
        count={anamnese.trim() ? 1 : 0}
        itemsLabel={itemsLabel}
        emptyTitle={emptyTitle}
        emptyText={emptyText}
        autosave
      >
        <CaseClinicalField required label={tx("Текущий анамнез", "Aktuelle Anamnese")} error={requiredError}>
          <textarea
            id={anamneseId}
            className={cn(textareaClass, "min-h-32 rounded-xl bg-white", requiredError && "border-destructive")}
            aria-invalid={Boolean(requiredError)}
            value={anamnese}
            onChange={(event) => onAnamneseChange(event.target.value)}
          />
        </CaseClinicalField>
      </CaseClinicalEditorSection>

      <CaseClinicalEditorSection
        title={tx("Диагнозы", "Diagnosen")}
        count={diagnoses.filter((item) => item.label.trim()).length}
        itemsLabel={itemsLabel}
        addLabel={addLabel}
        emptyTitle={emptyTitle}
        emptyText={emptyText}
        autosave
        onAdd={() => onDiagnosesChange([
          ...diagnoses,
          {
            id: clinicalId("diagnosis"),
            label: "",
            diagnosedOn: "",
            note: "",
            kind: diagnoses.some((item) => item.kind === "main") ? "secondary" : "main",
            icdCode: "",
            certainty: "bestaetigt",
            chronification: "",
          },
        ])}
      >
        {diagnoses.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <CaseClinicalField required label={tx("Диагноз", "Diagnose")}>
                <Input className={inputClass} value={item.label} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row))} />
              </CaseClinicalField>
              <CaseClinicalField label={tx("Тип", "Typ")}>
                <NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.kind} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, kind: event.target.value as LeadDiagnosisDraft["kind"] } : row))}>
                  <option value="main">{tx("Основной", "Hauptdiagnose")}</option>
                  <option value="secondary">{tx("Сопутствующий", "Nebendiagnose")}</option>
                </NativeComboboxSelect>
              </CaseClinicalField>
              <CaseClinicalField label="ICD-10">
                <Input className={inputClass} value={item.icdCode} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, icdCode: event.target.value } : row))} />
              </CaseClinicalField>
              <CaseClinicalField label={tx("Дата постановки", "Erstdiagnose")}>
                <Input className={inputClass} type="date" value={item.diagnosedOn} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, diagnosedOn: event.target.value } : row))} />
              </CaseClinicalField>
              <CaseClinicalField label={tx("Достоверность", "Diagnosesicherheit")}>
                <NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.certainty} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, certainty: event.target.value as LeadDiagnosisDraft["certainty"] } : row))}>
                  <option value="">—</option>
                  <option value="verdacht">{tx("Подозрение", "Verdacht")}</option>
                  <option value="bestaetigt">{tx("Подтверждён", "Bestätigt")}</option>
                  <option value="zustand_nach">{tx("Состояние после", "Zustand nach")}</option>
                </NativeComboboxSelect>
              </CaseClinicalField>
              <CaseClinicalField label={tx("Течение", "Verlauf")}>
                <NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.chronification} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, chronification: event.target.value as LeadDiagnosisDraft["chronification"] } : row))}>
                  <option value="">—</option>
                  <option value="akut">{tx("Острое", "Akut")}</option>
                  <option value="chronisch">{tx("Хроническое", "Chronisch")}</option>
                  <option value="rezidivierend">{tx("Рецидивирующее", "Rezidivierend")}</option>
                </NativeComboboxSelect>
              </CaseClinicalField>
              <div className="md:col-span-2">
                <CaseClinicalField label={tx("Примечание", "Notiz")}>
                  <Input className={inputClass} value={item.note} onChange={(event) => onDiagnosesChange(diagnoses.map((row) => row.id === item.id ? { ...row, note: event.target.value } : row))} />
                </CaseClinicalField>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" size="sm" className="rounded-lg text-destructive" onClick={() => onDiagnosesChange(diagnoses.filter((row) => row.id !== item.id))}>
                <Trash2 className="size-3.5" />{tx("Удалить", "Entfernen")}
              </Button>
            </div>
          </div>
        ))}
      </CaseClinicalEditorSection>

      <CaseClinicalEditorSection
        title={tx("Медикаменты", "Medikation")}
        count={medications.filter((item) => item.name.trim()).length}
        itemsLabel={itemsLabel}
        addLabel={addLabel}
        emptyTitle={emptyTitle}
        emptyText={emptyText}
        autosave
        onAdd={() => onMedicationsChange([
          ...medications,
          {
            id: clinicalId("medication"), name: "", activeIngredient: "", dose: "", schedule: "",
            form: "", route: "", doseUnit: "", unit: "", note: "", reason: "", since: "",
            prescriberId: "", prescriber: "", medicationType: "permanent", expiryDate: "",
            category: "dauer", status: "aktiv", doseMorning: "", doseNoon: "", doseEvening: "",
            doseNight: "", prescribedOn: "", pharmacyOnly: false, prescriptionOnly: false,
            btm: false, autIdemBlocked: false, dispensingRestricted: false, otherNotes: "",
          },
        ])}
      >
        {medications.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <CaseClinicalField required label={tx("Торговое название", "Handelsname")}><Input className={inputClass} value={item.name} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Действующее вещество", "Wirkstoff")}><Input className={inputClass} value={item.activeIngredient} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, activeIngredient: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Категория", "Kategorie")}><NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.category} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, category: event.target.value as LeadMedicationDraft["category"], medicationType: event.target.value === "dauer" ? "permanent" : "temporary" } : row))}><option value="dauer">{tx("Постоянная", "Dauermedikation")}</option><option value="besondere">{tx("По особым показаниям", "Zu besonderen Zeiten")}</option><option value="selbst">{tx("Самолечение", "Selbstmedikation")}</option></NativeComboboxSelect></CaseClinicalField>
              <CaseClinicalField label={tx("Статус", "Status")}><NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.status} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, status: event.target.value as LeadMedicationDraft["status"] } : row))}><option value="aktiv">{tx("Активный", "Aktiv")}</option><option value="pausiert">{tx("Приостановлен", "Pausiert")}</option><option value="abgesetzt">{tx("Отменён", "Abgesetzt")}</option><option value="geplant">{tx("Запланирован", "Geplant")}</option></NativeComboboxSelect></CaseClinicalField>
              <CaseClinicalField label={tx("Форма выпуска", "Darreichungsform")}><NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.form} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, form: event.target.value } : row))}><option value="">—</option>{DARREICHUNGSFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeComboboxSelect></CaseClinicalField>
              <CaseClinicalField label={tx("Способ применения", "Einnahmeform")}><NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.route} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, route: event.target.value } : row))}><option value="">—</option>{EINNAHMEFORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeComboboxSelect></CaseClinicalField>
              <CaseClinicalField label={tx("Дозировка", "Dosis")}><Input className={inputClass} value={item.dose} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, dose: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Единица дозировки", "Dosiseinheit")}><Input className={inputClass} value={item.doseUnit} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, doseUnit: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Схема приёма", "Einnahmeschema")}><Input className={inputClass} value={item.schedule} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, schedule: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Утро", "Morgens")}><Input className={inputClass} value={item.doseMorning} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, doseMorning: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("День", "Mittags")}><Input className={inputClass} value={item.doseNoon} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, doseNoon: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Вечер", "Abends")}><Input className={inputClass} value={item.doseEvening} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, doseEvening: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("На ночь", "Zur Nacht")}><Input className={inputClass} value={item.doseNight} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, doseNight: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Единица выдачи", "Einheit")}><Input className={inputClass} value={item.unit} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, unit: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Принимает с", "Seit")}><Input className={inputClass} value={item.since} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, since: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Назначен", "Verordnet am")}><Input className={inputClass} type="date" value={item.prescribedOn} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, prescribedOn: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Действителен до", "Gültig bis")}><Input className={inputClass} type="date" value={item.expiryDate} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, expiryDate: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Причина назначения", "Grund")}><Input className={inputClass} value={item.reason} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, reason: event.target.value } : row))} /></CaseClinicalField>
              <CaseClinicalField label={tx("Врач из реестра", "Arzt aus dem Verzeichnis")}><NativeComboboxSelect className={cn(selectClass, inputClass)} value={item.prescriberId} onChange={(event) => { const doctor = doctors.find((candidate) => candidate.id === event.target.value); onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, prescriberId: event.target.value, prescriber: doctor ? doctorLabel(doctor) : row.prescriber } : row)); }}><option value="">—</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctorLabel(doctor)}</option>)}</NativeComboboxSelect></CaseClinicalField>
              <CaseClinicalField label={tx("Врач (вручную)", "Arzt (manuell)")}><Input className={inputClass} value={item.prescriber} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, prescriber: event.target.value } : row))} /></CaseClinicalField>
              <div className="md:col-span-2"><CaseClinicalField label={tx("Примечание", "Anmerkung")}><Input className={inputClass} value={item.note} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, note: event.target.value } : row))} /></CaseClinicalField></div>
              <div className="md:col-span-2"><CaseClinicalField label={tx("Другие отметки", "Sonstige Vermerke")}><Input className={inputClass} value={item.otherNotes} onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, otherNotes: event.target.value } : row))} /></CaseClinicalField></div>
            </div>
            <div className="mt-4 grid gap-2 border-y border-border/70 py-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["pharmacyOnly", tx("Только в аптеке", "Apothekenpflichtig")],
                ["prescriptionOnly", tx("По рецепту", "Rezeptpflichtig")],
                ["btm", tx("Наркотическое средство", "Betäubungsmittel")],
                ["autIdemBlocked", "Aut-idem-Sperre"],
                ["dispensingRestricted", tx("Ограничение выдачи", "Abgabebeschränkung")],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={Boolean(item[key as keyof LeadMedicationDraft])}
                    onChange={(event) => onMedicationsChange(medications.map((row) => row.id === item.id ? { ...row, [key]: event.target.checked } : row))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg text-destructive" onClick={() => onMedicationsChange(medications.filter((row) => row.id !== item.id))}><Trash2 className="size-3.5" />{tx("Удалить", "Entfernen")}</Button></div>
          </div>
        ))}
      </CaseClinicalEditorSection>

      <CaseClinicalEditorSection title={tx("Аллергии", "Allergien")} count={allergies.filter((item) => item.label.trim()).length} itemsLabel={itemsLabel} addLabel={addLabel} emptyTitle={emptyTitle} emptyText={emptyText} autosave tone="warning" onAdd={() => onAllergiesChange([...allergies, { id: clinicalId("allergy"), label: "", reaction: "", severity: "", note: "" }])}>
        {allergies.map((item) => <div key={item.id} className="rounded-xl border border-orange-200 bg-white/80 p-4"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><CaseClinicalField required label={tx("Аллерген", "Allergen")}><Input className={inputClass} value={item.label} onChange={(event) => onAllergiesChange(allergies.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row))} /></CaseClinicalField><CaseClinicalField label={tx("Реакция", "Reaktion")}><Input className={inputClass} value={item.reaction} onChange={(event) => onAllergiesChange(allergies.map((row) => row.id === item.id ? { ...row, reaction: event.target.value } : row))} /></CaseClinicalField><CaseClinicalField label={tx("Тяжесть", "Schweregrad")}><Input className={inputClass} value={item.severity} onChange={(event) => onAllergiesChange(allergies.map((row) => row.id === item.id ? { ...row, severity: event.target.value } : row))} /></CaseClinicalField><CaseClinicalField label={tx("Примечание", "Notiz")}><Input className={inputClass} value={item.note} onChange={(event) => onAllergiesChange(allergies.map((row) => row.id === item.id ? { ...row, note: event.target.value } : row))} /></CaseClinicalField></div><div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg text-destructive" onClick={() => onAllergiesChange(allergies.filter((row) => row.id !== item.id))}><Trash2 className="size-3.5" />{tx("Удалить", "Entfernen")}</Button></div></div>)}
      </CaseClinicalEditorSection>

      <CaseClinicalEditorSection title="CAVE" count={caves.filter((item) => item.label.trim()).length} itemsLabel={itemsLabel} addLabel={addLabel} emptyTitle={emptyTitle} emptyText={emptyText} autosave tone="danger" onAdd={() => onCavesChange([...caves, { id: clinicalId("cave"), label: "", note: "" }])}>
        {caves.map((item) => <div key={item.id} className="rounded-xl border border-rose-200 bg-white/80 p-4"><div className="grid gap-4 md:grid-cols-2"><CaseClinicalField required label="CAVE"><Input className={inputClass} value={item.label} onChange={(event) => onCavesChange(caves.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row))} /></CaseClinicalField><CaseClinicalField label={tx("Примечание", "Notiz")}><Input className={inputClass} value={item.note} onChange={(event) => onCavesChange(caves.map((row) => row.id === item.id ? { ...row, note: event.target.value } : row))} /></CaseClinicalField></div><div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg text-destructive" onClick={() => onCavesChange(caves.filter((row) => row.id !== item.id))}><Trash2 className="size-3.5" />{tx("Удалить", "Entfernen")}</Button></div></div>)}
      </CaseClinicalEditorSection>
    </section>
  );
}
