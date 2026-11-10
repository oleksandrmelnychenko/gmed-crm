import { PortalInfoRow as InfoRow, PortalListItem as ListItem, PortalSection as Section, PortalDateChip } from "./ui/portal-page-layout";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useEffect, useMemo, useReducer, type FormEvent } from "react";
import { Download, History, LoaderCircle, RefreshCw, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  PageHeader,
  selectClass,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { uiText, useLang, useLanguageBound } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  createPortalPrivacyRequest,
  downloadPatientPortalExport,
  fetchPortalPrivacyRequests,
} from "@/pages/patients/data/portal-api";
import {
  privacyRequestSourceLabel as sharedPrivacyRequestSourceLabel,
  usePortalLabels,
} from "@/pages/patients/model/portal-shared";
import type { PortalPrivacyRequest } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

type RequestType =
  | "erasure"
  | "restriction"
  | "third_party_revoke"
  | "access"
  | "rectification"
  | "portability"
  | "objection";

/**
 * An erasure that waits for running orders and invoices: the patient reads a
 * neutral "carried out once current orders are completed", not a retention
 * block (QA 2026-10-12 B2-10).
 */
function waitsForOpenBusiness(item: Pick<PortalPrivacyRequest, "status" | "hold_reason">) {
  return item.status === "retention_hold" && item.hold_reason === "open_business";
}

/**
 * A completed request for a copy of the data (Art. 15) or for a
 * machine-readable copy (Art. 20): the patient fetches it with the export.
 */
function completedDataCopy(item: Pick<PortalPrivacyRequest, "status" | "request_type">) {
  return (
    ["completed", "executed"].includes(item.status) &&
    ["access", "portability"].includes(item.request_type)
  );
}

function privacyStatusBadgeTone(status: string): StatusTone {
  if (status === "executed" || status === "completed") return "success";
  if (status === "rejected") return "error";
  return "warning";
}

const PORTAL_PRIVACY_REALTIME_EVENTS = [
  "privacy_request.created",
  "privacy_request.reviewed",
  "privacy_request.executed",
] as const;

interface PatientPrivacyState {
  requests: PortalPrivacyRequest[];
  /** Empty until the patient picks a type: no legal request is pre-chosen. */
  requestType: RequestType | "";
  reason: string;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  /** The data export started from a completed request for a copy. */
  exportBusy: boolean;
  notice: string;
  error: string;
  version: number;
}

type PatientPrivacyAction =
  | Partial<PatientPrivacyState>
  | ((current: PatientPrivacyState) => Partial<PatientPrivacyState>);

const INITIAL_PATIENT_PRIVACY_STATE: PatientPrivacyState = {
  requests: [],
  requestType: "",
  reason: "",
  loading: true,
  refreshing: false,
  submitting: false,
  exportBusy: false,
  notice: "",
  error: "",
  version: 0,
};

function patientPrivacyReducer(
  current: PatientPrivacyState,
  action: PatientPrivacyAction,
): PatientPrivacyState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function privacyRequestSourceLabel(
  value: string | null | undefined,
) {
  return sharedPrivacyRequestSourceLabel(value);
}

export function PatientPrivacyPage() {
  const {
    formatPortalDate,
    portalStatusLabel,
    privacyRequestLabel,
  } = usePortalLabels();
  const { privacyRequestSourceLabel } = useLanguageHelpers();
  const { lang, t } = useLang();
  const [privacyState, dispatchPrivacyState] = useReducer(
    patientPrivacyReducer,
    INITIAL_PATIENT_PRIVACY_STATE,
  );
  const {
    error,
    exportBusy,
    loading,
    notice,
    reason,
    refreshing,
    requestType,
    requests,
    submitting,
    version,
  } = privacyState;

  useRealtimeSubscription(PORTAL_PRIVACY_REALTIME_EVENTS, () => {
    clearApiCache("/me/privacy-requests");
    dispatchPrivacyState((current) => ({ version: current.version + 1 }));
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      dispatchPrivacyState((current) => ({
        refreshing: !current.loading,
        error: "",
      }));

      try {
        const rows = await fetchPortalPrivacyRequests();
        if (cancelled) return;
        startTransition(() =>
          dispatchPrivacyState({
            requests: rows,
            error: "",
            loading: false,
            refreshing: false,
          }),
        );
      } catch (err) {
        if (cancelled) return;
        dispatchPrivacyState({
          error: err instanceof Error ? err.message : t.portal_privacy_failed_to_load_requests,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [version, t.portal_privacy_failed_to_load_requests]);

  const openRequests = useMemo(
    () => requests.filter((item) => !["rejected", "completed", "executed"].includes(item.status)),
    [requests],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestType) return;
    dispatchPrivacyState({ submitting: true, notice: "", error: "" });

    try {
      await createPortalPrivacyRequest({
        request_type: requestType,
        reason: reason.trim() || null,
      });
      dispatchPrivacyState((current) => ({
        reason: "",
        requestType: "",
        notice: t.portal_privacy_request_submitted,
        submitting: false,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchPrivacyState({
        error: err instanceof Error ? err.message : t.portal_privacy_failed_to_submit_request,
        submitting: false,
      });
    }
  }

  async function handleExport() {
    dispatchPrivacyState({ exportBusy: true, error: "" });
    try {
      await downloadPatientPortalExport();
    } catch (err) {
      dispatchPrivacyState({
        error: err instanceof Error ? err.message : t.portal_dashboard_failed_to_export_patient_data,
      });
    } finally {
      dispatchPrivacyState({ exportBusy: false });
    }
  }

  if (loading) {
    return (
      <div className="min-h-[320px]">
        <TabLoader />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      <PageHeader
        title={t.portal_privacy_title}
        description={t.portal_privacy_description}
        actions={
          <>

            <CountBadge>
              {t.portal_privacy_open_requests}: {openRequests.length}
            </CountBadge>
            <Button
              variant="default"
              className={tokens.control.primaryButton}
              onClick={() => dispatchPrivacyState((current) => ({ version: current.version + 1 }))}
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {t.portal_privacy_refresh}
            </Button>
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid items-start gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <Section
          title={t.portal_privacy_new_request}
          icon={Shield}
        >

          <form onSubmit={handleSubmit} className="space-y-3 [&_label]:font-mono [&_label]:text-xs">
            <Field label={t.portal_privacy_request_type} htmlFor="privacy-type">
              <NativeComboboxSelect
                id="privacy-type"
                value={requestType}
                onChange={(event) =>
                  dispatchPrivacyState({ requestType: event.target.value as RequestType | "" })
                }
                className={selectClass}
              >
                <option value="">{uiText("portal_privacy_request_type_choose", lang)}</option>
                <option value="restriction">{t.portal_privacy_request_restriction}</option>
                <option value="erasure">{t.portal_privacy_request_erasure}</option>
                <option value="third_party_revoke">{t.portal_privacy_request_third_party_revoke}</option>
                <option value="access">{t.portal_privacy_request_access}</option>
                <option value="rectification">{t.portal_privacy_request_rectification}</option>
                <option value="portability">{t.portal_privacy_request_portability}</option>
                <option value="objection">{t.portal_privacy_request_objection}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={t.portal_privacy_reason} htmlFor="privacy-reason">
              <textarea
                id="privacy-reason"
                value={reason}
                onChange={(event) => dispatchPrivacyState({ reason: event.target.value })}
                placeholder={t.portal_privacy_reason_placeholder}
                className={cn(textareaClass, "min-h-24")}
              />
            </Field>
            <Button
              type="submit"
              className="h-auto min-h-9 max-w-full whitespace-normal"
              disabled={submitting || !requestType}
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.portal_privacy_submit_request}
            </Button>
          </form>
        </Section>

        <Section icon={History} title={t.portal_privacy_request_history} accessory={<CountBadge>{requests.length}</CountBadge>}>
          {requests.length === 0 ? (
            <EmptyCell>
              {t.portal_privacy_empty}
            </EmptyCell>
          ) : (
            <div className="space-y-2">
              {requests.map((item) => (
                <ListItem key={item.id} className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <span>{t.portal_privacy_submitted} <PortalDateChip timestamp={item.requested_at} /></span>
                    </div>
                    <StatusBadge status={item.status} tone={privacyStatusBadgeTone(item.status)}>
                      {waitsForOpenBusiness(item)
                        ? uiText("portal_privacy_status_open_business_hold", lang)
                        : portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  {waitsForOpenBusiness(item) ? (
                    <p className="text-sm text-muted-foreground" data-testid="privacy-open-business-hint">
                      {uiText("portal_privacy_open_business_hint", lang)}
                    </p>
                  ) : null}

                  <div className="grid gap-2 md:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_due} value={<PortalDateChip>{formatPortalDate(item.due_at)}</PortalDateChip>} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_reviewed} value={<PortalDateChip timestamp={item.reviewed_at} />} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_executed} value={<PortalDateChip timestamp={item.executed_at} />} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_source} value={privacyRequestSourceLabel(item.source)} />
                  </div>

                  {completedDataCopy(item) ? (
                    // A completed request for a copy carries no file: the copy
                    // is the export, offered right here (global QA 2026-11-10).
                    <div
                      className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-foreground", tokens.surface.mutedCard)}
                      data-testid="privacy-data-copy-hint"
                    >
                      <p className="min-w-0 flex-1 basis-56">{uiText("portal_privacy_data_copy_hint", lang)}</p>
                      <Button
                        type="button"
                        className="h-auto min-h-8 max-w-full whitespace-normal rounded-lg"
                        disabled={exportBusy}
                        onClick={() => void handleExport()}
                      >
                        {exportBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        {t.portal_dashboard_export_my_data}
                      </Button>
                    </div>
                  ) : null}

                  {item.reason ? (
                    <div className={cn("rounded-lg px-3 py-2 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                      {item.reason}
                    </div>
                  ) : null}
                  {item.decision_reason ? (
                    <div
                      className={cn("mt-2 rounded-lg px-3 py-2 text-sm text-foreground", tokens.surface.mutedCard)}
                      data-testid="privacy-decision-reason"
                    >
                      <span className="font-medium">{uiText("privacy_decision_reason_label", lang)}:</span>{" "}
                      {item.decision_reason}
                    </div>
                  ) : null}
                </ListItem>
              ))}
            </div>
          )}
        </Section>
      </section>
    </div>
  );
}

/**
 * The helpers of this file that read the UI language themselves; its
 * components take them from `useLanguageHelpers()` (bound to the current language).
 */
const LANGUAGE_HELPERS = {
  privacyRequestSourceLabel,
};

function useLanguageHelpers() {
  return useLanguageBound(LANGUAGE_HELPERS);
}
