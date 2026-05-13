import { t as translateCatalog, useLang } from "@/lib/i18n";

import { type NeurologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

const BLANK: NeurologyAssessment = {
  is_relevant: false,
  headache: false,
  dizziness: false,
  sensory_changes: false,
  weakness: false,
  seizure_history: false,
  gait_balance_issues: false,
  prior_neuro_imaging: "",
  prior_neurology_workup: "",
  cognitive_changes: "",
  red_flags: "",
  notes: "",
};

export function NeurologySection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveNeurology,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<NeurologyAssessment>
      title={tri(lang, "case_ws_neurology")}
      description={tri(lang, "case_ws_neurological_signs_and_diagnostic_history")}
      blankValue={BLANK}
      rawValue={detail?.neurology}
      busy={sectionBusy === "neurology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveNeurology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "headache", label: tri(lang, "case_ws_headache") },
        { key: "dizziness", label: tri(lang, "case_ws_dizziness") },
        {
          key: "sensory_changes",
          label: tri(lang, "case_ws_sensory_changes"),
        },
        { key: "weakness", label: tri(lang, "case_ws_weakness") },
        {
          key: "seizure_history",
          label: tri(lang, "case_ws_seizure_history"),
        },
        {
          key: "gait_balance_issues",
          label: tri(lang, "case_ws_gait_balance_issues"),
        },
      ]}
      textFields={[
        {
          key: "prior_neuro_imaging",
          label: tri(lang, "case_ws_prior_neuro_imaging"),
        },
        {
          key: "prior_neurology_workup",
          label: tri(lang, "case_ws_prior_neurology_workup"),
        },
        {
          key: "cognitive_changes",
          label: tri(lang, "case_ws_cognitive_speech_changes"),
        },
        { key: "red_flags", label: tri(lang, "case_ws_red_flags_2") },
        {
          key: "notes",
          label: tri(lang, "case_ws_neurology_notes"),
          rows: 4,
        },
      ]}
    />
  );
}
