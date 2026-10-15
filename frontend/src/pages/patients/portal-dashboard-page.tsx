import { startTransition, useCallback, useEffect, useMemo, useReducer } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Download,
  FileText,
  LayoutGrid,
  LoaderCircle,
  MessageSquare,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { PortalSection as Section, PortalSummary, PortalComplete } from "./ui/portal-page-layout";
import { Button } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import {
  Banner,
  CountBadge,
  EmptyCell,
  InfoRow,
  ListItem,
  PageHeader,
  StatusBadge,
  TabLoader,
  TabShell,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatPluralCount, useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { localizeRequiredDocumentLabel } from "@/lib/required-document-labels";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import {
  downloadPatientPortalExport,
  fetchPatientPortalWorkspace,
} from "@/pages/patients/data/portal-api";
import {
  appointmentStatusTone,
  conciergeServiceStatusTone,
  feedbackStatusTone,
  invoiceStatusTone,
  nextActionTone,
  portalAppointmentPlaceLabel,
  privacyStatusTone,
  recommendationStatusTone,
  usePortalLabels,
} from "@/pages/patients/model/portal-shared";
import { isUpcomingPortalAppointment } from "@/pages/appointments/model/portal-appointment-visibility";
import {
  formatNextActionKind,
  nextActionButtonLabel,
  nextActionDescription,
} from "@/pages/patients/model/portal-next-actions";
import type {
  PortalAppointmentItem,
  PortalConciergeServiceItem,
  PortalDocumentAlertsSummary,
  PortalDocumentItem,
  PortalFeedbackItem,
  PortalInvoiceItem,
  PortalNextActionItem,
  PortalPrivacyRequest,
  PortalRecommendationItem,
} from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";
import { PatientPortalMobileAccess } from "@/pages/patients/ui/patient-portal-mobile-access";
import { missingDocumentHints } from "@/pages/patients/model/portal-required-documents";

const PATIENT_DASHBOARD_REALTIME_EVENTS = [
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "appointment_request.cancelled",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "document.uploaded",
  "document.payment_proof_uploaded",
  "document.generated",
  "document.updated",
  "document.deleted",
  "document.portal_released",
  "document.portal_revoked",
  "document.confirmed",
  "document.translation_requested",
  "document.translation_updated",
  "recommendation.created",
  "recommendation.updated",
  "recommendation.patient_decision",
  "recommendation.appointment_requested",
  "invoice.created",
  "invoice.status_changed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "privacy_request.created",
  "privacy_request.reviewed",
  "privacy_request.executed",
  "feedback.submitted",
  "feedback.reviewed",
  "order.phase_changed",
  "order.followup_flow_updated",
  "order.external_invoice_overdue",
] as const;

function nextActionPriorityRank(priority?: string | null) {
  switch (priority) {
    case "urgent":
      return 0;
    case "high":
      return 1;
    case "normal":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

function compareNextActions(a: PortalNextActionItem, b: PortalNextActionItem) {
  const priorityDiff = nextActionPriorityRank(a.priority) - nextActionPriorityRank(b.priority);
  if (priorityDiff !== 0) return priorityDiff;
  const aDue = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
  const bDue = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
  return aDue - bDue;
}

interface PatientDashboardState {
  loading: boolean;
  refreshing: boolean;
  documents: PortalDocumentItem[];
  documentAlerts: PortalDocumentAlertsSummary | null;
  appointments: PortalAppointmentItem[];
  services: PortalConciergeServiceItem[];
  invoices: PortalInvoiceItem[];
  recommendations: PortalRecommendationItem[];
  nextActions: PortalNextActionItem[];
  requests: PortalPrivacyRequest[];
  feedback: PortalFeedbackItem[];
  error: string;
  version: number;
  exportBusy: boolean;
}

type PatientDashboardAction =
  | Partial<PatientDashboardState>
  | ((current: PatientDashboardState) => Partial<PatientDashboardState>);

const INITIAL_PATIENT_DASHBOARD_STATE: PatientDashboardState = {
  loading: true,
  refreshing: false,
  documents: [],
  documentAlerts: null,
  appointments: [],
  services: [],
  invoices: [],
  recommendations: [],
  nextActions: [],
  requests: [],
  feedback: [],
  error: "",
  version: 0,
  exportBusy: false,
};

function patientDashboardReducer(
  current: PatientDashboardState,
  action: PatientDashboardAction,
): PatientDashboardState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function usePatientDashboardPageContent() {
  const {
    conciergeServiceKindLabel,
    feedbackStatusLabel,
    formatPortalCurrency,
    formatPortalDate,
    formatPortalDateTime,
    portalDocumentTypeLabels,
    portalStatusLabel,
    privacyRequestLabel,
    recommendationPriorityLabel,
    recommendationTypeLabel,
  } = usePortalLabels();
  const { user } = useAuth();
  const { lang, t } = useLang();
  // Portal routes are checked against the patient whitelist.
  const { staffGo } = useStaffNavigate();
  const [dashboardState, dispatchDashboardState] = useReducer(
    patientDashboardReducer,
    INITIAL_PATIENT_DASHBOARD_STATE,
  );
  const {
    appointments,
    documentAlerts,
    documents,
    error,
    exportBusy,
    feedback,
    invoices,
    loading,
    nextActions,
    recommendations,
    refreshing,
    requests,
    services,
    version,
  } = dashboardState;
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  const greeting = t.portal_dashboard_hello;
  const patientLabel = t.portal_dashboard_patient;

  useRealtimeSubscription(PATIENT_DASHBOARD_REALTIME_EVENTS, () => {
    clearApiCache("/me/appointments");
    clearApiCache("/me/appointment-requests");
    clearApiCache("/me/concierge-services");
    clearApiCache("/me/documents");
    clearApiCache("/me/document-alerts");
    clearApiCache("/me/invoices");
    clearApiCache("/me/recommendations");
    clearApiCache("/me/next-actions");
    clearApiCache("/me/translation-requests");
    clearApiCache("/me/privacy-requests");
    clearApiCache("/me/feedback");
    clearApiCache("/me/followup-milestones");
    dispatchDashboardState((current) => ({ version: current.version + 1 }));
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      dispatchDashboardState((current) => ({
        refreshing: !current.loading,
        error: "",
      }));

      try {
        const workspace = await fetchPatientPortalWorkspace();

        if (cancelled) return;
        startTransition(() =>
          dispatchDashboardState({
            appointments: workspace.appointments,
            services: workspace.services,
            documents: workspace.documents,
            documentAlerts: workspace.documentAlerts,
            invoices: workspace.invoices,
            recommendations: workspace.recommendations,
            nextActions: workspace.nextActions,
            requests: workspace.privacyRequests,
            feedback: workspace.feedback,
            error: "",
            loading: false,
            refreshing: false,
          }),
        );
      } catch (err) {
        if (cancelled) return;
        dispatchDashboardState({
          error: err instanceof Error ? err.message : t.portal_dashboard_failed_to_load_portal_workspace,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t.portal_dashboard_failed_to_load_portal_workspace, version]);

  const releasedDocuments = documents.length;
  const upcomingAppointmentItems = useMemo(
    () =>
      appointments
        .filter((item) => isUpcomingPortalAppointment(item))
        .toSorted((a, b) =>
          `${a.date} ${a.time_start ?? ""}`.localeCompare(`${b.date} ${b.time_start ?? ""}`),
        ),
    [appointments],
  );
  const upcomingAppointments = upcomingAppointmentItems.length;
  const nextAppointment = upcomingAppointmentItems[0] ?? null;
  const appointmentsById = useMemo(
    () => new Map(appointments.map((item) => [item.id, item])),
    [appointments],
  );
  const openInvoiceCount = useMemo(
    () => invoices.filter((item) => Number(item.balance_due ?? 0) > 0).length,
    [invoices],
  );
  const pendingConfirmations = useMemo(
    () => documents.filter((item) => item.requires_confirmation && !item.confirmed).length,
    [documents],
  );
  const openServiceRequests = useMemo(
    () => services.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
    [services],
  );
  const openRequests = useMemo(
    () =>
      requests.filter(
        (item) => !["rejected", "completed", "executed"].includes(item.status),
      ).length,
    [requests],
  );
  const outstandingBalance = useMemo(
    () => invoices.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0),
    [invoices],
  );
  const recentFeedback = useMemo(() => feedback.slice(0, 4), [feedback]);
  const recentDocuments = useMemo(() => documents.slice(0, 4), [documents]);
  // "Upcoming visits" lists only visits still ahead: not completed,
  // cancelled or past ones.
  const recentAppointments = useMemo(
    () => upcomingAppointmentItems.slice(0, 4),
    [upcomingAppointmentItems],
  );
  const recentServices = useMemo(() => services.slice(0, 4), [services]);
  const recentInvoices = useMemo(() => invoices.slice(0, 4), [invoices]);
  const topNextActions = useMemo(
    () => nextActions.toSorted(compareNextActions).slice(0, 6),
    [nextActions],
  );
  const urgentNextActionCount = useMemo(
    () => nextActions.filter((item) => ["urgent", "high"].includes(item.priority)).length,
    [nextActions],
  );
  const nextActionKindSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of nextActions) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries()).slice(0, 3);
  }, [nextActions]);
  const recentRecommendations = useMemo(() => recommendations.slice(0, 4), [recommendations]);
  const recentRequests = useMemo(() => requests.slice(0, 4), [requests]);

  // An upcoming visit names its place like "Upcoming visits" does (clinic and
  // doctor), not by the free-text location the server sends as description.
  function nextActionText(item: PortalNextActionItem) {
    if (item.kind === "upcoming_appointment") {
      const appointment = appointmentsById.get(item.entity_id);
      if (appointment) return portalAppointmentPlaceLabel(appointment);
    }
    return nextActionDescription(item, t);
  }

  async function handleExportData() {
    dispatchDashboardState({ exportBusy: true });
    try {
      await downloadPatientPortalExport();
    } catch (err) {
      dispatchDashboardState({
        error: err instanceof Error ? err.message : t.portal_dashboard_failed_to_export_patient_data,
      });
    } finally {
      dispatchDashboardState({ exportBusy: false });
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
    <TabShell className="mx-auto mt-0 min-h-0 max-w-7xl">
      <PageHeader
        title={`${greeting}, ${user?.name ?? patientLabel}`}
        description={t.portal_dashboard_only_explicitly_released_documents_and_privacy_workflows_are_sho}
        actions={
          // Two actions and a menu: the sections are in the side navigation
          // too, and eight buttons drew over the bell and the language
          // switch in the top bar (QA 2026-10-11).
          <>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => void handleExportData()}
              disabled={exportBusy}
            >
              {exportBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t.portal_dashboard_export_my_data}
            </Button>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => dispatchDashboardState((current) => ({ version: current.version + 1 }))}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t.portal_dashboard_refresh}
            </Button>
            <OverflowMenu
              label={t.portal_dashboard_more_sections}
              triggerClassName={cn(tokens.control.primaryButton, "max-lg:col-span-2")}
              triggerContent={
                <>
                  <LayoutGrid aria-hidden="true" />
                  <span className="lg:sr-only">{t.portal_dashboard_more_sections}</span>
                </>
              }
              items={[
                { key: "documents", label: t.portal_dashboard_my_documents, icon: <FileText />, onSelect: () => staffGo("/documents") },
                { key: "appointments", label: t.portal_dashboard_my_appointments, icon: <CalendarDays />, onSelect: () => staffGo("/appointments") },
                { key: "services", label: t.portal_dashboard_my_services, icon: <Sparkles />, onSelect: () => staffGo("/services") },
                { key: "invoices", label: t.portal_dashboard_my_invoices, icon: <ReceiptText />, onSelect: () => staffGo("/invoices") },
                { key: "feedback", label: t.portal_dashboard_my_feedback, icon: <MessageSquare />, onSelect: () => staffGo("/feedback") },
                { key: "privacy", label: t.portal_dashboard_privacy_requests, icon: <ShieldCheck />, onSelect: () => staffGo("/privacy") },
              ]}
            />
          </>
        }
      />

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      <nav aria-label={t.portal_dashboard_more_sections} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { href: "/appointments", label: t.portal_dashboard_my_appointments, Icon: CalendarDays, count: upcomingAppointments },
          { href: "/documents", label: t.portal_dashboard_my_documents, Icon: FileText, count: releasedDocuments },
          { href: "/services", label: t.portal_dashboard_my_services, Icon: Sparkles, count: openServiceRequests },
          { href: "/invoices", label: t.portal_dashboard_my_invoices, Icon: ReceiptText, count: openInvoiceCount },
        ].map(({ href, label, Icon, count }) => (
          <a key={href} href={href} className="group flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-card p-4 text-sm font-medium transition hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="rounded-lg bg-muted p-2"><Icon aria-hidden="true" className="size-4 text-primary" /></span>
            <span className="min-w-0 flex-1 break-words">{label}</span>
            {count > 0 ? <CountBadge>{count}</CountBadge> : <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          </a>
        ))}
      </nav>
      <PortalSummary items={[
        { label: t.portal_dashboard_upcoming_visits, value: nextAppointment ? formatPortalDate(nextAppointment.date) : "", visible: Boolean(nextAppointment) },
        { label: t.portal_documents_pending_confirmations, value: pendingConfirmations, visible: pendingConfirmations > 0 },
        { label: t.portal_dashboard_outstanding_balance, value: formatPortalCurrency(outstandingBalance), visible: outstandingBalance > 0 },
        { label: t.portal_dashboard_open_privacy_requests, value: openRequests, visible: openRequests > 0 },
      ]} />

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        documentAlerts.document_pack_complete ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3">
            <PortalComplete>{t.portal_dashboard_your_minimum_document_pack_is_complete}</PortalComplete>
            <a href="/documents" className="text-sm font-medium text-primary hover:underline">{t.portal_dashboard_open_documents}</a>
          </div>
        ) : (
          <Banner tone="warning" withIcon>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className={tokens.text.eyebrow}>
                  {t.portal_dashboard_required_documents}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {formatPluralCount(lang, documentAlerts.missing_count, {
                    one: t.portal_dashboard_missing_required_document_one,
                    few: t.portal_dashboard_missing_required_document_many,
                    many: t.portal_dashboard_missing_required_document_many,
                  })}
                </p>
                {(() => {
                  // A missing consent is signed, not uploaded: the card says
                  // so, as the documents page does (QA 2026-10-12 B2-13).
                  const hints = missingDocumentHints(
                    documentAlerts.missing_documents.map((item) => item.key),
                  );
                  return (
                    <>
                      {hints.upload || !hints.consent ? (
                        <p className={cn("mt-1", tokens.text.muted)}>
                          {t.portal_dashboard_upload_the_missing_items_in_the_portal_so_your_care_team_can_con}
                        </p>
                      ) : null}
                      {hints.consent ? (
                        <p
                          className={cn("mt-1", tokens.text.muted)}
                          data-testid="portal-dashboard-consent-hint"
                        >
                          {l("portal_documents_consent_sent_by_gmed")}
                        </p>
                      ) : null}
                    </>
                  );
                })()}
                {documentAlerts.missing_count > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {documentAlerts.missing_documents.map((item) => (
                      <StatusBadge key={item.key} tone="warning">
                        {localizeRequiredDocumentLabel(item.key, item.label, l)}
                      </StatusBadge>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <CountBadge>
                  {t.portal_dashboard_fulfilled}:{" "}
                  {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                  {documentAlerts.configured_rule_count}
                </CountBadge>
                <a href="/documents">
                  <Button variant="outline" className={tokens.control.accessoryButton}>
                    {t.portal_dashboard_open_documents}
                  </Button>
                </a>
              </div>
            </div>
          </Banner>
        )
      ) : null}

      <section className={cn("grid items-start gap-4", recentRecommendations.length > 0 && "lg:grid-cols-2")}>
        <Section
          title={t.portal_dashboard_next_actions}
          accessory={
            <div className="flex flex-wrap items-center gap-2">
              {urgentNextActionCount > 0 ? <CountBadge>{t.portal_dashboard_priority}: {urgentNextActionCount}</CountBadge> : null}
            </div>
          }
        >
          {nextActionKindSummary.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {nextActionKindSummary.map(([kind, count]) => (
                <CountBadge key={kind}>{formatNextActionKind(kind, t)}: {count}</CountBadge>
              ))}
            </div>
          ) : null}
          <div className="space-y-3">
            {topNextActions.length === 0 ? (
              <div className="py-3"><PortalComplete>{t.portal_dashboard_no_open_portal_actions_right_now}</PortalComplete></div>
            ) : (
              topNextActions.map((item) => (
                <ListItem key={item.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge className={nextActionTone(item.kind, item.priority)}>
                          {formatNextActionKind(item.kind, t)}
                        </StatusBadge>
                        <CountBadge>{recommendationPriorityLabel(item.priority || "normal")}</CountBadge>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p>
                      {nextActionText(item) ? (
                        <p className={cn("mt-1", tokens.text.muted)}>{nextActionText(item)}</p>
                      ) : null}
                    </div>
                  </div>
                  {(item.due_at || item.amount) ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {item.due_at ? (
                        <InfoRow label={t.portal_dashboard_due} value={formatPortalDateTime(item.due_at)} />
                      ) : null}
                      {item.amount ? (
                        <InfoRow label={t.portal_dashboard_amount} value={formatPortalCurrency(item.amount)} />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <a href={item.action_url} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                      {nextActionButtonLabel(item, t)}
                    </a>
                  </div>
                </ListItem>
              ))
            )}
          </div>
        </Section>

        {recentRecommendations.length > 0 ? (
        <Section
          title={t.portal_dashboard_recommendations}
          accessory={
            <a href="/recommendations" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <div className="space-y-3">
            {recentRecommendations.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_recommendations_released_yet}</EmptyCell>
            ) : (
              recentRecommendations.map((item) => (
                <ListItem key={item.recommendation_id || item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {[item.source_doctor_name, recommendationTypeLabel(item.recommendation_type)]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={recommendationStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {item.due_at
                      ? `${t.portal_dashboard_due} ${formatPortalDateTime(item.due_at)}`
                      : t.portal_dashboard_no_due_date}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-2">
        {recentAppointments.length > 0 ? (
        <Section
          title={t.portal_dashboard_upcoming_visits}
          accessory={
            <a href="/appointments" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <div className="space-y-3">
            {recentAppointments.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_scheduled_visits_yet}</EmptyCell>
            ) : (
              recentAppointments.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {portalAppointmentPlaceLabel(item)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={appointmentStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>{formatPortalDate(item.date)}</p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}

        {recentDocuments.length > 0 ? (
        <Section
          title={t.portal_dashboard_recent_documents}
          accessory={
            <a href="/documents" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <div className="space-y-3">
            {recentDocuments.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_documents_have_been_released_to_your_portal_yet}</EmptyCell>
            ) : (
              recentDocuments.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.auto_name}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {portalDocumentTypeLabels(item.art, item.category).join(" / ")}
                      </p>
                    </div>
                    <StatusBadge tone={item.confirmed ? "success" : item.requires_confirmation ? "warning" : "info"}>
                      {item.confirmed ? t.portal_dashboard_confirmed : item.requires_confirmation ? t.portal_dashboard_needs_confirmation : t.portal_dashboard_released}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {t.portal_dashboard_released} {formatPortalDateTime(item.shared_at)}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}

        {recentInvoices.length > 0 ? (
        <Section
          title={t.portal_dashboard_recent_invoices}
          accessory={
            <a href="/invoices" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {t.portal_dashboard_billing_snapshots_and_current_payment_state}
          </p>
          <div className="space-y-3">
            {recentInvoices.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_invoices_released_to_the_portal_yet}</EmptyCell>
            ) : (
              recentInvoices.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.invoice_number}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {item.order_number} / {t.portal_dashboard_due_2} {formatPortalDate(item.due_date)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={invoiceStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {t.portal_dashboard_open} {formatPortalCurrency(item.balance_due)}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}

        {recentServices.length > 0 ? (
        <Section
          title={t.portal_dashboard_my_services}
          accessory={
            <a href="/services" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {t.portal_dashboard_concierge_and_add_on_services_from_your_portal}
          </p>
          <div className="space-y-3">
            {recentServices.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_services_yet}</EmptyCell>
            ) : (
              recentServices.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {[item.provider_name, item.assigned_concierge_name, item.appointment_title].filter(Boolean).join(" / ")}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={conciergeServiceStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {conciergeServiceKindLabel(item.service_kind)}
                    {item.starts_at ? ` / ${formatPortalDateTime(item.starts_at)}` : ""}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}

        {recentRequests.length > 0 ? (
        <Section
          title={t.portal_dashboard_privacy_request_history}
          accessory={
            <a href="/privacy" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {t.portal_dashboard_dsgvo_related_requests_you_already_submitted}
          </p>
          <div className="space-y-3">
            {recentRequests.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_privacy_requests_submitted_yet}</EmptyCell>
            ) : (
              recentRequests.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {t.portal_dashboard_requested} {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={privacyStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {t.portal_dashboard_due} {formatPortalDate(item.due_at)}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}

        {recentFeedback.length > 0 ? (
        <Section
          title={t.portal_dashboard_recent_feedback}
          accessory={
            <a href="/feedback" className="text-sm font-medium text-primary hover:underline">
              {t.portal_dashboard_open_all}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {t.portal_dashboard_submitted_quality_surveys_and_review_follow_up}
          </p>
          <div className="space-y-3">
            {recentFeedback.length === 0 ? (
              <EmptyCell>{t.portal_dashboard_no_feedback_submitted_yet}</EmptyCell>
            ) : (
              recentFeedback.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {item.appointment_title || item.provider_name || t.portal_dashboard_general_feedback}
                      </p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {t.uiText.feedback_nps_label} {item.nps_score} / {formatPortalDateTime(item.submitted_at)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={feedbackStatusTone(item.status)}>
                      {feedbackStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                </ListItem>
              ))
            )}
          </div>
        </Section>
        ) : null}
      </section>
      <PatientPortalMobileAccess />
    </TabShell>
  );
}

export function PatientDashboardPage(...args: Parameters<typeof usePatientDashboardPageContent>) {
  return usePatientDashboardPageContent(...args);
}
