import type { LeadDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { leadIntakeTypeFromLead } from "@/pages/leads/model/leads-model";
import { LeadQuestionnaireFacts } from "@/pages/leads/ui/lead-questionnaire-facts";
import type {
  AllDoctorOption,
  ClinicalDiagnosis,
  ClinicalMedication,
  ClinicalNarrative,
  ClinicalWarning,
} from "@/pages/patients/data/patient-clinical";
import { AnamneseSection } from "@/pages/patients/ui/sections/anamnese-section";
import { DiagnosisTreeSection } from "@/pages/patients/ui/sections/diagnosis-tree";
import {
  PatientClinicalWarningSection,
  PatientMedicationSection,
} from "@/pages/patients/ui/sections/patient-clinical-entry-sections";
import type { ProviderSummary } from "@/pages/providers/model/types";

type Tx = (ru: string, de: string) => string;

type LeadMedicalIntakeFormProps = {
  lead: LeadDetail;
  tx: Tx;
  lang: string;
  anamneseId: string;
  narrative: ClinicalNarrative | null;
  diagnoses: ClinicalDiagnosis[];
  medications: ClinicalMedication[];
  allergies: ClinicalWarning[];
  caves: ClinicalWarning[];
  providers: ProviderSummary[];
  allDoctors: AllDoctorOption[];
  validationAttempted: boolean;
  onNarrativeChange: (value: ClinicalNarrative) => void;
  onDiagnosesChange: (value: ClinicalDiagnosis[]) => void;
  onMedicationsChange: (value: ClinicalMedication[]) => void;
  onAllergiesChange: (value: ClinicalWarning[]) => void;
  onCavesChange: (value: ClinicalWarning[]) => void;
};

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

export function LeadMedicalIntakeForm({
  lead,
  tx,
  lang,
  anamneseId,
  narrative,
  diagnoses,
  medications,
  allergies,
  caves,
  providers,
  allDoctors,
  validationAttempted,
  onNarrativeChange,
  onDiagnosesChange,
  onMedicationsChange,
  onAllergiesChange,
  onCavesChange,
}: LeadMedicalIntakeFormProps) {
  const missingAnamnese = validationAttempted && !narrative?.anamnese_aktuelle?.trim();

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

      <PatientClinicalWarningSection
        kind="allergie"
        items={allergies}
        canManage
        lang={lang}
        onSave={async (next) => {
          onAllergiesChange(next);
          return next;
        }}
      />
      <PatientClinicalWarningSection
        kind="cave"
        items={caves}
        canManage
        lang={lang}
        onSave={async (next) => {
          onCavesChange(next);
          return next;
        }}
      />
      <DiagnosisTreeSection
        items={diagnoses}
        providers={providers}
        allDoctors={allDoctors}
        canManage
        lang={lang}
        onSave={async (next) => {
          onDiagnosesChange(next);
          return next;
        }}
      />
      <div
        id={anamneseId}
        tabIndex={-1}
        className={cn("rounded-xl outline-none", missingAnamnese && "ring-1 ring-destructive")}
      >
        <AnamneseSection
          active={narrative}
          canManage
          lang={lang}
          requireCurrent
          onSave={async (next) => {
            onNarrativeChange(next);
            return next;
          }}
          loadHistory={async () => (narrative ? [narrative] : [])}
        />
        {missingAnamnese ? (
          <p role="alert" className="px-3 pb-3 text-xs text-destructive">
            {tx("Заполните актуальный анамнез", "Aktuelle Anamnese ausfüllen")}
          </p>
        ) : null}
      </div>
      <PatientMedicationSection
        items={medications}
        providers={providers}
        canManage
        lang={lang}
        onSave={async (next) => {
          onMedicationsChange(next);
          return next;
        }}
      />
    </section>
  );
}
