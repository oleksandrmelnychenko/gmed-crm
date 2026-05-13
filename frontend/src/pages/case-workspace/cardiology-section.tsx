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
        { key: "chest_pain", labels: { de: t.cases_specialty_chest_pain, ru: t.cases_specialty_chest_pain, en: t.cases_specialty_chest_pain } },
        { key: "dyspnea", labels: { de: t.cases_specialty_dyspnea, ru: t.cases_specialty_dyspnea, en: t.cases_specialty_dyspnea } },
        { key: "palpitations", labels: { de: t.cases_specialty_palpitations, ru: t.cases_specialty_palpitations, en: t.cases_specialty_palpitations } },
        { key: "syncope", labels: { de: t.cases_specialty_syncope, ru: t.cases_specialty_syncope, en: t.cases_specialty_syncope } },
        { key: "edema", labels: { de: t.cases_specialty_edema, ru: t.cases_specialty_edema, en: t.cases_specialty_edema } },
      ]}
      textFields={[
        {
          key: "known_diagnosis",
          labels: { de: t.cases_specialty_known_diagnosis, ru: t.cases_specialty_known_diagnosis, en: t.cases_specialty_known_diagnosis },
        },
        {
          key: "prior_cardiac_workup",
          labels: {
            de: t.cases_specialty_prior_cardiac_workup,
            ru: t.cases_specialty_prior_cardiac_workup,
            en: t.cases_specialty_prior_cardiac_workup,
          },
        },
        {
          key: "cardiovascular_risk_factors",
          labels: {
            de: t.cases_specialty_cv_risk_factors,
            ru: t.cases_specialty_cv_risk_factors,
            en: t.cases_specialty_cv_risk_factors,
          },
        },
        {
          key: "anticoagulation",
          labels: { de: t.cases_specialty_anticoagulation, ru: t.cases_specialty_anticoagulation, en: t.cases_specialty_anticoagulation },
        },
        {
          key: "family_history",
          labels: { de: t.cases_specialty_family_history, ru: t.cases_specialty_family_history, en: t.cases_specialty_family_history },
        },
        { key: "red_flags", labels: { de: t.cases_specialty_red_flags, ru: t.cases_specialty_red_flags, en: t.cases_specialty_red_flags } },
        {
          key: "notes",
          labels: { de: t.cases_specialty_cardiology_notes, ru: t.cases_specialty_cardiology_notes, en: t.cases_specialty_cardiology_notes },
          rows: 4,
        },
      ]}
    />
  );
}
