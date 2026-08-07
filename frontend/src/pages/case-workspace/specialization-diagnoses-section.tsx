import { Badge } from "@/components/ui/badge";
import { useLang } from "@/lib/i18n";
import { specializationLabelForItem } from "@/pages/providers/model/specialization-labels";

import {
  clinicalRecordHasSpecialization,
  diagnosesForSpecialization,
} from "./case-specializations";
import { useCaseWorkspace } from "./context";
import { Panel } from "./primitives";
import { useCaseSpecializations } from "./subject-store";

const LABELS = {
  de: {
    description: "Klinische Einträge dieses Falls für die ausgewählte Spezialisierung.",
    empty: "Für diesen Fall sind noch keine passenden klinischen Einträge erfasst.",
    diagnoses: "Diagnosen",
    examinations: "Befunde",
    narratives: "Anamnese",
    main: "Hauptdiagnose",
    secondary: "Nebendiagnose",
    prozedur: "Prozedur",
    diagnosedOn: "Diagnosedatum",
  },
  ru: {
    description: "Клинические записи этого кейса по выбранной специализации.",
    empty: "В этом кейсе пока нет подходящих клинических записей.",
    diagnoses: "Диагнозы",
    examinations: "Обследования",
    narratives: "Анамнез",
    main: "Основной диагноз",
    secondary: "Сопутствующий диагноз",
    prozedur: "Процедура",
    diagnosedOn: "Дата диагноза",
  },
} as const;

export function SpecializationDiagnosesSection({
  specializationId,
}: {
  specializationId: string;
}) {
  const { lang } = useLang();
  const {
    caseId,
    clinicalDiagnoses,
    clinicalExaminations,
    clinicalNarratives,
  } = useCaseWorkspace();
  const specializations = useCaseSpecializations(caseId);
  const labelLang = lang === "de" ? "de" : "ru";
  const labels = LABELS[labelLang];
  const specialization = specializations.find(
    (item) => item.id === specializationId,
  );
  const diagnoses = diagnosesForSpecialization(
    clinicalDiagnoses,
    specializationId,
  );
  const examinations = clinicalExaminations.filter((item) =>
    clinicalRecordHasSpecialization(item, specializationId),
  );
  const narratives = clinicalNarratives.filter((item) =>
    clinicalRecordHasSpecialization(item, specializationId),
  );
  const hasEntries = diagnoses.length + examinations.length + narratives.length > 0;

  if (!specialization) return null;

  return (
    <Panel
      title={specializationLabelForItem(specialization, labelLang)}
      description={labels.description}
    >
      {!hasEntries ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {labels.empty}
        </div>
      ) : (
        <div className="space-y-5">
          {diagnoses.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.diagnoses}
              </h3>
              {diagnoses.map((diagnosis, index) => (
            <article
              key={diagnosis.id ?? diagnosis.cid ?? `${diagnosis.label}-${index}`}
              className="rounded-lg border border-border/60 bg-card px-3.5 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-foreground">
                    {diagnosis.label}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="rounded-full border-border/60 bg-muted/25 text-[10px] text-muted-foreground"
                    >
                      {labels[diagnosis.kind]}
                    </Badge>
                    {diagnosis.icd_code ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-border/60 bg-muted/25 font-mono text-[10px] text-foreground"
                      >
                        ICD {diagnosis.icd_code}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {diagnosis.diagnosed_on ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {labels.diagnosedOn}: {diagnosis.diagnosed_on}
                  </span>
                ) : null}
              </div>
              {diagnosis.note?.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {diagnosis.note}
                </p>
              ) : null}
            </article>
              ))}
            </section>
          ) : null}

          {examinations.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.examinations}
              </h3>
              {examinations.map((examination, index) => (
                <article
                  key={examination.id ?? `${examination.title}-${index}`}
                  className="rounded-lg border border-border/60 bg-card px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="break-words text-sm font-semibold text-foreground">
                      {examination.title}
                    </p>
                    {examination.performed_on ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {examination.performed_on}
                      </span>
                    ) : null}
                  </div>
                  {examination.result ? (
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {examination.result}
                    </p>
                  ) : null}
                  {examination.red_flags ? (
                    <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                      <span className="font-semibold">Red flags:</span> {examination.red_flags}
                    </p>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          {narratives.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.narratives}
              </h3>
              {narratives.map((narrative, index) => {
                const details = narrative.specializations?.find(
                  (item) => item.id === specializationId,
                );
                return (
                  <article
                    key={narrative.id ?? `narrative-${index}`}
                    className="rounded-lg border border-border/60 bg-card px-3.5 py-3"
                  >
                    {narrative.anamnese_at ? (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {narrative.anamnese_at}
                      </p>
                    ) : null}
                    {details?.narrative_text ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                        {details.narrative_text}
                      </p>
                    ) : narrative.anamnese_aktuelle ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                        {narrative.anamnese_aktuelle}
                      </p>
                    ) : null}
                    {details?.assessment_text ? (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {details.assessment_text}
                      </p>
                    ) : null}
                    {narrative.red_flags ? (
                      <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                        <span className="font-semibold">Red flags:</span> {narrative.red_flags}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
