import { SectionHeading } from "@/components/ui/section-heading";
import { PortalDateChip, PortalSection } from "@/pages/patients/ui/portal-page-layout";
import {
  startTransition,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Inbox,
  ChartNoAxesCombined,
  ThumbsUp,
  Languages,
  Hospital,
  Lightbulb,
  FileLock2,
  ClipboardCheck,
  MessagesSquare,
  MessageSquareText,
  ListChecks,
  BarChart3,
  CalendarDays,
  History,
  HeartPulse,
  type LucideIcon,
  ChevronRight,
  ClipboardPen,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Star,
  Users,
} from "lucide-react";

import {
  ADMIN_INLINE_METRICS_GRID,
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
  CountBadge,
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
import { berlinNowNaive } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  useLang,
  type TranslationKey,
  type Translations,
  useLanguageBound,
} from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { revealCabinetTarget } from "@/pages/patient-lead/lead-request-field-target";
import {
  formatPortalDate,
  usePortalLabels,
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
  canReviewStaffFeedback,
  canViewStaffFeedback,
  feedbackReviewNeedsEdit,
  feedbackScoresPayload,
  feedbackScoreValue,
  formatFeedbackCount,
  formatFeedbackDecimal,
  formatFeedbackPercent,
  formatRatingCount,
  isRateableVisit,
  missingRequiredFeedbackScore,
  npsOptions,
  patientLabel,
  portalSurveyAsksInterpreter,
  roleCanCaptureFeedback,
  scoreOptions,
} from "./model/feedback-model";
import type {
  FeedbackFormState,
  PatientAppointmentOption,
  PatientOption,
} from "./model/types";

const selectClassName = shellSelectClassName;
/** The two required scales of the patient's survey, as «send» finds them. */
const FEEDBACK_SCALE_IDS = { overall: "feedback-scale-overall", nps: "feedback-scale-nps" } as const;
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
  /** The blank form left by the last success; sent again only once touched. */
  sentForm: FeedbackFormState | null;
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
  /** The last load of reviews or summary failed (QA E3-07): no "0 reviews" then. */
  loadFailed: boolean;
  /** Reviews and summary were loaded at least once. */
  loaded: boolean;
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
    sentForm: null,
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
    loadFailed: false,
    loaded: false,
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

function titleWithDot(title: ReactNode, icon: LucideIcon) {
  return <SectionHeading icon={icon}>{title}</SectionHeading>;
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
  label: ReactNode;
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
    <div className={cn("rounded-xl px-4 py-6 text-center", tokens.surface.dashed)}>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function FeedbackSummaryLine({ label, value }: { label: string; value?: string | null }) {
  const { portalNotSetLabel } = usePortalLabels();
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
      <span className="min-w-0 break-words text-xs font-medium text-muted-foreground">
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
  icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg bg-card p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title, icon)}</h2>
        </div>
      </div>
      <div className="mt-3 text-sm text-foreground">{children}</div>
    </section>
  );
}

function FeedbackReviewHeaderVariants({ item, t, patient }: { item: PortalFeedbackItem; t: Translations; patient: boolean }) {
  const { formatPortalDateTime, npsBandLabel } = usePortalLabels();
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
    <section className="rounded-lg bg-card">
      <div className="p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge tone={feedbackStatusTone(item.status)}>
                {feedbackReviewStatusLabel(item.status, t)}
              </StatusBadge>
            </div>
            <h3 className="mt-1.5 text-lg font-semibold leading-none text-foreground">{title}</h3>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{context}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{tags}</div>
          </div>
          <div className="flex items-start md:justify-end">
            <span className="font-mono text-xs leading-5 text-muted-foreground">
              {patient ? <PortalDateChip timestamp={item.submitted_at} /> : submittedAt}
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

/** The select value of a scale nobody rated (the select needs a non-empty value). */
const SCORE_NOT_RATED = "__none__";

function scoreField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: string[],
  notRatedLabel: string,
) {
  return (
    <Field label={label}>
      <NativeComboboxSelect
        value={value || SCORE_NOT_RATED}
        onChange={(event) =>
          onChange(!event.target.value || event.target.value === SCORE_NOT_RATED ? "" : event.target.value)
        }
        className={selectClassName}
      >
        <option value={SCORE_NOT_RATED}>{notRatedLabel}</option>
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
  // Nothing is pre-set: staff record what the patient said, an unasked scale
  // stays "not rated". The overall score and NPS are mandatory.
  const notRated = t.feedback_not_rated;
  const required = (label: string) => `${label} *`;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {scoreField(
        required(t.feedback_overall),
        form.overallScore,
        (value) => setForm((current) => ({ ...current, overallScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        required(`${t.uiText.feedback_nps_label} 0-10`),
        form.npsScore,
        (value) => setForm((current) => ({ ...current, npsScore: value })),
        npsOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_patient_manager,
        form.patientManagerScore,
        (value) => setForm((current) => ({ ...current, patientManagerScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_interpreter,
        form.interpreterScore,
        (value) => setForm((current) => ({ ...current, interpreterScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_concierge,
        form.conciergeScore,
        (value) => setForm((current) => ({ ...current, conciergeScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_treatment_quality,
        form.treatmentScore,
        (value) => setForm((current) => ({ ...current, treatmentScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_doctors,
        form.doctorScore,
        (value) => setForm((current) => ({ ...current, doctorScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_organization,
        form.organizationScore,
        (value) => setForm((current) => ({ ...current, organizationScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_service_quality,
        form.serviceScore,
        (value) => setForm((current) => ({ ...current, serviceScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_infrastructure_ambience,
        form.infrastructureScore,
        (value) => setForm((current) => ({ ...current, infrastructureScore: value })),
        scoreOptions,
        notRated,
      )}
      {scoreField(
        t.feedback_price_value,
        form.priceValueScore,
        (value) => setForm((current) => ({ ...current, priceValueScore: value })),
        scoreOptions,
        notRated,
      )}
      <Field label={t.feedback_treatment_success}>
        <NativeComboboxSelect
          value={form.treatmentSuccess || SCORE_NOT_RATED}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              treatmentSuccess:
                !event.target.value || event.target.value === SCORE_NOT_RATED ? "" : event.target.value,
            }))
          }
          className={selectClassName}
        >
          <option value={SCORE_NOT_RATED}>{notRated}</option>
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

/**
 * A scale of the patient's survey. Nothing is chosen until the patient
 * presses a score; pressing the chosen score again clears it.
 */
function PatientRatingScale({
  label,
  value,
  options,
  onChange,
  notChosenLabel,
  requiredLabel,
  prominent = false,
  id,
  missing = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  notChosenLabel: string;
  /** Set for a scale the survey cannot be sent without. */
  requiredLabel?: string;
  prominent?: boolean;
  /** The id «send» leads to when the scale is still missing. */
  id?: string;
  /** «Send» was pressed while this required scale was still empty. */
  missing?: boolean;
}) {
  const isNpsScale = options.length > 5;

  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      data-cabinet-invalid={missing ? "true" : undefined}
      className="portal-rating-scale min-w-0 py-2"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={cn("text-sm text-foreground", prominent ? "font-semibold" : "font-medium")}>
          {prominent ? titleWithDot(label, isNpsScale ? BarChart3 : Star) : label}
          {requiredLabel ? (
            <span className="text-destructive" title={requiredLabel} aria-label={requiredLabel}> *</span>
          ) : null}
        </span>
        <span
          className={cn(
            "text-sm tabular-nums",
            value ? "font-semibold text-foreground" : missing ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {value || (missing && requiredLabel ? requiredLabel : notChosenLabel)}
        </span>
      </div>
      <div
        className={cn(
          "grid gap-1.5",
          isNpsScale ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5",
        )}
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              aria-label={`${label}: ${option}`}
              className={cn(
                "flex h-9 min-w-0 items-center justify-center rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-ring hover:bg-muted",
              )}
              onClick={() => onChange(selected ? "" : option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PatientScoreGrid({
  t,
  form,
  setForm,
  withInterpreter,
  requiredAsked = false,
}: {
  t: Translations;
  form: FeedbackFormState;
  setForm: SetFeedbackForm;
  /** False for a visit without an interpreter: there is nobody to rate. */
  withInterpreter: boolean;
  /** «Send» was pressed without a required scale: the empty ones are marked. */
  requiredAsked?: boolean;
}) {
  const notChosen = t.uiText.feedback_score_not_chosen;
  const requiredLabel = t.uiText.feedback_required_scale;
  const detailedScores = (
    [
      [t.feedback_patient_manager, "patientManagerScore"],
      [t.feedback_interpreter, "interpreterScore"],
      [t.feedback_concierge, "conciergeScore"],
      [t.feedback_treatment_quality, "treatmentScore"],
      [t.feedback_doctors, "doctorScore"],
      [t.feedback_organization, "organizationScore"],
      [t.feedback_service_quality, "serviceScore"],
      [t.feedback_infrastructure_ambience, "infrastructureScore"],
      [t.feedback_price_value, "priceValueScore"],
    ] as const
  ).filter(([, field]) => withInterpreter || field !== "interpreterScore");

  return (
    <div className="space-y-3">
      <div className="grid gap-x-5 gap-y-2 rounded-xl border border-border/70 bg-card p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <PatientRatingScale
          prominent
          id={FEEDBACK_SCALE_IDS.overall}
          missing={requiredAsked && feedbackScoreValue(form.overallScore) === null}
          label={t.feedback_overall}
          value={form.overallScore}
          options={scoreOptions}
          notChosenLabel={notChosen}
          requiredLabel={requiredLabel}
          onChange={(value) =>
            setForm((current) => ({ ...current, overallScore: value }))
          }
        />
        <PatientRatingScale
          prominent
          id={FEEDBACK_SCALE_IDS.nps}
          missing={requiredAsked && feedbackScoreValue(form.npsScore) === null}
          label={`${t.uiText.feedback_nps_label} 0–10`}
          value={form.npsScore}
          options={npsOptions}
          notChosenLabel={notChosen}
          requiredLabel={requiredLabel}
          onChange={(value) =>
            setForm((current) => ({ ...current, npsScore: value }))
          }
        />
      </div>

      <section className="portal-detailed-ratings rounded-xl border border-border/70 bg-card p-3">
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          {titleWithDot(t.feedback_scores, Star)}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">{t.uiText.feedback_optional_scores_hint}</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {detailedScores.map(([label, field]) => (
            <PatientRatingScale
              key={field}
              label={label}
              value={form[field]}
              options={scoreOptions}
              notChosenLabel={notChosen}
              onChange={(value) =>
                setForm((current) => ({ ...current, [field]: value }))
              }
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground">{titleWithDot(t.feedback_treatment_success, HeartPulse)}</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {([
            ["yes", t.feedback_treatment_success_yes],
            ["partial", t.feedback_treatment_success_partial],
            ["no", t.feedback_treatment_success_no],
          ] as const).map(([option, label]) => (
            <button
              key={option}
              type="button"
              aria-pressed={form.treatmentSuccess === option}
              className={cn(
                "min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                form.treatmentSuccess === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-ring hover:bg-muted",
              )}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  // Pressing the chosen answer again leaves the question open.
                  treatmentSuccess: current.treatmentSuccess === option ? "" : option,
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 py-1.5">
          <input
            type="checkbox"
            checked={form.complicationReported}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                complicationReported: event.target.checked,
              }))
            }
            className={checkboxClass}
          />
          <span className="text-sm text-foreground">
            {t.feedback_complication_after_visit}
          </span>
        </label>
      </section>
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
      <Field label={includeInternal ? t.feedback_comment : titleWithDot(t.feedback_comment, MessageSquare)}>
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
        <FeedbackReviewHeaderVariants item={item} t={t} patient={!withInternal} />

        <section className="rounded-lg bg-card p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className={tokens.text.sectionTitle}>{titleWithDot(t.feedback_scores, Star)}</h2>
            </div>
          </div>
          <div className="mt-3 grid gap-2.5 xl:grid-cols-2">
            <div className="grid gap-1">
              <FeedbackSummaryLine label={t.feedback_overall} value={String(item.overall_score)} />
              <FeedbackSummaryLine label={t.uiText.feedback_pm_label} value={item.patient_manager_score ? String(item.patient_manager_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_interpreter} value={item.interpreter_score ? String(item.interpreter_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_concierge} value={item.concierge_score ? String(item.concierge_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_treatment} value={item.treatment_score ? String(item.treatment_score) : notRated} />
              <FeedbackSummaryLine label={t.feedback_doctor} value={item.doctor_score ? String(item.doctor_score) : notRated} />
            </div>
            <div className="grid gap-1">
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
          <FeedbackTextSection icon={MessageSquare} title={t.feedback_comment}>
            {item.comments}
          </FeedbackTextSection>
        ) : null}
        {item.improvement_notes ? (
          <FeedbackTextSection icon={Lightbulb} title={t.feedback_improvement_notes}>
            {item.improvement_notes}
          </FeedbackTextSection>
        ) : null}
        {withInternal && item.internal_note ? (
          <FeedbackTextSection icon={FileLock2} title={t.feedback_internal_note}>
            {item.internal_note}
          </FeedbackTextSection>
        ) : null}
        {item.review_note ? (
          <FeedbackTextSection icon={ClipboardCheck} title={t.feedback_review_note}>
            {item.review_note}
          </FeedbackTextSection>
        ) : null}
    </>
  );
}

function RankingList({
  title,
  icon,
  empty,
  rows,
  horizontal = false,
}: {
  title: string;
  icon: LucideIcon;
  empty: string;
  rows: Array<{ id: string; name: string; subtitle: string; value: string }>;
  horizontal?: boolean;
}) {
  return (
    <section className="rounded-lg bg-card p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title, icon)}</h2>
        </div>
      </div>
      <div className={cn("mt-3", horizontal ? "grid gap-1.5 md:grid-cols-2 2xl:grid-cols-5" : "space-y-1.5")}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">{row.name}</p>
                <p className="break-words text-xs text-muted-foreground">{row.subtitle}</p>
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
  refreshing: boolean;
  submitting: boolean;
  submitDisabled: boolean;
  /** The chosen visit had an interpreter (always true for a general feedback). */
  withInterpreter: boolean;
  /** «Send» was pressed without a required rating: the missing ones are marked and named. */
  requiredAsked: boolean;
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
  refreshing,
  submitting,
  submitDisabled,
  withInterpreter,
  requiredAsked,
  t,
  setActiveFeedbackId,
  setForm,
  setVersion,
  onSubmit,
}: PatientFeedbackContentProps) {
  const { formatPortalAverage, portalNotSetLabel } = usePortalLabels();
  const requiredMissing = requiredAsked && missingRequiredFeedbackScore(form) !== null;
  const { appointmentOptionLabel } = useLanguageHelpers();
  return (
    <div className="portal-feedback w-full min-w-0 space-y-3 [&_label]:font-sans [&_label]:text-sm">
      <PageHeader
        title={t.feedback_patient_page_title}
        description={t.feedback_patient_page_description}
        actions={
          <Button variant="default" className="h-9 rounded-lg" onClick={() => setVersion((value) => value + 1)}>
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t.common_refresh}
          </Button>
        }
      />

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="grid overflow-hidden rounded-xl border border-border bg-card px-3 py-3 sm:grid-cols-3 [&>article:not(:last-child)_.admin-inline-metric-separator]:sm:block">
        <AdminInlineMetric icon={MessageSquare} label={t.feedback_submitted_feedback_metric} value={feedback.length} tone="sky" />
        <AdminInlineMetric
          icon={Star}
          label={t.feedback_average_overall_metric}
          value={averageOverall === null ? portalNotSetLabel() : formatPortalAverage(averageOverall)}
          tone="amber"
        />
        <AdminInlineMetric icon={Users} label={t.feedback_available_visits_metric} value={availableAppointments.length} tone="slate" />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3">
        <PortalSection icon={ClipboardPen} title={t.feedback_new_survey_title}>
          <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <Field label={titleWithDot(t.feedback_visit, CalendarDays)}>
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
              <p className="mt-1.5 text-xs text-muted-foreground">{t.uiText.feedback_rateable_visits_hint}</p>
            </div>

            <PatientScoreGrid t={t} form={form} setForm={setForm} withInterpreter={withInterpreter} requiredAsked={requiredAsked} />

            <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3">
              <FeedbackFormNotes t={t} form={form} setForm={setForm} />
            </section>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="submit"
                className="h-9 w-full shrink-0 rounded-lg sm:w-auto"
                disabled={submitting || submitDisabled}
                aria-describedby={requiredMissing ? "feedback-required-missing" : undefined}
              >
                {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t.feedback_submit_button}
              </Button>
              {/* The ratings still missing, named at the button (QA 2026-11-10, A-1): the message at the
                  top of the form was out of sight. */}
              {requiredMissing ? (
                <p id="feedback-required-missing" role="alert" className="text-sm text-destructive" data-testid="feedback-required-missing">
                  {t.uiText.feedback_required_scores_missing}
                </p>
              ) : null}
            </div>
          </form>
        </PortalSection>

        <PortalSection icon={History} title={t.feedback_history_title} accessory={<CountBadge>{feedback.length}</CountBadge>}>
          <div className="min-w-0">
            {feedback.length === 0 ? (
              <EmptyState
                title={t.feedback_empty_title}
                description={t.feedback_empty_description}
              />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {feedback.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left transition-colors hover:border-ring hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setActiveFeedbackId(item.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={feedbackStatusTone(item.status)}>
                            {feedbackReviewStatusLabel(item.status, t)}
                          </StatusBadge>
                          <PortalDateChip timestamp={item.submitted_at} />
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-foreground" title={item.appointment_title || t.feedback_general_feedback}>
                          {item.appointment_title || t.feedback_general_feedback}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.feedback_overall}: {item.overall_score} · {t.uiText.feedback_nps_label}: {item.nps_score}
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                <div className="hidden md:block">
                  <DataTable
                    rows={feedback}
                    columns={feedbackColumns}
                    rowId={(row) => row.id}
                    activeRowId={activeFeedbackId || null}
                    onRowClick={(row) => setActiveFeedbackId(row.id)}
                  />
                </div>
              </>
            )}
          </div>
        </PortalSection>
      </div>

      <Sheet open={Boolean(activeFeedback)} onOpenChange={(open) => !open && setActiveFeedbackId("")}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            icon={MessageSquareText}
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
    sentForm,
    loading,
    refreshing,
    submitting,
    error,
    notice,
    version,
    activeFeedbackId,
  } = patientState;
  const submitInFlight = useRef(false);
  const [requiredAsked, setRequiredAsked] = useState(false);

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

  // Only visits that took place and are not rated yet: a cancelled visit or
  // one still ahead cannot be rated (global QA 2026-11-10; the server refuses
  // them too).
  const availableAppointments = useMemo(() => {
    const now = berlinNowNaive();
    return appointments.filter(
      (item) => !ratedAppointmentIds.has(item.id) && isRateableVisit(item, now),
    );
  }, [appointments, ratedAppointmentIds]);

  // Only a visit with an interpreter asks about one; the general survey and a
  // visit without an interpreter do not (owner decision 2026-11-12).
  const selectedAppointment = useMemo(
    () => availableAppointments.find((item) => item.id === form.appointmentId) ?? null,
    [availableAppointments, form.appointmentId],
  );
  const withInterpreter = portalSurveyAsksInterpreter(selectedAppointment);

  const averageOverall = useMemo(() => {
    if (feedback.length === 0) return null;
    const total = feedback.reduce((sum, item) => sum + item.overall_score, 0);
    return total / feedback.length;
  }, [feedback]);

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
          <PortalDateChip timestamp={row.submitted_at} />
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
        id: "nps",
        label: t.uiText.feedback_nps_label,
        accessor: (row) => row.nps_score,
        sortable: true,
        width: 110,
        render: (row) => <span className="text-xs text-foreground">{row.nps_score}</span>,
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
    // The blank form is valid: an untouched one after a success, or a second
    // click before the next render, would send the feedback twice (QA 2026-11-01).
    if (submitInFlight.current || form === sentForm) return;
    // Nothing is pre-set, so the two mandatory scales are asked for by name: next to the button,
    // and the page goes to the first one missing with the cursor on it (QA 2026-11-10, A-1).
    const missingScale = missingRequiredFeedbackScore(form);
    if (missingScale) {
      setRequiredAsked(true);
      dispatchPatientState({ error: "", notice: "" });
      const scale = document.getElementById(FEEDBACK_SCALE_IDS[missingScale]);
      if (scale) revealCabinetTarget({ element: scale, field: true });
      return;
    }
    setRequiredAsked(false);
    submitInFlight.current = true;
    dispatchPatientState({
      submitting: true,
      error: "",
      notice: "",
    });

    try {
      await submitPatientFeedback({
        appointment_id: form.appointmentId || null,
        ...feedbackScoresPayload(form, { withInterpreter }),
        complication_reported: form.complicationReported,
        comments: form.comments.trim() || null,
        improvement_notes: form.improvementNotes.trim() || null,
      });
      const emptyForm = blankFeedbackForm();
      dispatchPatientState((current) => ({
        form: emptyForm,
        sentForm: emptyForm,
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
    } finally {
      submitInFlight.current = false;
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
      refreshing={refreshing}
      submitting={submitting}
      t={t}
      setActiveFeedbackId={setActiveFeedbackId}
      setForm={setForm}
      setVersion={setVersion}
      onSubmit={handleSubmit}
      submitDisabled={form === sentForm}
      withInterpreter={withInterpreter}
      requiredAsked={requiredAsked}
    />
  );
}

function useStaffFeedbackWorkspaceContent() {
  const { formatPortalDateTime, portalNotSetLabel } = usePortalLabels();
  const { appointmentOptionLabel } = useLanguageHelpers();
  const { user } = useAuth();
  const { lang, t } = useLang();
  // "4,9" with a decimal comma in RU and DE (QA E3-07).
  const formatAverage = (value?: number | null) => formatFeedbackDecimal(value, lang, portalNotSetLabel());
  const feedbackSelectPatientError = t.feedback_select_patient_error;
  const canViewWorkspace = canViewStaffFeedback(user);
  const canCapture = roleCanCaptureFeedback(user);
  const canReview = canReviewStaffFeedback(user);

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
    loadFailed,
    loaded,
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
      dispatchStaffState((current) => {
        const selectedPatientId =
          typeof nextValue === "function"
            ? nextValue(current.selectedPatientId)
            : nextValue;
        return {
          selectedPatientId,
          error:
            selectedPatientId && current.error === feedbackSelectPatientError
              ? ""
              : current.error,
        };
      });
    },
    [feedbackSelectPatientError],
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
            loadFailed: false,
            loaded: true,
            loading: false,
            refreshing: false,
          });
        });
      } catch {
        if (cancelled) return;
        // Shown as its own translated error with a retry (QA E3-07).
        dispatchStaffState({
          loadFailed: true,
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
          <span className="text-xs text-foreground">
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
    if (missingRequiredFeedbackScore(form)) {
      dispatchStaffState({ error: t.uiText.feedback_required_scores_missing, notice: "" });
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
        // The server drops the interpreter score of a visit without one.
        ...feedbackScoresPayload(form, { withInterpreter: true }),
        complication_reported: form.complicationReported,
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

  const capturePatientError =
    captureOpen && error === feedbackSelectPatientError ? error : "";
  // Staff record feedback for a visit that took place, like the patient does.
  const captureNow = berlinNowNaive();
  const rateableAppointments = patientAppointments.filter((item) => isRateableVisit(item, captureNow));

  return (
    <div className="space-y-3">
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
      {error && !capturePatientError ? <Banner tone="error">{error}</Banner> : null}
      {loadFailed ? (
        <div
          role="alert"
          data-testid="feedback-load-error"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{t.feedback_workspace_load_error}</p>
            <p className="text-xs text-destructive/80">{t.feedback_workspace_load_error_hint}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              clearApiCache("/feedback");
              clearApiCache("/feedback/summary");
              setVersion((value) => value + 1);
            }}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t.feedback_retry}
          </Button>
        </div>
      ) : null}

      {loadFailed && !loaded ? null : (
      <>
      <div className={ADMIN_INLINE_METRICS_GRID} data-testid="feedback-metrics">
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
          value={formatAverage(summary?.average_scores?.overall)}
          tone="slate"
        />
      </div>

      <div className="space-y-3">
        {summary ? (
          <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-4">
              <section className="min-w-0 rounded-lg bg-card p-3 md:col-span-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className={tokens.text.sectionTitle}>
                      {titleWithDot(t.feedback_summary_title, ChartNoAxesCombined)}
                    </h2>
                  </div>
                </div>
                <div className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <FeedbackSummaryLine label={t.feedback_overall_average} value={formatAverage(summary.average_scores.overall)} />
                    <FeedbackSummaryLine label={t.feedback_interpreter_average} value={formatAverage(summary.average_scores.interpreter)} />
                    <FeedbackSummaryLine label={t.feedback_concierge_average} value={formatAverage(summary.average_scores.concierge)} />
                    <FeedbackSummaryLine label={t.feedback_treatment_average} value={formatAverage(summary.average_scores.treatment)} />
                  </div>
                  <div className="grid gap-1.5">
                    <FeedbackSummaryLine label={t.feedback_service_average} value={formatAverage(summary.average_scores.service)} />
                    <FeedbackSummaryLine label={t.feedback_ambience_average} value={formatAverage(summary.average_scores.infrastructure)} />
                    <FeedbackSummaryLine label={t.feedback_value_average} value={formatAverage(summary.average_scores.price_value)} />
                    <FeedbackSummaryLine
                      label={t.feedback_complication_rate}
                      value={formatFeedbackPercent(summary.complication_rate, lang, portalNotSetLabel())}
                    />
                  </div>
                </div>
              </section>

              <RankingList
                icon={ThumbsUp}
                title={t.feedback_top_promoters_title}
                empty={t.feedback_no_promoter_ranking}
                rows={summary.top_promoters.slice(0, 5).map((item) => ({
                  id: item.patient_id,
                  name: item.patient_name,
                  subtitle: formatFeedbackCount(lang, item.feedback_count),
                  value: formatAverage(item.average_nps),
                }))}
              />

              <RankingList
                icon={Languages}
                title={t.feedback_interpreter_ranking_title}
                empty={t.feedback_no_interpreter_feedback}
                rows={summary.interpreter_ranking.slice(0, 5).map((item) => ({
                  id: item.user_id ?? item.name,
                  name: item.name,
                  subtitle: formatRatingCount(lang, item.feedback_count),
                  value: formatAverage(item.average_score),
                }))}
              />

              <div className="md:col-span-2 2xl:col-span-4">
                <RankingList
                  icon={Hospital}
                  title={t.feedback_clinic_ranking_title}
                  empty={t.feedback_no_clinic_ranking}
                  horizontal
                  rows={summary.clinic_ranking.slice(0, 5).map((item) => ({
                    id: item.provider_id ?? item.name,
                    name: item.name,
                    subtitle: formatRatingCount(lang, item.feedback_count),
                    value: formatAverage(item.average_score),
                  }))}
                />
              </div>
          </div>
        ) : null}

        <AdminTableCard
          icon={Inbox}
          title={t.feedback_queue_title}
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
      </>
      )}

      <Sheet open={captureOpen} onOpenChange={setCaptureOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <form className="flex h-full flex-col" onSubmit={(event) => void handleCapture(event)}>
            <AdminSheetScaffold
              icon={ClipboardPen}
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
                <FormSection icon={CalendarDays} title={`${t.feedback_patient} / ${t.feedback_visit}`}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={t.feedback_patient}>
                      <NativeComboboxSelect
                        value={selectedPatientId || "__empty__"}
                        onChange={(event) =>
                          setSelectedPatientId(
                            event.target.value === "__empty__" || !event.target.value ? "" : event.target.value,
                          )
                        }
                        aria-invalid={Boolean(capturePatientError)}
                        className={cn(
                          selectClassName,
                          capturePatientError &&
                            "border-rose-300 focus:border-rose-400 focus:ring-rose-200",
                        )}
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
                      {capturePatientError ? (
                        <p className="text-xs text-rose-600">
                          {capturePatientError}
                        </p>
                      ) : null}
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
                        {rateableAppointments.map((item) => (
                          <option key={item.id} value={item.id}>
                            {appointmentOptionLabel(item)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                  </div>
                </FormSection>

                {/* The page banner lies behind the sheet on a narrow screen. */}
                {error && !capturePatientError ? <Banner tone="error">{error}</Banner> : null}

                <FormSection icon={Star} title={t.feedback_scores}>
                  <ScoreGrid t={t} form={form} setForm={setForm} />
                </FormSection>

                <FormSection icon={MessagesSquare} title={`${t.feedback_comment} / ${t.feedback_internal_note}`}>
                  <FeedbackFormNotes t={t} form={form} setForm={setForm} includeInternal />
                </FormSection>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        // Not marked dirty, so closing without saving asks nothing.
        requireChanges={feedbackReviewNeedsEdit(activeReview, reviewStatus)}
        open={Boolean(activeReview)}
        onOpenChange={(open) => !open && setActiveReview(null)}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          {activeReview ? (
            <form className="flex h-full flex-col" onSubmit={(event) => void handleReview(event)}>
              <AdminSheetScaffold
                icon={ListChecks}
                title={t.feedback_review_title}
                footer={
                  <SheetFormFooter
                    cancelLabel={t.common_close}
                    submitLabel={t.feedback_review_save}
                    submittingLabel={t.common_loading}
                    submitting={reviewBusy}
                    submitDisabled={!canReview}
                    onCancel={() => setActiveReview(null)}
                  />
                }
              >
                <div className="space-y-3 rounded-xl">
                  {feedbackCard(activeReview, t, true)}

                  {canReview ? (
                  <section className="rounded-lg bg-card p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(t.feedback_review_actions, ListChecks)}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
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
                  ) : null}
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

/**
 * The helpers of this file that read the UI language themselves; its
 * components take them from `useLanguageHelpers()` (bound to the current language).
 */
const LANGUAGE_HELPERS = {
  appointmentOptionLabel,
};

function useLanguageHelpers() {
  return useLanguageBound(LANGUAGE_HELPERS);
}
