import { useLang } from "@/lib/i18n";

import { type UrologyAssessment, useCaseWorkspace } from "./context";
import { SpecialtySection } from "./specialty-section";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      title={tri(lang, "Urologie", "Урология", "Urology")}
      description={tri(
        lang,
        "Urologische Leitsymptome und Vorgeschichte.",
        "Урологические симптомы и анамнез.",
        "Urologic signs and history.",
      )}
      blankValue={BLANK}
      rawValue={detail?.urology}
      busy={sectionBusy === "urology"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      save={saveUrology}
      revisionKey={detail?.updated_at ?? detail?.id ?? ""}
      booleanFlags={[
        { key: "dysuria", labels: { de: "Dysurie", ru: "Дизурия", en: "Dysuria" } },
        { key: "hematuria", labels: { de: "Hämaturie", ru: "Гематурия", en: "Hematuria" } },
        { key: "flank_pain", labels: { de: "Flankenschmerz", ru: "Боль в пояснице", en: "Flank pain" } },
        {
          key: "urinary_frequency",
          labels: { de: "Pollakisurie", ru: "Учащённое мочеиспускание", en: "Urinary frequency" },
        },
        {
          key: "urinary_retention",
          labels: { de: "Harnverhalt", ru: "Задержка мочи", en: "Urinary retention" },
        },
        { key: "incontinence", labels: { de: "Inkontinenz", ru: "Недержание", en: "Incontinence" } },
      ]}
      textFields={[
        {
          key: "prior_urology_workup",
          labels: {
            de: "Vorherige urologische Diagnostik",
            ru: "Предыдущее урологическое обследование",
            en: "Prior urology workup",
          },
        },
        {
          key: "catheter_history",
          labels: {
            de: "Katheter-/Interventionshistorie",
            ru: "История катетеров и вмешательств",
            en: "Catheter / intervention history",
          },
        },
        {
          key: "stone_history",
          labels: { de: "Steinleiden", ru: "Мочекаменная болезнь", en: "Stone disease history" },
        },
        { key: "red_flags", labels: { de: "Warnzeichen", ru: "Красные флаги", en: "Red flags" } },
        {
          key: "notes",
          labels: { de: "Urologische Notizen", ru: "Урологические заметки", en: "Urology notes" },
          rows: 4,
        },
      ]}
    />
  );
}
