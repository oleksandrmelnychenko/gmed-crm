import { useLang } from "@/lib/i18n";

import { type OrthopedicsAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      title={tri(lang, "Orthopädie", "Ортопедия", "Orthopedics")}
      description={tri(
        lang,
        "Bewegungsapparat, Vorgeschichte und Funktionseinschränkungen.",
        "Опорно-двигательный аппарат, анамнез и ограничения.",
        "Musculoskeletal history and functional limitations.",
      )}
      blankValue={BLANK}
      rawValue={detail?.orthopedics}
      busy={sectionBusy === "orthopedics"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveOrthopedics}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "joint_pain", labels: { de: "Gelenkschmerz", ru: "Боль в суставах", en: "Joint pain" } },
        { key: "back_pain", labels: { de: "Rückenschmerz", ru: "Боль в спине", en: "Back pain" } },
        {
          key: "mobility_limitation",
          labels: { de: "Bewegungseinschränkung", ru: "Ограничение движений", en: "Mobility limitation" },
        },
        {
          key: "trauma_history",
          labels: { de: "Traumaanamnese", ru: "Травматический анамнез", en: "Trauma history" },
        },
      ]}
      textFields={[
        {
          key: "prior_imaging",
          labels: { de: "Vorherige Bildgebung", ru: "Предыдущая визуализация", en: "Prior imaging" },
        },
        {
          key: "assistive_devices",
          labels: {
            de: "Hilfsmittel / Implantate",
            ru: "Средства поддержки / импланты",
            en: "Assistive devices / implants",
          },
        },
        {
          key: "physiotherapy_history",
          labels: {
            de: "Physiotherapie- / Reha-Vorgeschichte",
            ru: "Физиотерапия / реабилитация в анамнезе",
            en: "Physiotherapy / rehab history",
          },
        },
        {
          key: "pain_triggers",
          labels: {
            de: "Schmerzauslöser / Belastungsmuster",
            ru: "Триггеры боли / характер нагрузки",
            en: "Pain triggers / load pattern",
          },
        },
        { key: "red_flags", labels: { de: "Warnzeichen", ru: "Красные флаги", en: "Red flags" } },
        {
          key: "notes",
          labels: { de: "Orthopädische Notizen", ru: "Ортопедические заметки", en: "Orthopedics notes" },
          rows: 4,
        },
      ]}
    />
  );
}
