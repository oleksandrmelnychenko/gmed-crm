import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  EmptyCell,
  InfoRow,
  ListItem,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  TabShell,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatUnknownValue, useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { localizeRequiredDocumentLabel } from "@/lib/required-document-labels";
import {
  downloadPatientPortalExport,
  fetchPatientPortalWorkspace,
} from "@/pages/patients/data/portal-api";
import {
  appointmentStatusTone,
  conciergeServiceKindLabel,
  conciergeServiceStatusTone,
  feedbackStatusTone,
  formatPortalCurrency,
  formatPortalDate,
  formatPortalDateTime,
  invoiceStatusTone,
  nextActionTone,
  portalStatusLabel,
  privacyRequestLabel,
  privacyStatusTone,
  recommendationPriorityLabel,
  recommendationStatusTone,
  recommendationTypeLabel,
} from "@/pages/patients/model/portal-shared";
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

const PATIENT_DASHBOARD_REALTIME_EVENTS = [
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
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

function formatNextActionKind(
  kind: string,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (kind) {
    case "invoice_payment":
      return l("Rechnung bezahlen", "Оплата счета", "Invoice payment");
    case "package_approval":
      return l("Paket freigeben", "Подтверждение пакета", "Package approval");
    case "document_confirmation":
      return l("Dokument bestatigen", "Подтверждение документа", "Document confirmation");
    case "recommendation_decision":
      return l("Empfehlung entscheiden", "Решение по рекомендации", "Recommendation decision");
    case "appointment_request":
      return l("Terminanfrage", "Запрос на визит", "Appointment request");
    case "privacy_request":
      return l("Datenschutzanfrage", "Запрос приватности", "Privacy request");
    case "feedback_request":
      return l("Feedback abgeben", "Оставить отзыв", "Feedback request");
    case "concierge_service":
      return l("Zusatzservice", "Дополнительная услуга", "Concierge service");
    default:
      return formatUnknownValue(kind, translations);
  }
}

function portalDocumentValueLabel(
  value: string | null | undefined,
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (value) {
    case "general":
      return l("Allgemein", "Общий", "General");
    case "report":
    case "medical_report":
      return l("Medizinischer Bericht", "Медицинский отчет", "Medical report");
    case "discharge_report":
      return l("Entlassungsbericht", "Выписной отчет", "Discharge report");
    case "clinic_letter":
    case "clinic_correspondence":
    case "correspondence":
      return l("Korrespondenz", "Переписка", "Correspondence");
    case "blood_results":
    case "analyses":
    case "analysis":
      return l("Analysen", "Анализы", "Analyses");
    case "conclusions":
      return l("Befunde", "Заключения", "Conclusions");
    case "invoice_pdf":
    case "invoices":
      return l("Rechnung", "Счет", "Invoice");
    case "translated_letter":
    case "translations":
      return l("Ubersetzung", "Перевод", "Translation");
    case "insurance":
    case "insurance_document":
      return l("Versicherungsdokument", "Страховой документ", "Insurance document");
    case "identity":
      return l("Identitat", "Идентификация", "Identity");
    case "payment_proof":
      return l("Zahlungsnachweis", "Подтверждение оплаты", "Payment proof");
    default:
      return formatUnknownValue(value, translations);
  }
}

export function PatientDashboardPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState<PortalDocumentItem[]>([]);
  const [documentAlerts, setDocumentAlerts] = useState<PortalDocumentAlertsSummary | null>(null);
  const [appointments, setAppointments] = useState<PortalAppointmentItem[]>([]);
  const [services, setServices] = useState<PortalConciergeServiceItem[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoiceItem[]>([]);
  const [recommendations, setRecommendations] = useState<PortalRecommendationItem[]>([]);
  const [nextActions, setNextActions] = useState<PortalNextActionItem[]>([]);
  const [requests, setRequests] = useState<PortalPrivacyRequest[]>([]);
  const [feedback, setFeedback] = useState<PortalFeedbackItem[]>([]);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const greeting = l("Hallo", "Здравствуйте", "Hello");
  const patientLabel = l("Patient", "Пациент", "Patient");

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
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const workspace = await fetchPatientPortalWorkspace();

        if (cancelled) return;
        startTransition(() => {
          setAppointments(workspace.appointments);
          setServices(workspace.services);
          setDocuments(workspace.documents);
          setDocumentAlerts(workspace.documentAlerts);
          setInvoices(workspace.invoices);
          setRecommendations(workspace.recommendations);
          setNextActions(workspace.nextActions);
          setRequests(workspace.privacyRequests);
          setFeedback(workspace.feedback);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Patientenportal konnte nicht geladen werden.", "Не удалось загрузить портал пациента.", "Failed to load portal workspace."));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loading, version, l]);

  const releasedDocuments = documents.length;
  const upcomingAppointments = useMemo(
    () => appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10)).length,
    [appointments],
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
  const promoterCount = useMemo(
    () => feedback.filter((item) => Number(item.nps_score) >= 9).length,
    [feedback],
  );
  const recentFeedback = useMemo(() => feedback.slice(0, 4), [feedback]);
  const recentDocuments = useMemo(() => documents.slice(0, 4), [documents]);
  const recentAppointments = useMemo(() => appointments.slice(0, 4), [appointments]);
  const recentServices = useMemo(() => services.slice(0, 4), [services]);
  const recentInvoices = useMemo(() => invoices.slice(0, 4), [invoices]);
  const topNextActions = useMemo(
    () => [...nextActions].sort(compareNextActions).slice(0, 6),
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

  async function handleExportData() {
    setExportBusy(true);
    try {
      await downloadPatientPortalExport();
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Patientendaten konnten nicht exportiert werden.", "Не удалось экспортировать данные пациента.", "Failed to export patient data."));
    } finally {
      setExportBusy(false);
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
    <TabShell className="mt-0 min-h-0">
      <PageHeader
        title={`${greeting}, ${user?.name ?? patientLabel}`}
        description={l(
          "Hier werden nur ausdrucklich freigegebene Dokumente und Datenschutz-Workflows angezeigt.",
          "Здесь отображаются только явно опубликованные документы и процессы по защите данных.",
          "Only explicitly released documents and privacy workflows are shown here.",
        )}
        actions={
          <>
            <CountBadge>{l("Patientenportal", "Портал пациента", "Patient portal")}</CountBadge>
            <a href="/documents">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Download className="size-4" />
                {l("Meine Dokumente", "Мои документы", "My documents")}
              </Button>
            </a>
            <a href="/appointments">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Download className="size-4" />
                {l("Meine Termine", "Мои записи", "My appointments")}
              </Button>
            </a>
            <a href="/privacy">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <ShieldCheck className="size-4" />
                {l("Datenschutzanfragen", "Запросы по приватности", "Privacy requests")}
              </Button>
            </a>
            <a href="/feedback">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <ShieldCheck className="size-4" />
                {l("Mein Feedback", "Мои отзывы", "My feedback")}
              </Button>
            </a>
            <a href="/services">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Download className="size-4" />
                {l("Meine Services", "Мои сервисы", "My services")}
              </Button>
            </a>
            <a href="/invoices">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Download className="size-4" />
                {l("Meine Rechnungen", "Мои счета", "My invoices")}
              </Button>
            </a>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => void handleExportData()}
              disabled={exportBusy}
            >
              {exportBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {l("Meine Daten exportieren", "Экспортировать мои данные", "Export my data")}
            </Button>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        documentAlerts.document_pack_complete ? (
          <SuccessBanner>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className={tokens.text.eyebrow}>
                  {l("Erforderliche Dokumente", "Обязательные документы", "Required documents")}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {l("Ihr Mindest-Dokumentenpaket ist vollständig.", "Минимальный комплект документов уже собран.", "Your minimum document pack is complete")}
                </p>
                <p className={cn("mt-1", tokens.text.muted)}>
                  {l(
                    "Ihr Betreuungsteam hat bereits den erforderlichen Mindest-Dokumentensatz.",
                    "У команды сопровождения уже есть минимально необходимый комплект документов.",
                    "Your care team already has the minimum required document set.",
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <CountBadge>
                  {l("Erfüllt", "Выполнено", "Fulfilled")}:{" "}
                  {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                  {documentAlerts.configured_rule_count}
                </CountBadge>
                <a href="/documents">
                  <Button variant="outline" className={tokens.control.accessoryButton}>
                    {l("Dokumente öffnen", "Открыть документы", "Open documents")}
                  </Button>
                </a>
              </div>
            </div>
          </SuccessBanner>
        ) : (
          <Banner tone="warning" withIcon>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className={tokens.text.eyebrow}>
                  {l("Erforderliche Dokumente", "Обязательные документы", "Required documents")}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {l(
                    `Es fehlen noch ${documentAlerts.missing_count} Pflichtdokument${documentAlerts.missing_count === 1 ? "" : "e"}.`,
                    `Еще не хватает ${documentAlerts.missing_count} обязательн${documentAlerts.missing_count === 1 ? "ого документа" : "ых документов"}.`,
                    `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} still missing`,
                  )}
                </p>
                <p className={cn("mt-1", tokens.text.muted)}>
                  {l(
                    "Laden Sie die fehlenden Unterlagen im Portal hoch, damit Ihr Team ohne manuelles Nachfassen weiterarbeiten kann.",
                    "Загрузите недостающие документы в портал, чтобы команда могла продолжить работу без ручного напоминания.",
                    "Upload the missing items in the portal so your care team can continue without manual follow-up.",
                  )}
                </p>
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
                  {l("Erfüllt", "Выполнено", "Fulfilled")}:{" "}
                  {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                  {documentAlerts.configured_rule_count}
                </CountBadge>
                <a href="/documents">
                  <Button variant="outline" className={tokens.control.accessoryButton}>
                    {l("Dokumente öffnen", "Открыть документы", "Open documents")}
                  </Button>
                </a>
              </div>
            </div>
          </Banner>
        )
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Section
          title={l("Nächste Schritte", "Следующие действия", "Next actions")}
          accessory={
            <div className="flex flex-wrap items-center gap-2">
              <CountBadge>
                {l("Priorität", "Приоритет", "Priority")}: {urgentNextActionCount} / {nextActions.length}
              </CountBadge>
              <a href="/recommendations" className="text-sm font-medium text-primary hover:underline">
                {l("Empfehlungen", "Рекомендации", "Recommendations")}
              </a>
            </div>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Ein konsolidierter Block aus Terminen, Empfehlungen, Dokumenten und sichtbaren Rechnungen.", "Единый блок из визитов, рекомендаций, документов и видимых счетов.", "A consolidated block from appointments, recommendations, documents and visible invoices.")}
          </p>
          {nextActionKindSummary.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {nextActionKindSummary.map(([kind, count]) => (
                <CountBadge key={kind}>{formatNextActionKind(kind, l, t)}: {count}</CountBadge>
              ))}
            </div>
          ) : null}
          <div className="space-y-3">
            {topNextActions.length === 0 ? (
              <EmptyCell>{l("Aktuell sind keine offenen Portal-Aktionen vorhanden.", "Сейчас нет открытых действий в портале.", "No open portal actions right now.")}</EmptyCell>
            ) : (
              topNextActions.map((item) => (
                <ListItem key={item.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge className={nextActionTone(item.kind, item.priority)}>
                          {formatNextActionKind(item.kind, l, t)}
                        </StatusBadge>
                        <CountBadge>{recommendationPriorityLabel(item.priority || "normal")}</CountBadge>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p>
                      {item.description ? <p className={cn("mt-1", tokens.text.muted)}>{item.description}</p> : null}
                    </div>
                  </div>
                  {(item.due_at || item.amount) ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {item.due_at ? (
                        <InfoRow label={l("Fällig", "Срок", "Due")} value={formatPortalDateTime(item.due_at)} />
                      ) : null}
                      {item.amount ? (
                        <InfoRow label={l("Betrag", "Сумма", "Amount")} value={formatPortalCurrency(item.amount)} />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <a href={item.action_url} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                      {item.action_label}
                    </a>
                  </div>
                </ListItem>
              ))
            )}
          </div>
        </Section>

        <Section
          title={l("Empfehlungen", "Рекомендации", "Recommendations")}
          accessory={
            <a href="/recommendations" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Vom Betreuungsteam freigegebene medizinische Empfehlungen.", "Медицинские рекомендации, опубликованные командой сопровождения.", "Care-team recommendations released to your portal.")}
          </p>
          <div className="space-y-3">
            {recentRecommendations.length === 0 ? (
              <EmptyCell>{l("Noch keine Empfehlungen freigegeben.", "Пока нет опубликованных рекомендаций.", "No recommendations released yet.")}</EmptyCell>
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
                      ? `${l("Fällig", "Срок", "Due")} ${formatPortalDateTime(item.due_at)}`
                      : l("Ohne Frist", "Без срока", "No due date")}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <StatCard label={l("Kommende Termine", "Предстоящие визиты", "Upcoming visits")} value={upcomingAppointments} description={l(`${releasedDocuments} freigegebene Dokumente`, `${releasedDocuments} опубликованных документа`, `${releasedDocuments} released documents`)} />
        <StatCard label={l("Offene Serviceanfragen", "Открытые сервисные запросы", "Open service requests")} value={openServiceRequests} description={l(`${services.length} Concierge-Einträge gesamt`, `${services.length} записей concierge всего`, `${services.length} total concierge entries`)} />
        <StatCard label={l("Offener Saldo", "Остаток к оплате", "Outstanding balance")} value={outstandingBalance === 0 ? formatPortalCurrency(0) : formatPortalCurrency(outstandingBalance)} />
        <StatCard label={l("Offene Datenschutzanfragen", "Открытые запросы по приватности", "Open privacy requests")} value={openRequests} description={l(`${pendingConfirmations} ausstehende Bestätigungen`, `${pendingConfirmations} ожидающих подтверждений`, `${pendingConfirmations} pending confirmations`)} />
        <StatCard label={l("Gesendetes Feedback", "Отправленные отзывы", "Feedback sent")} value={feedback.length} description={l(`${promoterCount} Promotor-Bewertungen`, `${promoterCount} оценок промоутеров`, `${promoterCount} promoter ratings`)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-3 2xl:grid-cols-6">
        <Section
          title={l("Kommende Termine", "Предстоящие визиты", "Upcoming visits")}
          accessory={
            <a href="/appointments" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Geplante patientenseitige Termine.", "Запланированные визиты для пациента.", "Scheduled patient-facing appointments.")}
          </p>
          <div className="space-y-3">
            {recentAppointments.length === 0 ? (
              <EmptyCell>{l("Noch keine geplanten Termine.", "Пока нет запланированных визитов.", "No scheduled visits yet.")}</EmptyCell>
            ) : (
              recentAppointments.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {[item.provider_name, item.doctor_name].filter(Boolean).join(" / ")}
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

        <Section
          title={l("Aktuelle Dokumente", "Недавние документы", "Recent documents")}
          accessory={
            <a href="/documents" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Von Ihrem Betreuungsteam für den Portalzugang freigegebene Dateien.", "Файлы, опубликованные командой сопровождения для доступа через портал.", "Files released by your care team for portal access.")}
          </p>
          <div className="space-y-3">
            {recentDocuments.length === 0 ? (
              <EmptyCell>{l("Es wurden noch keine Dokumente für Ihr Portal freigegeben.", "Для вашего портала пока не опубликовано ни одного документа.", "No documents have been released to your portal yet.")}</EmptyCell>
            ) : (
              recentDocuments.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.auto_name}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {[
                          portalDocumentValueLabel(item.art, l, t),
                          item.category ? portalDocumentValueLabel(item.category, l, t) : null,
                          item.shared_by_name,
                        ].filter(Boolean).join(" / ")}
                      </p>
                    </div>
                    <StatusBadge tone={item.confirmed ? "success" : item.requires_confirmation ? "warning" : "info"}>
                      {item.confirmed ? l("Bestätigt", "Подтверждено", "Confirmed") : item.requires_confirmation ? l("Bestätigung erforderlich", "Требуется подтверждение", "Needs confirmation") : l("Freigegeben", "Опубликовано", "Released")}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {l("Freigegeben", "Опубликовано", "Released")} {formatPortalDateTime(item.shared_at)}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>

        <Section
          title={l("Aktuelle Rechnungen", "Недавние счета", "Recent invoices")}
          accessory={
            <a href="/invoices" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Abrechnungs-Snapshots und aktueller Zahlungsstand.", "Снимки счетов и текущий статус оплаты.", "Billing snapshots and current payment state.")}
          </p>
          <div className="space-y-3">
            {recentInvoices.length === 0 ? (
              <EmptyCell>{l("Es wurden noch keine Rechnungen im Portal freigegeben.", "В портале пока нет опубликованных счетов.", "No invoices released to the portal yet.")}</EmptyCell>
            ) : (
              recentInvoices.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.invoice_number}</p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {item.order_number} / {l("Fällig", "Срок оплаты", "Due")} {formatPortalDate(item.due_date)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={invoiceStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {l("Offen", "Открыто", "Open")} {formatPortalCurrency(item.balance_due)}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>

        <Section
          title={l("Meine Services", "Мои сервисы", "My services")}
          accessory={
            <a href="/services" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Concierge- und Zusatzleistungen aus Ihrem Portal.", "Консьерж- и дополнительные услуги из вашего портала.", "Concierge and add-on services from your portal.")}
          </p>
          <div className="space-y-3">
            {recentServices.length === 0 ? (
              <EmptyCell>{l("Noch keine Services angelegt.", "Пока нет сервисов.", "No services yet.")}</EmptyCell>
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

        <Section
          title={l("Verlauf der Datenschutzanfragen", "История запросов по приватности", "Privacy request history")}
          accessory={
            <a href="/privacy" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Bereits eingereichte DSGVO-bezogene Anfragen.", "Уже отправленные запросы по защите данных.", "DSGVO-related requests you already submitted.")}
          </p>
          <div className="space-y-3">
            {recentRequests.length === 0 ? (
              <EmptyCell>{l("Noch keine Datenschutzanfragen eingereicht.", "Запросы по приватности еще не отправлялись.", "No privacy requests submitted yet.")}</EmptyCell>
            ) : (
              recentRequests.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {l("Angefragt", "Запрошено", "Requested")} {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={privacyStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className={cn("mt-3", tokens.text.muted)}>
                    {l("Fällig", "Срок", "Due")} {formatPortalDate(item.due_at)}
                  </p>
                </ListItem>
              ))
            )}
          </div>
        </Section>

        <Section
          title={l("Aktuelles Feedback", "Недавние отзывы", "Recent feedback")}
          accessory={
            <a href="/feedback" className="text-sm font-medium text-primary hover:underline">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          }
        >
          <p className="text-sm text-muted-foreground">
            {l("Eingereichte Qualitätsumfragen und deren Review-Status.", "Отправленные опросы качества и их статус проверки.", "Submitted quality surveys and review follow-up.")}
          </p>
          <div className="space-y-3">
            {recentFeedback.length === 0 ? (
              <EmptyCell>{l("Noch kein Feedback eingereicht.", "Отзывы еще не отправлялись.", "No feedback submitted yet.")}</EmptyCell>
            ) : (
              recentFeedback.map((item) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {item.appointment_title || item.provider_name || l("Allgemeines Feedback", "Общий отзыв", "General feedback")}
                      </p>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        NPS {item.nps_score} / {formatPortalDateTime(item.submitted_at)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} className={feedbackStatusTone(item.status)}>
                      {portalStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                </ListItem>
              ))
            )}
          </div>
        </Section>
      </section>
    </TabShell>
  );
}
