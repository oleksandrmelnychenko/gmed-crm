import { t as translateCatalog, useLang } from "@/lib/i18n";

import { type UrologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

const BLANK: UrologyAssessment = {
  is_relevant: false,
  dysuria: false,
  hematuria: false,
  flank_pain: false,
  urinary_frequency: false,
  urinary_retention: false,
  incontinence: false,
  prior_urology_workup: "",
  catheter_history: "",
  stone_history: "",
  red_flags: "",
  notes: "",
};

export function UrologySection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveUrology,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<UrologyAssessment>
      title={tri(lang, "case_ws_urology")}
      description={tri(lang, "case_ws_urologic_signs_and_history")}
      blankValue={BLANK}
      rawValue={detail?.urology}
      busy={sectionBusy === "urology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveUrology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "dysuria", label: tri(lang, "case_ws_dysuria") },
        { key: "hematuria", label: tri(lang, "case_ws_hematuria") },
        { key: "flank_pain", label: tri(lang, "case_ws_flank_pain") },
        {
          key: "urinary_frequency",
          label: tri(lang, "case_ws_urinary_frequency"),
        },
        {
          key: "urinary_retention",
          label: tri(lang, "case_ws_urinary_retention"),
        },
        { key: "incontinence", label: tri(lang, "case_ws_incontinence") },
      ]}
      textFields={[
        {
          key: "prior_urology_workup",
          label: tri(lang, "case_ws_prior_urology_workup"),
        },
        {
          key: "catheter_history",
          label: tri(lang, "case_ws_catheter_intervention_history"),
        },
        {
          key: "stone_history",
          label: tri(lang, "case_ws_stone_disease_history"),
        },
        { key: "red_flags", label: tri(lang, "case_ws_red_flags_5") },
        {
          key: "notes",
          label: tri(lang, "case_ws_urology_notes"),
          rows: 4,
        },
      ]}
    />
  );
}
