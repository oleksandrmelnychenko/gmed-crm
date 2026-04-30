import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarPlus, CheckCircle2, LoaderCircle, MessageCircle, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  decidePortalRecommendation,
  fetchPortalRecommendations,
  requestRecommendationAppointment,
} from "@/pages/patients/data/portal-api";
import {
  formatPortalDateTime,
  portalStatusLabel,
  recommendationStatusTone,
} from "@/pages/patients/model/portal-shared";
import type { PortalRecommendationItem } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

const PORTAL_RECOMMENDATION_REALTIME_EVENTS = [
  "recommendation.created",
  "recommendation.updated",
  "recommendation.patient_decision",
  "recommendation.appointment_requested",
  "appointment_request.created",
] as const;

export function PatientRecommendationsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const [recommendations, setRecommendations] = useState<PortalRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const isPatientPortalUser = user?.role === "patient";

  useRealtimeSubscription(PORTAL_RECOMMENDATION_REALTIME_EVENTS, () => {
    clearApiCache("/me/recommendations");
    clearApiCache("/me/next-actions");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isPatientPortalUser) {
        setRecommendations([]);
        setError("");
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await fetchPortalRecommendations();
        if (cancelled) return;
        startTransition(() => {
          setRecommendations(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Empfehlungen konnten nicht geladen werden.", "Не удалось загрузить рекомендации.", "Failed to load recommendations."));
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
  }, [isPatientPortalUser, loading, version, l]);

  const activeCount = useMemo(
    () => recommendations.filter((item) => item.status === "active").length,
    [recommendations],
  );

  async function handleDecision(recommendationId: string, decision: string) {
    if (!isPatientPortalUser) {
      return;
    }

    setBusyId(`${recommendationId}:${decision}`);
    setError("");
    setNotice("");

    try {
      if (decision === "schedule") {
        await requestRecommendationAppointment(recommendationId, {});
        setNotice(l("Terminanfrage wurde aus der Empfehlung erstellt.", "Запрос на визит создан из рекомендации.", "Appointment request created from the recommendation."));
      } else {
        await decidePortalRecommendation(recommendationId, { decision });
        setNotice(l("Ihre Entscheidung wurde gespeichert.", "Ваше решение сохранено.", "Your decision was saved."));
      }
      clearApiCache("/me/recommendations");
      clearApiCache("/me/next-actions");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Aktion konnte nicht gespeichert werden.", "Не удалось сохранить действие.", "Failed to save action."));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Empfehlungen werden geladen...", "Загрузка рекомендаций...", "Loading recommendations...")}
        </div>
      </div>
    );
  }

  if (!isPatientPortalUser) {
    return (
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
            Staff access
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            Recommendations
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-500">
            This route is the patient portal recommendations page. CEO can open it for review, but
            patient-specific recommendation data is shown inside each patient workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/patients" className="inline-flex rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Open patients
            </a>
            <a href="/patients?tab=timeline" className="inline-flex rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Review patient timeline
            </a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              {l("Patientenportal", "Портал пациента", "Patient portal")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {l("Meine Empfehlungen", "Мои рекомендации", "My recommendations")}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-500">
              {l("Hier sehen Sie freigegebene Empfehlungen Ihres Betreuungsteams und können die nächste Entscheidung dokumentieren.", "Здесь отображаются опубликованные рекомендации команды сопровождения, по которым можно выбрать следующее действие.", "Review released care-team recommendations and record the next decision.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              {l("Aktiv", "Активно", "Active")}: <span className="font-semibold text-slate-950">{activeCount}</span>
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 shadow-sm">
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-sm">
          {error}
        </section>
      ) : null}

      {recommendations.length === 0 ? (
        <section className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <p className="text-base font-semibold text-slate-950">
            {l("Noch keine Empfehlungen", "Пока нет рекомендаций", "No recommendations yet")}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {l("Sobald Ihr Team eine Empfehlung freigibt, erscheint sie hier.", "Когда команда опубликует рекомендацию, она появится здесь.", "Released recommendations from your care team will appear here.")}
          </p>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {recommendations.map((item) => {
            const recommendationId = item.recommendation_id || item.id;
            const disabled = busyId?.startsWith(`${recommendationId}:`) ?? false;
            const isClosed = ["completed", "declined", "cancelled", "superseded"].includes(item.status);

            return (
              <article
                key={recommendationId}
                className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className={cn("rounded-full", recommendationStatusTone(item.status))}>
                        {portalStatusLabel(item.status)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                        {item.recommendation_type.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {[item.source_doctor_name, item.source_appointment_title, item.source_document_name]
                        .filter(Boolean)
                        .join(" · ") || l("Betreuungsteam", "Команда сопровождения", "Care team")}
                    </p>
                  </div>
                  {item.due_at ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {l("Fällig", "Срок", "Due")} {formatPortalDateTime(item.due_at)}
                    </div>
                  ) : null}
                </div>

                {item.description ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    {item.description}
                  </div>
                ) : null}

                {item.patient_decision ? (
                  <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                    {l("Ihre Entscheidung", "Ваше решение", "Your decision")}:{" "}
                    <span className="font-semibold">{item.patient_decision.replaceAll("_", " ")}</span>
                    {item.appointment_request_status ? ` · ${portalStatusLabel(item.appointment_request_status)}` : ""}
                  </div>
                ) : null}

                {!isClosed ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <ActionButton
                      busy={busyId === `${recommendationId}:schedule`}
                      disabled={disabled || Boolean(item.appointment_request_id)}
                      icon={<CalendarPlus className="size-4" />}
                      label={item.appointment_request_id ? l("Terminanfrage erstellt", "Запрос создан", "Request created") : l("Termin planen", "Запланировать визит", "Schedule")}
                      onClick={() => void handleDecision(recommendationId, "schedule")}
                    />
                    <ActionButton
                      busy={busyId === `${recommendationId}:already_done`}
                      disabled={disabled}
                      icon={<CheckCircle2 className="size-4" />}
                      label={l("Schon erledigt", "Уже выполнено", "Already done")}
                      onClick={() => void handleDecision(recommendationId, "already_done")}
                    />
                    <ActionButton
                      busy={busyId === `${recommendationId}:need_consultation`}
                      disabled={disabled}
                      icon={<MessageCircle className="size-4" />}
                      label={l("Beratung nötig", "Нужна консультация", "Need consultation")}
                      onClick={() => void handleDecision(recommendationId, "need_consultation")}
                    />
                    <ActionButton
                      busy={busyId === `${recommendationId}:declined`}
                      disabled={disabled}
                      icon={<XCircle className="size-4" />}
                      label={l("Ablehnen", "Отклонить", "Decline")}
                      onClick={() => void handleDecision(recommendationId, "declined")}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function ActionButton({
  busy,
  disabled,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="rounded-2xl"
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {label}
    </Button>
  );
}
