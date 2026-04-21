import { useLang } from "@/lib/i18n";

import { type GastroenterologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      title={tri(lang, "Gastroenterologie", "Гастроэнтерология", "Gastroenterology")}
      description={tri(
        lang,
        "Gastrointestinale Beschwerden und Vorgeschichte.",
        "Желудочно-кишечные жалобы и анамнез.",
        "Gastrointestinal complaints and history.",
      )}
      blankValue={BLANK}
      rawValue={detail?.gastroenterology}
      busy={sectionBusy === "gastroenterology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveGastroenterology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "abdominal_pain", labels: { de: "Bauchschmerz", ru: "Боль в животе", en: "Abdominal pain" } },
        { key: "reflux", labels: { de: "Reflux", ru: "Рефлюкс", en: "Reflux" } },
        { key: "nausea", labels: { de: "Übelkeit", ru: "Тошнота", en: "Nausea" } },
        { key: "diarrhea", labels: { de: "Diarrhoe", ru: "Диарея", en: "Diarrhea" } },
        { key: "constipation", labels: { de: "Obstipation", ru: "Запор", en: "Constipation" } },
        { key: "gi_bleeding", labels: { de: "GI-Blutung", ru: "ЖК-кровотечение", en: "GI bleeding" } },
      ]}
      textFields={[
        {
          key: "prior_endoscopy",
          labels: {
            de: "Vorherige Endoskopie / Koloskopie",
            ru: "Предыдущая эндоскопия / колоноскопия",
            en: "Prior endoscopy / colonoscopy",
          },
        },
        {
          key: "bowel_habits",
          labels: {
            de: "Veränderungen der Stuhlgewohnheiten",
            ru: "Изменения стула",
            en: "Bowel habit changes",
          },
        },
        {
          key: "liver_history",
          labels: {
            de: "Leber- / hepatobiliäre Vorgeschichte",
            ru: "Печёночно-билиарный анамнез",
            en: "Liver / hepatobiliary history",
          },
        },
        {
          key: "food_intolerance",
          labels: {
            de: "Nahrungsmittelunverträglichkeiten / Auslöser",
            ru: "Пищевая непереносимость / триггеры",
            en: "Food intolerance / triggers",
          },
        },
        { key: "red_flags", labels: { de: "Warnzeichen", ru: "Красные флаги", en: "Red flags" } },
        {
          key: "notes",
          labels: {
            de: "Gastroenterologische Notizen",
            ru: "Гастроэнтерологические заметки",
            en: "Gastroenterology notes",
          },
          rows: 4,
        },
      ]}
    />
  );
}
