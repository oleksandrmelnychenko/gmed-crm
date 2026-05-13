import { t as translateCatalog, useLang } from "@/lib/i18n";

import { type PulmonologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

const BLANK: PulmonologyAssessment = {
  is_relevant: false,
  chronic_cough: false,
  dyspnea: false,
  wheezing: false,
  chest_tightness: false,
  hemoptysis: false,
  smoking_history: "",
  prior_chest_imaging: "",
  inhaler_therapy: "",
  sleep_apnea_history: "",
  red_flags: "",
  notes: "",
};

export function PulmonologySection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    savePulmonology,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<PulmonologyAssessment>
      title={tri(lang, "case_ws_pulmonology")}
      description={tri(lang, "case_ws_respiratory_complaints_smoking_history_and_therapies")}
      blankValue={BLANK}
      rawValue={detail?.pulmonology}
      busy={sectionBusy === "pulmonology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={savePulmonology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        {
          key: "chronic_cough",
          label: tri(lang, "case_ws_chronic_cough"),
        },
        { key: "dyspnea", label: tri(lang, "case_ws_dyspnea") },
        { key: "wheezing", label: tri(lang, "case_ws_wheezing") },
        {
          key: "chest_tightness",
          label: tri(lang, "case_ws_chest_tightness"),
        },
        { key: "hemoptysis", label: tri(lang, "case_ws_hemoptysis") },
      ]}
      textFields={[
        {
          key: "smoking_history",
          label: tri(lang, "case_ws_smoking_history_pack_years"),
        },
        {
          key: "prior_chest_imaging",
          label: tri(lang, "case_ws_prior_chest_imaging"),
        },
        {
          key: "inhaler_therapy",
          label: tri(lang, "case_ws_inhaler_respiratory_therapy"),
        },
        {
          key: "sleep_apnea_history",
          label: tri(lang, "case_ws_sleep_apnea_history"),
        },
        { key: "red_flags", label: tri(lang, "case_ws_red_flags_4") },
        {
          key: "notes",
          label: tri(lang, "case_ws_pulmonology_notes"),
          rows: 4,
        },
      ]}
    />
  );
}
