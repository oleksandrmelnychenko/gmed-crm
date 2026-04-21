import { useLang } from "@/lib/i18n";

import { type PulmonologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      title={tri(lang, "Pulmonologie", "Пульмонология", "Pulmonology")}
      description={tri(
        lang,
        "Atemwegsbeschwerden, Raucheranamnese und Therapien.",
        "Жалобы на дыхание, курительный анамнез и терапия.",
        "Respiratory complaints, smoking history, and therapies.",
      )}
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
          labels: { de: "Chronischer Husten", ru: "Хронический кашель", en: "Chronic cough" },
        },
        { key: "dyspnea", labels: { de: "Dyspnoe", ru: "Одышка", en: "Dyspnea" } },
        { key: "wheezing", labels: { de: "Pfeifen", ru: "Свистящее дыхание", en: "Wheezing" } },
        {
          key: "chest_tightness",
          labels: { de: "Thoraxenge", ru: "Стеснение в груди", en: "Chest tightness" },
        },
        { key: "hemoptysis", labels: { de: "Hämoptysen", ru: "Кровохарканье", en: "Hemoptysis" } },
      ]}
      textFields={[
        {
          key: "smoking_history",
          labels: {
            de: "Raucheranamnese / Pack Years",
            ru: "Курительный анамнез / пачка-лет",
            en: "Smoking history / pack years",
          },
        },
        {
          key: "prior_chest_imaging",
          labels: {
            de: "Vorherige Thoraxbildgebung",
            ru: "Предыдущая визуализация грудной клетки",
            en: "Prior chest imaging",
          },
        },
        {
          key: "inhaler_therapy",
          labels: {
            de: "Inhalation / Atemtherapie",
            ru: "Ингаляторы / респираторная терапия",
            en: "Inhaler / respiratory therapy",
          },
        },
        {
          key: "sleep_apnea_history",
          labels: { de: "Schlafapnoe-Anamnese", ru: "Апноэ сна в анамнезе", en: "Sleep apnea history" },
        },
        { key: "red_flags", labels: { de: "Warnzeichen", ru: "Красные флаги", en: "Red flags" } },
        {
          key: "notes",
          labels: { de: "Pulmonologische Notizen", ru: "Пульмонологические заметки", en: "Pulmonology notes" },
          rows: 4,
        },
      ]}
    />
  );
}
