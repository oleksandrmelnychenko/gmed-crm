import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
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
import { PatientMedicationTable } from "./patient-clinical-tab";

type Bilingual = (ru: string, de: string) => string;

const MEDICATION_GROUPS = (tx: Bilingual) => [
  { key: "dauer", label: tx("Постоянная", "Dauermedikation") },
  { key: "besondere", label: tx("По особым показаниям", "Zu besonderen Zeiten") },
  { key: "selbst", label: tx("Самолечение", "Selbstmedikation") },
];

function diagnosisStatusLabel(status: DiagnosisStatus, tx: Bilingual) {
  if (status === "chronic") return tx("Хроническое", "Chronisch");
  if (status === "resolved") return tx("Разрешено", "Abgeheilt");
  return tx("Активное", "Aktiv");
}

function diagnosisStatusTone(status: DiagnosisStatus) {
  if (status === "chronic") return "border-amber-300 bg-amber-50 text-amber-800";
  if (status === "resolved") return "border-border bg-muted text-muted-foreground";
  return "border-rose-300 bg-rose-50 text-rose-800";
}

function lateralityLabel(value: ClinicalDiagnosis["laterality"], tx: Bilingual) {
  if (value === "left") return tx("слева", "links");
  if (value === "right") return tx("справа", "rechts");
  if (value === "bilateral") return tx("двусторонне", "beidseits");
  return null;
}

/** A treating doctor surfaced from the patient's clinical attribution. */
type OverviewDoctor = { name: string; title: string | null; provider: string | null };

function deriveDoctors(sources: { doctor_name: string | null; doctor_title: string | null; provider_name: string | null }[]): OverviewDoctor[] {
  const seen = new Map<string, OverviewDoctor>();
  for (const source of sources) {
    const name = source.doctor_name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, { name, title: source.doctor_title, provider: source.provider_name });
  }
  return [...seen.values()];
}

function OverviewSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {typeof count === "number" ? (
          <Badge variant="outline" className="rounded-full text-[10px]">{count}</Badge>
        ) : null}
      </div>
      {children}
    </div>
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

  const mainDiagnoses = diagnoses.filter((d) => d.kind === "main");
  const secondaryDiagnoses = diagnoses.filter((d) => d.kind !== "main");
  const doctors = deriveDoctors([...diagnoses, ...medications]);
  const emptyDash = <span className="text-muted-foreground">—</span>;

  const renderDiagnosis = (item: ClinicalDiagnosis) => {
    const laterality = lateralityLabel(item.laterality, tx);
    return (
      <li key={item.id ?? item.label} className="leading-snug">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-sm font-medium text-foreground">{item.label}</span>
          {item.icd_code ? (
            <span className="font-mono text-[11px] text-muted-foreground">{item.icd_code}</span>
          ) : null}
          <Badge
            variant="outline"
            className={cn("rounded-md px-1.5 py-0 text-[10px]", diagnosisStatusTone(item.status))}
          >
            {diagnosisStatusLabel(item.status, tx)}
          </Badge>
        </div>
        {(item.grade || laterality || item.diagnosed_on) ? (
          <p className="text-[11px] text-muted-foreground">
            {[item.grade, laterality, item.diagnosed_on].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      {allergies ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
            {tx("Аллергии / CAVE", "Allergien / CAVE")}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-rose-900">{allergies}</p>
        </div>
      ) : null}

      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-3">
        <OverviewSection
          title={tx("Диагнозы", "Diagnosen")}
          count={diagnoses.length || undefined}
        >
          {diagnoses.length === 0 ? (
            emptyDash
          ) : (
            <div className="space-y-2">
              <ul className="space-y-1.5">{mainDiagnoses.map(renderDiagnosis)}</ul>
              {secondaryDiagnoses.length > 0 ? (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {tx("Сопутствующие", "Nebendiagnosen")}
                  </p>
                  <ul className="space-y-1.5">{secondaryDiagnoses.map(renderDiagnosis)}</ul>
                </div>
              ) : null}
            </div>
          )}
        </OverviewSection>

        <OverviewSection
          title={tx("Рекомендации", "Empfehlungen")}
          count={recommendations.length || undefined}
        >
          {recommendations.length === 0 ? (
            emptyDash
          ) : (
            <ul className="space-y-1.5">
              {recommendations.map((rec) => (
                <li key={rec.id} className="leading-snug">
                  <span className="text-sm font-medium text-foreground">{rec.title}</span>
                  {(rec.recommendation_type || rec.due_at) ? (
                    <p className="text-[11px] text-muted-foreground">
                      {[rec.recommendation_type, rec.due_at].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </OverviewSection>

        <OverviewSection
          title={tx("Лечащие врачи", "Behandelnde Ärzte")}
          count={doctors.length || undefined}
        >
          {doctors.length === 0 ? (
            emptyDash
          ) : (
            <ul className="space-y-1">
              {doctors.map((doctor) => (
                <li key={doctor.name} className="text-sm leading-snug text-foreground">
                  {[doctor.title, doctor.name].filter(Boolean).join(" ")}
                  {doctor.provider ? (
                    <span className="block text-[11px] text-muted-foreground">{doctor.provider}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </OverviewSection>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tx("Назначенные препараты", "Verordnete Medikamente")}
        </h3>
        {medications.length === 0 ? (
          emptyDash
        ) : (
          <PatientMedicationTable
            canManage={false}
            groupOf={(m) => m.category}
            groups={MEDICATION_GROUPS(tx)}
            indexed={medications.map((item, index) => ({ item, index }))}
            renderActions={() => null}
            tx={tx}
          />
        )}
      </div>
    </section>
  );
}
