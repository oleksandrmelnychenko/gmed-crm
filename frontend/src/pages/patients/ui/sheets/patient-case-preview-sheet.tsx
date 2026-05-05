import { useEffect, useState } from "react";
import { ExternalLink, Folder, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { formatUnknownValue, useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type CasePreview = {
  id: string;
  case_id: string;
  case_uuid?: string | null;
  patient_id: string;
  status: string;
  hauptanfragegrund: string | null;
  aktuelle_anamnese: string | null;
  zuweiser: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
  retention_until?: string | null;
  last_clinical_update_at?: string | null;
  vorerkrankungen?: { erkrankung?: string | null }[];
  allergien?: { allergie?: string | null }[];
  medikamente?: { handelsname?: string | null; wirkstoff?: string | null }[];
  symptome?: { beschreibung?: string | null }[];
  operationen?: {
    datum?: string | null;
    grund?: string | null;
    arzt?: string | null;
    notiz?: string | null;
  }[];
  pain_records?: {
    lokalisierung?: string | null;
    intensitaet_nrs?: number | null;
    qualitaet?: string | null;
    verlauf?: string | null;
  }[];
  cardiology_recommended?: boolean;
  cardiology?: Record<string, unknown> | null;
  gastroenterology_recommended?: boolean;
  gastroenterology?: Record<string, unknown> | null;
  orthopedics_recommended?: boolean;
  orthopedics?: Record<string, unknown> | null;
  neurology_recommended?: boolean;
  neurology?: Record<string, unknown> | null;
  pulmonology_recommended?: boolean;
  pulmonology?: Record<string, unknown> | null;
  urology_recommended?: boolean;
  urology?: Record<string, unknown> | null;
  vegetative_anamnese?: Record<string, unknown> | null;
  impfstatus?: string | null;
  history?: {
    id?: number;
    section?: string;
    changed_by_name?: string;
    changed_by_role?: string;
    created_at?: string;
    old_value?: unknown;
    new_value?: unknown;
  }[];
};

type CaseLookupItem = {
  id: string;
  case_uuid?: string;
  case_id: string;
};

function formatDate(
  value: string | null | undefined,
  fallback: string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  if (!value) return fallback;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatUnknownValue(value, translations);
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  } catch {
    return formatUnknownValue(value, translations);
  }
}

function formatDateTime(
  value: string | null | undefined,
  fallback: string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  if (!value) return fallback;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatUnknownValue(value, translations);
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return formatUnknownValue(value, translations);
  }
}

function caseStatusLabel(
  status: string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  const labels = translations as unknown as Record<string, string>;
  return labels[`cases_${status}`] ?? formatUnknownValue(status, translations);
}

function caseHistorySectionLabel(
  section: string | null | undefined,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (section) {
    case "overview":
      return l("Ubersicht", "Обзор", "Overview");
    case "vorerkrankungen":
      return l("Vorerkrankungen", "Сопутствующие заболевания", "Preconditions");
    case "allergien":
      return l("Allergien", "Аллергии", "Allergies");
    case "operationen":
      return l("Operationen", "Операции", "Operations");
    case "medikamente":
      return l("Medikation", "Медикаменты", "Medication");
    case "pain_records":
      return l("Schmerzdokumentation", "Записи о боли", "Pain records");
    case "symptome":
      return l("Symptome", "Симптомы", "Symptoms");
    case "cardiology":
      return l("Kardiologie", "Кардиология", "Cardiology");
    case "gastroenterology":
      return l("Gastroenterologie", "Гастроэнтерология", "Gastroenterology");
    case "orthopedics":
      return l("Orthopadie", "Ортопедия", "Orthopedics");
    case "neurology":
      return l("Neurologie", "Неврология", "Neurology");
    case "pulmonology":
      return l("Pneumologie", "Пульмонология", "Pulmonology");
    case "urology":
      return l("Urologie", "Урология", "Urology");
    case "vegetative":
    case "vegetative_anamnese":
      return l("Vegetative Anamnese", "Вегетативный анамнез", "Vegetative");
    case "impfstatus":
      return l("Impfstatus", "Вакцинация", "Vaccination");
    default:
      return formatUnknownValue(section, translations);
  }
}

function caseFieldLabel(
  key: string,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (key) {
    case "is_relevant":
      return l("Relevant", "Релевантно", "Relevant");
    case "chest_pain":
      return l("Brustschmerz", "Боль в груди", "Chest pain");
    case "dyspnea":
      return l("Dyspnoe", "Одышка", "Dyspnea");
    case "palpitations":
      return l("Palpitationen", "Сердцебиение", "Palpitations");
    case "syncope":
      return l("Synkope", "Обморок", "Syncope");
    case "edema":
      return l("Odeme", "Отеки", "Edema");
    case "known_diagnosis":
      return l("Bekannte Diagnose", "Известный диагноз", "Known diagnosis");
    case "prior_cardiac_workup":
      return l("Bisherige Kardiologie", "Предыдущее кардиообследование", "Prior cardiac workup");
    case "cardiovascular_risk_factors":
      return l("Kardiovaskulare Risiken", "Сердечно-сосудистые риски", "Cardiovascular risks");
    case "anticoagulation":
      return l("Antikoagulation", "Антикоагуляция", "Anticoagulation");
    case "family_history":
      return l("Familienanamnese", "Семейный анамнез", "Family history");
    case "red_flags":
      return l("Warnzeichen", "Красные флаги", "Red flags");
    case "notes":
      return l("Notizen", "Заметки", "Notes");
    case "abdominal_pain":
      return l("Bauchschmerz", "Боль в животе", "Abdominal pain");
    case "reflux":
      return l("Reflux", "Рефлюкс", "Reflux");
    case "nausea":
      return l("Ubelkeit", "Тошнота", "Nausea");
    case "diarrhea":
      return l("Diarrho", "Диарея", "Diarrhea");
    case "constipation":
      return l("Obstipation", "Запор", "Constipation");
    case "gi_bleeding":
      return l("GI-Blutung", "ЖКТ-кровотечение", "GI bleeding");
    case "prior_endoscopy":
      return l("Bisherige Endoskopie", "Предыдущая эндоскопия", "Prior endoscopy");
    case "bowel_habits":
      return l("Stuhlgewohnheiten", "Особенности стула", "Bowel habits");
    case "liver_history":
      return l("Leberanamnese", "Печеночный анамнез", "Liver history");
    case "food_intolerance":
      return l("Nahrungsmittelintoleranz", "Пищевая непереносимость", "Food intolerance");
    case "joint_pain":
      return l("Gelenkschmerz", "Боль в суставах", "Joint pain");
    case "back_pain":
      return l("Ruckenschmerz", "Боль в спине", "Back pain");
    case "mobility_limitation":
      return l("Mobilitatseinschrankung", "Ограничение подвижности", "Mobility limitation");
    case "trauma_history":
      return l("Traumaanamnese", "Травматологический анамнез", "Trauma history");
    case "prior_imaging":
      return l("Bisherige Bildgebung", "Предыдущая визуализация", "Prior imaging");
    case "assistive_devices":
      return l("Hilfsmittel", "Вспомогательные средства", "Assistive devices");
    case "physiotherapy_history":
      return l("Physiotherapie-Anamnese", "Физиотерапия в анамнезе", "Physiotherapy history");
    case "pain_triggers":
      return l("Schmerzausloser", "Триггеры боли", "Pain triggers");
    case "headache":
      return l("Kopfschmerz", "Головная боль", "Headache");
    case "dizziness":
      return l("Schwindel", "Головокружение", "Dizziness");
    case "sensory_changes":
      return l("Sensibilitatsanderungen", "Изменения чувствительности", "Sensory changes");
    case "weakness":
      return l("Schwache", "Слабость", "Weakness");
    case "seizure_history":
      return l("Krampfanamnese", "Судорожный анамнез", "Seizure history");
    case "gait_balance_issues":
      return l("Gang / Gleichgewicht", "Походка / равновесие", "Gait / balance");
    case "prior_neuro_imaging":
      return l("Bisherige Neuro-Bildgebung", "Предыдущая нейровизуализация", "Prior neuro imaging");
    case "prior_neurology_workup":
      return l("Bisherige Neurologie", "Предыдущее неврологическое обследование", "Prior neurology workup");
    case "cognitive_changes":
      return l("Kognitive Veranderungen", "Когнитивные изменения", "Cognitive changes");
    case "chronic_cough":
      return l("Chronischer Husten", "Хронический кашель", "Chronic cough");
    case "wheezing":
      return l("Giemen", "Свистящее дыхание", "Wheezing");
    case "chest_tightness":
      return l("Engegefuhl Brust", "Стеснение в груди", "Chest tightness");
    case "hemoptysis":
      return l("Hamoptyse", "Кровохарканье", "Hemoptysis");
    case "smoking_history":
      return l("Raucheranamnese", "Курительный анамнез", "Smoking history");
    case "prior_chest_imaging":
      return l("Bisherige Thorax-Bildgebung", "Предыдущая визуализация грудной клетки", "Prior chest imaging");
    case "inhaler_therapy":
      return l("Inhalationstherapie", "Ингаляционная терапия", "Inhaler therapy");
    case "sleep_apnea_history":
      return l("Schlafapnoe-Anamnese", "Анамнез апноэ сна", "Sleep apnea history");
    case "dysuria":
      return l("Dysurie", "Дизурия", "Dysuria");
    case "hematuria":
      return l("Hamaturie", "Гематурия", "Hematuria");
    case "flank_pain":
      return l("Flankenschmerz", "Боль в боку", "Flank pain");
    case "urinary_frequency":
      return l("Haufiges Wasserlassen", "Частое мочеиспускание", "Urinary frequency");
    case "urinary_retention":
      return l("Harnverhalt", "Задержка мочи", "Urinary retention");
    case "incontinence":
      return l("Inkontinenz", "Недержание", "Incontinence");
    case "prior_urology_workup":
      return l("Bisherige Urologie", "Предыдущее урологическое обследование", "Prior urology workup");
    case "catheter_history":
      return l("Katheteranamnese", "Катетеризация в анамнезе", "Catheter history");
    case "stone_history":
      return l("Steinanamnese", "Анамнез камней", "Stone history");
    case "appetit_durst":
      return l("Appetit / Durst", "Аппетит / жажда", "Appetite / thirst");
    case "koerpergroesse":
      return l("Korpergroesse", "Рост", "Height");
    case "gewicht":
      return l("Gewicht", "Вес", "Weight");
    case "gewichtsveraenderung":
      return l("Gewichtsveranderung", "Изменение веса", "Weight change");
    case "grund":
      return l("Grund", "Причина", "Reason");
    default:
      return formatUnknownValue(key, translations);
  }
}

function caseRoleLabel(
  role: string | null | undefined,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  if (!role) return null;
  const labels = translations as unknown as Record<string, string>;
  return labels[`role_${role}`] ?? formatUnknownValue(role, translations);
}

export function PatientCasePreviewSheet({
  caseId,
  patientId,
  open,
  onOpenChange,
  showFullViewAction = true,
}: {
  caseId: string | null;
  patientId?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  showFullViewAction?: boolean;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const { staffGo } = useStaffNavigate();
  const [detailState, setDetailState] = useState<{
    caseId: string | null;
    detail: CasePreview | null;
    failed: boolean;
    error: string;
  }>({
    caseId: null,
    detail: null,
    failed: false,
    error: "",
  });

  const activeDetail =
    open &&
    caseId &&
    detailState.caseId === caseId &&
    !detailState.failed
      ? detailState.detail
      : null;
  const showLoading = open && Boolean(caseId) && detailState.caseId !== caseId;

  useEffect(() => {
    if (!open || !caseId) return;
    let cancelled = false;

    void (async () => {
      try {
        const row = await apiFetch<CasePreview>(`/cases/${caseId}`);
        if (cancelled) return;
        setDetailState({
          caseId,
          detail: row,
          failed: false,
          error: "",
        });
      } catch (primaryError) {
        if (!patientId) {
          if (cancelled) return;
          setDetailState({
            caseId,
            detail: null,
            failed: true,
            error:
              primaryError instanceof Error
                ? primaryError.message
                : t.common_failed_load,
          });
          return;
        }

        try {
          const items = await apiFetch<CaseLookupItem[]>(
            `/cases?patient_id=${patientId}`,
          );
          if (cancelled) return;
          const match = items.find(
            (item) =>
              item.id === caseId ||
              item.case_uuid === caseId ||
              item.case_id === caseId,
          );
          if (!match?.id) {
            setDetailState({
              caseId,
              detail: null,
              failed: true,
              error:
                primaryError instanceof Error
                  ? primaryError.message
                  : t.common_failed_load,
            });
            return;
          }
          const row = await apiFetch<CasePreview>(`/cases/${match.id}`);
          if (cancelled) return;
          setDetailState({
            caseId,
            detail: row,
            failed: false,
            error: "",
          });
        } catch (fallbackError) {
          if (cancelled) return;
          setDetailState({
            caseId,
            detail: null,
            failed: true,
            error:
              fallbackError instanceof Error
                ? fallbackError.message
                : t.common_failed_load,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, caseId, patientId, t.common_failed_load]);

  const statusLabel = activeDetail ? caseStatusLabel(activeDetail.status, t) : "";
  const statusClassName = activeDetail
    ? caseStatusBadgeClass(activeDetail.status)
    : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      maxWidthClassName="sm:max-w-[980px]"
      title={
        <span className="inline-flex items-center gap-2">
          <Folder className="size-4 text-muted-foreground" />
          {activeDetail?.case_id || t.patient_case_fallback_title}
        </span>
      }
      description={t.patient_case_description}
      bodyClassName="px-6 py-6 space-y-4"
    >
      {caseId && showFullViewAction ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg gap-1 text-[12px] text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              staffGo(
                patientId
                  ? `/cases?patient=${patientId}&case=${caseId}`
                  : `/cases?case=${caseId}`,
              );
            }}
          >
            {t.patient_case_full_view}
            <ExternalLink className="size-3" />
          </Button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
          {showLoading ? (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {t.patient_case_loading}
            </div>
          ) : !activeDetail ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {detailState.error || t.common_failed_load}
            </div>
          ) : (
            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("rounded-full", statusClassName)}>
                    {statusLabel}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-full border-slate-200 bg-white text-slate-700"
                  >
                    {activeDetail.patient_id}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetaCard label={t.patient_case_reference_code} value={activeDetail.case_id} emptyLabel={t.common_not_set} mono />
                  <MetaCard
                    label={t.patient_case_system_uuid}
                    value={activeDetail.case_uuid ?? activeDetail.id}
                    emptyLabel={t.common_not_set}
                    mono
                  />
                  <MetaCard
                    label={t.patient_case_retention_until}
                    value={formatDate(activeDetail.retention_until, t.common_not_set, t)}
                    emptyLabel={t.common_not_set}
                  />
                  <MetaCard
                    label={t.patient_case_last_clinical_update}
                    value={formatDateTime(
                      activeDetail.last_clinical_update_at ?? activeDetail.updated_at,
                      t.common_not_set,
                      t,
                    )}
                    emptyLabel={t.common_not_set}
                  />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label={t.cases_preconditions}
                    value={String(activeDetail.vorerkrankungen?.length ?? 0)}
                  />
                  <MetricCard
                    label={t.cases_allergies}
                    value={String(activeDetail.allergien?.length ?? 0)}
                  />
                  <MetricCard
                    label={t.cases_medication}
                    value={String(activeDetail.medikamente?.length ?? 0)}
                  />
                  <MetricCard
                    label={t.cases_symptoms}
                    value={String(activeDetail.symptome?.length ?? 0)}
                  />
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-950">
                  {t.cases_core_anamnesis}
                </h3>
                <Field label={t.cases_reason} value={activeDetail.hauptanfragegrund} emptyLabel={t.common_not_set} />
                <Field label={t.cases_narrative} value={activeDetail.aktuelle_anamnese} emptyLabel={t.common_not_set} />
                <Field label={t.cases_referrer} value={activeDetail.zuweiser} emptyLabel={t.common_not_set} />
                <Field label={t.patients_notes} value={activeDetail.notes} emptyLabel={t.common_not_set} />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 grid gap-4 lg:grid-cols-2">
                <ListField
                  label={t.cases_preconditions}
                  items={activeDetail.vorerkrankungen?.map((item) => item.erkrankung) ?? []}
                  emptyLabel={t.common_not_set}
                />
                <ListField
                  label={t.cases_allergies}
                  items={activeDetail.allergien?.map((item) => item.allergie) ?? []}
                  emptyLabel={t.common_not_set}
                />
                <ListField
                  label={t.cases_medication}
                  items={
                    activeDetail.medikamente?.map((item) =>
                      [item.handelsname, item.wirkstoff].filter(Boolean).join(" / "),
                    ) ?? []
                  }
                  emptyLabel={t.common_not_set}
                />
                <ListField
                  label={t.cases_symptoms}
                  items={activeDetail.symptome?.map((item) => item.beschreibung) ?? []}
                  emptyLabel={t.common_not_set}
                />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 grid gap-4 lg:grid-cols-2">
                <ListField
                  label={t.cases_operations}
                  items={
                    activeDetail.operationen?.map((item) =>
                      [
                        item.datum ? formatDate(item.datum, t.common_not_set, t) : "",
                        item.grund ?? "",
                        item.arzt ?? "",
                      ]
                        .filter(Boolean)
                        .join(" / "),
                    ) ?? []
                  }
                  emptyLabel={t.common_not_set}
                />
                <ListField
                  label={t.cases_pain}
                  items={
                    activeDetail.pain_records?.map((item) =>
                      [
                        item.lokalisierung ?? "",
                        item.intensitaet_nrs != null ? `NRS ${item.intensitaet_nrs}` : "",
                        item.qualitaet ?? "",
                        item.verlauf ?? "",
                      ]
                        .filter(Boolean)
                        .join(" / "),
                    ) ?? []
                  }
                  emptyLabel={t.common_not_set}
                />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-950">
                  {t.patient_case_specialized_assessments}
                </h3>
                <KeyValueGrid
                  title={t.patient_case_assessment_cardiology}
                  recommended={activeDetail.cardiology_recommended}
                  data={activeDetail.cardiology}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
                <KeyValueGrid
                  title={t.patient_case_assessment_gastroenterology}
                  recommended={activeDetail.gastroenterology_recommended}
                  data={activeDetail.gastroenterology}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
                <KeyValueGrid
                  title={t.patient_case_assessment_orthopedics}
                  recommended={activeDetail.orthopedics_recommended}
                  data={activeDetail.orthopedics}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
                <KeyValueGrid
                  title={t.patient_case_assessment_neurology}
                  recommended={activeDetail.neurology_recommended}
                  data={activeDetail.neurology}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
                <KeyValueGrid
                  title={t.patient_case_assessment_pulmonology}
                  recommended={activeDetail.pulmonology_recommended}
                  data={activeDetail.pulmonology}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
                <KeyValueGrid
                  title={t.patient_case_assessment_urology}
                  recommended={activeDetail.urology_recommended}
                  data={activeDetail.urology}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-950">
                  {t.patient_case_additional_blocks}
                </h3>
                <KeyValueGrid
                  title={t.cases_vegetative}
                  data={activeDetail.vegetative_anamnese}
                  l={l}
                  notSetLabel={t.common_not_set}
                  translations={t}
                  recommendedLabel={t.patient_case_recommended}
                  notRequiredLabel={t.patient_case_not_required}
                />
                <Field label={t.cases_vaccination} value={activeDetail.impfstatus} emptyLabel={t.common_not_set} />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-950">{t.patient_case_history}</h3>
                {activeDetail.history?.length ? (
                  <div className="space-y-2">
                    {activeDetail.history.map((entry) => (
                      <div
                        key={`${entry.id ?? "entry"}-${entry.created_at ?? ""}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {caseHistorySectionLabel(entry.section, l, t)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDateTime(entry.created_at, t.common_not_set, t)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">
                          {[entry.changed_by_name, caseRoleLabel(entry.changed_by_role, t)]
                            .filter(Boolean)
                            .join(" / ") || t.common_not_set}
                        </p>
                        <div className="mt-2 grid gap-2 lg:grid-cols-2">
                          <CodeBlock
                            label={t.patient_case_old_value}
                            value={safeStringify(entry.old_value, l, t)}
                          />
                          <CodeBlock
                            label={t.patient_case_new_value}
                            value={safeStringify(entry.new_value, l, t)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">{t.common_not_set}</p>
                )}
              </section>
            </div>
          )}
      </div>
    </PatientSheetScaffold>
  );
}

function caseStatusBadgeClass(status: string) {
  switch (status) {
    case "open":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "in_progress":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "closed":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function MetaCard({
  label,
  value,
  emptyLabel,
  mono = false,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-sm text-slate-900",
          mono ? "font-mono break-all text-xs" : null,
        )}
      >
        {value || emptyLabel}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value: string | null | undefined;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">
        {value?.trim() || emptyLabel}
      </p>
    </div>
  );
}

function ListField({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: Array<string | null | undefined>;
  emptyLabel: string;
}) {
  const normalized = items
    .map((item) => (item ?? "").trim())
    .filter((item) => item.length > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      {normalized.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{emptyLabel}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {normalized.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function KeyValueGrid({
  title,
  recommended,
  data,
  l,
  notSetLabel,
  translations,
  recommendedLabel,
  notRequiredLabel,
}: {
  title: string;
  recommended?: boolean;
  data?: Record<string, unknown> | null;
  l: (de: string, ru: string, en: string) => string;
  notSetLabel: string;
  recommendedLabel: string;
  notRequiredLabel: string;
  translations: {
    common_not_set: string;
    common_unknown: string;
    common_unknown_value: string;
  };
}) {
  const entries = Object.entries(data ?? {});

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {recommended != null ? (
          <Badge variant="outline" className="rounded-full text-[10px]">
            {recommended ? recommendedLabel : notRequiredLabel}
          </Badge>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">{notSetLabel}</p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.1em] text-slate-500">
                {caseFieldLabel(key, l, translations)}
              </p>
              <p className="mt-1 break-words text-sm text-slate-900">
                {typeof value === "string"
                  ? value || notSetLabel
                  : typeof value === "boolean"
                    ? value
                      ? l("Ja", "Да", "Yes")
                      : l("Nein", "Нет", "No")
                    : value == null
                      ? notSetLabel
                      : safeStringify(value, l, translations)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[11px] uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-800">
        {value}
      </pre>
    </div>
  );
}

function safeStringify(
  value: unknown,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_not_set: string; common_unknown: string; common_unknown_value: string },
) {
  if (value == null) return translations.common_not_set;
  if (typeof value === "string") return value || translations.common_not_set;
  if (typeof value === "boolean") return value ? l("Ja", "Да", "Yes") : l("Nein", "Нет", "No");
  if (typeof value === "number") return value.toLocaleString();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return formatUnknownValue(value, translations);
  }
}
