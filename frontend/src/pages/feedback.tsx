import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BarChart3,
  ClipboardPen,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  Star,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  feedbackSourceLabel,
  feedbackStatusTone,
  formatPortalAverage,
  formatPortalDate,
  formatPortalDateTime,
  npsBandLabel,
} from "@/pages/patient-portal.shared";
import type {
  PortalAppointmentItem,
  PortalFeedbackItem,
  PortalFeedbackSummary,
} from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

type PatientAppointmentOption = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  provider_name?: string | null;
  doctor_name?: string | null;
  status: string;
};

type FeedbackFormState = {
  appointmentId: string;
  overallScore: string;
  patientManagerScore: string;
  interpreterScore: string;
  conciergeScore: string;
  treatmentScore: string;
  doctorScore: string;
  organizationScore: string;
  serviceScore: string;
  infrastructureScore: string;
  priceValueScore: string;
  treatmentSuccess: string;
  complicationReported: boolean;
  npsScore: string;
  comments: string;
  improvementNotes: string;
  internalNote: string;
};

const scoreOptions = ["1", "2", "3", "4", "5"];
const npsOptions = Array.from({ length: 11 }, (_, index) => String(index));

function blankFeedbackForm(): FeedbackFormState {
  return {
    appointmentId: "",
    overallScore: "5",
    patientManagerScore: "5",
    interpreterScore: "5",
    conciergeScore: "5",
    treatmentScore: "5",
    doctorScore: "5",
    organizationScore: "5",
    serviceScore: "5",
    infrastructureScore: "5",
    priceValueScore: "5",
    treatmentSuccess: "yes",
    complicationReported: false,
    npsScore: "10",
    comments: "",
    improvementNotes: "",
    internalNote: "",
  };
}

function shellCard(extra?: string) {
  return cn("rounded-[1.75rem] border border-slate-200 bg-white shadow-sm", extra);
}

function roleCanCaptureFeedback(role?: string) {
  return role === "ceo" || role === "patient_manager";
}

function canViewStaffFeedback(role?: string) {
  return (
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "concierge"
  );
}

function buildFeedbackQuery(search: string, status: string, source: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function patientLabel(item: PatientOption) {
  return `${item.patient_id} · ${[item.first_name, item.last_name].filter(Boolean).join(" ")}`.trim();
}

function scoreField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: string[],
) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function metricCard(label: string, value: string | number, description?: string) {
  return (
    <article className={shellCard("p-4")}>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {description ? <p className="mt-2 text-sm text-slate-500">{description}</p> : null}
    </article>
  );
}

function detailField(label: string, value?: string | null) {
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value || "Not set"}</p>
    </div>
  );
}

function treatmentSuccessLabel(value?: string | null) {
  if (value === "yes") return "Yes";
  if (value === "partial") return "Partial";
  if (value === "no") return "No";
  return "Not set";
}

function feedbackCard(item: PortalFeedbackItem, withInternal = false, footer?: ReactNode) {
  return (
    <article key={item.id} className={shellCard("p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={cn("rounded-full", feedbackStatusTone(item.status))}>
              {item.status.replaceAll("_", " ")}
            </Badge>
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
              {feedbackSourceLabel(item.source)}
            </Badge>
            <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
              NPS {item.nps_score} · {npsBandLabel(item.nps_score)}
            </Badge>
          </div>
          <h2 className="mt-3 text-lg font-semibold text-slate-950">{item.patient_name || "Patient feedback"}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {[item.patient_pid, item.appointment_title, item.provider_name, item.doctor_name].filter(Boolean).join(" · ") || "General feedback"}
          </p>
        </div>
        <p className="text-xs text-slate-500">{formatPortalDateTime(item.submitted_at)}</p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {detailField("Overall", String(item.overall_score))}
        {detailField("PM", item.patient_manager_score ? String(item.patient_manager_score) : "Not rated")}
        {detailField("Interpreter", item.interpreter_score ? String(item.interpreter_score) : "Not rated")}
        {detailField("Concierge", item.concierge_score ? String(item.concierge_score) : "Not rated")}
        {detailField("Treatment", item.treatment_score ? String(item.treatment_score) : "Not rated")}
        {detailField("Doctor", item.doctor_score ? String(item.doctor_score) : "Not rated")}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {detailField("Organization", item.organization_score ? String(item.organization_score) : "Not rated")}
        {detailField("Service", item.service_score ? String(item.service_score) : "Not rated")}
        {detailField("Ambience", item.infrastructure_score ? String(item.infrastructure_score) : "Not rated")}
        {detailField("Price / value", item.price_value_score ? String(item.price_value_score) : "Not rated")}
        {detailField("Treatment success", treatmentSuccessLabel(item.treatment_success))}
        {detailField("Complication", item.complication_reported ? "Reported" : "No")}
      </div>

      {item.comments ? (
        <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Comment</p>
          <p className="mt-2">{item.comments}</p>
        </div>
      ) : null}
      {item.improvement_notes ? (
        <div className="mt-3 rounded-[1.2rem] border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Improvement notes</p>
          <p className="mt-2">{item.improvement_notes}</p>
        </div>
      ) : null}
      {withInternal && item.internal_note ? (
        <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Internal capture note</p>
          <p className="mt-2">{item.internal_note}</p>
        </div>
      ) : null}
      {item.review_note ? (
        <div className="mt-3 rounded-[1.2rem] border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">Review note</p>
          <p className="mt-2">{item.review_note}</p>
        </div>
      ) : null}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  );
}

export function FeedbackPage() {
  const { user } = useAuth();
  if (user?.role === "patient") return <PatientFeedbackWorkspace />;
  return <StaffFeedbackWorkspace />;
}

function PatientFeedbackWorkspace() {
  const [feedback, setFeedback] = useState<PortalFeedbackItem[]>([]);
  const [appointments, setAppointments] = useState<PortalAppointmentItem[]>([]);
  const [form, setForm] = useState<FeedbackFormState>(blankFeedbackForm());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) setRefreshing(false);
      else setRefreshing(true);

      try {
        const [feedbackRows, appointmentRows] = await Promise.all([
          apiFetch<PortalFeedbackItem[]>("/me/feedback").catch(() => []),
          apiFetch<PortalAppointmentItem[]>("/me/appointments").catch(() => []),
        ]);
        if (cancelled) return;
        startTransition(() => {
          setFeedback(feedbackRows);
          setAppointments(appointmentRows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load feedback workspace.");
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
  }, [loading, version]);

  const ratedAppointmentIds = useMemo(
    () =>
      new Set(
        feedback
          .filter((item) => item.source === "patient_portal" && item.appointment_id)
          .map((item) => item.appointment_id as string),
      ),
    [feedback],
  );
  const availableAppointments = useMemo(
    () => appointments.filter((item) => !ratedAppointmentIds.has(item.id)),
    [appointments, ratedAppointmentIds],
  );
  const averageOverall = useMemo(() => {
    if (feedback.length === 0) return null;
    return feedback.reduce((sum, item) => sum + Number(item.overall_score || 0), 0) / feedback.length;
  }, [feedback]);
  const promoters = useMemo(
    () => feedback.filter((item) => Number(item.nps_score) >= 9).length,
    [feedback],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      await apiFetch("/me/feedback", {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
      setForm(blankFeedbackForm());
      setNotice("Feedback submitted. Thank you.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading feedback workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(135deg,#0f172a_0%,#1e293b_55%,#0f766e_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">Patient portal</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">My feedback</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Share treatment, clinic and service experience so the team can improve the journey.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </section>

      {notice ? (
        <section
          role="status"
          aria-live="polite"
          className={shellCard("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}
        >
          {notice}
        </section>
      ) : null}
      {error ? (
        <section
          role="alert"
          className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}
        >
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        {metricCard("Submitted feedback", feedback.length)}
        {metricCard("Promoters", promoters)}
        {metricCard("Average overall", averageOverall === null ? "Not set" : formatPortalAverage(averageOverall))}
        {metricCard("Available visits to rate", availableAppointments.length)}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <section className={shellCard("p-5")}>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
              <Star className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">New satisfaction survey</h2>
              <p className="mt-1 text-sm text-slate-500">
                One portal feedback can be submitted per appointment. General feedback without an appointment is also allowed.
              </p>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label>Appointment</Label>
              <select
                value={form.appointmentId}
                onChange={(event) => setForm((current) => ({ ...current, appointmentId: event.target.value }))}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              >
                <option value="">General feedback</option>
                {availableAppointments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {[formatPortalDate(item.date), item.title, item.provider_name, item.doctor_name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {scoreField("Overall satisfaction", form.overallScore, (value) => setForm((current) => ({ ...current, overallScore: value })), scoreOptions)}
              {scoreField("NPS 0-10", form.npsScore, (value) => setForm((current) => ({ ...current, npsScore: value })), npsOptions)}
              {scoreField("Patient manager", form.patientManagerScore, (value) => setForm((current) => ({ ...current, patientManagerScore: value })), scoreOptions)}
              {scoreField("Interpreter", form.interpreterScore, (value) => setForm((current) => ({ ...current, interpreterScore: value })), scoreOptions)}
              {scoreField("Concierge", form.conciergeScore, (value) => setForm((current) => ({ ...current, conciergeScore: value })), scoreOptions)}
              {scoreField("Treatment quality", form.treatmentScore, (value) => setForm((current) => ({ ...current, treatmentScore: value })), scoreOptions)}
              {scoreField("Doctors", form.doctorScore, (value) => setForm((current) => ({ ...current, doctorScore: value })), scoreOptions)}
              {scoreField("Inpatient organization", form.organizationScore, (value) => setForm((current) => ({ ...current, organizationScore: value })), scoreOptions)}
              {scoreField("Service quality", form.serviceScore, (value) => setForm((current) => ({ ...current, serviceScore: value })), scoreOptions)}
              {scoreField("Infrastructure / ambience", form.infrastructureScore, (value) => setForm((current) => ({ ...current, infrastructureScore: value })), scoreOptions)}
              {scoreField("Price / value", form.priceValueScore, (value) => setForm((current) => ({ ...current, priceValueScore: value })), scoreOptions)}
              <div className="space-y-2">
                <Label>Treatment success</Label>
                <select
                  value={form.treatmentSuccess}
                  onChange={(event) => setForm((current) => ({ ...current, treatmentSuccess: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="yes">Yes</option>
                  <option value="partial">Partial</option>
                  <option value="no">No</option>
                </select>
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.complicationReported}
                  onChange={(event) => setForm((current) => ({ ...current, complicationReported: event.target.checked }))}
                  className="size-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                Complication reported after visit
              </label>
            </div>

            <div className="space-y-2">
              <Label>Comment</Label>
              <textarea
                value={form.comments}
                onChange={(event) => setForm((current) => ({ ...current, comments: event.target.value }))}
                placeholder="What worked well?"
                className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </div>
            <div className="space-y-2">
              <Label>Improvement notes</Label>
              <textarea
                value={form.improvementNotes}
                onChange={(event) => setForm((current) => ({ ...current, improvementNotes: event.target.value }))}
                placeholder="What should the team improve?"
                className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </div>
            <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={submitting}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              Submit feedback
            </Button>
          </form>
        </section>

        <section className={shellCard("p-5")}>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Feedback history</h2>
            <p className="mt-1 text-sm text-slate-500">
              Submitted surveys, review notes and treatment quality signals.
            </p>
          </div>

          {feedback.length === 0 ? (
            <div className="mt-5 rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-sm text-slate-500">
              No feedback submitted yet.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {feedback.map((item) => feedbackCard(item))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function StaffFeedbackWorkspace() {
  const { user } = useAuth();
  const canViewWorkspace = canViewStaffFeedback(user?.role);
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

  const canCapture = roleCanCaptureFeedback(user?.role);
  const queryString = useMemo(
    () => buildFeedbackQuery(deferredSearch, statusFilter, sourceFilter),
    [deferredSearch, statusFilter, sourceFilter],
  );

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
        const [feedbackRows, summaryData] = await Promise.all([
          apiFetch<PortalFeedbackItem[]>(`/feedback${queryString}`).catch(() => []),
          apiFetch<PortalFeedbackSummary>(`/feedback/summary${queryString}`).catch(() => null),
        ]);
        if (cancelled) return;
        startTransition(() => {
          setFeedback(feedbackRows);
          setSummary(summaryData);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load feedback workspace.");
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
  }, [canViewWorkspace, loading, queryString, version]);

  useEffect(() => {
    if (!canViewWorkspace || !canCapture) return;
    let cancelled = false;

    async function loadPatients() {
      try {
        const rows = await apiFetch<PatientOption[]>("/patients?active_only=true");
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
        const rows = await apiFetch<PatientAppointmentOption[]>(`/patients/${selectedPatientId}/appointments`);
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

  async function handleCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatientId) {
      setError("Select a patient first.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      await apiFetch("/feedback", {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
      setForm(blankFeedbackForm());
      setSelectedPatientId("");
      setPatientAppointments([]);
      setNotice("Feedback captured.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture feedback.");
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
      await apiFetch(`/feedback/${activeReview.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          status: reviewStatus,
          review_note: reviewNote.trim() || null,
        }),
      });
      setActiveReview(null);
      setReviewStatus("reviewed");
      setReviewNote("");
      setNotice("Feedback review saved.");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review feedback.");
    } finally {
      setReviewBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading feedback workspace...
        </div>
      </div>
    );
  }

  if (!canViewWorkspace) {
    return (
      <section className={shellCard("px-6 py-6")}>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          Feedback workspace
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          This role cannot access feedback operations.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#0f172a_48%,#155e75_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">Operations</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Feedback and NPS</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Review patient satisfaction, capture clinic feedback and track promoter signals across the care chain.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </section>

      {notice ? (
        <section
          role="status"
          aria-live="polite"
          className={shellCard("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}
        >
          {notice}
        </section>
      ) : null}
      {error ? (
        <section
          role="alert"
          className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}
        >
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        {metricCard("Total feedback", summary?.total_feedback ?? 0)}
        {metricCard("NPS", summary?.nps_score ?? 0, `${summary?.promoters ?? 0} promoters / ${summary?.detractors ?? 0} detractors`)}
        {metricCard("Reviewed", summary?.reviewed_feedback ?? 0)}
        {metricCard("Average overall", formatPortalAverage(summary?.average_scores?.overall))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <section className="space-y-4">
          <section className={shellCard("p-5")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Feedback queue</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Search by patient, clinic, doctor or free-text notes. Role scope is enforced server-side.
                </p>
              </div>
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search patient, clinic, doctor or note"
                    className="w-full rounded-2xl pl-9 md:w-80"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="">All statuses</option>
                  <option value="submitted">Submitted</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="archived">Archived</option>
                </select>
                <select
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                  className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="">All sources</option>
                  <option value="patient_portal">Patient portal</option>
                  <option value="staff_capture">Staff capture</option>
                </select>
              </div>
            </div>
          </section>

          {feedback.length === 0 ? (
            <section className={shellCard("border-dashed px-6 py-12 text-center")}>
              <p className="text-base font-semibold text-slate-950">No feedback entries</p>
              <p className="mt-2 text-sm text-slate-500">Current filters do not return any feedback records.</p>
            </section>
          ) : (
            feedback.map((item) =>
              feedbackCard(
                item,
                true,
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Reviewed {item.reviewed_at ? formatPortalDateTime(item.reviewed_at) : "not yet"} by {item.reviewed_by_name || "n/a"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => {
                      setActiveReview(item);
                      setReviewStatus(item.status === "archived" ? "archived" : "reviewed");
                      setReviewNote(item.review_note || "");
                    }}
                  >
                    <ClipboardPen className="size-4" />
                    Review
                  </Button>
                </div>,
                ),
            )
          )}
        </section>

        <section className="space-y-4">
          {summary ? (
            <section className={shellCard("p-5")}>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                  <BarChart3 className="size-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Summary and ranking</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Average quality scores, top promoters and interpreter/clinic ranking.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {detailField("Overall avg", formatPortalAverage(summary.average_scores.overall))}
                {detailField("Interpreter avg", formatPortalAverage(summary.average_scores.interpreter))}
                {detailField("Concierge avg", formatPortalAverage(summary.average_scores.concierge))}
                {detailField("Treatment avg", formatPortalAverage(summary.average_scores.treatment))}
                {detailField("Service avg", formatPortalAverage(summary.average_scores.service))}
                {detailField("Ambience avg", formatPortalAverage(summary.average_scores.infrastructure))}
                {detailField("Value avg", formatPortalAverage(summary.average_scores.price_value))}
                {detailField(
                  "Treatment success",
                  summary.treatment_success_yes_rate === null || summary.treatment_success_yes_rate === undefined
                    ? "Not set"
                    : `${summary.treatment_success_yes_rate.toFixed(1)}% yes`,
                )}
                {detailField(
                  "Complication rate",
                  summary.complication_rate === null || summary.complication_rate === undefined
                    ? "Not set"
                    : `${summary.complication_rate.toFixed(1)}%`,
                )}
              </div>

              <div className="mt-5 grid gap-4">
                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-950">Top promoters</p>
                  <div className="mt-3 space-y-3">
                    {summary.top_promoters.length === 0 ? (
                      <p className="text-sm text-slate-500">No promoter ranking yet.</p>
                    ) : (
                      summary.top_promoters.slice(0, 5).map((item) => (
                        <div key={item.patient_id} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-slate-900">{item.patient_name}</p>
                            <p className="text-slate-500">{item.patient_pid || "Patient"} · {item.feedback_count} feedback</p>
                          </div>
                          <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                            {item.average_nps.toFixed(1)}
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-950">Interpreter ranking</p>
                  <div className="mt-3 space-y-3">
                    {summary.interpreter_ranking.length === 0 ? (
                      <p className="text-sm text-slate-500">No interpreter feedback yet.</p>
                    ) : (
                      summary.interpreter_ranking.slice(0, 5).map((item) => (
                        <div key={item.user_id ?? item.name} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-slate-900">{item.name}</p>
                            <p className="text-slate-500">{item.feedback_count} ratings</p>
                          </div>
                          <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                            {item.average_score.toFixed(1)}
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-950">Clinic ranking</p>
                  <div className="mt-3 space-y-3">
                    {summary.clinic_ranking.length === 0 ? (
                      <p className="text-sm text-slate-500">No clinic ranking yet.</p>
                    ) : (
                      summary.clinic_ranking.slice(0, 5).map((item) => (
                        <div key={item.provider_id ?? item.name} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-slate-900">{item.name}</p>
                            <p className="text-slate-500">{item.feedback_count} ratings</p>
                          </div>
                          <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                            {item.average_score.toFixed(1)}
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {canCapture ? (
            <section className={shellCard("p-5")}>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <ClipboardPen className="size-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Capture feedback</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Record clinic feedback for the selected patient when the survey comes in by phone or staff handoff.
                  </p>
                </div>
              </div>

              <form className="mt-5 space-y-4" onSubmit={(event) => void handleCapture(event)}>
                <div className="space-y-2">
                  <Label>Patient</Label>
                  <select
                    value={selectedPatientId}
                    onChange={(event) => setSelectedPatientId(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  >
                    <option value="">Select patient</option>
                    {patients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {patientLabel(item)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Appointment</Label>
                  <select
                    value={form.appointmentId}
                    onChange={(event) => setForm((current) => ({ ...current, appointmentId: event.target.value }))}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    disabled={!selectedPatientId}
                  >
                    <option value="">General feedback</option>
                    {patientAppointments.map((item) => (
                      <option key={item.id} value={item.id}>
                        {[formatPortalDate(item.date), item.title, item.provider_name, item.doctor_name].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {scoreField("Overall", form.overallScore, (value) => setForm((current) => ({ ...current, overallScore: value })), scoreOptions)}
                  {scoreField("NPS 0-10", form.npsScore, (value) => setForm((current) => ({ ...current, npsScore: value })), npsOptions)}
                  {scoreField("Patient manager", form.patientManagerScore, (value) => setForm((current) => ({ ...current, patientManagerScore: value })), scoreOptions)}
                  {scoreField("Interpreter", form.interpreterScore, (value) => setForm((current) => ({ ...current, interpreterScore: value })), scoreOptions)}
                  {scoreField("Concierge", form.conciergeScore, (value) => setForm((current) => ({ ...current, conciergeScore: value })), scoreOptions)}
                  {scoreField("Treatment quality", form.treatmentScore, (value) => setForm((current) => ({ ...current, treatmentScore: value })), scoreOptions)}
                  {scoreField("Doctors", form.doctorScore, (value) => setForm((current) => ({ ...current, doctorScore: value })), scoreOptions)}
                  {scoreField("Inpatient organization", form.organizationScore, (value) => setForm((current) => ({ ...current, organizationScore: value })), scoreOptions)}
                  {scoreField("Service quality", form.serviceScore, (value) => setForm((current) => ({ ...current, serviceScore: value })), scoreOptions)}
                  {scoreField("Infrastructure / ambience", form.infrastructureScore, (value) => setForm((current) => ({ ...current, infrastructureScore: value })), scoreOptions)}
                  {scoreField("Price / value", form.priceValueScore, (value) => setForm((current) => ({ ...current, priceValueScore: value })), scoreOptions)}
                  <div className="space-y-2">
                    <Label>Treatment success</Label>
                    <select
                      value={form.treatmentSuccess}
                      onChange={(event) => setForm((current) => ({ ...current, treatmentSuccess: event.target.value }))}
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    >
                      <option value="yes">Yes</option>
                      <option value="partial">Partial</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.complicationReported}
                      onChange={(event) => setForm((current) => ({ ...current, complicationReported: event.target.checked }))}
                      className="size-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    Complication reported after visit
                  </label>
                </div>

                <div className="space-y-2">
                  <Label>Comment</Label>
                  <textarea
                    value={form.comments}
                    onChange={(event) => setForm((current) => ({ ...current, comments: event.target.value }))}
                    className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    placeholder="Patient statement or key quote"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Improvement notes</Label>
                  <textarea
                    value={form.improvementNotes}
                    onChange={(event) => setForm((current) => ({ ...current, improvementNotes: event.target.value }))}
                    className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    placeholder="What should be improved?"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Internal capture note</Label>
                  <textarea
                    value={form.internalNote}
                    onChange={(event) => setForm((current) => ({ ...current, internalNote: event.target.value }))}
                    className="min-h-[90px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    placeholder="How this feedback was collected"
                  />
                </div>
                <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={submitting}>
                  {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Capture feedback
                </Button>
              </form>
            </section>
          ) : null}
        </section>
      </section>

      <Sheet open={Boolean(activeReview)} onOpenChange={(open) => !open && setActiveReview(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Review feedback</SheetTitle>
            <SheetDescription>
              Mark the entry as reviewed or archive it with an internal note.
            </SheetDescription>
          </SheetHeader>

          {activeReview ? (
            <form className="mt-6 space-y-4" onSubmit={(event) => void handleReview(event)}>
              <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                <p className="text-sm font-semibold text-slate-950">{activeReview.patient_name || "Patient feedback"}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {[activeReview.patient_pid, activeReview.appointment_title, activeReview.provider_name, activeReview.doctor_name].filter(Boolean).join(" · ")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Review status</Label>
                <select
                  value={reviewStatus}
                  onChange={(event) => setReviewStatus(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="reviewed">Reviewed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Review note</Label>
                <textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  className="min-h-[140px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  placeholder="Operational follow-up or review note"
                />
              </div>
              <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={reviewBusy}>
                {reviewBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Save review
              </Button>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
