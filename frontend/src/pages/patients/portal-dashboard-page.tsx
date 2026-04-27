import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { localizeRequiredDocumentLabel } from "@/lib/required-document-labels";
import {
  downloadPatientPortalExport,
  fetchPatientPortalWorkspace,
} from "@/pages/patients/data/portal-api";
import {
  appointmentStatusTone,
  feedbackStatusTone,
  formatPortalCurrency,
  formatPortalDate,
  formatPortalDateTime,
  invoiceStatusTone,
  portalStatusLabel,
  privacyRequestLabel,
  privacyStatusTone,
} from "@/pages/patients/model/portal-shared";
import type {
  PortalAppointmentItem,
  PortalConciergeServiceItem,
  PortalDocumentAlertsSummary,
  PortalDocumentItem,
  PortalFeedbackItem,
  PortalInvoiceItem,
  PortalPrivacyRequest,
} from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

function shellCard(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-slate-200 bg-white shadow-sm",
    extra,
  );
}

export function PatientDashboardPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState<PortalDocumentItem[]>([]);
  const [documentAlerts, setDocumentAlerts] = useState<PortalDocumentAlertsSummary | null>(null);
  const [appointments, setAppointments] = useState<PortalAppointmentItem[]>([]);
  const [services, setServices] = useState<PortalConciergeServiceItem[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoiceItem[]>([]);
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
  const recentInvoices = useMemo(() => invoices.slice(0, 4), [invoices]);
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Patientenportal wird geladen...", "Загрузка портала пациента...", "Loading portal workspace...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(135deg,#0f172a_0%,#172554_52%,#0f766e_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">
              {l("Patientenportal", "Портал пациента", "Patient portal")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {greeting}, {user?.name ?? patientLabel}
            </h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              {l(
                "Hier werden nur ausdrucklich freigegebene Dokumente und Datenschutz-Workflows angezeigt.",
                "Здесь отображаются только явно опубликованные документы и процессы по защите данных.",
                "Only explicitly released documents and privacy workflows are shown here.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/documents">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                {l("Meine Dokumente", "Мои документы", "My documents")}
              </Button>
            </a>
            <a href="/appointments">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                {l("Meine Termine", "Мои записи", "My appointments")}
              </Button>
            </a>
            <a href="/privacy">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <ShieldCheck className="size-4" />
                {l("Datenschutzanfragen", "Запросы по приватности", "Privacy requests")}
              </Button>
            </a>
            <Button
              variant="outline"
              className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
              onClick={() => void handleExportData()}
              disabled={exportBusy}
            >
              {exportBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {l("Meine Daten exportieren", "Экспортировать мои данные", "Export my data")}
            </Button>
            <a href="/feedback">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <ShieldCheck className="size-4" />
                {l("Mein Feedback", "Мои отзывы", "My feedback")}
              </Button>
            </a>
            <a href="/services">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                {l("Meine Services", "Мои сервисы", "My services")}
              </Button>
            </a>
            <a href="/invoices">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Download className="size-4" />
                {l("Meine Rechnungen", "Мои счета", "My invoices")}
              </Button>
            </a>
            <Button
              variant="outline"
              className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <section className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      {documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        <section
          className={shellCard(
            cn(
              "px-5 py-4",
              documentAlerts.document_pack_complete
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50",
            ),
          )}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Erforderliche Dokumente", "Обязательные документы", "Required documents")}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                {documentAlerts.document_pack_complete
                  ? l("Ihr Mindest-Dokumentenpaket ist vollständig.", "Минимальный комплект документов уже собран.", "Your minimum document pack is complete")
                  : l(
                      `Es fehlen noch ${documentAlerts.missing_count} Pflichtdokument${documentAlerts.missing_count === 1 ? "" : "e"}.`,
                      `Еще не хватает ${documentAlerts.missing_count} обязательн${documentAlerts.missing_count === 1 ? "ого документа" : "ых документов"}.`,
                      `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} still missing`,
                    )}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {documentAlerts.document_pack_complete
                  ? l(
                      "Ihr Betreuungsteam hat bereits den erforderlichen Mindest-Dokumentensatz.",
                      "У команды сопровождения уже есть минимально необходимый комплект документов.",
                      "Your care team already has the minimum required document set.",
                    )
                  : l(
                      "Laden Sie die fehlenden Unterlagen im Portal hoch, damit Ihr Team ohne manuelles Nachfassen weiterarbeiten kann.",
                      "Загрузите недостающие документы в портал, чтобы команда могла продолжить работу без ручного напоминания.",
                      "Upload the missing items in the portal so your care team can continue without manual follow-up.",
                    )}
              </p>
              {documentAlerts.missing_count > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {documentAlerts.missing_documents.map((item) => (
                    <Badge
                      key={item.key}
                      variant="outline"
                      className="rounded-full border-amber-300 bg-white text-amber-800"
                    >
                      {localizeRequiredDocumentLabel(item.key, item.label, l)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-2 text-sm text-slate-700">
                {l("Erfüllt", "Выполнено", "Fulfilled")}:{" "}
                <span className="font-semibold text-slate-950">
                  {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                  {documentAlerts.configured_rule_count}
                </span>
              </div>
              <a href="/documents">
                <Button variant="outline" className="rounded-2xl bg-white/80">
                  {l("Dokumente öffnen", "Открыть документы", "Open documents")}
                </Button>
              </a>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-5">
        <MetricCard label={l("Kommende Termine", "Предстоящие визиты", "Upcoming visits")} value={upcomingAppointments} description={l(`${releasedDocuments} freigegebene Dokumente`, `${releasedDocuments} опубликованных документа`, `${releasedDocuments} released documents`)} />
        <MetricCard label={l("Offene Serviceanfragen", "Открытые сервисные запросы", "Open service requests")} value={openServiceRequests} description={l(`${services.length} Concierge-Einträge gesamt`, `${services.length} записей concierge всего`, `${services.length} total concierge entries`)} />
        <MetricCard label={l("Offener Saldo", "Остаток к оплате", "Outstanding balance")} value={outstandingBalance === 0 ? formatPortalCurrency(0) : formatPortalCurrency(outstandingBalance)} />
        <MetricCard label={l("Offene Datenschutzanfragen", "Открытые запросы по приватности", "Open privacy requests")} value={openRequests} description={l(`${pendingConfirmations} ausstehende Bestätigungen`, `${pendingConfirmations} ожидающих подтверждений`, `${pendingConfirmations} pending confirmations`)} />
        <MetricCard label={l("Gesendetes Feedback", "Отправленные отзывы", "Feedback sent")} value={feedback.length} description={l(`${promoterCount} Promotor-Bewertungen`, `${promoterCount} оценок промоутеров`, `${promoterCount} promoter ratings`)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Kommende Termine", "Предстоящие визиты", "Upcoming visits")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Geplante patientenseitige Termine.", "Запланированные визиты для пациента.", "Scheduled patient-facing appointments.")}
              </p>
            </div>
            <a href="/appointments" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {recentAppointments.length === 0 ? (
              <EmptyState message={l("Noch keine geplanten Termine.", "Пока нет запланированных визитов.", "No scheduled visits yet.")} />
            ) : (
              recentAppointments.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[item.provider_name, item.doctor_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", appointmentStatusTone(item.status))}
                    >
                      {portalStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {formatPortalDate(item.date)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Aktuelle Dokumente", "Недавние документы", "Recent documents")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Von Ihrem Betreuungsteam für den Portalzugang freigegebene Dateien.", "Файлы, опубликованные командой сопровождения для доступа через портал.", "Files released by your care team for portal access.")}
              </p>
            </div>
            <a href="/documents" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {recentDocuments.length === 0 ? (
              <EmptyState message={l("Es wurden noch keine Dokumente für Ihr Portal freigegeben.", "Для вашего портала пока не опубликовано ни одного документа.", "No documents have been released to your portal yet.")} />
            ) : (
              recentDocuments.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.auto_name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[item.art, item.category, item.shared_by_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {item.confirmed ? l("Bestätigt", "Подтверждено", "Confirmed") : item.requires_confirmation ? l("Bestätigung erforderlich", "Требуется подтверждение", "Needs confirmation") : l("Freigegeben", "Опубликовано", "Released")}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {l("Freigegeben", "Опубликовано", "Released")} {formatPortalDateTime(item.shared_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Aktuelle Rechnungen", "Недавние счета", "Recent invoices")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Abrechnungs-Snapshots und aktueller Zahlungsstand.", "Снимки счетов и текущий статус оплаты.", "Billing snapshots and current payment state.")}
              </p>
            </div>
            <a href="/invoices" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {recentInvoices.length === 0 ? (
              <EmptyState message={l("Es wurden noch keine Rechnungen im Portal freigegeben.", "В портале пока нет опубликованных счетов.", "No invoices released to the portal yet.")} />
            ) : (
              recentInvoices.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{item.invoice_number}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.order_number} · {l("Fällig", "Срок оплаты", "Due")} {formatPortalDate(item.due_date)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", invoiceStatusTone(item.status))}
                    >
                      {portalStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {l("Offen", "Открыто", "Open")} {formatPortalCurrency(item.balance_due)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Verlauf der Datenschutzanfragen", "История запросов по приватности", "Privacy request history")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Bereits eingereichte DSGVO-bezogene Anfragen.", "Уже отправленные запросы по защите данных.", "DSGVO-related requests you already submitted.")}
              </p>
            </div>
            <a href="/privacy" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {recentRequests.length === 0 ? (
              <EmptyState message={l("Noch keine Datenschutzanfragen eingereicht.", "Запросы по приватности еще не отправлялись.", "No privacy requests submitted yet.")} />
            ) : (
              recentRequests.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {l("Angefragt", "Запрошено", "Requested")} {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", privacyStatusTone(item.status))}
                    >
                      {portalStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {l("Fällig", "Срок", "Due")} {formatPortalDate(item.due_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Aktuelles Feedback", "Недавние отзывы", "Recent feedback")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Eingereichte Qualitätsumfragen und deren Review-Status.", "Отправленные опросы качества и их статус проверки.", "Submitted quality surveys and review follow-up.")}
              </p>
            </div>
            <a href="/feedback" className="text-sm font-medium text-sky-700 hover:text-sky-800">
              {l("Alle öffnen", "Открыть все", "Open all")}
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {recentFeedback.length === 0 ? (
              <EmptyState message={l("Noch kein Feedback eingereicht.", "Отзывы еще не отправлялись.", "No feedback submitted yet.")} />
            ) : (
              recentFeedback.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {item.appointment_title || item.provider_name || l("Allgemeines Feedback", "Общий отзыв", "General feedback")}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        NPS {item.nps_score} · {formatPortalDateTime(item.submitted_at)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", feedbackStatusTone(item.status))}
                    >
                      {portalStatusLabel(item.status)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function MetricCard({ label, value, description }: { label: string; value: number | string; description?: string }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {description ? <p className="mt-2 text-xs text-slate-500">{description}</p> : null}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
      {message}
    </div>
  );
}
