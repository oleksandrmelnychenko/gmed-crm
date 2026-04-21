import { useLang } from "@/lib/i18n";

import { type CardiologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

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
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveCardiology,
  } = useCaseWorkspace();

  return (
    <SpecialtySection<CardiologyAssessment>
      title={tri(lang, "Kardiologie", "Кардиология", "Cardiology")}
      description={tri(
        lang,
        "Kardiovaskuläre Anamnese und Leitsymptome.",
        "Сердечно-сосудистый анамнез и ключевые симптомы.",
        "Cardiovascular history and key signs.",
      )}
      blankValue={BLANK}
      rawValue={detail?.cardiology}
      busy={sectionBusy === "cardiology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveCardiology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "chest_pain", labels: { de: "Thoraxschmerz", ru: "Боль в груди", en: "Chest pain" } },
        { key: "dyspnea", labels: { de: "Dyspnoe", ru: "Одышка", en: "Dyspnea" } },
        { key: "palpitations", labels: { de: "Palpitationen", ru: "Сердцебиение", en: "Palpitations" } },
        { key: "syncope", labels: { de: "Synkopen", ru: "Синкопе", en: "Syncope" } },
        { key: "edema", labels: { de: "Ödeme", ru: "Отёки", en: "Edema" } },
      ]}
      textFields={[
        {
          key: "known_diagnosis",
          labels: { de: "Bekannte Diagnose", ru: "Известный диагноз", en: "Known diagnosis" },
        },
        {
          key: "prior_cardiac_workup",
          labels: {
            de: "Vorbefunde (EKG / Echo / Diagnostik)",
            ru: "Предыдущие ЭКГ / Эхо / обследования",
            en: "Prior ECG / echo / workup",
          },
        },
        {
          key: "cardiovascular_risk_factors",
          labels: {
            de: "Kardiovaskuläre Risikofaktoren",
            ru: "Сердечно-сосудистые факторы риска",
            en: "CV risk factors",
          },
        },
        {
          key: "anticoagulation",
          labels: { de: "Antikoagulation", ru: "Антикоагуляция", en: "Anticoagulation" },
        },
        {
          key: "family_history",
          labels: { de: "Familienanamnese", ru: "Семейный анамнез", en: "Family history" },
        },
        { key: "red_flags", labels: { de: "Warnzeichen", ru: "Красные флаги", en: "Red flags" } },
        {
          key: "notes",
          labels: { de: "Kardiologische Notizen", ru: "Кардиологические заметки", en: "Cardiology notes" },
          rows: 4,
        },
      ]}
    />
  );
}
