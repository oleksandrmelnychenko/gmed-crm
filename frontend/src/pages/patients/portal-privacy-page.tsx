import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useReducer, type FormEvent } from "react";
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
import { formatUnknownValue, useLang } from "@/lib/i18n";
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
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  return sharedPrivacyRequestSourceLabel(value);
  switch (value) {
    case "patient_portal":
      return l("Patientenportal", "Портал пациента", "Patient portal");
    case "staff_workspace":
      return l("Team-Workspace", "Рабочая область команды", "Team workspace");
    default:
      return formatUnknownValue(value, translations);
  }
}

export function PatientPrivacyPage() {
  const { t, lang } = useLang();
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
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

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
          error: err instanceof Error ? err.message : l("Datenschutzanfragen konnten nicht geladen werden.", "Не удалось загрузить запросы по приватности.", "Failed to load privacy requests."),
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [version, l]);

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
        notice: l("Datenschutzanfrage wurde eingereicht.", "Запрос по приватности отправлен.", "Privacy request submitted."),
        submitting: false,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchPrivacyState({
        error: err instanceof Error ? err.message : l("Datenschutzanfrage konnte nicht gesendet werden.", "Не удалось отправить запрос по приватности.", "Failed to submit privacy request."),
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
        title={l("Datenschutzanfragen", "Запросы по приватности", "Privacy requests")}
        description={l("Reichen Sie DSGVO-Anfragen zur Datenlöschung, Verarbeitungseinschränkung oder zum Widerruf der Weitergabe an Dritte ein.", "Отправляйте запросы по защите данных на удаление, ограничение обработки или отзыв передачи третьим лицам.", "Submit DSGVO requests for data erasure, processing restriction or third-party sharing revocation.")}
        actions={
          <>
            <CountBadge>{l("Patientenportal", "Портал пациента", "Patient portal")}</CountBadge>
            <CountBadge>
              {l("Offene Anfragen", "Открытые запросы", "Open requests")}: {openRequests.length}
            </CountBadge>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => dispatchPrivacyState((current) => ({ version: current.version + 1 }))}
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <Section
          title={l("Neue Anfrage", "Новый запрос", "New request")}
          accessory={<Shield className="size-4 text-muted-foreground" />}
        >
          <p className="text-sm text-muted-foreground">
            {l("Anfragen gehen zur Prüfung und Bearbeitung an Ihren Patientenmanager.", "Запросы поступают вашему менеджеру пациента на рассмотрение и исполнение.", "Requests go to your patient manager for review and execution.")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label={l("Anfragetyp", "Тип запроса", "Request type")} htmlFor="privacy-type">
              <NativeComboboxSelect
                id="privacy-type"
                value={requestType}
                onChange={(event) => dispatchPrivacyState({ requestType: event.target.value as RequestType })}
                className={selectClass}
              >
                <option value="restriction">{l("Verarbeitung einschränken", "Ограничить обработку", "Restrict processing")}</option>
                <option value="erasure">{l("Daten löschen", "Удалить данные", "Erase data")}</option>
                <option value="third_party_revoke">{l("Weitergabe an Dritte widerrufen", "Отозвать передачу третьим лицам", "Revoke third-party sharing")}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={l("Begründung", "Причина", "Reason")} htmlFor="privacy-reason">
              <textarea
                id="privacy-reason"
                value={reason}
                onChange={(event) => dispatchPrivacyState({ reason: event.target.value })}
                placeholder={l("Optionaler Kontext für das Betreuungsteam", "Необязательный контекст для команды сопровождения", "Optional context for the care team")}
                className={cn(textareaClass, "min-h-[120px]")}
              />
            </Field>
            <Button
              type="submit"
              className={tokens.control.primaryButton}
              disabled={submitting}
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {l("Anfrage senden", "Отправить запрос", "Submit request")}
            </Button>
          </form>
        </Section>

        <Section title={l("Anfrageverlauf", "История запросов", "Request history")} accessory={<CountBadge>{requests.length}</CountBadge>}>
          <p className="text-sm text-muted-foreground">
            {l("Zeitachse eingereichter Datenschutzmaßnahmen und ihrer Fristen.", "Хронология отправленных запросов по приватности и их сроков.", "Timeline for submitted privacy actions and due dates.")}
          </p>
          {requests.length === 0 ? (
            <EmptyCell>
              {l("Noch keine Datenschutzanfragen eingereicht.", "Запросы по приватности еще не отправлялись.", "No privacy requests submitted yet.")}
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
                        {l("Eingereicht", "Отправлено", "Submitted")} {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} tone={privacyStatusBadgeTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Fällig", "Срок", "Due")} value={formatPortalDate(item.due_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Geprüft", "Проверено", "Reviewed")} value={formatPortalDateTime(item.reviewed_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Ausgeführt", "Исполнено", "Executed")} value={formatPortalDateTime(item.executed_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Quelle", "Источник", "Source")} value={privacyRequestSourceLabel(item.source, l, t)} />
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
