import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { AllergiesSection } from "./allergies-section";
import { CardiologySection } from "./cardiology-section";
import { CaseWorkspaceProvider, useCaseWorkspace } from "./context";
import { GastroenterologySection } from "./gastroenterology-section";
import { HistorySection } from "./history-section";
import { MedicationsSection } from "./medications-section";
import { NeurologySection } from "./neurology-section";
import { OrthopedicsSection } from "./orthopedics-section";
import { OverviewSection } from "./overview-section";
import { PainSection } from "./pain-section";
import { PreconditionsSection } from "./preconditions-section";
import { PulmonologySection } from "./pulmonology-section";
import { SurgeriesSection } from "./surgeries-section";
import { SymptomsSection } from "./symptoms-section";
import { UrologySection } from "./urology-section";
import { VegetativeSection } from "./vegetative-section";
import { type CaseSectionKey, normalizeCaseSectionKey } from "./sections";

type CasePatientSummary = {
  id: string;
  patient_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-border/60 bg-muted/25 text-muted-foreground",
};

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function caseStatusLabel(
  status: string,
  labels: Pick<
    Translations,
    "cases_open" | "cases_in_progress" | "cases_closed" | "common_unknown" | "common_unknown_value"
  >,
) {
  const dictionary = labels as unknown as Record<string, string>;
  return dictionary[`cases_${status}`] ?? formatUnknownValue(status, labels);
}

function renderSection(section: CaseSectionKey) {
  switch (section) {
    case "overview":
      return <OverviewSection />;
    case "preconditions":
      return <PreconditionsSection />;
    case "allergies":
      return <AllergiesSection />;
    case "surgeries":
      return <SurgeriesSection />;
    case "medications":
      return <MedicationsSection />;
    case "pain":
      return <PainSection />;
    case "symptoms":
      return <SymptomsSection />;
    case "vegetative":
      return <VegetativeSection />;
    case "cardiology":
      return <CardiologySection />;
    case "gastroenterology":
      return <GastroenterologySection />;
    case "orthopedics":
      return <OrthopedicsSection />;
    case "neurology":
      return <NeurologySection />;
    case "pulmonology":
      return <PulmonologySection />;
    case "urology":
      return <UrologySection />;
    case "history":
      return <HistorySection />;
    default:
      return <OverviewSection />;
  }
}

export function CaseWorkspacePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { t } = useLang();

  if (!caseId) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
        {t.cases_title}
      </div>
    );
  }

  return (
    <CaseWorkspaceProvider caseId={caseId}>
      <CaseWorkspaceContent />
    </CaseWorkspaceProvider>
  );
}

function CaseWorkspaceContent() {
  const { t, lang } = useLang();
  const [searchParams] = useSearchParams();
  const { caseId, detail, loading, error } = useCaseWorkspace();
  const activeSection = normalizeCaseSectionKey(searchParams.get("section"));
  const activePatientId = detail?.patient_id ?? null;

  const [patient, setPatient] = useState<CasePatientSummary | null>(null);

  useEffect(() => {
    if (!activePatientId) return;
    const controller = new AbortController();
    const { signal } = controller;
    apiFetch<CasePatientSummary>(`/patients/${activePatientId}`, { signal })
      .then((payload) => {
        if (!signal.aborted) setPatient(payload);
      })
      .catch(() => {
        if (!signal.aborted) setPatient(null);
      });
    return () => controller.abort();
  }, [activePatientId]);

  const patientLabelText = useMemo(() => {
    if (!activePatientId) return "";
    if (!patient) return activePatientId;
    const name = [patient.last_name, patient.first_name]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(", ");
    const pid = patient.patient_id ?? patient.id;
    if (name && pid) return `${name} (${pid})`;
    return name || pid || "";
  }, [activePatientId, patient]);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-xl border border-border/60 bg-muted/20 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-[var(--brand)]"
            />
            <h1 className="text-base font-semibold text-foreground">
              {detail?.case_id ?? caseId}
            </h1>
            {detail?.status ? (
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full",
                  STATUS_BADGE_CLASS[detail.status] ??
                    "border-border/60 bg-muted/25 text-foreground",
                )}
              >
                {caseStatusLabel(detail.status, t)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {tri(
              lang,
              "Workspace für den ausgewählten Patientenfall. Die Sektionen werden aus der linken Navigation geöffnet.",
              "Рабочее пространство выбранного кейса пациента. Разделы открываются из левого меню.",
              "Workspace for the selected patient case. Open sections from the left nav.",
            )}
          </p>
          {patientLabelText ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />
              {patientLabelText}
            </p>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-border/50 bg-card text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {t.common_loading}
        </div>
      ) : (
        renderSection(activeSection)
      )}
    </div>
  );
}
