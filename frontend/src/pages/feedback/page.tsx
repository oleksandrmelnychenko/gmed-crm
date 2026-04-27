import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  BarChart3,
  ClipboardPen,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Star,
  Users,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  AdminTableCard,
  AdminToolbar,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Banner as ShellBanner,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
  toneForStatus,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  feedbackSourceLabel,
  formatPortalAverage,
  formatPortalDate,
  formatPortalDateTime,
  npsBandLabel,
  portalNotSetLabel,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type {
  PortalAppointmentItem,
  PortalFeedbackItem,
  PortalFeedbackSummary,
} from "@/pages/patients/model/portal-shared";
import {
  captureStaffFeedback,
  fetchFeedbackPatientAppointments,
  fetchFeedbackPatients,
  fetchPatientFeedbackWorkspace,
  fetchStaffFeedbackWorkspace,
  reviewFeedback,
  submitPatientFeedback,
} from "./data/feedback-api";
import {
  blankFeedbackForm,
  buildFeedbackQuery,
  canViewStaffFeedback,
  feedbackText,
  npsOptions,
  patientLabel,
  roleCanCaptureFeedback,
  scoreOptions,
} from "./model/feedback-model";
import type {
  FeedbackFormState,
  PatientAppointmentOption,
  PatientOption,
} from "./model/types";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;

type Localize = (de: string, ru: string, en: string) => string;
type SetFeedbackForm = Dispatch<SetStateAction<FeedbackFormState>>;

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

const FEEDBACK_REALTIME_EVENTS = [
  "feedback.submitted",
  "feedback.reviewed",
] as const;

function Banner({
  tone,
  children,
}: {
  tone: "error" | "warning" | "success";
  children: ReactNode;
}) {
  if (tone === "success") return <SuccessBanner>{children}</SuccessBanner>;
  return <ShellBanner tone={tone}>{children}</ShellBanner>;
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className={cn("rounded-xl p-3", tokens.surface.mutedCard)}>
      <p className={tokens.text.eyebrow}>{label}</p>
      <p className="mt-2 text-sm text-foreground">{value || portalNotSetLabel()}</p>
    </div>
  );
}

function treatmentSuccessLabel(value?: string | null) {
  if (value === "yes") return feedbackText("Ja", "Да", "Yes");
  if (value === "partial") return feedbackText("Teilweise", "Частично", "Partial");
  if (value === "no") return feedbackText("Nein", "Нет", "No");
  return portalNotSetLabel();
}

function scoreField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: string[],
) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClassName}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ScoreGrid({
  l,
  form,
  setForm,
}: {
  l: Localize;
  form: FeedbackFormState;
  setForm: SetFeedbackForm;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {scoreField(
        l("Gesamtzufriedenheit", "Общая удовлетворённость", "Overall satisfaction"),
        form.overallScore,
        (value) => setForm((current) => ({ ...current, overallScore: value })),
        scoreOptions,
      )}
      {scoreField("NPS 0-10", form.npsScore, (value) => setForm((current) => ({ ...current, npsScore: value })), npsOptions)}
      {scoreField(
        l("Patientenmanager", "Менеджер пациента", "Patient manager"),
        form.patientManagerScore,
        (value) => setForm((current) => ({ ...current, patientManagerScore: value })),
        scoreOptions,
      )}
      {scoreField(
        l("Dolmetscher", "Переводчик", "Interpreter"),
        form.interpreterScore,
        (value) => setForm((current) => ({ ...current, interpreterScore: value })),
        scoreOptions,
      )}
      {scoreField("Concierge", form.conciergeScore, (value) => setForm((current) => ({ ...current, conciergeScore: value })), scoreOptions)}
      {scoreField(
        l("Behandlungsqualität", "Качество лечения", "Treatment quality"),
        form.treatmentScore,
        (value) => setForm((current) => ({ ...current, treatmentScore: value })),
        scoreOptions,
      )}
      {scoreField(
        l("Ärzte", "Врачи", "Doctors"),
        form.doctorScore,
        (value) => setForm((current) => ({ ...current, doctorScore: value })),
        scoreOptions,
      )}
      {scoreField(
        l("Organisation", "Организация", "Organization"),
        form.organizationScore,
        (value) => setForm((current) => ({ ...current, organizationScore: value })),
        scoreOptions,
      )}
      {scoreField(
        l("Servicequalität", "Качество сервиса", "Service quality"),
        form.serviceScore,
        (value) => setForm((current) => ({ ...current, serviceScore: value })),
        scoreOptions,
      )}
      {scoreField(
        l("Infrastruktur / Ambiente", "Инфраструктура / атмосфера", "Infrastructure / ambience"),
        form.infrastructureScore,
        (value) => setForm((current) => ({ ...current, infrastructureScore: value })),
        scoreOptions,
      )}
      {scoreField(
        l("Preis / Leistung", "Цена / ценность", "Price / value"),
        form.priceValueScore,
        (value) => setForm((current) => ({ ...current, priceValueScore: value })),
        scoreOptions,
      )}
      <Field label={l("Behandlungserfolg", "Успех лечения", "Treatment success")}>
        <select
          value={form.treatmentSuccess}
          onChange={(event) =>
            setForm((current) => ({ ...current, treatmentSuccess: event.target.value }))
          }
          className={selectClassName}
        >
          <option value="yes">{l("Ja", "Да", "Yes")}</option>
          <option value="partial">{l("Teilweise", "Частично", "Partial")}</option>
          <option value="no">{l("Nein", "Нет", "No")}</option>
        </select>
      </Field>
      <label className={cn("flex items-center gap-3 rounded-lg px-3 py-2", tokens.surface.mutedCard)}>
        <input
          type="checkbox"
          checked={form.complicationReported}
          onChange={(event) =>
            setForm((current) => ({ ...current, complicationReported: event.target.checked }))
          }
          className="size-4 rounded border-border"
        />
        <span className="text-sm text-muted-foreground">
          {l(
            "Komplikation nach dem Termin gemeldet",
            "Сообщено об осложнении после визита",
            "Complication reported after visit",
          )}
        </span>
      </label>
    </div>
  );
}

function FeedbackFormNotes({
  l,
  form,
  setForm,
  includeInternal,
}: {
  l: Localize;
  form: FeedbackFormState;
  setForm: SetFeedbackForm;
  includeInternal?: boolean;
}) {
  return (
    <>
      <Field label={l("Kommentar", "Комментарий", "Comment")}>
        <textarea
          value={form.comments}
          onChange={(event) => setForm((current) => ({ ...current, comments: event.target.value }))}
          className={textareaClassName}
          placeholder={l("Was ist gut gelaufen?", "Что прошло хорошо?", "What worked well?")}
        />
      </Field>
      <Field label={l("Verbesserungshinweise", "Замечания по улучшению", "Improvement notes")}>
        <textarea
          value={form.improvementNotes}
          onChange={(event) =>
            setForm((current) => ({ ...current, improvementNotes: event.target.value }))
          }
          className={textareaClassName}
          placeholder={l(
            "Was sollte das Team verbessern?",
            "Что стоит улучшить команде?",
            "What should the team improve?",
          )}
        />
      </Field>
      {includeInternal ? (
        <Field label={l("Interne Erfassungsnotiz", "Внутренняя заметка", "Internal capture note")}>
          <textarea
            value={form.internalNote}
            onChange={(event) => setForm((current) => ({ ...current, internalNote: event.target.value }))}
            className={textareaClassName}
            placeholder={l(
              "Wie dieses Feedback erfasst wurde",
              "Как был собран этот отзыв",
              "How this feedback was collected",
            )}
          />
        </Field>
      ) : null}
    </>
  );
}

function feedbackCard(item: PortalFeedbackItem, withInternal = false) {
  return (
    <div className={cn("space-y-4 rounded-xl p-4", tokens.surface.card)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={toneForStatus(item.status)}>{portalStatusLabel(item.status)}</StatusBadge>
            <Badge variant="outline" className="rounded-full">
              {feedbackSourceLabel(item.source)}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              NPS {item.nps_score} · {npsBandLabel(item.nps_score)}
            </Badge>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-foreground">
            {item.patient_name || feedbackText("Patientenfeedback", "Отзыв пациента", "Patient feedback")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {[item.patient_pid, item.appointment_title, item.provider_name, item.doctor_name]
              .filter(Boolean)
              .join(" · ") ||
              feedbackText("Allgemeines Feedback", "Общий отзыв", "General feedback")}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">{formatPortalDateTime(item.submitted_at)}</div>
      </div>

      <AdminTableCard title={titleWithDot(feedbackText("Scores", "Оценки", "Scores"))}>
        <div className="grid gap-3 p-3 md:grid-cols-3 xl:grid-cols-6">
          <DetailField label={feedbackText("Gesamt", "Общая", "Overall")} value={String(item.overall_score)} />
          <DetailField label="PM" value={item.patient_manager_score ? String(item.patient_manager_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Dolmetscher", "Переводчик", "Interpreter")} value={item.interpreter_score ? String(item.interpreter_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label="Concierge" value={item.concierge_score ? String(item.concierge_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Behandlung", "Лечение", "Treatment")} value={item.treatment_score ? String(item.treatment_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Arzt", "Врач", "Doctor")} value={item.doctor_score ? String(item.doctor_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Organisation", "Организация", "Organization")} value={item.organization_score ? String(item.organization_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Service", "Сервис", "Service")} value={item.service_score ? String(item.service_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Ambiente", "Атмосфера", "Ambience")} value={item.infrastructure_score ? String(item.infrastructure_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Preis / Leistung", "Цена / ценность", "Price / value")} value={item.price_value_score ? String(item.price_value_score) : feedbackText("Nicht bewertet", "Не оценено", "Not rated")} />
          <DetailField label={feedbackText("Behandlungserfolg", "Успех лечения", "Treatment success")} value={treatmentSuccessLabel(item.treatment_success)} />
          <DetailField label={feedbackText("Komplikation", "Осложнение", "Complication")} value={item.complication_reported ? feedbackText("Gemeldet", "Сообщено", "Reported") : feedbackText("Nein", "Нет", "No")} />
        </div>
      </AdminTableCard>

      {item.comments ? (
        <AdminTableCard title={titleWithDot(feedbackText("Kommentar", "Комментарий", "Comment"))}>
          <div className="p-3 text-sm text-foreground">{item.comments}</div>
        </AdminTableCard>
      ) : null}
      {item.improvement_notes ? (
        <AdminTableCard title={titleWithDot(feedbackText("Verbesserungshinweise", "Замечания", "Improvement notes"))}>
          <div className="p-3 text-sm text-foreground">{item.improvement_notes}</div>
        </AdminTableCard>
      ) : null}
      {withInternal && item.internal_note ? (
        <AdminTableCard title={titleWithDot(feedbackText("Interne Erfassungsnotiz", "Внутренняя заметка", "Internal capture note"))}>
          <div className="p-3 text-sm text-foreground">{item.internal_note}</div>
        </AdminTableCard>
      ) : null}
      {item.review_note ? (
        <AdminTableCard title={titleWithDot(feedbackText("Prüfnotiz", "Заметка по проверке", "Review note"))}>
          <div className="p-3 text-sm text-foreground">{item.review_note}</div>
        </AdminTableCard>
      ) : null}
    </div>
  );
}

function RankingList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; name: string; subtitle: string; value: string }>;
}) {
  return (
    <AdminTableCard title={titleWithDot(title)}>
      <div className="space-y-2 p-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-2", tokens.surface.mutedCard)}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>
              </div>
              <StatusBadge tone="info">{row.value}</StatusBadge>
            </div>
          ))
        )}
      </div>
    </AdminTableCard>
  );
}

export function FeedbackPage() {
  const { user } = useAuth();
  if (user?.role === "patient") return <PatientFeedbackWorkspace />;
  return <StaffFeedbackWorkspace />;
}

function PatientFeedbackWorkspace() {
  const { lang } = useLang();
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const [feedback, setFeedback] = useState<PortalFeedbackItem[]>([]);
  const [appointments, setAppointments] = useState<PortalAppointmentItem[]>([]);
  const [form, setForm] = useState<FeedbackFormState>(blankFeedbackForm());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [activeFeedbackId, setActiveFeedbackId] = useState("");

  useRealtimeSubscription(FEEDBACK_REALTIME_EVENTS, () => {
    clearApiCache("/me/feedback");
    clearApiCache("/me/appointments");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) setRefreshing(false);
      else setRefreshing(true);

      try {
        const { feedback: feedbackRows, appointments: appointmentRows } =
          await fetchPatientFeedbackWorkspace();
        if (cancelled) return;
        startTransition(() => {
          setFeedback(feedbackRows);
          setAppointments(appointmentRows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : l(
                "Feedback-Bereich konnte nicht geladen werden.",
                "Не удалось загрузить раздел отзывов.",
                "Failed to load feedback workspace.",
              ),
        );
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

  const ratedAppointmentIds = useMemo(
    () => new Set(feedback.map((item) => item.appointment_id).filter(Boolean) as string[]),
    [feedback],
  );

  const availableAppointments = useMemo(
    () => appointments.filter((item) => !ratedAppointmentIds.has(item.id)),
    [appointments, ratedAppointmentIds],
  );

  const averageOverall = useMemo(() => {
    if (feedback.length === 0) return null;
    const total = feedback.reduce((sum, item) => sum + item.overall_score, 0);
    return total / feedback.length;
  }, [feedback]);

  const promoters = useMemo(
    () => feedback.filter((item) => item.nps_score >= 9).length,
    [feedback],
  );

  const activeFeedback = useMemo(
    () => feedback.find((item) => item.id === activeFeedbackId) ?? null,
    [feedback, activeFeedbackId],
  );

  const feedbackColumns = useMemo<ColumnDef<PortalFeedbackItem>[]>(
    () => [
      {
        id: "submitted",
        label: l("Datum", "Дата", "Date"),
        accessor: (row) => row.submitted_at,
        sortable: true,
        width: 170,
        render: (row) => (
          <span className="text-xs text-foreground">{formatPortalDateTime(row.submitted_at)}</span>
        ),
      },
      {
        id: "status",
        label: l("Status", "Статус", "Status"),
        accessor: (row) => row.status,
        width: 140,
        render: (row) => (
          <StatusBadge tone={toneForStatus(row.status)}>{portalStatusLabel(row.status)}</StatusBadge>
        ),
      },
      {
        id: "source",
        label: l("Quelle", "Источник", "Source"),
        accessor: (row) => row.source,
        width: 160,
        render: (row) => <span className="text-xs text-foreground">{feedbackSourceLabel(row.source)}</span>,
      },
      {
        id: "appointment",
        label: l("Termin", "Визит", "Visit"),
        accessor: (row) => row.appointment_title ?? "",
        width: 260,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.appointment_title || l("Allgemeines Feedback", "Общий отзыв", "General feedback")}
          </span>
        ),
      },
      {
        id: "provider",
        label: l("Provider", "Провайдер", "Provider"),
        accessor: (row) => row.provider_name ?? "",
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.provider_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "doctor",
        label: l("Arzt", "Врач", "Doctor"),
        accessor: (row) => row.doctor_name ?? "",
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.doctor_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "nps",
        label: "NPS",
        accessor: (row) => row.nps_score,
        sortable: true,
        width: 110,
        render: (row) => <span className="text-xs text-foreground">{row.nps_score}</span>,
      },
      {
        id: "nps_band",
        label: l("NPS-Band", "NPS-группа", "NPS band"),
        accessor: (row) => npsBandLabel(row.nps_score),
        width: 150,
        render: (row) => <span className="text-xs text-foreground">{npsBandLabel(row.nps_score)}</span>,
      },
      {
        id: "overall",
        label: l("Gesamt", "Общая", "Overall"),
        accessor: (row) => row.overall_score,
        sortable: true,
        width: 110,
        render: (row) => <span className="text-xs text-foreground">{row.overall_score}</span>,
      },
    ],
    [l],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      await submitPatientFeedback({
        appointment_id: form.appointmentId || null,
        overall_score: Number(form.overallScore),
        patient_manager_score: Number(form.patientManagerScore),
        interpreter_score: Number(form.interpreterScore),
        concierge_score: Number(form.conciergeScore),
        treatment_score: Number(form.treatmentScore),
        doctor_score: Number(form.doctorScore),
        organization_score: Number(form.organizationScore),
        service_score: Number(form.serviceScore),
        infrastructure_score: Number(form.infrastructureScore),
        price_value_score: Number(form.priceValueScore),
        treatment_success: form.treatmentSuccess || null,
        complication_reported: form.complicationReported,
        nps_score: Number(form.npsScore),
        comments: form.comments.trim() || null,
        improvement_notes: form.improvementNotes.trim() || null,
      });
      setForm(blankFeedbackForm());
      setNotice(
        l(
          "Feedback wurde gesendet. Vielen Dank.",
          "Отзыв отправлен. Спасибо.",
          "Feedback submitted. Thank you.",
        ),
      );
      setVersion((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : l(
              "Feedback konnte nicht gesendet werden.",
              "Не удалось отправить отзыв.",
              "Failed to submit feedback.",
            ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <LoadingState
        label={l(
          "Feedback-Bereich wird geladen...",
          "Раздел отзывов загружается...",
          "Loading feedback workspace...",
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={l("Mein Feedback", "Мои отзывы", "My feedback")}
        description={l(
          "Teilen Sie Ihre Erfahrungen mit Behandlung, Klinik und Service.",
          "Поделитесь впечатлениями о лечении, клинике и сервисе.",
          "Share your treatment, clinic and service experience.",
        )}
        actions={
          <Button variant="outline" className="h-9 rounded-lg" onClick={() => setVersion((value) => value + 1)}>
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {l("Aktualisieren", "Обновить", "Refresh")}
          </Button>
        }
      />

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="flex flex-wrap gap-5 rounded-xl border border-border bg-card px-4 py-3">
        <AdminInlineMetric
          icon={MessageSquare}
          label={l("Abgegebene Rückmeldungen", "Отправлено отзывов", "Submitted feedback")}
          value={feedback.length}
          tone="sky"
        />
        <AdminInlineMetric
          icon={Star}
          label={l("Promotoren", "Промоутеры", "Promoters")}
          value={promoters}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={BarChart3}
          label={l("Durchschnitt gesamt", "Средняя общая", "Average overall")}
          value={averageOverall === null ? portalNotSetLabel() : formatPortalAverage(averageOverall)}
          tone="amber"
        />
        <AdminInlineMetric
          icon={Users}
          label={l("Verfügbare Termine", "Доступные визиты", "Available visits")}
          value={availableAppointments.length}
          tone="slate"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <AdminTableCard
          title={titleWithDot(l("Neue Zufriedenheitsumfrage", "Новый опрос", "New satisfaction survey"))}
          description={l(
            "Eine Rückmeldung pro Termin plus allgemeines Feedback ohne Termin.",
            "Один отзыв на визит плюс общий отзыв без визита.",
            "One submission per appointment plus general feedback without an appointment.",
          )}
        >
          <form className="space-y-3 p-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label={l("Termin", "Визит", "Appointment")}>
              <select
                value={form.appointmentId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, appointmentId: event.target.value }))
                }
                className={selectClassName}
              >
                <option value="">{l("Allgemeines Feedback", "Общий отзыв", "General feedback")}</option>
                {availableAppointments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {[formatPortalDate(item.date), item.title, item.provider_name, item.doctor_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                ))}
              </select>
            </Field>

            <ScoreGrid l={l} form={form} setForm={setForm} />
            <FeedbackFormNotes l={l} form={form} setForm={setForm} />

            <Button type="submit" className="h-9 rounded-lg" disabled={submitting}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {l("Feedback senden", "Отправить отзыв", "Submit feedback")}
            </Button>
          </form>
        </AdminTableCard>

        <AdminTableCard
          title={titleWithDot(l("Feedback-Verlauf", "История отзывов", "Feedback history"))}
          description={l(
            "Отправленные анкеты и сигналы качества лечения.",
            "Отправленные анкеты и сигналы качества лечения.",
            "Submitted surveys and treatment-quality signals.",
          )}
          count={feedback.length}
        >
          <div className="p-3">
            <DataTable
              rows={feedback}
              columns={feedbackColumns}
              rowId={(row) => row.id}
              activeRowId={activeFeedbackId || null}
              onRowClick={(row) => setActiveFeedbackId(row.id)}
              emptyState={
                <EmptyState
                  title={l("Noch kein Feedback", "Пока нет отзывов", "No feedback yet")}
                  description={l(
                    "Ihre gesendeten Einträge erscheinen hier.",
                    "Здесь появятся ваши отправленные отзывы.",
                    "Your submitted entries will appear here.",
                  )}
                />
              }
            />
          </div>
        </AdminTableCard>
      </div>

      <Sheet open={Boolean(activeFeedback)} onOpenChange={(open) => !open && setActiveFeedbackId("")}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={l("Карточка feedback", "Карточка feedback", "Feedback detail")}
            description={l(
              "Детали оценки и комментарии.",
              "Детали оценки и комментарии.",
              "Score details and comments.",
            )}
          >
            {activeFeedback ? feedbackCard(activeFeedback) : null}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StaffFeedbackWorkspace() {
  const { user } = useAuth();
  const { lang } = useLang();
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const canViewWorkspace = canViewStaffFeedback(user?.role);
  const canCapture = roleCanCaptureFeedback(user?.role);

  const [feedback, setFeedback] = useState<PortalFeedbackItem[]>([]);
  const [summary, setSummary] = useState<PortalFeedbackSummary | null>(null);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientAppointments, setPatientAppointments] = useState<PatientAppointmentOption[]>([]);
  const [form, setForm] = useState<FeedbackFormState>(blankFeedbackForm());
  const [selectedPatientId, setSelectedPatientId] = useState("");

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);

  const [activeReview, setActiveReview] = useState<PortalFeedbackItem | null>(null);
  const [reviewStatus, setReviewStatus] = useState("reviewed");
  const [reviewNote, setReviewNote] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);

  const queryString = useMemo(
    () => buildFeedbackQuery(deferredSearch, statusFilter, sourceFilter),
    [deferredSearch, statusFilter, sourceFilter],
  );

  useRealtimeSubscription(FEEDBACK_REALTIME_EVENTS, () => {
    if (!canViewWorkspace) return;
    clearApiCache("/feedback");
    clearApiCache("/feedback/summary");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;
    if (!canViewWorkspace) {
      setFeedback([]);
      setSummary(null);
      setLoading(false);
      setRefreshing(false);
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      if (loading) setRefreshing(false);
      else setRefreshing(true);

      try {
        const {
          feedback: feedbackRows,
          summary: summaryData,
        } = await fetchStaffFeedbackWorkspace(queryString);
        if (cancelled) return;
        startTransition(() => {
          setFeedback(feedbackRows);
          setSummary(summaryData);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : l(
                "Feedback-Bereich konnte nicht geladen werden.",
                "Не удалось загрузить раздел отзывов.",
                "Failed to load feedback workspace.",
              ),
        );
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
  }, [canViewWorkspace, loading, queryString, version, l]);

  useEffect(() => {
    if (!canViewWorkspace || !canCapture) return;
    let cancelled = false;

    async function loadPatients() {
      try {
        const rows = await fetchFeedbackPatients();
        if (!cancelled) setPatients(rows);
      } catch {
        if (!cancelled) setPatients([]);
      }
    }

    void loadPatients();
    return () => {
      cancelled = true;
    };
  }, [canCapture, canViewWorkspace]);

  useEffect(() => {
    if (!canViewWorkspace || !canCapture || !selectedPatientId) {
      setPatientAppointments([]);
      setForm((current) => ({ ...current, appointmentId: "" }));
      return;
    }

    let cancelled = false;
    async function loadAppointments() {
      try {
        const rows = await fetchFeedbackPatientAppointments(selectedPatientId);
        if (!cancelled) setPatientAppointments(rows);
      } catch {
        if (!cancelled) setPatientAppointments([]);
      }
    }

    void loadAppointments();
    return () => {
      cancelled = true;
    };
  }, [canCapture, canViewWorkspace, selectedPatientId]);

  const feedbackColumns = useMemo<ColumnDef<PortalFeedbackItem>[]>(
    () => [
      {
        id: "submitted",
        label: l("Datum", "Дата", "Date"),
        accessor: (row) => row.submitted_at,
        sortable: true,
        width: 170,
        render: (row) => (
          <span className="text-xs text-foreground">{formatPortalDateTime(row.submitted_at)}</span>
        ),
      },
      {
        id: "patient",
        label: l("Patient", "Пациент", "Patient"),
        accessor: (row) => row.patient_name ?? "",
        sortable: true,
        width: 220,
        pinned: "left",
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {row.patient_name || l("Patient", "Пациент", "Patient")}
          </span>
        ),
      },
      {
        id: "patient_pid",
        label: "PID",
        accessor: (row) => row.patient_pid ?? "",
        width: 130,
        render: (row) => (
          <span className="text-xs text-foreground">{row.patient_pid || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "source",
        label: l("Quelle", "Источник", "Source"),
        accessor: (row) => row.source,
        width: 160,
        render: (row) => <span className="text-xs text-foreground">{feedbackSourceLabel(row.source)}</span>,
      },
      {
        id: "status",
        label: l("Status", "Статус", "Status"),
        accessor: (row) => row.status,
        sortable: true,
        width: 140,
        render: (row) => (
          <StatusBadge tone={toneForStatus(row.status)}>{portalStatusLabel(row.status)}</StatusBadge>
        ),
      },
      {
        id: "nps",
        label: "NPS",
        accessor: (row) => row.nps_score,
        sortable: true,
        width: 120,
        render: (row) => <span className="text-xs text-foreground">{row.nps_score}</span>,
      },
      {
        id: "provider",
        label: l("Provider", "Провайдер", "Provider"),
        accessor: (row) => row.provider_name ?? "",
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.provider_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "doctor",
        label: l("Arzt", "Врач", "Doctor"),
        accessor: (row) => row.doctor_name ?? "",
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.doctor_name || portalNotSetLabel()}</span>
        ),
      },
    ],
    [l],
  );

  function openReview(item: PortalFeedbackItem) {
    setActiveReview(item);
    setReviewStatus(item.status === "archived" ? "archived" : "reviewed");
    setReviewNote(item.review_note || "");
  }

  async function handleCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatientId) {
      setError(
        l(
          "Wählen Sie zuerst einen Patienten aus.",
          "Сначала выберите пациента.",
          "Select a patient first.",
        ),
      );
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      await captureStaffFeedback({
        patient_id: selectedPatientId,
        appointment_id: form.appointmentId || null,
        overall_score: Number(form.overallScore),
        patient_manager_score: Number(form.patientManagerScore),
        interpreter_score: Number(form.interpreterScore),
        concierge_score: Number(form.conciergeScore),
        treatment_score: Number(form.treatmentScore),
        doctor_score: Number(form.doctorScore),
        organization_score: Number(form.organizationScore),
        service_score: Number(form.serviceScore),
        infrastructure_score: Number(form.infrastructureScore),
        price_value_score: Number(form.priceValueScore),
        treatment_success: form.treatmentSuccess || null,
        complication_reported: form.complicationReported,
        nps_score: Number(form.npsScore),
        comments: form.comments.trim() || null,
        improvement_notes: form.improvementNotes.trim() || null,
        internal_note: form.internalNote.trim() || null,
      });
      setForm(blankFeedbackForm());
      setSelectedPatientId("");
      setPatientAppointments([]);
      setCaptureOpen(false);
      setNotice(l("Feedback wurde erfasst.", "Отзыв сохранён.", "Feedback captured."));
      setVersion((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : l(
              "Feedback konnte nicht erfasst werden.",
              "Не удалось сохранить отзыв.",
              "Failed to capture feedback.",
            ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeReview) return;

    setReviewBusy(true);
    setError("");
    setNotice("");

    try {
      await reviewFeedback(activeReview.id, {
        status: reviewStatus,
        review_note: reviewNote.trim() || null,
      });
      setActiveReview(null);
      setReviewStatus("reviewed");
      setReviewNote("");
      setNotice(
        l(
          "Feedback-Prüfung wurde gespeichert.",
          "Проверка отзыва сохранена.",
          "Feedback review saved.",
        ),
      );
      setVersion((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : l(
              "Feedback konnte nicht geprüft werden.",
              "Не удалось сохранить проверку отзыва.",
              "Failed to review feedback.",
            ),
      );
    } finally {
      setReviewBusy(false);
    }
  }

  if (loading) {
    return (
      <LoadingState
        label={l(
          "Feedback-Bereich wird geladen...",
          "Раздел отзывов загружается...",
          "Loading feedback workspace...",
        )}
      />
    );
  }

  if (!canViewWorkspace) {
    return (
      <ShellBanner tone="warning">
        {l(
          "Diese Rolle hat keinen Zugriff auf Feedback-Vorgänge.",
          "У этой роли нет доступа к операциям с отзывами.",
          "This role cannot access feedback operations.",
        )}
      </ShellBanner>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={l("Feedback und NPS", "Отзывы и NPS", "Feedback and NPS")}
        description={l(
          "Queue, review flow and capture workspace for patient feedback.",
          "Очередь, проверка и фиксация отзывов пациентов.",
          "Queue, review flow and capture workspace for patient feedback.",
        )}
        actions={
          <>
            {canCapture ? (
              <Button type="button" className="h-9 rounded-lg" onClick={() => setCaptureOpen(true)}>
                <ClipboardPen className="size-4" />
                {l("Feedback erfassen", "Зафиксировать отзыв", "Capture feedback")}
              </Button>
            ) : null}
            <Button variant="outline" className="h-9 rounded-lg" onClick={() => setVersion((value) => value + 1)}>
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="flex flex-wrap gap-5 rounded-xl border border-border bg-card px-4 py-3">
        <AdminInlineMetric
          icon={MessageSquare}
          label={l("Feedback gesamt", "Всего отзывов", "Total feedback")}
          value={summary?.total_feedback ?? 0}
          tone="sky"
        />
        <AdminInlineMetric
          icon={Star}
          label="NPS"
          value={summary?.nps_score ?? 0}
          description={l(
            `${summary?.promoters ?? 0} Promotoren / ${summary?.detractors ?? 0} Detraktoren`,
            `${summary?.promoters ?? 0} промоутеров / ${summary?.detractors ?? 0} критиков`,
            `${summary?.promoters ?? 0} promoters / ${summary?.detractors ?? 0} detractors`,
          )}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={BarChart3}
          label={l("Geprüft", "Проверено", "Reviewed")}
          value={summary?.reviewed_feedback ?? 0}
          tone="amber"
        />
        <AdminInlineMetric
          icon={Users}
          label={l("Durchschnitt gesamt", "Средняя общая", "Average overall")}
          value={formatPortalAverage(summary?.average_scores?.overall)}
          tone="slate"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <div className="space-y-4">
          <AdminTableCard
            title={titleWithDot(l("Feedback-Warteschlange", "Очередь отзывов", "Feedback queue"))}
            description={l(
              "Search by patient, clinic, doctor or notes.",
              "Поиск по пациенту, клинике, врачу или заметкам.",
              "Search by patient, clinic, doctor or notes.",
            )}
            count={feedback.length}
            accessory={
              <AdminToolbar>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={l(
                      "Patient, Klinik, Arzt oder Notiz",
                      "Пациент, клиника, врач или заметка",
                      "Patient, clinic, doctor or note",
                    )}
                    className={cn(shellInputClassName, "w-72 pl-8")}
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className={selectClassName}
                >
                  <option value="">{l("Alle Status", "Все статусы", "All statuses")}</option>
                  <option value="submitted">{l("Eingereicht", "Отправлено", "Submitted")}</option>
                  <option value="reviewed">{l("Geprüft", "Проверено", "Reviewed")}</option>
                  <option value="archived">{l("Archiviert", "В архиве", "Archived")}</option>
                </select>
                <select
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                  className={selectClassName}
                >
                  <option value="">{l("Alle Quellen", "Все источники", "All sources")}</option>
                  <option value="patient_portal">{l("Patientenportal", "Портал пациента", "Patient portal")}</option>
                  <option value="staff_capture">{l("Erfassung durch Team", "Фиксация сотрудником", "Staff capture")}</option>
                </select>
              </AdminToolbar>
            }
          >
            <div className="p-3">
              <DataTable
                rows={feedback}
                columns={feedbackColumns}
                rowId={(row) => row.id}
                activeRowId={activeReview?.id ?? null}
                onRowClick={(row) => openReview(row)}
                rowActions={(row) => (
                  <Button type="button" variant="outline" className="h-8 rounded-lg" onClick={() => openReview(row)}>
                    <ClipboardPen className="size-3.5" />
                    {l("Prüfen", "Проверить", "Review")}
                  </Button>
                )}
                emptyState={
                  <EmptyState
                    title={l("Keine Feedback-Einträge", "Нет записей отзывов", "No feedback entries")}
                    description={l(
                      "Die aktuellen Filter liefern keine Datensätze.",
                      "Текущие фильтры не возвращают записи.",
                      "Current filters do not return records.",
                    )}
                  />
                }
              />
            </div>
          </AdminTableCard>
        </div>

        <div className="space-y-4">
          {summary ? (
            <>
              <AdminTableCard
                title={titleWithDot(l("Übersicht", "Сводка", "Summary"))}
                description={l(
                  "Average quality values and treatment outcome signals.",
                  "Средние значения качества и сигналы исхода лечения.",
                  "Average quality values and treatment outcome signals.",
                )}
              >
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  <DetailField label={l("Durchschnitt gesamt", "Средняя общая", "Overall avg")} value={formatPortalAverage(summary.average_scores.overall)} />
                  <DetailField label={l("Dolmetscher", "Переводчик", "Interpreter avg")} value={formatPortalAverage(summary.average_scores.interpreter)} />
                  <DetailField label={l("Concierge", "Concierge", "Concierge avg")} value={formatPortalAverage(summary.average_scores.concierge)} />
                  <DetailField label={l("Behandlung", "Лечение", "Treatment avg")} value={formatPortalAverage(summary.average_scores.treatment)} />
                  <DetailField label={l("Service", "Сервис", "Service avg")} value={formatPortalAverage(summary.average_scores.service)} />
                  <DetailField label={l("Ambiente", "Атмосфера", "Ambience avg")} value={formatPortalAverage(summary.average_scores.infrastructure)} />
                  <DetailField label={l("Preis/Leistung", "Цена/ценность", "Value avg")} value={formatPortalAverage(summary.average_scores.price_value)} />
                  <DetailField
                    label={l("Komplikationsrate", "Частота осложнений", "Complication rate")}
                    value={
                      summary.complication_rate === null || summary.complication_rate === undefined
                        ? portalNotSetLabel()
                        : `${summary.complication_rate.toFixed(1)}%`
                    }
                  />
                </div>
              </AdminTableCard>

              <RankingList
                title={l("Top-Promotoren", "Топ промоутеров", "Top promoters")}
                empty={l(
                  "Noch kein Promotoren-Ranking.",
                  "Рейтинг промоутеров пока отсутствует.",
                  "No promoter ranking yet.",
                )}
                rows={summary.top_promoters.slice(0, 5).map((item) => ({
                  id: item.patient_id,
                  name: item.patient_name,
                  subtitle: l(
                    `${item.feedback_count} Rückmeldungen`,
                    `${item.feedback_count} отзывов`,
                    `${item.feedback_count} feedback`,
                  ),
                  value: item.average_nps.toFixed(1),
                }))}
              />

              <RankingList
                title={l("Dolmetscher-Ranking", "Рейтинг переводчиков", "Interpreter ranking")}
                empty={l("Noch kein Dolmetscher-Feedback.", "Отзывов по переводчикам пока нет.", "No interpreter feedback yet.")}
                rows={summary.interpreter_ranking.slice(0, 5).map((item) => ({
                  id: item.user_id ?? item.name,
                  name: item.name,
                  subtitle: l(
                    `${item.feedback_count} Bewertungen`,
                    `${item.feedback_count} оценок`,
                    `${item.feedback_count} ratings`,
                  ),
                  value: item.average_score.toFixed(1),
                }))}
              />

              <RankingList
                title={l("Klinik-Ranking", "Рейтинг клиник", "Clinic ranking")}
                empty={l("Noch kein Klinik-Ranking.", "Рейтинг клиник пока отсутствует.", "No clinic ranking yet.")}
                rows={summary.clinic_ranking.slice(0, 5).map((item) => ({
                  id: item.provider_id ?? item.name,
                  name: item.name,
                  subtitle: l(
                    `${item.feedback_count} Bewertungen`,
                    `${item.feedback_count} оценок`,
                    `${item.feedback_count} ratings`,
                  ),
                  value: item.average_score.toFixed(1),
                }))}
              />
            </>
          ) : null}
        </div>
      </div>

      <Sheet open={captureOpen} onOpenChange={setCaptureOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-3xl">
          <form className="flex h-full flex-col" onSubmit={(event) => void handleCapture(event)}>
            <AdminSheetScaffold
              title={l("Feedback erfassen", "Зафиксировать отзыв", "Capture feedback")}
              description={l(
                "Record clinic feedback when the survey comes by phone or staff handoff.",
                "Фиксация отзыва о клинике при телефонном или внутреннем опросе.",
                "Record clinic feedback when the survey comes by phone or staff handoff.",
              )}
              footer={
                <SheetFormFooter
                  cancelLabel={l("Abbrechen", "Отмена", "Cancel")}
                  submitLabel={l("Feedback erfassen", "Сохранить отзыв", "Capture feedback")}
                  submittingLabel={l("Speichern...", "Сохранение...", "Saving...")}
                  submitting={submitting}
                  onCancel={() => setCaptureOpen(false)}
                />
              }
            >
              <Field label={l("Patient", "Пациент", "Patient")}>
                <select
                  value={selectedPatientId}
                  onChange={(event) => setSelectedPatientId(event.target.value)}
                  className={selectClassName}
                >
                  <option value="">{l("Patient auswählen", "Выберите пациента", "Select patient")}</option>
                  {patients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {patientLabel(item)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={l("Termin", "Визит", "Appointment")}>
                <select
                  value={form.appointmentId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, appointmentId: event.target.value }))
                  }
                  className={selectClassName}
                  disabled={!selectedPatientId}
                >
                  <option value="">{l("Allgemeines Feedback", "Общий отзыв", "General feedback")}</option>
                  {patientAppointments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {[formatPortalDate(item.date), item.title, item.provider_name, item.doctor_name]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </Field>

              <ScoreGrid l={l} form={form} setForm={setForm} />
              <FeedbackFormNotes l={l} form={form} setForm={setForm} includeInternal />
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(activeReview)} onOpenChange={(open) => !open && setActiveReview(null)}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-3xl">
          {activeReview ? (
            <form className="flex h-full flex-col" onSubmit={(event) => void handleReview(event)}>
              <AdminSheetScaffold
                title={l("Feedback prüfen", "Проверить отзыв", "Review feedback")}
                description={l(
                  "Mark as reviewed or archive with an internal note.",
                  "Отметьте как проверено или отправьте в архив с заметкой.",
                  "Mark as reviewed or archive with an internal note.",
                )}
                footer={
                  <SheetFormFooter
                    cancelLabel={l("Schließen", "Закрыть", "Close")}
                    submitLabel={l("Prüfung speichern", "Сохранить проверку", "Save review")}
                    submittingLabel={l("Speichern...", "Сохранение...", "Saving...")}
                    submitting={reviewBusy}
                    onCancel={() => setActiveReview(null)}
                  />
                }
              >
                {feedbackCard(activeReview, true)}

                <AdminTableCard title={titleWithDot(l("Review actions", "Действия проверки", "Review actions"))}>
                  <div className="space-y-3 p-3">
                    <Field label={l("Prüfstatus", "Статус проверки", "Review status")}>
                      <select
                        value={reviewStatus}
                        onChange={(event) => setReviewStatus(event.target.value)}
                        className={selectClassName}
                      >
                        <option value="reviewed">{l("Geprüft", "Проверено", "Reviewed")}</option>
                        <option value="archived">{l("Archiviert", "В архиве", "Archived")}</option>
                      </select>
                    </Field>
                    <Field label={l("Prüfnotiz", "Заметка по проверке", "Review note")}>
                      <textarea
                        value={reviewNote}
                        onChange={(event) => setReviewNote(event.target.value)}
                        className={textareaClassName}
                        placeholder={l(
                          "Operative Nachverfolgung oder Prüfnotiz",
                          "Операционное действие или заметка проверки",
                          "Operational follow-up or review note",
                        )}
                      />
                    </Field>
                  </div>
                </AdminTableCard>
              </AdminSheetScaffold>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
