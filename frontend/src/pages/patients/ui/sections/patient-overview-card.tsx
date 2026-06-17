import { useEffect, useState, type ReactNode } from "react";

import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  fetchPatientClinical,
  fetchPatientRecommendations,
  type ClinicalDiagnosis,
  type ClinicalMedication,
  type DiagnosisStatus,
  type PatientRecommendation,
} from "../../data/patient-clinical";

type Bilingual = (ru: string, de: string) => string;

function diagnosisStatusLabel(status: DiagnosisStatus, tx: Bilingual) {
  if (status === "chronic") return tx("хрон.", "chron.");
  if (status === "resolved") return tx("разрешено", "abgeheilt");
  return tx("активн.", "aktiv");
}

function diagnosisStatusClass(status: DiagnosisStatus) {
  if (status === "chronic") return "text-amber-700";
  if (status === "resolved") return "text-muted-foreground";
  return "text-rose-700";
}

function lateralityLabel(value: ClinicalDiagnosis["laterality"], tx: Bilingual) {
  if (value === "left") return tx("слева", "links");
  if (value === "right") return tx("справа", "rechts");
  if (value === "bilateral") return tx("двусторонне", "beidseits");
  return null;
}

/** Compact M-Mi-A-N intake scheme, e.g. "1-0-1-0". Empty when no dose is set. */
function intakeScheme(item: ClinicalMedication): string {
  const slots = [item.dose_morgens, item.dose_mittags, item.dose_abends, item.dose_nachts];
  if (slots.every((slot) => !slot || !slot.trim())) return "";
  return slots.map((slot) => (slot && slot.trim() ? slot.trim() : "0")).join("-");
}

/** Allergies/CAVE free text → one item per line or comma. */
function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|,|;/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Notes/descriptions → one sub-bullet per line (commas are kept intact). */
function splitLines(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A treating doctor surfaced from the patient's clinical attribution. */
type OverviewDoctor = {
  name: string;
  title: string | null;
  fachbereich: string | null;
  provider: string | null;
};

function deriveDoctors(
  sources: {
    doctor_name: string | null;
    doctor_title: string | null;
    doctor_fachbereich: string | null;
    provider_name: string | null;
  }[],
): OverviewDoctor[] {
  const seen = new Map<string, OverviewDoctor>();
  for (const source of sources) {
    const name = source.doctor_name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = seen.get(key);
    if (existing) {
      if (!existing.fachbereich && source.doctor_fachbereich) existing.fachbereich = source.doctor_fachbereich;
      if (!existing.provider && source.provider_name) existing.provider = source.provider_name;
      continue;
    }
    seen.set(key, {
      name,
      title: source.doctor_title,
      fachbereich: source.doctor_fachbereich,
      provider: source.provider_name,
    });
  }
  return [...seen.values()].sort((a, b) =>
    (a.fachbereich ?? "￿").localeCompare(b.fachbereich ?? "￿"),
  );
}

function ColumnTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {typeof count === "number" && count > 0 ? (
        <span className="text-[10px] font-medium text-muted-foreground/60">{count}</span>
      ) : null}
    </div>
  );
}

const dash = <span className="text-xs text-muted-foreground">—</span>;

/** Nested sub-bullets shared by diagnoses and recommendations. */
function SubBullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-0.5 ml-3.5 list-disc space-y-0 text-[11px] leading-snug text-muted-foreground marker:text-muted-foreground/40">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function PatientOverviewCard({
  patientId,
  allergies,
  canViewClinical,
  version = 0,
}: {
  patientId: string;
  allergies: string | null;
  canViewClinical: boolean;
  version?: number;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>([]);
  const [medications, setMedications] = useState<ClinicalMedication[]>([]);
  const [recommendations, setRecommendations] = useState<PatientRecommendation[]>([]);

  useEffect(() => {
    if (!patientId || !canViewClinical) return;
    let active = true;
    void Promise.all([
      fetchPatientClinical(patientId).catch(() => null),
      fetchPatientRecommendations(patientId).catch(() => [] as PatientRecommendation[]),
    ]).then(([clinical, recs]) => {
      if (!active) return;
      setDiagnoses(clinical?.diagnoses ?? []);
      setMedications(clinical?.medications ?? []);
      setRecommendations(recs ?? []);
    });
    return () => {
      active = false;
    };
  }, [patientId, canViewClinical, version]);

  if (!canViewClinical) return null;

  const allergyItems = splitList(allergies);
  const mainDiagnoses = diagnoses.filter((d) => d.kind === "main");
  const secondaryDiagnoses = diagnoses.filter((d) => d.kind !== "main");
  const doctors = deriveDoctors([...diagnoses, ...medications]);

  const renderDiagnosis = (item: ClinicalDiagnosis) => {
    const laterality = lateralityLabel(item.laterality, tx);
    const sub: string[] = [];
    if (item.diagnosed_on) sub.push(`ED ${item.diagnosed_on}`);
    if (item.grade) sub.push(item.grade);
    sub.push(...splitLines(item.note));
    return (
      <li key={item.id ?? item.label} className="leading-snug">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[13px] font-medium text-foreground">
            {item.label}
            {laterality ? ` ${laterality}` : ""}
          </span>
          {item.icd_code ? (
            <span className="font-mono text-[10px] text-muted-foreground">{item.icd_code}</span>
          ) : null}
          {item.status !== "active" ? (
            <span className={cn("text-[10px] font-medium", diagnosisStatusClass(item.status))}>
              {diagnosisStatusLabel(item.status, tx)}
            </span>
          ) : null}
        </span>
        <SubBullets items={sub} />
      </li>
    );
  };

  const medColumns = [
    tx("Вещество", "Wirkstoff"),
    tx("Торговое название", "Handelsname"),
    tx("Дозировка", "Dosis"),
    tx("Форма", "Form"),
    tx("Приём", "Einnahme"),
    tx("Заметка", "Hinweis"),
    tx("Показание", "Grund"),
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-[0.8fr_1.3fr_1.3fr_1fr]">
        <div className="min-w-0">
          <ColumnTitle count={allergyItems.length || undefined}>{tx("Аллергии", "Allergien")}</ColumnTitle>
          {allergyItems.length === 0 ? (
            dash
          ) : (
            <ul className="space-y-0.5 text-[13px] font-medium leading-snug text-rose-700">
              {allergyItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <ColumnTitle count={diagnoses.length || undefined}>{tx("Диагнозы", "Diagnosen")}</ColumnTitle>
          {diagnoses.length === 0 ? (
            dash
          ) : (
            <div className="space-y-1.5">
              <ul className="list-disc space-y-1 pl-3.5 marker:text-muted-foreground/50">
                {mainDiagnoses.map(renderDiagnosis)}
              </ul>
              {secondaryDiagnoses.length > 0 ? (
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {tx("Сопутствующие", "Nebendiagnosen")}
                  </p>
                  <ul className="list-disc space-y-1 pl-3.5 marker:text-muted-foreground/40">
                    {secondaryDiagnoses.map(renderDiagnosis)}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <ColumnTitle count={recommendations.length || undefined}>{tx("Рекомендации", "Empfehlungen")}</ColumnTitle>
          {recommendations.length === 0 ? (
            dash
          ) : (
            <ul className="list-disc space-y-1 pl-3.5 marker:text-muted-foreground/50">
              {recommendations.map((rec) => {
                const sub: string[] = [];
                if (rec.recommendation_type) sub.push(rec.recommendation_type);
                sub.push(...splitLines(rec.description));
                if (rec.due_at) sub.push(rec.due_at);
                return (
                  <li key={rec.id} className="leading-snug">
                    <span className="text-[13px] font-medium text-foreground">{rec.title}</span>
                    <SubBullets items={sub} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0 lg:border-l lg:border-border/60 lg:pl-4">
          <ColumnTitle count={doctors.length || undefined}>{tx("Лечащие врачи", "Behandelnde Ärzte")}</ColumnTitle>
          {doctors.length === 0 ? (
            dash
          ) : (
            <ul className="space-y-1.5">
              {doctors.map((doctor) => (
                <li key={doctor.name} className="leading-tight">
                  {doctor.fachbereich ? (
                    <p className="text-[11px] font-semibold text-sky-700">{doctor.fachbereich}</p>
                  ) : null}
                  <p className="text-[13px] text-foreground">
                    {[doctor.title, doctor.name].filter(Boolean).join(" ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <ColumnTitle count={medications.length || undefined}>
          {tx("Назначенные препараты", "Verordnete Medikamente")}
        </ColumnTitle>
        {medications.length === 0 ? (
          dash
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="border-b border-border/70 bg-muted/40 text-[10px] uppercase text-muted-foreground">
                <tr>
                  {medColumns.map((column) => (
                    <th key={column} scope="col" className="px-2.5 py-1.5 font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {medications.map((item, index) => (
                  <tr key={item.id ?? index} className="align-top">
                    <td className="px-2.5 py-1.5 text-foreground">{item.wirkstoff || "—"}</td>
                    <td className="px-2.5 py-1.5 font-medium text-foreground">
                      {item.handelsname || tx("Без названия", "Ohne Namen")}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-foreground">{item.staerke || ""}</td>
                    <td className="px-2.5 py-1.5 text-foreground">{item.form || ""}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-foreground">{intakeScheme(item) || "—"}</td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">{item.hinweis || ""}</td>
                    <td className="px-2.5 py-1.5 text-foreground">{item.grund || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
