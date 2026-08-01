import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { apiFetch } from "@/lib/api";
import {
  formatEnumLabelFromKeys,
  t as translateCatalog,
  useLang,
  type Translations,
} from "@/lib/i18n";
import { CASE_STATUS_LABEL_KEYS } from "@/lib/i18n/catalogs/cases-clinical";
import { cn } from "@/lib/utils";
import {
  daysInStatus,
  daysInStatusLabel,
} from "@/pages/leads/appearance/status-appearance";

import { AllergiesSection } from "./allergies-section";
import { CardiologySection } from "./cardiology-section";
import { CaseWorkspaceProvider, useCaseWorkspace } from "./context";
import { GastroenterologySection } from "./gastroenterology-section";
import { HistorySection } from "./history-section";
import { ImpfstatusSection } from "./impfstatus-section";
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

const CASE_CLOSE_REASONS = ["abgeschlossen", "abgebrochen", "dublette"] as const;

function caseStatusLabel(
  status: string,
  labels: Translations,
) {
  return formatEnumLabelFromKeys(status, CASE_STATUS_LABEL_KEYS, labels);
}

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

function closeReasonLabel(reason: string, lang: string) {
  return tri(lang, `case_ws_close_reason_${reason}`);
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
    case "impfstatus":
      return <ImpfstatusSection />;
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
  const {
    caseId,
    detail,
    loading,
    error,
    permissions,
    sectionBusy,
    updateStatus,
  } = useCaseWorkspace();
  const activeSection = normalizeCaseSectionKey(searchParams.get("section"));
  const activePatientId = detail?.patient_id ?? null;

  const [patient, setPatient] = useState<CasePatientSummary | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const statusBusy = sectionBusy === "status";

  async function handleStatusChange(status: string, reason?: string) {
    const saved = await updateStatus(status, reason);
    if (saved) {
      setCloseDialogOpen(false);
      setCloseReason("");
    }
  }

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
      <header className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
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
              {detail?.status === "closed" && detail.closed_reason ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-border/60 bg-muted/25 text-muted-foreground"
                >
                  {closeReasonLabel(detail.closed_reason, lang)}
                </Badge>
              ) : null}
              {daysInStatus(detail?.status_changed_at) != null ? (
                <span className="text-xs text-muted-foreground">
                  · {daysInStatusLabel(daysInStatus(detail?.status_changed_at)!, lang)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {t.cases_workspace_header_description}
            </p>
            {patientLabelText ? (
              <p className="mt-3 inline-flex items-center gap-2 text-sm text-foreground">
                <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />
                {patientLabelText}
              </p>
            ) : null}
          </div>
          {detail && permissions.canEdit ? (
            <div className="flex flex-wrap gap-2">
              {detail.status === "open" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg bg-card px-3 text-xs"
                  disabled={statusBusy}
                  onClick={() => void handleStatusChange("in_progress")}
                >
                  {statusBusy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {tri(lang, "case_ws_status_start")}
                </Button>
              ) : null}
              {detail.status === "open" || detail.status === "in_progress" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg bg-card px-3 text-xs"
                  disabled={statusBusy}
                  onClick={() => {
                    setCloseReason("");
                    setCloseDialogOpen(true);
                  }}
                >
                  {tri(lang, "case_ws_status_close")}
                </Button>
              ) : null}
              {detail.status === "closed" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg bg-card px-3 text-xs"
                  disabled={statusBusy}
                  onClick={() => void handleStatusChange("in_progress")}
                >
                  {statusBusy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {tri(lang, "case_ws_status_reopen")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen} allowImplicitDismissal>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tri(lang, "case_ws_status_close")}</DialogTitle>
            <DialogDescription>
              {tri(lang, "case_ws_close_description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {tri(lang, "case_ws_close_reason")}
            </span>
            <NativeComboboxSelect
              value={closeReason || "__none__"}
              onChange={(event) =>
                setCloseReason(
                  event.target.value === "__none__" ? "" : event.target.value,
                )
              }
              className="h-9 w-full rounded-lg border border-border bg-field px-3 text-sm"
            >
              <option value="__none__">{t.common_not_set}</option>
              {CASE_CLOSE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {closeReasonLabel(reason, lang)}
                </option>
              ))}
            </NativeComboboxSelect>
          </div>
          <DialogFooter showCloseButton>
            <Button
              type="button"
              className="h-9 rounded-lg"
              disabled={!closeReason || statusBusy}
              onClick={() => void handleStatusChange("closed", closeReason)}
            >
              {statusBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {tri(lang, "case_ws_status_close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
