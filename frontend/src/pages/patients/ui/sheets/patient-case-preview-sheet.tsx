import { useEffect, useState } from "react";
import { ExternalLink, Folder, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

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

function formatDate(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
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
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
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

  const statusLabel = activeDetail
    ? tr[`cases_${activeDetail.status}`] ?? activeDetail.status.replaceAll("_", " ")
    : "";
  const statusClassName = activeDetail
    ? caseStatusBadgeClass(activeDetail.status)
    : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-[980px]">
        <SheetHeader className="border-b border-border/70 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="inline-flex items-center gap-2">
              <Folder className="size-4 text-muted-foreground" />
              {activeDetail?.case_id || "Case"}
            </SheetTitle>
            {caseId && showFullViewAction ? (
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
                Full view
                <ExternalLink className="size-3" />
              </Button>
            ) : null}
          </div>
          <SheetDescription>
            Full narrative and structured anamnesis editor for the selected patient case.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {showLoading ? (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              Loading case
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
                  <MetaCard label="Reference code" value={activeDetail.case_id} mono />
                  <MetaCard
                    label="System case UUID"
                    value={activeDetail.case_uuid ?? activeDetail.id}
                    mono
                  />
                  <MetaCard
                    label="Retention until"
                    value={formatDate(activeDetail.retention_until)}
                  />
                  <MetaCard
                    label="Last clinical update"
                    value={formatDateTime(
                      activeDetail.last_clinical_update_at ?? activeDetail.updated_at,
                    )}
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
                <Field label={t.cases_reason} value={activeDetail.hauptanfragegrund} />
                <Field label={t.cases_narrative} value={activeDetail.aktuelle_anamnese} />
                <Field label={t.cases_referrer} value={activeDetail.zuweiser} />
                <Field label={t.patients_notes} value={activeDetail.notes} />
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
                        item.datum ? formatDate(item.datum) : "",
                        item.grund ?? "",
                        item.arzt ?? "",
                      ]
                        .filter(Boolean)
                        .join(" • "),
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
                        .join(" • "),
                    ) ?? []
                  }
                  emptyLabel={t.common_not_set}
                />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-950">
                  Specialized assessments
                </h3>
                <KeyValueGrid
                  title="Cardiology"
                  recommended={activeDetail.cardiology_recommended}
                  data={activeDetail.cardiology}
                  notSetLabel={t.common_not_set}
                />
                <KeyValueGrid
                  title="Gastroenterology"
                  recommended={activeDetail.gastroenterology_recommended}
                  data={activeDetail.gastroenterology}
                  notSetLabel={t.common_not_set}
                />
                <KeyValueGrid
                  title="Orthopedics"
                  recommended={activeDetail.orthopedics_recommended}
                  data={activeDetail.orthopedics}
                  notSetLabel={t.common_not_set}
                />
                <KeyValueGrid
                  title="Neurology"
                  recommended={activeDetail.neurology_recommended}
                  data={activeDetail.neurology}
                  notSetLabel={t.common_not_set}
                />
                <KeyValueGrid
                  title="Pulmonology"
                  recommended={activeDetail.pulmonology_recommended}
                  data={activeDetail.pulmonology}
                  notSetLabel={t.common_not_set}
                />
                <KeyValueGrid
                  title="Urology"
                  recommended={activeDetail.urology_recommended}
                  data={activeDetail.urology}
                  notSetLabel={t.common_not_set}
                />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-950">
                  Additional blocks
                </h3>
                <KeyValueGrid
                  title={t.cases_vegetative}
                  data={activeDetail.vegetative_anamnese}
                  notSetLabel={t.common_not_set}
                />
                <Field label={t.cases_vaccination} value={activeDetail.impfstatus} />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-950">History</h3>
                {activeDetail.history?.length ? (
                  <div className="space-y-2">
                    {activeDetail.history.map((entry) => (
                      <div
                        key={`${entry.id ?? "entry"}-${entry.created_at ?? ""}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {entry.section || t.common_not_set}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDateTime(entry.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">
                          {[entry.changed_by_name, entry.changed_by_role]
                            .filter(Boolean)
                            .join(" • ") || t.common_not_set}
                        </p>
                        <div className="mt-2 grid gap-2 lg:grid-cols-2">
                          <CodeBlock
                            label="Old value"
                            value={safeStringify(entry.old_value)}
                          />
                          <CodeBlock
                            label="New value"
                            value={safeStringify(entry.new_value)}
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
      </SheetContent>
    </Sheet>
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
  mono = false,
}: {
  label: string;
  value: string;
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
        {value || "-"}
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
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <p className="text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">
        {value?.trim() || "-"}
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
  notSetLabel,
}: {
  title: string;
  recommended?: boolean;
  data?: Record<string, unknown> | null;
  notSetLabel: string;
}) {
  const entries = Object.entries(data ?? {});

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {recommended != null ? (
          <Badge variant="outline" className="rounded-full text-[10px]">
            {recommended ? "recommended" : "not required"}
          </Badge>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">{notSetLabel}</p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.1em] text-slate-500">{key}</p>
              <p className="mt-1 break-words text-sm text-slate-900">
                {typeof value === "string"
                  ? value || notSetLabel
                  : typeof value === "boolean"
                    ? value
                      ? "Yes"
                      : "No"
                    : value == null
                      ? notSetLabel
                      : safeStringify(value)}
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

function safeStringify(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
