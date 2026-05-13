import { useLang } from "@/lib/i18n";

import { type CardiologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

const BLANK: CardiologyAssessment = {
  is_relevant: false,
  chest_pain: false,
  dyspnea: false,
  palpitations: false,
  syncope: false,
  edema: false,
  known_diagnosis: "",
  prior_cardiac_workup: "",
  cardiovascular_risk_factors: "",
  anticoagulation: "",
  family_history: "",
  red_flags: "",
  notes: "",
};

export function CardiologySection() {
  const { t } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveCardiology,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<CardiologyAssessment>
      title={t.cases_clinical_section_cardiology}
      description={t.cases_specialty_cardiology_description}
      blankValue={BLANK}
      rawValue={detail?.cardiology}
      busy={sectionBusy === "cardiology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveCardiology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "chest_pain", label: t.cases_specialty_chest_pain },
        { key: "dyspnea", label: t.cases_specialty_dyspnea },
        { key: "palpitations", label: t.cases_specialty_palpitations },
        { key: "syncope", label: t.cases_specialty_syncope },
        { key: "edema", label: t.cases_specialty_edema },
      ]}
      textFields={[
        {
          key: "known_diagnosis",
          label: t.cases_specialty_known_diagnosis,
        },
        {
          key: "prior_cardiac_workup",
          label: t.cases_specialty_prior_cardiac_workup,
        },
        {
          key: "cardiovascular_risk_factors",
          label: t.cases_specialty_cv_risk_factors,
        },
        {
          key: "anticoagulation",
          label: t.cases_specialty_anticoagulation,
        },
        {
          key: "family_history",
          label: t.cases_specialty_family_history,
        },
        { key: "red_flags", label: t.cases_specialty_red_flags },
        {
          key: "notes",
          label: t.cases_specialty_cardiology_notes,
          rows: 4,
        },
      ]}
    />
  );
}
