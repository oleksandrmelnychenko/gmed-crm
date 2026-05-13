import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useEffect, useMemo, useReducer, type FormEvent } from "react";
import { LoaderCircle, RefreshCw, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  InfoRow,
  ListItem,
  PageHeader,
  Section,
  selectClass,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  createPortalPrivacyRequest,
  fetchPortalPrivacyRequests,
} from "@/pages/patients/data/portal-api";
import {
  formatPortalDate,
  formatPortalDateTime,
  portalStatusLabel,
  privacyRequestLabel,
  privacyRequestSourceLabel as sharedPrivacyRequestSourceLabel,
} from "@/pages/patients/model/portal-shared";
import type { PortalPrivacyRequest } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

type RequestType = "erasure" | "restriction" | "third_party_revoke";

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
  requestType: RequestType;
  reason: string;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  notice: string;
  error: string;
  version: number;
}

type PatientPrivacyAction =
  | Partial<PatientPrivacyState>
  | ((current: PatientPrivacyState) => Partial<PatientPrivacyState>);

const INITIAL_PATIENT_PRIVACY_STATE: PatientPrivacyState = {
  requests: [],
  requestType: "restriction",
  reason: "",
  loading: true,
  refreshing: false,
  submitting: false,
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
  const { t } = useLang();
  const [privacyState, dispatchPrivacyState] = useReducer(
    patientPrivacyReducer,
    INITIAL_PATIENT_PRIVACY_STATE,
  );
  const {
    error,
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
    dispatchPrivacyState({ submitting: true, notice: "", error: "" });

    try {
      await createPortalPrivacyRequest({
        request_type: requestType,
        reason: reason.trim() || null,
      });
      dispatchPrivacyState((current) => ({
        reason: "",
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

  if (loading) {
    return (
      <div className="min-h-[320px]">
        <TabLoader />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.portal_privacy_title}
        description={t.portal_privacy_description}
        actions={
          <>
            <CountBadge>{t.portal_privacy_patient_portal}</CountBadge>
            <CountBadge>
              {t.portal_privacy_open_requests}: {openRequests.length}
            </CountBadge>
            <Button
              variant="outline"
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

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <Section
          title={t.portal_privacy_new_request}
          accessory={<Shield className="size-4 text-muted-foreground" />}
        >
          <p className="text-sm text-muted-foreground">
            {t.portal_privacy_manager_review_hint}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label={t.portal_privacy_request_type} htmlFor="privacy-type">
              <NativeComboboxSelect
                id="privacy-type"
                value={requestType}
                onChange={(event) => dispatchPrivacyState({ requestType: event.target.value as RequestType })}
                className={selectClass}
              >
                <option value="restriction">{t.portal_privacy_request_restriction}</option>
                <option value="erasure">{t.portal_privacy_request_erasure}</option>
                <option value="third_party_revoke">{t.portal_privacy_request_third_party_revoke}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={t.portal_privacy_reason} htmlFor="privacy-reason">
              <textarea
                id="privacy-reason"
                value={reason}
                onChange={(event) => dispatchPrivacyState({ reason: event.target.value })}
                placeholder={t.portal_privacy_reason_placeholder}
                className={cn(textareaClass, "min-h-[120px]")}
              />
            </Field>
            <Button
              type="submit"
              className={tokens.control.primaryButton}
              disabled={submitting}
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.portal_privacy_submit_request}
            </Button>
          </form>
        </Section>

        <Section title={t.portal_privacy_request_history} accessory={<CountBadge>{requests.length}</CountBadge>}>
          <p className="text-sm text-muted-foreground">
            {t.portal_privacy_history_description}
          </p>
          {requests.length === 0 ? (
            <EmptyCell>
              {t.portal_privacy_empty}
            </EmptyCell>
          ) : (
            <div className="space-y-3">
              {requests.map((item) => (
                <ListItem key={item.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.portal_privacy_submitted} {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} tone={privacyStatusBadgeTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_due} value={formatPortalDate(item.due_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_reviewed} value={formatPortalDateTime(item.reviewed_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_executed} value={formatPortalDateTime(item.executed_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_privacy_source} value={privacyRequestSourceLabel(item.source)} />
                  </div>

                  {item.reason ? (
                    <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                      {item.reason}
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
