import { t as translateCatalog, useLang } from "@/lib/i18n";

import { type OrthopedicsAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

const BLANK: OrthopedicsAssessment = {
  is_relevant: false,
  joint_pain: false,
  back_pain: false,
  mobility_limitation: false,
  trauma_history: false,
  prior_imaging: "",
  assistive_devices: "",
  physiotherapy_history: "",
  pain_triggers: "",
  red_flags: "",
  notes: "",
};

export function OrthopedicsSection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveOrthopedics,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<OrthopedicsAssessment>
      title={tri(lang, "case_ws_orthopedics")}
      description={tri(lang, "case_ws_musculoskeletal_history_and_functional_limitations")}
      blankValue={BLANK}
      rawValue={detail?.orthopedics}
      busy={sectionBusy === "orthopedics"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveOrthopedics}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "joint_pain", label: tri(lang, "case_ws_joint_pain") },
        { key: "back_pain", label: tri(lang, "case_ws_back_pain") },
        {
          key: "mobility_limitation",
          label: tri(lang, "case_ws_mobility_limitation"),
        },
        {
          key: "trauma_history",
          label: tri(lang, "case_ws_trauma_history"),
        },
      ]}
      textFields={[
        {
          key: "prior_imaging",
          label: tri(lang, "case_ws_prior_imaging"),
        },
        {
          key: "assistive_devices",
          label: tri(lang, "case_ws_assistive_devices_implants"),
        },
        {
          key: "physiotherapy_history",
          label: tri(lang, "case_ws_physiotherapy_rehab_history"),
        },
        {
          key: "pain_triggers",
          label: tri(lang, "case_ws_pain_triggers_load_pattern"),
        },
        { key: "red_flags", label: tri(lang, "case_ws_red_flags_3") },
        {
          key: "notes",
          label: tri(lang, "case_ws_orthopedics_notes"),
          rows: 4,
        },
      ]}
    />
  );
}
