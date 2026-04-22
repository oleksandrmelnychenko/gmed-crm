import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle, RefreshCw, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import {
  formatPortalDate,
  formatPortalDateTime,
  portalStatusLabel,
  privacyRequestLabel,
  privacyStatusTone,
} from "@/pages/patients/model/portal-shared";
import type { PortalPrivacyRequest } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

type RequestType = "erasure" | "restriction" | "third_party_revoke";

export function PatientPrivacyPage() {
  const { lang } = useLang();
  const [requests, setRequests] = useState<PortalPrivacyRequest[]>([]);
  const [requestType, setRequestType] = useState<RequestType>("restriction");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await apiFetch<PortalPrivacyRequest[]>("/me/privacy-requests");
        if (cancelled) return;
        startTransition(() => {
          setRequests(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Datenschutzanfragen konnten nicht geladen werden.", "Не удалось загрузить запросы по приватности.", "Failed to load privacy requests."));
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

  const openRequests = useMemo(
    () => requests.filter((item) => !["rejected", "completed", "executed"].includes(item.status)),
    [requests],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice("");
    setError("");

    try {
      await apiFetch("/me/privacy-requests", {
        method: "POST",
        body: JSON.stringify({
          request_type: requestType,
          reason: reason.trim() || null,
        }),
      });
      setReason("");
      setNotice(l("Datenschutzanfrage wurde eingereicht.", "Запрос по приватности отправлен.", "Privacy request submitted."));
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Datenschutzanfrage konnte nicht gesendet werden.", "Не удалось отправить запрос по приватности.", "Failed to submit privacy request."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Datenschutzbereich wird geladen...", "Загрузка раздела приватности...", "Loading privacy workspace...")}
        </div>
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
              {l("Datenschutzanfragen", "Запросы по приватности", "Privacy requests")}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-500">
              {l("Reichen Sie DSGVO-Anfragen zur Datenlöschung, Verarbeitungseinschränkung oder zum Widerruf der Weitergabe an Dritte ein.", "Отправляйте запросы по защите данных на удаление, ограничение обработки или отзыв передачи третьим лицам.", "Submit DSGVO requests for data erasure, processing restriction or third-party sharing revocation.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              {l("Offene Anfragen", "Открытые запросы", "Open requests")}: <span className="font-semibold text-slate-950">{openRequests.length}</span>
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

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
              <Shield className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Neue Anfrage", "Новый запрос", "New request")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Anfragen gehen zur Prüfung und Bearbeitung an Ihren Patientenmanager.", "Запросы поступают вашему менеджеру пациента на рассмотрение и исполнение.", "Requests go to your patient manager for review and execution.")}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="privacy-type">{l("Anfragetyp", "Тип запроса", "Request type")}</Label>
              <select
                id="privacy-type"
                value={requestType}
                onChange={(event) => setRequestType(event.target.value as RequestType)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="restriction">{l("Verarbeitung einschränken", "Ограничить обработку", "Restrict processing")}</option>
                <option value="erasure">{l("Daten löschen", "Удалить данные", "Erase data")}</option>
                <option value="third_party_revoke">{l("Weitergabe an Dritte widerrufen", "Отозвать передачу третьим лицам", "Revoke third-party sharing")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="privacy-reason">{l("Begründung", "Причина", "Reason")}</Label>
              <textarea
                id="privacy-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={l("Optionaler Kontext für das Betreuungsteam", "Необязательный контекст для команды сопровождения", "Optional context for the care team")}
                className="min-h-[120px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <Button
              type="submit"
              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={submitting}
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {l("Anfrage senden", "Отправить запрос", "Submit request")}
            </Button>
          </form>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Anfrageverlauf", "История запросов", "Request history")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Zeitachse eingereichter Datenschutzmaßnahmen und ihrer Fristen.", "Хронология отправленных запросов по приватности и их сроков.", "Timeline for submitted privacy actions and due dates.")}
              </p>
            </div>
          </div>

          {requests.length === 0 ? (
            <div className="mt-5 rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
              {l("Noch keine Datenschutzanfragen eingereicht.", "Запросы по приватности еще не отправлялись.", "No privacy requests submitted yet.")}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {requests.map((item) => (
                <article
                  key={item.id}
                  className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {privacyRequestLabel(item.request_type)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {l("Eingereicht", "Отправлено", "Submitted")} {formatPortalDateTime(item.requested_at)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", privacyStatusTone(item.status))}
                    >
                      {portalStatusLabel(item.status)}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <RequestField label={l("Fällig", "Срок", "Due")} value={formatPortalDate(item.due_at)} />
                    <RequestField label={l("Geprüft", "Проверено", "Reviewed")} value={formatPortalDateTime(item.reviewed_at)} />
                    <RequestField label={l("Ausgeführt", "Исполнено", "Executed")} value={formatPortalDateTime(item.executed_at)} />
                    <RequestField label={l("Quelle", "Источник", "Source")} value={item.source.replaceAll("_", " ")} />
                  </div>

                  {item.reason ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      {item.reason}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function RequestField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  );
}
