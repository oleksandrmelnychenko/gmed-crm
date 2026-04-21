import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
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
  closed: "border-slate-200 bg-slate-50 text-slate-600",
};

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      <header className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-orange-50/40 to-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full bg-orange-500 shadow-[0_0_0_4px_rgba(249,115,22,0.15)]"
            />
            <h1 className="text-xl font-semibold tracking-tight text-slate-950">
              {detail?.case_id ?? caseId}
            </h1>
            {detail?.status ? (
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full",
                  STATUS_BADGE_CLASS[detail.status] ??
                    "border-slate-200 bg-white text-slate-700",
                )}
              >
                {detail.status}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
            {tri(
              lang,
              "Workspace für den ausgewählten Patientenfall. Die Sektionen werden aus der linken Navigation geöffnet.",
              "Рабочее пространство выбранного кейса пациента. Разделы открываются из левого меню.",
              "Workspace for the selected patient case. Open sections from the left nav.",
            )}
          </p>
          {patientLabelText ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
              <span aria-hidden className="size-1.5 rounded-full bg-slate-400" />
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
        <div className="flex min-h-[280px] items-center justify-center rounded-[1.75rem] border border-slate-200/80 bg-white text-sm text-slate-500">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {t.common_loading}
        </div>
      ) : (
        renderSection(activeSection)
      )}
    </div>
  );
}
