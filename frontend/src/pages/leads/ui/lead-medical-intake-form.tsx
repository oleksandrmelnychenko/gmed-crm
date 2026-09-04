import type { LeadDetail } from "@/lib/api/types";
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
import type {
  ProviderSummary,
  SpecializationItem,
} from "@/pages/providers/model/types";

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
  specializations: SpecializationItem[];
  onNarrativeChange: (value: ClinicalNarrative) => void | Promise<void>;
  onDiagnosesChange: (value: ClinicalDiagnosis[]) => void | Promise<void>;
  onMedicationsChange: (value: ClinicalMedication[]) => void | Promise<void>;
  onAllergiesChange: (value: ClinicalWarning[]) => void | Promise<void>;
  onCavesChange: (value: ClinicalWarning[]) => void | Promise<void>;
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
  specializations,
  onNarrativeChange,
  onDiagnosesChange,
  onMedicationsChange,
  onAllergiesChange,
  onCavesChange,
}: LeadMedicalIntakeFormProps) {
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
          await onAllergiesChange(next);
          return next;
        }}
      />
      <PatientClinicalWarningSection
        kind="cave"
        items={caves}
        canManage
        lang={lang}
        onSave={async (next) => {
          await onCavesChange(next);
          return next;
        }}
      />
      <DiagnosisTreeSection
        items={diagnoses}
        providers={providers}
        allDoctors={allDoctors}
        specializations={specializations}
        canManage
        lang={lang}
        onSave={async (next) => {
          await onDiagnosesChange(next);
          return next;
        }}
      />
      <div id={anamneseId} tabIndex={-1} className="rounded-xl outline-none">
        <AnamneseSection
          active={narrative}
          specializations={specializations}
          canManage
          lang={lang}
          requireCurrent
          onSave={async (next) => {
            await onNarrativeChange(next);
            return next;
          }}
          loadHistory={async () => (narrative ? [narrative] : [])}
        />
      </div>
      <PatientMedicationSection
        items={medications}
        providers={providers}
        canManage
        lang={lang}
        onSave={async (next) => {
          await onMedicationsChange(next);
          return next;
        }}
      />
    </section>
  );
}
