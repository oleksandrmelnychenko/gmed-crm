import { startTransition, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Building2, LoaderCircle, RefreshCw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import {
  conciergeServiceKindLabel,
  conciergeServiceSourceLabel,
  conciergeServiceStatusTone,
  formatPortalCurrency,
  formatPortalDateTime,
  portalStatusLabel,
} from "@/pages/patient-portal.shared";
import type { PortalConciergeServiceItem } from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

function shellCard(extra?: string) {
  return cn("rounded-[1.75rem] border border-slate-200 bg-white shadow-sm", extra);
}

type ServiceRequestFormState = {
  serviceKind: string;
  title: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  costEstimate: string;
  serviceNotes: string;
};

function blankServiceRequestForm(): ServiceRequestFormState {
  return {
    serviceKind: "hotel",
    title: "",
    vendorName: "",
    vendorContact: "",
    startsAt: "",
    endsAt: "",
    costEstimate: "",
    serviceNotes: "",
  };
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function PatientServicesPage() {
  const { lang } = useLang();
  const [services, setServices] = useState<PortalConciergeServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [cancelBusyId, setCancelBusyId] = useState("");
  const [form, setForm] = useState<ServiceRequestFormState>(blankServiceRequestForm());
  const [version, setVersion] = useState(0);
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await apiFetch<PortalConciergeServiceItem[]>("/me/concierge-services");
        if (cancelled) return;
        startTransition(() => {
          setServices(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Zusatzservices konnten nicht geladen werden.", "Не удалось загрузить дополнительные сервисы.", "Failed to load additional services."));
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

  const openItems = useMemo(
    () => services.filter((item) => !["completed", "cancelled"].includes(item.status)),
    [services],
  );
  const bookedItems = useMemo(
    () => services.filter((item) => ["booked", "confirmed", "in_service"].includes(item.status)),
    [services],
  );
  const completedItems = useMemo(
    () => services.filter((item) => item.status === "completed"),
    [services],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestBusy(true);
    setRequestError("");
    setNotice("");

    try {
      await apiFetch("/me/concierge-services", {
        method: "POST",
        body: JSON.stringify({
          service_kind: form.serviceKind,
          title: form.title,
          vendor_name: form.vendorName || undefined,
          vendor_contact: form.vendorContact || undefined,
          starts_at: toIsoDateTime(form.startsAt),
          ends_at: toIsoDateTime(form.endsAt),
          cost_estimate: form.costEstimate ? Number(form.costEstimate) : undefined,
          service_notes: form.serviceNotes || undefined,
        }),
      });
      setNotice(l("Serviceanfrage wurde an das Betreuungsteam gesendet.", "Запрос на сервис отправлен команде сопровождения.", "Additional service request sent to the care team."));
      setForm(blankServiceRequestForm());
      setVersion((value) => value + 1);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : l("Serviceanfrage konnte nicht erstellt werden.", "Не удалось создать сервисный запрос.", "Failed to create service request."));
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleCancel(serviceId: string) {
    setCancelBusyId(serviceId);
    setError("");
    setNotice("");

    try {
      await apiFetch(`/me/concierge-services/${serviceId}/cancel`, {
        method: "POST",
      });
      setNotice(l("Serviceanfrage wurde storniert.", "Сервисный запрос отменен.", "Service request cancelled."));
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Serviceanfrage konnte nicht storniert werden.", "Не удалось отменить сервисный запрос.", "Failed to cancel service request."));
    } finally {
      setCancelBusyId("");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Zusatzservices werden geladen...", "Загрузка дополнительных сервисов...", "Loading additional services...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section
        className={shellCard(
          "bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#155e75_48%,#134e4a_100%)] px-6 py-6 text-white",
        )}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">{l("Patientenportal", "Портал пациента", "Patient portal")}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{l("Meine Zusatzservices", "Мои дополнительные сервисы", "My additional services")}</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              {l(
                "Fordern Sie Reise-, Hotel-, Transfer- oder andere Concierge-Unterstützung an und verfolgen Sie die Bearbeitung durch das Betreuungsteam.",
                "Запрашивайте поездки, отели, трансферы и другие concierge-сервисы и отслеживайте, как команда сопровождения их обрабатывает.",
                "Request travel, hotel, transfer or other concierge support and track how the care team processes it.",
              )}
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {l("Aktualisieren", "Обновить", "Refresh")}
          </Button>
        </div>
      </section>

      {notice ? (
        <section className={shellCard("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}>
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label={l("Offene Anfragen", "Открытые запросы", "Open requests")} value={String(openItems.length)} />
        <MetricCard label={l("Gebucht oder in Bearbeitung", "Забронировано или в работе", "Booked or in service")} value={String(bookedItems.length)} />
        <MetricCard label={l("Abgeschlossene Services", "Завершенные сервисы", "Completed services")} value={String(completedItems.length)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4">
          <section className={shellCard("p-5")}>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Serviceverlauf", "История сервисов", "Service history")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Portal-Anfragen und Concierge-Services, die bereits für Ihren Fall organisiert wurden.", "Запросы из портала и concierge-сервисы, уже организованные по вашему случаю.", "Portal requests and concierge services already organized for your case.")}
              </p>
            </div>
          </section>

          {services.length === 0 ? (
            <section className={shellCard("border-dashed px-6 py-12 text-center")}>
              <p className="text-base font-semibold text-slate-950">{l("Noch keine Zusatzservices", "Пока нет дополнительных сервисов", "No additional services yet")}</p>
              <p className="mt-2 text-sm text-slate-500">
                {l("Sobald Sie oder das Betreuungsteam einen Concierge-Service anlegen, erscheint er hier.", "Как только вы или команда сопровождения создадите запись concierge-сервиса, она появится здесь.", "Once you or the care team create a concierge service entry, it will appear here.")}
              </p>
            </section>
          ) : (
            services.map((item) => (
              <article key={item.id} className={shellCard("p-5")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className={cn("rounded-full", conciergeServiceStatusTone(item.status))}>
                        {portalStatusLabel(item.status)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                        {conciergeServiceKindLabel(item.service_kind)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                        {conciergeServiceSourceLabel(item.request_source)}
                      </Badge>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {[item.provider_name, item.assigned_concierge_name, item.appointment_title].filter(Boolean).join(" · ") || l("Bearbeitung durch Betreuungsteam ausstehend", "Ожидает обработки командой сопровождения", "Care-team handling pending")}
                    </p>
                  </div>
                  <Building2 className="size-5 text-sky-700" />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Detail label={l("Bevorzugter Start", "Предпочтительное начало", "Preferred start")} value={formatPortalDateTime(item.starts_at)} />
                  <Detail label={l("Bevorzugtes Ende", "Предпочтительное окончание", "Preferred end")} value={formatPortalDateTime(item.ends_at)} />
                  <Detail label={l("Anbieter", "Поставщик", "Vendor")} value={item.vendor_name || l("Nicht festgelegt", "Не указано", "Not set")} />
                  <Detail
                    label={l("Schätzung", "Оценка", "Estimate")}
                    value={item.cost_estimate ? formatPortalCurrency(item.cost_estimate) : l("Nicht festgelegt", "Не указано", "Not set")}
                  />
                  <Detail label={l("Buchungsreferenz", "Референс бронирования", "Booking reference")} value={item.booking_reference || l("Nicht festgelegt", "Не указано", "Not set")} />
                  <Detail label={l("Erstellt", "Создано", "Created")} value={formatPortalDateTime(item.created_at)} />
                </div>
                {item.service_notes ? (
                  <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                    {item.service_notes}
                  </div>
                ) : null}
                {item.can_cancel ? (
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                      disabled={cancelBusyId === item.id}
                      onClick={() => void handleCancel(item.id)}
                    >
                      {cancelBusyId === item.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                      {l("Anfrage stornieren", "Отменить запрос", "Cancel request")}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Service anfragen", "Запросить сервис", "Request a service")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Senden Sie einen Concierge-Bedarf direkt aus dem Portal. Das zuständige Team prüft die Anfrage und bucht operativ.", "Отправьте запрос на concierge-сервис прямо из портала. Назначенная команда рассмотрит его и оформит на своей стороне.", "Send a concierge need directly from the portal. The assigned team reviews and books it operationally.")}
              </p>
            </div>
            <Send className="mt-1 size-5 text-sky-700" />
          </div>
          <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label={l("Servicetyp", "Тип сервиса", "Service type")}>
              <select
                value={form.serviceKind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    serviceKind: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-2xl border border-slate-200 bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="hotel">{l("Hotel", "Отель", "Hotel")}</option>
                <option value="transfer">{l("Transfer", "Трансфер", "Transfer")}</option>
                <option value="vip_terminal">{l("VIP-Terminal", "VIP-терминал", "VIP terminal")}</option>
                <option value="flight">{l("Flug", "Перелет", "Flight")}</option>
                <option value="chauffeur">{l("Chauffeur", "Шофер", "Chauffeur")}</option>
                <option value="translation_support">{l("Sprachunterstützung", "Языковая поддержка", "Translation support")}</option>
                <option value="other">{l("Sonstiges", "Другое", "Other")}</option>
              </select>
            </Field>

            <Field label={l("Titel", "Название", "Title")}>
              <Input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder={l("Hotelübernachtung am Flughafen", "Отель у аэропорта", "Airport hotel stay")}
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={l("Bevorzugter Anbieter", "Предпочтительный поставщик", "Preferred vendor")}>
                <Input
                  value={form.vendorName}
                  onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))}
                  placeholder={l("Hotel / Fluglinie / Transferfirma", "Отель / авиакомпания / трансферная компания", "Hotel / airline / transfer company")}
                />
              </Field>
              <Field label={l("Kontakt des Anbieters", "Контакт поставщика", "Vendor contact")}>
                <Input
                  value={form.vendorContact}
                  onChange={(event) => setForm((current) => ({ ...current, vendorContact: event.target.value }))}
                  placeholder={l("Buchungs-E-Mail oder Telefon", "Почта или телефон для бронирования", "Booking email or phone")}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={l("Bevorzugter Start", "Предпочтительное начало", "Preferred start")}>
                <Input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </Field>
              <Field label={l("Bevorzugtes Ende", "Предпочтительное окончание", "Preferred end")}>
                <Input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))}
                />
              </Field>
            </div>

            <Field label={l("Geschätztes Budget (EUR)", "Ориентировочный бюджет (EUR)", "Estimated budget (EUR)")}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.costEstimate}
                onChange={(event) => setForm((current) => ({ ...current, costEstimate: event.target.value }))}
                placeholder="250.00"
              />
            </Field>

            <Field label={l("Notizen", "Заметки", "Notes")}>
              <textarea
                value={form.serviceNotes}
                onChange={(event) => setForm((current) => ({ ...current, serviceNotes: event.target.value }))}
                placeholder={l("Ankunftsdetails, Gepäck, Hotelwünsche, VIP-Kontext...", "Детали прибытия, багаж, предпочтения по отелю, контекст VIP...", "Arrival details, luggage, hotel preferences, VIP support context...")}
                className="min-h-[132px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </Field>

            {requestError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {requestError}
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={requestBusy}
            >
              {requestBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {l("Anfrage senden", "Отправить запрос", "Send request")}
            </Button>
          </form>
        </section>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50/80 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  );
}
