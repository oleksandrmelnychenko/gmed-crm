import { useEffect, useState, type ReactNode } from "react";

import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  fetchPatientClinical,
  fetchPatientRecommendations,
  type ClinicalDiagnosis,
  type ClinicalMedication,
  type ClinicalWarning,
  type DiagnosisStatus,
  type PatientRecommendation,
} from "../../data/patient-clinical";

type Bilingual = (ru: string, de: string) => string;

function diagnosisStatusLabel(status: DiagnosisStatus | undefined, tx: Bilingual) {
  if (status === "chronic") return tx("хрон.", "chron.");
  if (status === "resolved") return tx("разрешено", "abgeheilt");
  return tx("активн.", "aktiv");
}

function diagnosisStatusClass(status: DiagnosisStatus | undefined) {
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

/** Certainty prefix shown in front of the label: V.a. / Z.n. (bestätigt has none). */
function certaintyPrefix(certainty: ClinicalDiagnosis["certainty"]): string {
  if (certainty === "verdacht") return "V.a. ";
  if (certainty === "zustand_nach") return "Z.n. ";
  return "";
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

function SubLines({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-0.5 space-y-0 text-[11px] leading-snug text-muted-foreground">
      {items.map((item, index) => (
        <div key={index}>{item}</div>
      ))}
    </div>
  );
}

function certaintyClass(certainty: ClinicalDiagnosis["certainty"]): string {
  switch (certainty) {
    case "verdacht":
      return "text-amber-700";
    case "bestaetigt":
      return "text-teal-700";
    case "zustand_nach":
      return "text-indigo-700";
    default:
      return "text-foreground";
  }
}

function computeAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 200 ? age : null;
}

function genderText(gender: string | null | undefined, tx: Bilingual): string {
  if (gender === "male") return tx("Мужской", "Männlich");
  if (gender === "female") return tx("Женский", "Weiblich");
  if (gender === "diverse") return tx("Другое", "Divers");
  return "";
}

function formatBirthDate(value: string | null | undefined, lang: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** One labelled demographic field in the card header. */
function DemoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="min-w-0 max-w-full break-words text-[13px] font-semibold text-foreground">
        {value && String(value).trim() ? value : <span className="text-muted-foreground">—</span>}
      </p>
    </div>
  );
}

export function PatientOverviewCard({
  patientId,
  allergies,
  canViewClinical,
  version = 0,
  birthDate,
  gender,
  phone,
  email,
}: {
  patientId: string;
  allergies: string | null;
  canViewClinical: boolean;
  version?: number;
  birthDate?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [allergien, setAllergien] = useState<ClinicalWarning[]>([]);
  const [cave, setCave] = useState<ClinicalWarning[]>([]);
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
      setAllergien(clinical?.allergien ?? []);
      setCave(clinical?.cave ?? []);
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
  const allergyCount = allergien.length > 0 ? allergien.length : allergyItems.length;
  // Rebuild the tree from the flat list. A node's identity is cid (falling back
  // to the server id); its parent is parent_cid (falling back to parent_id).
  const nodeKey = (d: ClinicalDiagnosis): string | null => d.cid ?? d.id ?? null;
  const parentKey = (d: ClinicalDiagnosis): string | null => d.parent_cid ?? d.parent_id ?? null;
  const childrenByParent = new Map<string, ClinicalDiagnosis[]>();
  for (const d of diagnoses) {
    const pk = parentKey(d);
    if (pk == null) continue;
    const bucket = childrenByParent.get(pk);
    if (bucket) bucket.push(d);
    else childrenByParent.set(pk, [d]);
  }
  const childrenOf = (d: ClinicalDiagnosis): ClinicalDiagnosis[] => {
    const k = nodeKey(d);
    return k == null ? [] : (childrenByParent.get(k) ?? []);
  };
  // Roots are nodes with no resolvable parent in this list (typically the "main"
  // diagnoses). Anything orphaned still surfaces here so nothing is hidden.
  const known = new Set(diagnoses.map(nodeKey).filter((k): k is string => k != null));
  const rootDiagnoses = diagnoses.filter((d) => {
    const pk = parentKey(d);
    return pk == null || !known.has(pk);
  });
  const doctors = deriveDoctors([...diagnoses, ...medications]);
  const age = computeAge(birthDate);
  const showDemographics = Boolean(birthDate || gender || phone || email);
  // Completed ("erfolg") recommendations drop off the overview list.
  const activeRecommendations = recommendations.filter((rec) => rec.lifecycle_status !== "erfolg");

  const renderDiagnosis = (item: ClinicalDiagnosis, depth = 0) => {
    const isProzedur = item.kind === "prozedur";
    const laterality = lateralityLabel(item.laterality, tx);
    const code = isProzedur ? item.ops_code : item.icd_code;
    const sub: string[] = [];
    if (item.diagnosed_on) sub.push(`${isProzedur ? "" : "ED "}${item.diagnosed_on}`);
    if (item.grade) sub.push(item.grade);
    sub.push(...splitLines(item.note));
    const children = childrenOf(item);
    return (
      <li key={nodeKey(item) ?? item.label} className="relative leading-snug">
        {depth >= 0 ? (
          <span
            aria-hidden="true"
            className="absolute -left-3 top-2.5 h-px w-2.5 bg-border/70"
          />
        ) : null}
        <div className="py-0.5">
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className={cn("text-[13px] font-medium", certaintyClass(item.certainty))}>
              {certaintyPrefix(item.certainty)}
              {item.label}
              {laterality ? ` ${laterality}` : ""}
            </span>
            {code ? (
              <span className="font-mono text-[10px] text-muted-foreground">{code}</span>
            ) : null}
            {item.status && item.status !== "active" ? (
              <span className={cn("text-[10px] font-medium", diagnosisStatusClass(item.status))}>
                {diagnosisStatusLabel(item.status, tx)}
              </span>
            ) : null}
          </span>
          <SubLines items={sub} />
        </div>
        {children.length > 0 ? (
          <ul className="relative mt-1 ml-3 space-y-1 border-l border-border/70 pl-3">
            {children.map((child) => renderDiagnosis(child, depth + 1))}
          </ul>
        ) : null}
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
    <section className="space-y-2.5 rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
      {showDemographics ? (
        <div className="grid gap-x-5 gap-y-1.5 border-b border-border/60 pb-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
          <DemoItem label={tx("Дата рождения", "Geburtsdatum")} value={formatBirthDate(birthDate, lang)} />
          <DemoItem
            label={tx("Возраст", "Alter")}
            value={age != null ? `${age} ${tx("лет", "J.")}` : ""}
          />
          <DemoItem label={tx("Пол", "Geschlecht")} value={genderText(gender, tx)} />
          <DemoItem label={tx("Телефон", "Telefon")} value={phone ?? ""} />
          <DemoItem label={tx("Электронная почта", "E-Mail")} value={email ?? ""} />
        </div>
      ) : null}
      <div className="grid gap-x-5 gap-y-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-[0.8fr_1.3fr_1.3fr]">
            <div className="min-w-0">
              <ColumnTitle count={allergyCount || undefined}>{tx("Аллергии", "Allergien")}</ColumnTitle>
              {allergien.length > 0 ? (
                <ul className="space-y-0.5 text-[13px] font-medium leading-snug text-orange-700">
                  {allergien.map((item, index) => (
                    <li key={item.id ?? index}>
                      <span>{item.label}</span>
                      {item.reaction ? (
                        <span className="font-normal text-muted-foreground"> · {item.reaction}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : allergyItems.length > 0 ? (
                <ul className="space-y-0.5 text-[13px] font-medium leading-snug text-orange-700">
                  {allergyItems.map((item, index) => (
                    <li key={index}>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                dash
              )}

              {cave.length > 0 ? (
                <div className="mt-2.5">
                  <ColumnTitle count={cave.length}>CAVE</ColumnTitle>
                  <ul className="space-y-0.5 text-[13px] font-medium leading-snug text-rose-700">
                    {cave.map((item, index) => (
                      <li key={item.id ?? index}>
                        <span>{item.label}</span>
                        {item.note ? (
                          <span className="font-normal text-muted-foreground"> · {item.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="min-w-0">
              <ColumnTitle count={diagnoses.length || undefined}>{tx("Диагнозы", "Diagnosen")}</ColumnTitle>
              {diagnoses.length === 0 ? (
                dash
              ) : (
                <ul className="relative space-y-1 border-l border-border/70 pl-3">
                  {rootDiagnoses.map((d) => renderDiagnosis(d))}
                </ul>
              )}
            </div>

            <div className="min-w-0">
              <ColumnTitle count={activeRecommendations.length || undefined}>{tx("Рекомендации", "Empfehlungen")}</ColumnTitle>
              {activeRecommendations.length === 0 ? (
                dash
              ) : (
                <ul className="list-disc space-y-1 pl-3.5 marker:text-muted-foreground/50">
                  {activeRecommendations.map((rec) => {
                    const sub: string[] = [];
                    if (rec.recommendation_type) sub.push(rec.recommendation_type);
                    sub.push(...splitLines(rec.description));
                    if (rec.due_at) sub.push(rec.due_at);
                    return (
                      <li key={rec.id} className="leading-snug">
                        <span className="text-[13px] font-medium text-foreground">{rec.title}</span>
                        {rec.lifecycle_status === "nicht_erfolgt" ? (
                          <span className="ml-1 text-[10px] font-medium text-rose-600">
                            ({tx("не выполнено", "nicht erfolgt")})
                          </span>
                        ) : rec.lifecycle_status === "unbekannt" ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            ({tx("статус неизвестен", "unbekannt")})
                          </span>
                        ) : null}
                        <SubBullets items={sub} />
                      </li>
                    );
                  })}
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
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <tr>
                      {medColumns.map((column) => (
                        <th key={column} scope="col" className="px-2.5 py-2 font-semibold">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {medications.map((item, index) => (
                      <tr key={item.id ?? index} className="align-top transition-colors hover:bg-muted/30">
                        <td className="px-2.5 py-2 text-foreground">{item.wirkstoff || "—"}</td>
                        <td className="px-2.5 py-2 font-medium text-foreground">
                          {item.handelsname || tx("Без названия", "Ohne Namen")}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-foreground">{item.staerke || ""}</td>
                        <td className="px-2.5 py-2 text-foreground">{item.form || ""}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 font-mono tabular-nums text-foreground">{intakeScheme(item) || "—"}</td>
                        <td className="px-2.5 py-2 text-muted-foreground">{item.hinweis || ""}</td>
                        <td className="px-2.5 py-2 text-foreground">{item.grund || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="min-w-0 border-t border-border/60 pt-3 lg:-my-3 lg:-mr-3 lg:self-stretch lg:rounded-r-2xl lg:border-l lg:border-t-0 lg:border-border/60 lg:bg-muted/30 lg:p-3">
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
        </aside>
      </div>
    </section>
  );
}
