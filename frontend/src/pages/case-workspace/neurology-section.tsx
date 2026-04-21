import { useLang } from "@/lib/i18n";

import { type NeurologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      title={tri(lang, "Neurologie", "Неврология", "Neurology")}
      description={tri(
        lang,
        "Neurologische Leitsymptome und Diagnostik-Historie.",
        "Неврологические симптомы и история диагностики.",
        "Neurological signs and diagnostic history.",
      )}
      blankValue={BLANK}
      rawValue={detail?.neurology}
      busy={sectionBusy === "neurology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveNeurology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "headache", labels: { de: "Kopfschmerz", ru: "Головная боль", en: "Headache" } },
        { key: "dizziness", labels: { de: "Schwindel", ru: "Головокружение", en: "Dizziness" } },
        {
          key: "sensory_changes",
          labels: {
            de: "Sensibilitätsstörung",
            ru: "Нарушения чувствительности",
            en: "Sensory changes",
          },
        },
        { key: "weakness", labels: { de: "Kraftminderung", ru: "Слабость", en: "Weakness" } },
        {
          key: "seizure_history",
          labels: { de: "Anfälle in der Anamnese", ru: "Приступы в анамнезе", en: "Seizure history" },
        },
        {
          key: "gait_balance_issues",
          labels: {
            de: "Gang- / Gleichgewichtsstörung",
            ru: "Нарушения походки / равновесия",
            en: "Gait / balance issues",
          },
        },
      ]}
      textFields={[
        {
          key: "prior_neuro_imaging",
          labels: {
            de: "Vorherige neuroradiologische Bildgebung",
            ru: "Предыдущая нейровизуализация",
            en: "Prior neuro imaging",
          },
        },
        {
          key: "prior_neurology_workup",
          labels: {
            de: "Frühere neurologische Diagnostik",
            ru: "Предыдущее неврологическое обследование",
            en: "Prior neurology workup",
          },
        },
        {
          key: "cognitive_changes",
          labels: {
            de: "Kognitive / sprachliche Veränderungen",
            ru: "Когнитивные / речевые изменения",
            en: "Cognitive / speech changes",
          },
        },
        { key: "red_flags", labels: { de: "Warnzeichen", ru: "Красные флаги", en: "Red flags" } },
        {
          key: "notes",
          labels: { de: "Neurologische Notizen", ru: "Неврологические заметки", en: "Neurology notes" },
          rows: 4,
        },
      ]}
    />
  );
}
