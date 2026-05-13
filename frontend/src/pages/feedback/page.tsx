import {
  startTransition,
  useEffect,
  useMemo,
  useReducer,
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
  Send,
  Star,
  Users,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  AdminTableCard,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Banner as ShellBanner,
  Section as FormSection,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  checkboxClass,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
  toneForStatus,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  useLang,
  type TranslationKey,
  type Translations,
} from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  formatPortalAverage,
  formatPortalDate,
  formatPortalDateTime,
  npsBandLabel,
  portalNotSetLabel,
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
  canViewStaffFeedback,
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
const FEEDBACK_DEFAULT_FROZEN_COLUMNS = ["patient"];
const FEEDBACK_DEFAULT_HIDDEN_COLUMNS = [
  "comments",
  "improvement_notes",
  "internal_note",
  "review_note",
];
const FEEDBACK_MAX_FROZEN_COLUMNS = 2;
const FEEDBACK_STATUSES = ["submitted", "reviewed", "archived"];
const FEEDBACK_SOURCES = ["patient_portal", "staff_capture"];

type SetFeedbackForm = Dispatch<SetStateAction<FeedbackFormState>>;
type StatePatch<TState> =
  | Partial<TState>
  | ((current: TState) => Partial<TState>);

type PatientFeedbackWorkspaceState = {
  feedback: PortalFeedbackItem[];
  appointments: PortalAppointmentItem[];
  form: FeedbackFormState;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  error: string;
  notice: string;
  version: number;
  activeFeedbackId: string;
};

type StaffFeedbackWorkspaceState = {
  feedback: PortalFeedbackItem[];
  summary: PortalFeedbackSummary | null;
  patients: PatientOption[];
  patientAppointments: PatientAppointmentOption[];
  form: FeedbackFormState;
  selectedPatientId: string;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  reviewBusy: boolean;
  error: string;
  notice: string;
  version: number;
  activeReview: PortalFeedbackItem | null;
  reviewStatus: string;
  reviewNote: string;
  captureOpen: boolean;
};

function applyStatePatch<TState>(
  state: TState,
  patch: StatePatch<TState>,
): TState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createPatientFeedbackWorkspaceState(): PatientFeedbackWorkspaceState {
  return {
    feedback: [],
    appointments: [],
    form: blankFeedbackForm(),
    loading: true,
    refreshing: false,
    submitting: false,
    error: "",
    notice: "",
    version: 0,
    activeFeedbackId: "",
  };
}

function createStaffFeedbackWorkspaceState(): StaffFeedbackWorkspaceState {
  return {
    feedback: [],
    summary: null,
    patients: [],
    patientAppointments: [],
    form: blankFeedbackForm(),
    selectedPatientId: "",
    loading: true,
    refreshing: false,
    submitting: false,
    reviewBusy: false,
    error: "",
    notice: "",
    version: 0,
    activeReview: null,
    reviewStatus: "reviewed",
    reviewNote: "",
    captureOpen: false,
  };
}

const FEEDBACK_STATUS_LABEL_KEYS = {
  submitted: "feedback_status_submitted",
  reviewed: "feedback_status_reviewed",
  archived: "feedback_status_archived",
} as const satisfies Partial<Record<string, TranslationKey>>;

const FEEDBACK_SOURCE_LABEL_KEYS = {
  patient_portal: "feedback_source_patient_portal",
  staff_capture: "feedback_source_staff_capture",
} as const satisfies Partial<Record<string, TranslationKey>>;

const FEEDBACK_TREATMENT_SUCCESS_LABEL_KEYS = {
  yes: "feedback_treatment_success_yes",
  partial: "feedback_treatment_success_partial",
  no: "feedback_treatment_success_no",
} as const satisfies Partial<Record<string, TranslationKey>>;

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function feedbackReviewStatusLabel(status: string, translations: Translations) {
  return formatEnumLabelFromKeys(status, FEEDBACK_STATUS_LABEL_KEYS, translations);
}

function feedbackStatusTone(status: string) {
  if (status === "reviewed") return "success";
  if (status === "submitted") return "warning";
  if (status === "archived") return "neutral";
  return toneForStatus(status);
}

function feedbackStatusAccentClass(status: string) {
  if (status === "reviewed") return "bg-emerald-500";
  if (status === "submitted") return "bg-amber-500";
  if (status === "archived") return "bg-muted-foreground/45";
  return "bg-sky-500";
}

function feedbackSourceDisplay(source: string | null | undefined, translations: Translations) {
  return formatEnumLabelFromKeys(source, FEEDBACK_SOURCE_LABEL_KEYS, translations);
}

function treatmentSuccessLabel(value: string | null | undefined, translations: Translations) {
  return formatEnumLabelFromKeys(value, FEEDBACK_TREATMENT_SUCCESS_LABEL_KEYS, translations);
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

function FeedbackSummaryLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="h-px min-w-6 flex-1 bg-border/70" />
      <span className="shrink-0 text-sm font-semibold leading-none text-foreground">
        {value || portalNotSetLabel()}
      </span>
    </div>
  );
}

function FeedbackTextSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
        </div>
      </div>
      <div className="mt-5 text-sm text-foreground">{children}</div>
    </section>
  );
}

function FeedbackReviewHeaderVariants({ item, t }: { item: PortalFeedbackItem; t: Translations }) {
  const title = item.patient_name || t.feedback_patient_feedback;
  const context =
    [item.patient_pid, item.appointment_title, item.provider_name, item.doctor_name]
      .filter(Boolean)
      .join(" - ") || t.feedback_general_feedback;
  const submittedAt = formatPortalDateTime(item.submitted_at);
  const tags = (
    <>
      <Badge variant="outline" className="rounded-full">
        {feedbackSourceDisplay(item.source, t)}
      </Badge>
      <Badge variant="outline" className="rounded-full">
        {t.uiText.feedback_nps_label} {item.nps_score} - {npsBandLabel(item.nps_score)}
      </Badge>
    </>
  );

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="relative overflow-hidden p-4">
        <span
          className={cn(
            "absolute left-0 top-4 h-12 w-1 rounded-r-full",
            feedbackStatusAccentClass(item.status),
          )}
        />
        <div className="grid gap-4 pl-3 md:grid-cols-[minmax(0,1fr)_120px]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-px w-8 bg-border" />
              <StatusBadge tone={feedbackStatusTone(item.status)}>
                {feedbackReviewStatusLabel(item.status, t)}
              </StatusBadge>
            </div>
            <h3 className="mt-2 text-lg font-semibold leading-none text-foreground">{title}</h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{context}</p>
            <div className="mt-3 flex flex-wrap gap-2">{tags}</div>
          </div>
          <div className="flex flex-col justify-between border-l border-dashed border-border pl-4">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {feedbackSourceDisplay(item.source, t)}
            </span>
            <span className="text-right text-xs font-medium leading-5 text-foreground">
              {submittedAt}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function appointmentOptionLabel(item: PatientAppointmentOption) {
  return [formatPortalDate(item.date), item.title, item.provider_name, item.doctor_name]
    .filter(Boolean)
    .join(" - ");
}

function scoreField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: string[],
) {
  return (
    <Field label={label}>
      <NativeComboboxSelect
        value={value}
        onChange={(event) => onChange(event.target.value || value)}
        className={selectClassName}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeComboboxSelect>
    </Field>
  );
}

function ScoreGrid({
  t,
  form,
  setForm,
}: {
  t: Translations;
  form: FeedbackFormState;
  setForm: SetFeedbackForm;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {scoreField(
        t.feedback_overall,
        form.overallScore,
        (value) => setForm((current) => ({ ...current, overallScore: value })),
        scoreOptions,
      )}
      {scoreField(
        `${t.uiText.feedback_nps_label} 0-10`,
        form.npsScore,
        (value) => setForm((current) => ({ ...current, npsScore: value })),
        npsOptions,
      )}
      {scoreField(
        t.feedback_patient_manager,
        form.patientManagerScore,
        (value) => setForm((current) => ({ ...current, patientManagerScore: value })),
        scoreOptions,
      )}
      {scoreField(
        t.feedback_interpreter,
        form.interpreterScore,
        (value) => setForm((current) => ({ ...current, interpreterScore: value })),
        scoreOptions,
      )}
      {scoreField(t.feedback_concierge, form.conciergeScore, (value) => setForm((current) => ({ ...current, conciergeScore: value })), scoreOptions)}
      {scoreField(
        t.feedback_treatment_quality,
        form.treatmentScore,
        (value) => setForm((current) => ({ ...current, treatmentScore: value })),
        scoreOptions,
      )}
      {scoreField(
        t.feedback_doctors,
        form.doctorScore,
        (value) => setForm((current) => ({ ...current, doctorScore: value })),
        scoreOptions,
      )}
      {scoreField(
        t.feedback_organization,
        form.organizationScore,
        (value) => setForm((current) => ({ ...current, organizationScore: value })),
        scoreOptions,
      )}
      {scoreField(
        t.feedback_service_quality,
        form.serviceScore,
        (value) => setForm((current) => ({ ...current, serviceScore: value })),
        scoreOptions,
      )}
      {scoreField(
        t.feedback_infrastructure_ambience,
        form.infrastructureScore,
        (value) => setForm((current) => ({ ...current, infrastructureScore: value })),
        scoreOptions,
      )}
      {scoreField(
        t.feedback_price_value,
        form.priceValueScore,
        (value) => setForm((current) => ({ ...current, priceValueScore: value })),
        scoreOptions,
      )}
      <Field label={t.feedback_treatment_success}>
        <NativeComboboxSelect
          value={form.treatmentSuccess}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              treatmentSuccess: event.target.value || current.treatmentSuccess,
            }))
          }
          className={selectClassName}
        >
          <option value="yes">{t.feedback_treatment_success_yes}</option>
          <option value="partial">{t.feedback_treatment_success_partial}</option>
          <option value="no">{t.feedback_treatment_success_no}</option>
        </NativeComboboxSelect>
      </Field>
      <label className={cn("flex items-center gap-3 rounded-lg px-3 py-2", tokens.surface.mutedCard)}>
        <input
          type="checkbox"
          checked={form.complicationReported}
          onChange={(event) =>
            setForm((current) => ({ ...current, complicationReported: event.target.checked }))
          }
          className={checkboxClass}
        />
        <span className="text-sm text-muted-foreground">{t.feedback_complication_after_visit}</span>
      </label>
    </div>
  );
}

function FeedbackFormNotes({
  t,
  form,
  setForm,
  includeInternal,
}: {
  t: Translations;
  form: FeedbackFormState;
  setForm: SetFeedbackForm;
  includeInternal?: boolean;
}) {
  return (
    <>
      <Field label={t.feedback_comment}>
        <textarea
          value={form.comments}
          onChange={(event) => setForm((current) => ({ ...current, comments: event.target.value }))}
          className={textareaClassName}
          placeholder={t.feedback_comment_placeholder}
        />
      </Field>
      <Field label={t.feedback_improvement_notes}>
        <textarea
          value={form.improvementNotes}
          onChange={(event) =>
            setForm((current) => ({ ...current, improvementNotes: event.target.value }))
          }
          className={textareaClassName}
          placeholder={t.feedback_improvement_notes_placeholder}
        />
      </Field>
      {includeInternal ? (
        <Field label={t.feedback_internal_note}>
          <textarea
            value={form.internalNote}
            onChange={(event) => setForm((current) => ({ ...current, internalNote: event.target.value }))}
            className={textareaClassName}
            placeholder={t.feedback_internal_note_placeholder}
          />
        </Field>
      ) : null}
    </>
  );
}

function feedbackCard(item: PortalFeedbackItem, t: Translations, withInternal = false) {
  const notRated = t.feedback_not_rated;
  return (
    <>
        <FeedbackReviewHeaderVariants item={item} t={t} />

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.feedback_scores)}</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            <div className="grid gap-2 rounded-xl bg-card p-3">
              <FeedbackSummaryLine label={t.feedback_overall} value={String(item.overall_score)} />
              <FeedbackSummaryLine label={t.uiText.feedback_pm_label} value={item.patient_manager_score ? String(item.patient_manager_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_interpreter} value={item.interpreter_score ? String(item.interpreter_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_concierge} value={item.concierge_score ? String(item.concierge_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_treatment} value={item.treatment_score ? String(item.treatment_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_doctor} value={item.doctor_score ? String(item.doctor_score) : notRated} />
            </div>
            <div className="grid gap-2 rounded-xl bg-card p-3">
              <FeedbackSummaryLine label={t.feedback_organization} value={item.organization_score ? String(item.organization_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_service} value={item.service_score ? String(item.service_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_ambience} value={item.infrastructure_score ? String(item.infrastructure_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_price_value} value={item.price_value_score ? String(item.price_value_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_treatment_success} value={treatmentSuccessLabel(item.treatment_success, t)} />
              <FeedbackSummaryLine label={t.feedback_complication} value={item.complication_reported ? t.feedback_complication_reported : t.common_no} />
            </div>
          </div>
        </section>

        {item.comments ? (
          <FeedbackTextSection title={t.feedback_comment}>
            {item.comments}
          </FeedbackTextSection>
        ) : null}
        {item.improvement_notes ? (
          <FeedbackTextSection title={t.feedback_improvement_notes}>
            {item.improvement_notes}
          </FeedbackTextSection>
        ) : null}
        {withInternal && item.internal_note ? (
          <FeedbackTextSection title={t.feedback_internal_note}>
            {item.internal_note}
          </FeedbackTextSection>
        ) : null}
        {item.review_note ? (
          <FeedbackTextSection title={t.feedback_review_note}>
            {item.review_note}
          </FeedbackTextSection>
        ) : null}
    </>
  );
}

function RankingList({
  title,
  empty,
  rows,
  horizontal = false,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; name: string; subtitle: string; value: string }>;
  horizontal?: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
        </div>
      </div>
      <div className={cn("mt-5", horizontal ? "grid gap-2 md:grid-cols-2 xl:grid-cols-5" : "space-y-2")}>
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
    </section>
  );
}

export function FeedbackPage() {
  const { user } = useAuth();
  if (user?.role === "patient") return <PatientFeedbackWorkspace />;
  return <StaffFeedbackWorkspace />;
}

type PatientFeedbackContentProps = {
  activeFeedback: PortalFeedbackItem | null;
  activeFeedbackId: string;
  availableAppointments: PortalAppointmentItem[];
  averageOverall: number | null;
  error: string;
  feedback: PortalFeedbackItem[];
  feedbackColumns: ColumnDef<PortalFeedbackItem>[];
  form: FeedbackFormState;
  notice: string;
  promoters: number;
  refreshing: boolean;
  submitting: boolean;
  t: ReturnType<typeof useLang>["t"];
  setActiveFeedbackId: Dispatch<SetStateAction<string>>;
  setForm: SetFeedbackForm;
  setVersion: Dispatch<SetStateAction<number>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function PatientFeedbackContent({
  activeFeedback,
  activeFeedbackId,
  availableAppointments,
  averageOverall,
  error,
  feedback,
  feedbackColumns,
  form,
  notice,
  promoters,
  refreshing,
  submitting,
  t,
  setActiveFeedbackId,
  setForm,
  setVersion,
  onSubmit,
}: PatientFeedbackContentProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.feedback_patient_page_title}
        description={t.feedback_patient_page_description}
        actions={
          <Button variant="outline" className="h-9 rounded-lg" onClick={() => setVersion((value) => value + 1)}>
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t.common_refresh}
          </Button>
        }
      />

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric icon={MessageSquare} label={t.feedback_submitted_feedback_metric} value={feedback.length} tone="sky" />
        <AdminInlineMetric icon={Star} label={null} value={promoters} tone="emerald" />
        <AdminInlineMetric
          icon={BarChart3}
          label={t.feedback_average_overall_metric}
          value={averageOverall === null ? portalNotSetLabel() : formatPortalAverage(averageOverall)}
          tone="amber"
        />
        <AdminInlineMetric icon={Users} label={t.feedback_available_visits_metric} value={availableAppointments.length} tone="slate" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <AdminTableCard
          title={titleWithDot(t.feedback_new_survey_title)}
          description={t.feedback_new_survey_description}
        >
          <form className="space-y-3 p-4" onSubmit={(event) => void onSubmit(event)}>
            <Field label={t.feedback_visit}>
              <NativeComboboxSelect
                value={form.appointmentId || "__general__"}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    appointmentId:
                      event.target.value === "__general__" || !event.target.value
                        ? ""
                        : event.target.value,
                  }))
                }
                className={selectClassName}
              >
                <option value="__general__">{t.feedback_general_feedback}</option>
                {availableAppointments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {appointmentOptionLabel(item)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>

            <ScoreGrid t={t} form={form} setForm={setForm} />
            <FeedbackFormNotes t={t} form={form} setForm={setForm} />

            <Button type="submit" className="h-9 rounded-lg" disabled={submitting}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t.feedback_submit_button}
            </Button>
          </form>
        </AdminTableCard>

        <AdminTableCard
          title={titleWithDot(t.feedback_history_title)}
          description={t.feedback_history_description}
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
                  title={t.feedback_empty_title}
                  description={t.feedback_empty_description}
                />
              }
            />
          </div>
        </AdminTableCard>
      </div>

      <Sheet open={Boolean(activeFeedback)} onOpenChange={(open) => !open && setActiveFeedbackId("")}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={t.feedback_detail_title}
            description={t.feedback_detail_description}
          >
            {activeFeedback ? feedbackCard(activeFeedback, t) : null}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PatientFeedbackWorkspace() {
  const { t } = useLang();
  const [patientState, dispatchPatientState] = useReducer(
    (
      state: PatientFeedbackWorkspaceState,
      patch: StatePatch<PatientFeedbackWorkspaceState>,
    ) => applyStatePatch(state, patch),
    undefined,
    createPatientFeedbackWorkspaceState,
  );
  const {
    feedback,
    appointments,
    form,
    loading,
    refreshing,
    submitting,
    error,
    notice,
    version,
    activeFeedbackId,
  } = patientState;

  const setForm = useMemo<SetFeedbackForm>(
    () => (nextValue) => {
      dispatchPatientState((current) => ({
        form:
          typeof nextValue === "function"
            ? nextValue(current.form)
            : nextValue,
      }));
    },
    [],
  );
  const setVersion = useMemo<Dispatch<SetStateAction<number>>>(
    () => (nextValue) => {
      dispatchPatientState((current) => ({
        version:
          typeof nextValue === "function"
            ? nextValue(current.version)
            : nextValue,
      }));
    },
    [],
  );
  const setActiveFeedbackId = useMemo<Dispatch<SetStateAction<string>>>(
    () => (nextValue) => {
      dispatchPatientState((current) => ({
        activeFeedbackId:
          typeof nextValue === "function"
            ? nextValue(current.activeFeedbackId)
            : nextValue,
      }));
    },
    [],
  );

  useDebouncedRealtimeSubscription(FEEDBACK_REALTIME_EVENTS, () => {
    clearApiCache("/me/feedback");
    clearApiCache("/me/appointments");
    setVersion((value) => value + 1);
  }, 250);

  useEffect(() => {
    let cancelled = false;
    const initialLoad = loading;

    async function load() {
      dispatchPatientState({
        refreshing: !initialLoad,
      });

      try {
        const { feedback: feedbackRows, appointments: appointmentRows } =
          await fetchPatientFeedbackWorkspace();
        if (cancelled) return;
        startTransition(() => {
          dispatchPatientState({
            feedback: feedbackRows,
            appointments: appointmentRows,
            error: "",
            loading: false,
            refreshing: false,
          });
        });
      } catch (err) {
        if (cancelled) return;
        dispatchPatientState({
          error:
            err instanceof Error
              ? err.message
              : t.feedback_workspace_load_error,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [version, t]);

  const ratedAppointmentIds = useMemo(
    () =>
      new Set(
        feedback.flatMap((item) =>
          item.appointment_id ? [item.appointment_id] : [],
        ),
      ),
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
        label: t.feedback_date,
        accessor: (row) => row.submitted_at,
        sortable: true,
        width: 170,
        render: (row) => (
          <span className="text-xs text-foreground">{formatPortalDateTime(row.submitted_at)}</span>
        ),
      },
      {
        id: "status",
        label: t.feedback_status,
        accessor: (row) => row.status,
        width: 140,
        render: (row) => (
          <StatusBadge tone={feedbackStatusTone(row.status)}>{feedbackReviewStatusLabel(row.status, t)}</StatusBadge>
        ),
      },
      {
        id: "source",
        label: t.feedback_source,
        accessor: (row) => row.source,
        width: 160,
        render: (row) => <span className="text-xs text-foreground">{feedbackSourceDisplay(row.source, t)}</span>,
      },
      {
        id: "appointment",
        label: t.feedback_visit,
        accessor: (row) => row.appointment_title ?? "",
        width: 260,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.appointment_title || t.feedback_general_feedback}
          </span>
        ),
      },
      {
        id: "provider",
        label: t.feedback_provider,
        accessor: (row) => row.provider_name ?? "",
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.provider_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "doctor",
        label: t.feedback_doctor,
        accessor: (row) => row.doctor_name ?? "",
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.doctor_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "nps",
        label: t.uiText.feedback_nps_label,
        accessor: (row) => row.nps_score,
        sortable: true,
        width: 110,
        render: (row) => <span className="text-xs text-foreground">{row.nps_score}</span>,
      },
      {
        id: "nps_band",
        label: t.feedback_nps_band,
        accessor: (row) => npsBandLabel(row.nps_score),
        width: 150,
        render: (row) => <span className="text-xs text-foreground">{npsBandLabel(row.nps_score)}</span>,
      },
      {
        id: "overall",
        label: t.feedback_overall,
        accessor: (row) => row.overall_score,
        sortable: true,
        width: 110,
        render: (row) => <span className="text-xs text-foreground">{row.overall_score}</span>,
      },
    ],
    [t],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchPatientState({
      submitting: true,
      error: "",
      notice: "",
    });

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
      dispatchPatientState((current) => ({
        form: blankFeedbackForm(),
        notice: t.feedback_submit_success,
        version: current.version + 1,
        submitting: false,
      }));
    } catch (err) {
      dispatchPatientState({
        error:
          err instanceof Error
            ? err.message
            : t.feedback_submit_error,
        submitting: false,
      });
    }
  }

  if (loading) {
    return (
      <LoadingState
        label={t.feedback_loading_workspace}
      />
    );
  }

  return (
    <PatientFeedbackContent
      activeFeedback={activeFeedback}
      activeFeedbackId={activeFeedbackId}
      availableAppointments={availableAppointments}
      averageOverall={averageOverall}
      error={error}
      feedback={feedback}
      feedbackColumns={feedbackColumns}
      form={form}
      notice={notice}
      promoters={promoters}
      refreshing={refreshing}
      submitting={submitting}
      t={t}
      setActiveFeedbackId={setActiveFeedbackId}
      setForm={setForm}
      setVersion={setVersion}
      onSubmit={handleSubmit}
    />
  );
}

function useStaffFeedbackWorkspaceContent() {
  const { user } = useAuth();
  const { t } = useLang();
  const canViewWorkspace = canViewStaffFeedback(user?.role);
  const canCapture = roleCanCaptureFeedback(user?.role);

  const [staffState, dispatchStaffState] = useReducer(
    (
      state: StaffFeedbackWorkspaceState,
      patch: StatePatch<StaffFeedbackWorkspaceState>,
    ) => applyStatePatch(state, patch),
    undefined,
    createStaffFeedbackWorkspaceState,
  );
  const {
    feedback,
    summary,
    patients,
    patientAppointments,
    form,
    selectedPatientId,
    loading,
    refreshing,
    submitting,
    reviewBusy,
    error,
    notice,
    version,
    activeReview,
    reviewStatus,
    reviewNote,
    captureOpen,
  } = staffState;

  const setForm = useMemo<SetFeedbackForm>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        form:
          typeof nextValue === "function"
            ? nextValue(current.form)
            : nextValue,
      }));
    },
    [],
  );
  const setVersion = useMemo<Dispatch<SetStateAction<number>>>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        version:
          typeof nextValue === "function"
            ? nextValue(current.version)
            : nextValue,
      }));
    },
    [],
  );
  const setSelectedPatientId = useMemo<Dispatch<SetStateAction<string>>>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        selectedPatientId:
          typeof nextValue === "function"
            ? nextValue(current.selectedPatientId)
            : nextValue,
      }));
    },
    [],
  );
  const setCaptureOpen = useMemo<Dispatch<SetStateAction<boolean>>>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        captureOpen:
          typeof nextValue === "function"
            ? nextValue(current.captureOpen)
            : nextValue,
      }));
    },
    [],
  );
  const setActiveReview = useMemo<Dispatch<SetStateAction<PortalFeedbackItem | null>>>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        activeReview:
          typeof nextValue === "function"
            ? nextValue(current.activeReview)
            : nextValue,
      }));
    },
    [],
  );
  const setReviewStatus = useMemo<Dispatch<SetStateAction<string>>>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        reviewStatus:
          typeof nextValue === "function"
            ? nextValue(current.reviewStatus)
            : nextValue,
      }));
    },
    [],
  );
  const setReviewNote = useMemo<Dispatch<SetStateAction<string>>>(
    () => (nextValue) => {
      dispatchStaffState((current) => ({
        reviewNote:
          typeof nextValue === "function"
            ? nextValue(current.reviewNote)
            : nextValue,
      }));
    },
    [],
  );

  useDebouncedRealtimeSubscription(FEEDBACK_REALTIME_EVENTS, () => {
    if (!canViewWorkspace) return;
    clearApiCache("/feedback");
    clearApiCache("/feedback/summary");
    setVersion((value) => value + 1);
  }, 250);

  useEffect(() => {
    let cancelled = false;
    if (!canViewWorkspace) {
      dispatchStaffState({
        feedback: [],
        summary: null,
        loading: false,
        refreshing: false,
      });
      return () => {
        cancelled = true;
      };
    }
    const initialLoad = loading;

    async function load() {
      dispatchStaffState({
        refreshing: !initialLoad,
      });

      try {
        const {
          feedback: feedbackRows,
          summary: summaryData,
        } = await fetchStaffFeedbackWorkspace("");
        if (cancelled) return;
        startTransition(() => {
          dispatchStaffState({
            feedback: feedbackRows,
            summary: summaryData,
            error: "",
            loading: false,
            refreshing: false,
          });
        });
      } catch (err) {
        if (cancelled) return;
        dispatchStaffState({
          error:
            err instanceof Error
              ? err.message
              : t.feedback_workspace_load_error,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canViewWorkspace, version, t]);

  useEffect(() => {
    if (!canViewWorkspace || !canCapture) return;
    let cancelled = false;

    async function loadPatients() {
      try {
        const rows = await fetchFeedbackPatients();
        if (!cancelled) dispatchStaffState({ patients: rows });
      } catch {
        if (!cancelled) dispatchStaffState({ patients: [] });
      }
    }

    void loadPatients();
    return () => {
      cancelled = true;
    };
  }, [canCapture, canViewWorkspace]);

  useEffect(() => {
    if (!canViewWorkspace || !canCapture || !selectedPatientId) {
      dispatchStaffState((current) => ({
        patientAppointments: [],
        form: { ...current.form, appointmentId: "" },
      }));
      return;
    }

    let cancelled = false;
    async function loadAppointments() {
      try {
        const rows = await fetchFeedbackPatientAppointments(selectedPatientId);
        if (!cancelled) dispatchStaffState({ patientAppointments: rows });
      } catch {
        if (!cancelled) dispatchStaffState({ patientAppointments: [] });
      }
    }

    void loadAppointments();
    return () => {
      cancelled = true;
    };
  }, [canCapture, canViewWorkspace, selectedPatientId]);

  const feedbackTableDictionary = useMemo(
    () => ({
      table_filter: t.table_filter,
      table_filter_search_fields: t.table_filter_search_fields,
      table_filter_no_fields: t.table_filter_no_fields,
      table_filter_remove: t.table_filter_remove,
      table_filter_value: t.table_filter_value,
      table_sort_add: t.table_sort_add,
      table_sort_clear: t.table_sort_clear,
      table_sort_ascending: t.table_sort_ascending,
      table_sort_descending: t.table_sort_descending,
      table_sort_move_up: t.table_sort_move_up,
      table_sort_move_down: t.table_sort_move_down,
      table_columns: t.table_columns,
      table_columns_search: t.table_columns_search,
      table_columns_show_all: t.table_columns_show_all,
      table_columns_hide_all: t.table_columns_hide_all,
      table_columns_required: t.table_columns_required,
      table_columns_freeze: t.table_columns_freeze,
      table_columns_unfreeze: t.table_columns_unfreeze,
      table_columns_frozen: t.table_columns_frozen,
      table_columns_freeze_limit: t.table_columns_freeze_limit,
      table_density: t.table_density,
      table_density_comfortable: t.table_density_comfortable,
      table_density_compact: t.table_density_compact,
      table_density_condensed: t.table_density_condensed,
      table_actions: t.common_actions,
      common_reset: t.common_reset,
      common_remove: t.common_remove,
      common_clear_all: t.common_clear,
      common_yes: t.common_yes,
      common_no: t.common_no,
      filter_op_contains: t.filter_op_contains,
      filter_op_does_not_contain: t.filter_op_does_not_contain,
      filter_op_is_empty: t.filter_op_is_empty,
      filter_op_is_not_empty: t.filter_op_is_not_empty,
      filter_op_is: t.filter_op_is,
      filter_op_is_not: t.filter_op_is_not,
      filter_op_is_any_of: t.filter_op_is_any_of,
      filter_op_is_none_of: t.filter_op_is_none_of,
      filter_op_before: t.filter_op_before,
      filter_op_after: t.filter_op_after,
      filter_op_between: t.filter_op_between,
      filter_op_last_n_days: t.filter_op_last_n_days,
      filter_op_equals: t.filter_op_equals,
    }),
    [t],
  );

  const feedbackColumnGroups = useMemo(
    () => ({
      identity: t.feedback_group_identity,
      feedback: t.feedback_group_feedback,
      treatment: t.feedback_group_treatment,
      scores: t.feedback_group_scores,
      audit: t.feedback_group_audit,
    }),
    [t],
  );

  const feedbackColumns = useMemo<ColumnDef<PortalFeedbackItem>[]>(
    () => [
      {
        id: "submitted",
        label: t.feedback_date,
        accessor: (row) => row.submitted_at,
        filterType: "date",
        group: "audit",
        sortable: true,
        width: 170,
        render: (row) => (
          <span className="text-xs text-foreground">{formatPortalDateTime(row.submitted_at)}</span>
        ),
      },
      {
        id: "patient",
        label: t.feedback_patient,
        accessor: (row) => row.patient_name ?? "",
        filterType: "text",
        group: "identity",
        searchable: true,
        sortable: true,
        width: 220,
        pinned: "left",
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {row.patient_name || t.feedback_patient}
          </span>
        ),
      },
      {
        id: "patient_pid",
        label: t.revenue_common_patient_id,
        accessor: (row) => row.patient_pid ?? "",
        filterType: "text",
        group: "identity",
        searchable: true,
        width: 130,
        render: (row) => (
          <span className="text-xs text-foreground">{row.patient_pid || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "source",
        label: t.feedback_source,
        accessor: (row) => row.source,
        filterType: "enum",
        filterOptions: FEEDBACK_SOURCES.map((source) => ({
          value: source,
          label: feedbackSourceDisplay(source, t),
        })),
        group: "feedback",
        sortable: true,
        width: 160,
        render: (row) => <span className="text-xs text-foreground">{feedbackSourceDisplay(row.source, t)}</span>,
      },
      {
        id: "status",
        label: t.feedback_status,
        accessor: (row) => row.status,
        filterType: "enum",
        filterOptions: FEEDBACK_STATUSES.map((status) => ({
          value: status,
          label: feedbackReviewStatusLabel(status, t),
        })),
        group: "feedback",
        sortable: true,
        width: 140,
        render: (row) => (
          <StatusBadge tone={toneForStatus(row.status)}>
            {feedbackReviewStatusLabel(row.status, t)}
          </StatusBadge>
        ),
      },
      {
        id: "nps",
        label: t.uiText.feedback_nps_label,
        accessor: (row) => row.nps_score,
        filterType: "number",
        group: "scores",
        sortable: true,
        width: 120,
        render: (row) => <span className="text-xs text-foreground">{row.nps_score}</span>,
      },
      {
        id: "provider",
        label: t.feedback_provider,
        accessor: (row) => row.provider_name ?? "",
        filterType: "text",
        group: "treatment",
        searchable: true,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.provider_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "doctor",
        label: t.feedback_doctor,
        accessor: (row) => row.doctor_name ?? "",
        filterType: "text",
        group: "treatment",
        searchable: true,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">{row.doctor_name || portalNotSetLabel()}</span>
        ),
      },
      {
        id: "comments",
        label: t.feedback_comment,
        accessor: (row) => row.comments ?? "",
        filterType: "text",
        group: "feedback",
        searchable: true,
        width: 260,
        render: (row) => (
          <span className="line-clamp-2 text-xs text-foreground">
            {row.comments || portalNotSetLabel()}
          </span>
        ),
      },
      {
        id: "improvement_notes",
        label: t.feedback_improvement_notes,
        accessor: (row) => row.improvement_notes ?? "",
        filterType: "text",
        group: "feedback",
        searchable: true,
        width: 260,
        render: (row) => (
          <span className="line-clamp-2 text-xs text-foreground">
            {row.improvement_notes || portalNotSetLabel()}
          </span>
        ),
      },
      {
        id: "internal_note",
        label: t.feedback_internal_note,
        accessor: (row) => row.internal_note ?? "",
        filterType: "text",
        group: "audit",
        searchable: true,
        width: 260,
        render: (row) => (
          <span className="line-clamp-2 text-xs text-foreground">
            {row.internal_note || portalNotSetLabel()}
          </span>
        ),
      },
      {
        id: "review_note",
        label: t.feedback_review_note,
        accessor: (row) => row.review_note ?? "",
        filterType: "text",
        group: "audit",
        searchable: true,
        width: 260,
        render: (row) => (
          <span className="line-clamp-2 text-xs text-foreground">
            {row.review_note || portalNotSetLabel()}
          </span>
        ),
      },
    ],
    [t],
  );

  function openReview(item: PortalFeedbackItem) {
    dispatchStaffState({
      activeReview: item,
      reviewStatus: item.status === "archived" ? "archived" : "reviewed",
      reviewNote: item.review_note || "",
    });
  }

  async function handleCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatientId) {
      dispatchStaffState({ error: t.feedback_select_patient_error });
      return;
    }

    dispatchStaffState({
      submitting: true,
      error: "",
      notice: "",
    });

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
      dispatchStaffState((current) => ({
        form: blankFeedbackForm(),
        selectedPatientId: "",
        patientAppointments: [],
        captureOpen: false,
        notice: t.feedback_capture_notice,
        version: current.version + 1,
        submitting: false,
      }));
    } catch (err) {
      dispatchStaffState({
        error:
          err instanceof Error
            ? err.message
            : t.feedback_capture_error,
        submitting: false,
      });
    }
  }

  async function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeReview) return;

    dispatchStaffState({
      reviewBusy: true,
      error: "",
      notice: "",
    });

    try {
      await reviewFeedback(activeReview.id, {
        status: reviewStatus,
        review_note: reviewNote.trim() || null,
      });
      dispatchStaffState((current) => ({
        activeReview: null,
        reviewStatus: "reviewed",
        reviewNote: "",
        notice: t.feedback_review_notice,
        version: current.version + 1,
        reviewBusy: false,
      }));
    } catch (err) {
      dispatchStaffState({
        error:
          err instanceof Error
            ? err.message
            : t.feedback_review_error,
        reviewBusy: false,
      });
    }
  }

  if (loading) {
    return (
      <LoadingState
        label={t.feedback_loading_workspace}
      />
    );
  }

  if (!canViewWorkspace) {
    return (
      <ShellBanner tone="warning">
        {t.feedback_access_denied}
      </ShellBanner>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.feedback_staff_page_title}
        description={t.feedback_staff_page_description}
        actions={
          <>
            {canCapture ? (
              <Button type="button" className="h-9 rounded-lg" onClick={() => setCaptureOpen(true)}>
                <ClipboardPen className="size-4" />
                {t.feedback_capture_button}
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={MessageSquare}
          label={t.feedback_total_metric}
          value={summary?.total_feedback ?? 0}
          tone="sky"
        />
        <AdminInlineMetric
          icon={Star}
          label={null}
          value={summary?.nps_score ?? 0}
          description={`${summary?.promoters ?? 0} ${t.feedback_promoters_metric} / ${summary?.detractors ?? 0} ${t.feedback_detractors_metric}`}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={BarChart3}
          label={t.feedback_reviewed_metric}
          value={summary?.reviewed_feedback ?? 0}
          tone="amber"
        />
        <AdminInlineMetric
          icon={Users}
          label={t.feedback_average_overall_metric}
          value={formatPortalAverage(summary?.average_scores?.overall)}
          tone="slate"
        />
      </div>

      <div className="space-y-4">
        {summary ? (
          <div className="grid gap-4 xl:grid-cols-4">
              <section className="rounded-xl border border-border bg-card p-6 xl:col-span-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className={tokens.text.sectionTitle}>
                      {titleWithDot(t.feedback_summary_title)}
                    </h2>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 xl:grid-cols-2">
                  <div className="grid gap-2 rounded-xl bg-card p-3">
                    <FeedbackSummaryLine label={t.feedback_overall_average} value={formatPortalAverage(summary.average_scores.overall)} />
                    <FeedbackSummaryLine label={t.feedback_interpreter_average} value={formatPortalAverage(summary.average_scores.interpreter)} />
                    <FeedbackSummaryLine label={t.feedback_concierge_average} value={formatPortalAverage(summary.average_scores.concierge)} />
                    <FeedbackSummaryLine label={t.feedback_treatment_average} value={formatPortalAverage(summary.average_scores.treatment)} />
                  </div>
                  <div className="grid gap-2 rounded-xl bg-card p-3">
                    <FeedbackSummaryLine label={t.feedback_service_average} value={formatPortalAverage(summary.average_scores.service)} />
                    <FeedbackSummaryLine label={t.feedback_ambience_average} value={formatPortalAverage(summary.average_scores.infrastructure)} />
                    <FeedbackSummaryLine label={t.feedback_value_average} value={formatPortalAverage(summary.average_scores.price_value)} />
                    <FeedbackSummaryLine
                      label={t.feedback_complication_rate}
                      value={
                        summary.complication_rate === null || summary.complication_rate === undefined
                          ? portalNotSetLabel()
                          : `${summary.complication_rate.toFixed(1)}%`
                      }
                    />
                  </div>
                </div>
              </section>

              <RankingList
                title={t.feedback_top_promoters_title}
                empty={t.feedback_no_promoter_ranking}
                rows={summary.top_promoters.slice(0, 5).map((item) => ({
                  id: item.patient_id,
                  name: item.patient_name,
                  subtitle: `${item.feedback_count} ${t.feedback_feedback_count_suffix}`,
                  value: item.average_nps.toFixed(1),
                }))}
              />

              <RankingList
                title={t.feedback_interpreter_ranking_title}
                empty={t.feedback_no_interpreter_feedback}
                rows={summary.interpreter_ranking.slice(0, 5).map((item) => ({
                  id: item.user_id ?? item.name,
                  name: item.name,
                  subtitle: `${item.feedback_count} ${t.feedback_rating_count_suffix}`,
                  value: item.average_score.toFixed(1),
                }))}
              />

              <div className="xl:col-span-4">
                <RankingList
                  title={t.feedback_clinic_ranking_title}
                  empty={t.feedback_no_clinic_ranking}
                  horizontal
                  rows={summary.clinic_ranking.slice(0, 5).map((item) => ({
                    id: item.provider_id ?? item.name,
                    name: item.name,
                    subtitle: `${item.feedback_count} ${t.feedback_rating_count_suffix}`,
                    value: item.average_score.toFixed(1),
                  }))}
                />
              </div>
          </div>
        ) : null}

        <AdminTableCard
          title={titleWithDot(t.feedback_queue_title)}
          description={t.feedback_queue_description}
          count={feedback.length}
        >
          <DataTableSurface
            rows={feedback}
            columns={feedbackColumns}
            rowId={(row) => row.id}
            defaultDensity="compact"
            defaultFrozenColumns={FEEDBACK_DEFAULT_FROZEN_COLUMNS}
            defaultHiddenColumns={FEEDBACK_DEFAULT_HIDDEN_COLUMNS}
            dictionary={feedbackTableDictionary}
            groupLabels={feedbackColumnGroups}
            loading={refreshing}
            maxFrozenColumns={FEEDBACK_MAX_FROZEN_COLUMNS}
            tableClassName="min-h-[560px] xl:min-h-[640px]"
            toolbarClassName="border-b border-border/70 bg-card px-3 py-2"
            activeRowId={activeReview?.id ?? null}
            onRowClick={(row) => openReview(row)}
            rowAccent={(row) => {
              if (row.id === activeReview?.id) return "bg-sky-500";
              if (row.status === "submitted") return "bg-amber-500";
              if (row.status === "reviewed") return "bg-emerald-500";
              if (row.status === "archived") return "bg-slate-400";
              return null;
            }}
            rowActionsLabel={feedbackTableDictionary.table_actions}
            emptyState={
              <EmptyState
                title={t.feedback_queue_empty_title}
                description={t.feedback_queue_empty_description}
              />
            }
          />
        </AdminTableCard>
      </div>

      <Sheet open={captureOpen} onOpenChange={setCaptureOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <form className="flex h-full flex-col" onSubmit={(event) => void handleCapture(event)}>
            <AdminSheetScaffold
              title={t.feedback_capture_button}
              description={t.feedback_capture_description}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.feedback_capture_button}
                  submittingLabel={t.common_loading}
                  submitting={submitting}
                  onCancel={() => setCaptureOpen(false)}
                />
              }
            >
              <div className="space-y-3">
                <FormSection title={`${t.feedback_patient} / ${t.feedback_visit}`}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={t.feedback_patient}>
                      <NativeComboboxSelect
                        value={selectedPatientId || "__empty__"}
                        onChange={(event) =>
                          setSelectedPatientId(
                            event.target.value === "__empty__" || !event.target.value ? "" : event.target.value,
                          )
                        }
                        className={selectClassName}
                      >
                        <option value="__empty__">
                          {t.feedback_select_patient}
                        </option>
                        {patients.map((item) => (
                          <option key={item.id} value={item.id}>
                            {patientLabel(item)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>

                    <Field label={t.feedback_visit}>
                      <NativeComboboxSelect
                        value={form.appointmentId || "__general__"}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            appointmentId:
                              event.target.value === "__general__" || !event.target.value
                                ? ""
                                : event.target.value,
                          }))
                        }
                        disabled={!selectedPatientId}
                        className={selectClassName}
                      >
                        <option value="__general__">
                          {t.feedback_general_feedback}
                        </option>
                        {patientAppointments.map((item) => (
                          <option key={item.id} value={item.id}>
                            {appointmentOptionLabel(item)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                  </div>
                </FormSection>

                <FormSection title={t.feedback_scores}>
                  <ScoreGrid t={t} form={form} setForm={setForm} />
                </FormSection>

                <FormSection title={`${t.feedback_comment} / ${t.feedback_internal_note}`}>
                  <FeedbackFormNotes t={t} form={form} setForm={setForm} includeInternal />
                </FormSection>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(activeReview)} onOpenChange={(open) => !open && setActiveReview(null)}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          {activeReview ? (
            <form className="flex h-full flex-col" onSubmit={(event) => void handleReview(event)}>
              <AdminSheetScaffold
                title={t.feedback_review_title}
                footer={
                  <SheetFormFooter
                    cancelLabel={t.common_close}
                    submitLabel={t.feedback_review_save}
                    submittingLabel={t.common_loading}
                    submitting={reviewBusy}
                    onCancel={() => setActiveReview(null)}
                  />
                }
              >
                <div className="space-y-4 rounded-xl p-4">
                  {feedbackCard(activeReview, t, true)}

                  <section className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(t.feedback_review_actions)}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      <Field label={t.feedback_review_status}>
                        <NativeComboboxSelect
                          value={reviewStatus}
                          onChange={(event) => setReviewStatus(event.target.value || reviewStatus)}
                          className={selectClassName}
                        >
                          <option value="reviewed">{feedbackReviewStatusLabel("reviewed", t)}</option>
                          <option value="archived">{feedbackReviewStatusLabel("archived", t)}</option>
                        </NativeComboboxSelect>
                      </Field>
                      <Field label={t.feedback_review_note}>
                        <textarea
                          value={reviewNote}
                          onChange={(event) => setReviewNote(event.target.value)}
                          className={textareaClassName}
                          placeholder={t.feedback_review_note_placeholder}
                        />
                      </Field>
                    </div>
                  </section>
                </div>
              </AdminSheetScaffold>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StaffFeedbackWorkspace(...args: Parameters<typeof useStaffFeedbackWorkspaceContent>) {
  return useStaffFeedbackWorkspaceContent(...args);
}
