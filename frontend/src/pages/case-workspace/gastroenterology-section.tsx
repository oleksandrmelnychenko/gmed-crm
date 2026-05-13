import { t as translateCatalog, useLang } from "@/lib/i18n";

import { type GastroenterologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

const BLANK: GastroenterologyAssessment = {
  is_relevant: false,
  abdominal_pain: false,
  reflux: false,
  nausea: false,
  diarrhea: false,
  constipation: false,
  gi_bleeding: false,
  prior_endoscopy: "",
  bowel_habits: "",
  liver_history: "",
  food_intolerance: "",
  red_flags: "",
  notes: "",
};

export function GastroenterologySection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveGastroenterology,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<GastroenterologyAssessment>
      title={tri(lang, "case_ws_gastroenterology")}
      description={tri(lang, "case_ws_gastrointestinal_complaints_and_history")}
      blankValue={BLANK}
      rawValue={detail?.gastroenterology}
      busy={sectionBusy === "gastroenterology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveGastroenterology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "abdominal_pain", label: tri(lang, "case_ws_abdominal_pain") },
        { key: "reflux", label: tri(lang, "case_ws_reflux") },
        { key: "nausea", label: tri(lang, "case_ws_nausea") },
        { key: "diarrhea", label: tri(lang, "case_ws_diarrhea") },
        { key: "constipation", label: tri(lang, "case_ws_constipation") },
        { key: "gi_bleeding", label: tri(lang, "case_ws_gi_bleeding") },
      ]}
      textFields={[
        {
          key: "prior_endoscopy",
          label: tri(lang, "case_ws_prior_endoscopy_colonoscopy"),
        },
        {
          key: "bowel_habits",
          label: tri(lang, "case_ws_bowel_habit_changes"),
        },
        {
          key: "liver_history",
          label: tri(lang, "case_ws_liver_hepatobiliary_history"),
        },
        {
          key: "food_intolerance",
          label: tri(lang, "case_ws_food_intolerance_triggers"),
        },
        { key: "red_flags", label: tri(lang, "case_ws_red_flags") },
        {
          key: "notes",
          label: tri(lang, "case_ws_gastroenterology_notes"),
          rows: 4,
        },
      ]}
    />
  );
}
