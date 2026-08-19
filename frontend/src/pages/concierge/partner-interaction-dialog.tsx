import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  History,
  LoaderCircle,
  Mail,
  MapPinned,
  MessageSquareText,
  Phone,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";

import {
  conciergeDialogContentClassName,
  ConciergeDialogBody,
  ConciergeDialogHeader,
  ConciergeDialogSection,
  ConciergeField,
} from "./dialog-layout";

import {
  conciergePartnerEmailUrl,
  conciergePartnerPhoneUrl,
  conciergeProviderAddress,
  googleMapsDirectionsUrl,
  type ConciergePartnerChannel,
  type ConciergePartnerDirection,
  type ConciergePartnerInteraction,
  type ConciergePartnerOutcome,
  type ConciergeProvider,
  type ConciergeService,
} from "./model";

const copy = {
  de: {
    title: "Partnerkontakt",
    description: "Kontakt und Buchungsverlauf für diesen nicht-medizinischen Service dokumentieren.",
    call: "Anrufen",
    email: "E-Mail",
    route: "Route",
    occurredAt: "Zeitpunkt",
    channel: "Kanal",
    direction: "Richtung",
    outbound: "Ausgehend",
    inbound: "Eingehend",
    outcome: "Ergebnis",
    contactPerson: "Kontaktperson",
    contactPlaceholder: "Name beim Partner",
    quote: "Angebot",
    note: "Notiz",
    notePlaceholder: "Vereinbarung, Rückruf oder Buchungsdetail",
    record: "Kontakt dokumentieren",
    saving: "Wird gespeichert",
    history: "Kontaktverlauf",
    empty: "Noch kein Partnerkontakt dokumentiert.",
    recordedBy: "Erfasst von {name}",
    phone: "Telefon",
    channel_email: "E-Mail",
    messaging: "Nachricht",
    in_person: "Persönlich",
    other: "Andere",
    no_answer: "Nicht erreicht",
    reached: "Erreicht",
    quote_requested: "Angebot angefragt",
    quote_received: "Angebot erhalten",
    follow_up_needed: "Rückmeldung erforderlich",
    booking_requested: "Buchung angefragt",
    booking_confirmed: "Buchung bestätigt",
    declined: "Abgelehnt",
    cancelled: "Storniert",
    applyQuote: "Als Plankosten übernehmen",
    applyingQuote: "Wird übernommen",
    appliedQuote: "Als Plankosten übernommen",
    currencyMismatch: "Angebots- und Servicewährung stimmen nicht überein.",
  },
  ru: {
    title: "Связь с партнёром",
    description: "Фиксируйте контакты и ход бронирования по этой немедицинской услуге.",
    call: "Позвонить",
    email: "Написать",
    route: "Маршрут",
    occurredAt: "Время",
    channel: "Канал",
    direction: "Направление",
    outbound: "Исходящий",
    inbound: "Входящий",
    outcome: "Результат",
    contactPerson: "Контактное лицо",
    contactPlaceholder: "Имя представителя партнёра",
    quote: "Предложенная цена",
    note: "Заметка",
    notePlaceholder: "Договорённость, обратный звонок или детали брони",
    record: "Сохранить контакт",
    saving: "Сохранение",
    history: "История контактов",
    empty: "Контакты с партнёром ещё не зафиксированы.",
    recordedBy: "Зафиксировал(а): {name}",
    phone: "Телефон",
    channel_email: "E-mail",
    messaging: "Сообщение",
    in_person: "Лично",
    other: "Другое",
    no_answer: "Не ответили",
    reached: "Связались",
    quote_requested: "Цена запрошена",
    quote_received: "Цена получена",
    follow_up_needed: "Нужен повторный контакт",
    booking_requested: "Бронирование запрошено",
    booking_confirmed: "Бронирование подтверждено",
    declined: "Отказ",
    cancelled: "Отменено",
    applyQuote: "Принять как плановые затраты",
    applyingQuote: "Применение",
    appliedQuote: "Принято в плановые затраты",
    currencyMismatch: "Валюта предложения не совпадает с валютой услуги.",
  },
} as const;

const CHANNELS: ConciergePartnerChannel[] = ["phone", "email", "messaging", "in_person", "other"];
const OUTCOMES: ConciergePartnerOutcome[] = [
  "no_answer",
  "reached",
  "quote_requested",
  "quote_received",
  "follow_up_needed",
  "declined",
  "cancelled",
];

export type RecordPartnerInteractionInput = {
  channel: ConciergePartnerChannel;
  direction: ConciergePartnerDirection;
  outcome: ConciergePartnerOutcome;
  occurred_at: string;
  contact_person: string | null;
  note: string | null;
  quoted_cost: number | null;
  quoted_currency: string | null;
};

function localDateTimeValue(value: Date) {
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function formatDateTime(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function interactionLabel(
  value: ConciergePartnerChannel | ConciergePartnerOutcome,
  lang: Lang,
) {
  if (value === "email") return copy[lang].channel_email;
  return copy[lang][value];
}

function outcomeTone(outcome: ConciergePartnerOutcome) {
  if (outcome === "booking_confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["declined", "cancelled"].includes(outcome)) return "border-rose-200 bg-rose-50 text-rose-700";
  if (["quote_received", "reached"].includes(outcome)) return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function money(value: string | null, currency: string | null, lang: Lang) {
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency ?? ""}`.trim();
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-field px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

export function ConciergePartnerInteractionDialog({
  service,
  provider,
  lang,
  open,
  events,
  error,
  loading,
  submitting,
  applyingQuoteId,
  onOpenChange,
  onRecord,
  onApplyQuote,
}: {
  service: ConciergeService | null;
  provider: ConciergeProvider | null;
  lang: Lang;
  open: boolean;
  events: ConciergePartnerInteraction[];
  error: string;
  loading: boolean;
  submitting: boolean;
  applyingQuoteId: string | null;
  onOpenChange: (open: boolean) => void;
  onRecord: (input: RecordPartnerInteractionInput) => Promise<void>;
  onApplyQuote: (event: ConciergePartnerInteraction) => Promise<void>;
}) {
  const labels = copy[lang];
  const [channel, setChannel] = useState<ConciergePartnerChannel>("phone");
  const [direction, setDirection] = useState<ConciergePartnerDirection>("outbound");
  const [outcome, setOutcome] = useState<ConciergePartnerOutcome>("reached");
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue(new Date()));
  const [contactPerson, setContactPerson] = useState("");
  const [note, setNote] = useState("");
  const [quotedCost, setQuotedCost] = useState("");
  const [currency, setCurrency] = useState("EUR");

  const callUrl = conciergePartnerPhoneUrl(provider?.phone);
  const emailUrl = conciergePartnerEmailUrl(provider?.email);
  const routeUrl = googleMapsDirectionsUrl(conciergeProviderAddress(provider));
  const initialChannel = useMemo<ConciergePartnerChannel>(
    () => (callUrl ? "phone" : emailUrl ? "email" : "other"),
    [callUrl, emailUrl],
  );

  useEffect(() => {
    if (!open) return;
    setChannel(initialChannel);
    setDirection("outbound");
    setOutcome("reached");
    setOccurredAt(localDateTimeValue(new Date()));
    setContactPerson("");
    setNote("");
    setQuotedCost("");
    setCurrency(service?.currency || "EUR");
  }, [initialChannel, open, service?.currency, service?.id]);

  if (!service || !provider) return null;

  async function record() {
    try {
      await onRecord({
        channel,
        direction,
        outcome,
        occurred_at: new Date(occurredAt).toISOString(),
        contact_person: contactPerson.trim() || null,
        note: note.trim() || null,
        quoted_cost: quotedCost.trim() ? Number(quotedCost) : null,
        quoted_currency: quotedCost.trim() ? currency.trim().toUpperCase() : null,
      });
      setOccurredAt(localDateTimeValue(new Date()));
      setContactPerson("");
      setNote("");
      setQuotedCost("");
    } catch {
      // Keep the entered values so a failed request can be retried.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader
          icon={MessageSquareText}
          tone="indigo"
          title={labels.title}
          description={labels.description}
          meta={<Badge variant="secondary" className="max-w-72 truncate rounded-full">{provider.name}</Badge>}
        />

        <ConciergeDialogBody>
          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
            <div className="space-y-4">
              <ConciergeDialogSection title={provider.name}>
                <div className="grid grid-cols-3 gap-2">
                  <Button nativeButton={false} render={<a href={callUrl ?? "#"} />} type="button" variant="outline" disabled={!callUrl}>
                    <Phone />{labels.call}
                  </Button>
                  <Button nativeButton={false} render={<a href={emailUrl ?? "#"} />} type="button" variant="outline" disabled={!emailUrl}>
                    <Mail />{labels.email}
                  </Button>
                  <Button nativeButton={false} render={<a href={routeUrl ?? "#"} target="_blank" rel="noreferrer" />} type="button" variant="outline" disabled={!routeUrl}>
                    <MapPinned />{labels.route}
                  </Button>
                </div>
              </ConciergeDialogSection>

              <ConciergeDialogSection title={labels.record} icon={MessageSquareText}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ConciergeField label={labels.occurredAt}>
              <Input type="datetime-local" value={occurredAt} max={localDateTimeValue(new Date(Date.now() + 5 * 60_000))} onChange={(event) => setOccurredAt(event.target.value)} />
                  </ConciergeField>
                  <ConciergeField label={labels.channel}>
              <select className={selectClass} value={channel} onChange={(event) => setChannel(event.target.value as ConciergePartnerChannel)}>
                {CHANNELS.map((value) => <option key={value} value={value}>{interactionLabel(value, lang)}</option>)}
              </select>
                  </ConciergeField>
                  <ConciergeField label={labels.direction}>
              <select className={selectClass} value={direction} onChange={(event) => setDirection(event.target.value as ConciergePartnerDirection)}>
                <option value="outbound">{labels.outbound}</option>
                <option value="inbound">{labels.inbound}</option>
              </select>
                  </ConciergeField>
                  <ConciergeField label={labels.outcome}>
              <select className={selectClass} value={outcome} onChange={(event) => setOutcome(event.target.value as ConciergePartnerOutcome)}>
                {OUTCOMES.map((value) => <option key={value} value={value}>{interactionLabel(value, lang)}</option>)}
              </select>
                  </ConciergeField>
                  <ConciergeField label={labels.contactPerson} className="sm:col-span-2">
              <Input value={contactPerson} maxLength={160} placeholder={labels.contactPlaceholder} onChange={(event) => setContactPerson(event.target.value)} />
                  </ConciergeField>
                  <ConciergeField label={labels.quote} className="sm:col-span-2">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                <Input type="number" min="0" step="0.01" value={quotedCost} onChange={(event) => setQuotedCost(event.target.value)} />
                <Input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
              </div>
                  </ConciergeField>
                  <ConciergeField label={labels.note} className="sm:col-span-2">
                    <textarea value={note} maxLength={2000} rows={4} placeholder={labels.notePlaceholder} onChange={(event) => setNote(event.target.value)} className="flex min-h-28 w-full rounded-md border border-input bg-field px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" />
                  </ConciergeField>
                </div>
                <div className="flex justify-end border-t border-border/60 pt-3">
                  <Button type="button" className="min-h-10 w-full sm:w-auto" disabled={submitting || !occurredAt || (quotedCost.trim() !== "" && !Number.isFinite(Number(quotedCost)))} onClick={() => void record()}>
                    {submitting ? <LoaderCircle className="animate-spin" /> : <MessageSquareText />}
                    {submitting ? labels.saving : labels.record}
                  </Button>
                </div>
              </ConciergeDialogSection>
            </div>

            <ConciergeDialogSection title={labels.history} icon={History} className="lg:sticky lg:top-0">
              <div className="max-h-[56vh] overflow-y-auto pr-1">
                {loading ? (
                  <div className="flex justify-center py-12 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /></div>
                ) : events.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-12 text-center text-xs text-muted-foreground">{labels.empty}</p>
                ) : (
                  <ol className="space-y-2">
              {[...events].reverse().map((event) => (
                <li key={event.id} className="rounded-lg border border-border/70 bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={`rounded-full ${outcomeTone(event.outcome)}`}>{interactionLabel(event.outcome, lang)}</Badge>
                      <Badge variant="secondary" className="rounded-full">{interactionLabel(event.channel, lang)}</Badge>
                      <Badge variant="outline" className="rounded-full">{event.direction === "outbound" ? labels.outbound : labels.inbound}</Badge>
                      {event.applied_as_cost_estimate_at ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          <CheckCircle2 className="size-3" />
                          {labels.appliedQuote}
                        </Badge>
                      ) : null}
                    </div>
                    <time dateTime={event.occurred_at} className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="size-3" />{formatDateTime(event.occurred_at, lang)}</time>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {event.contact_person ? <span className="flex items-center gap-1"><UserRound className="size-3.5 text-muted-foreground" />{event.contact_person}</span> : null}
                    {event.quoted_cost ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium">{money(event.quoted_cost, event.quoted_currency, lang)}</span>
                        {!event.applied_as_cost_estimate_at ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={
                              Boolean(applyingQuoteId) ||
                              event.quoted_currency !== service.currency
                            }
                            title={
                              event.quoted_currency !== service.currency
                                ? labels.currencyMismatch
                                : labels.applyQuote
                            }
                            onClick={() => void onApplyQuote(event)}
                          >
                            {applyingQuoteId === event.id ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <CircleDollarSign />
                            )}
                            {applyingQuoteId === event.id
                              ? labels.applyingQuote
                              : labels.applyQuote}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {event.note ? <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{event.note}</p> : null}
                  <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground"><ExternalLink className="size-3" />{labels.recordedBy.replace("{name}", event.recorded_by_name)}</p>
                </li>
              ))}
                  </ol>
                )}
              </div>
            </ConciergeDialogSection>
          </div>
        </ConciergeDialogBody>
      </DialogContent>
    </Dialog>
  );
}
