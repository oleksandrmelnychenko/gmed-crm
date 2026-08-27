import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CalendarCheck2, LoaderCircle, Mail, MapPinned, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";

import {
  conciergeDialogContentClassName,
  ConciergeDialogBody,
  ConciergeDialogFooter,
  ConciergeDialogHeader,
  ConciergeDialogSection,
  ConciergeField,
} from "./dialog-layout";

import {
  conciergePartnerEmailUrl,
  conciergePartnerPhoneUrl,
  conciergeProviderAddress,
  conciergeServiceDisplayTitle,
  eligibleConciergeServicesForProvider,
  googleMapsDirectionsUrl,
  type ConciergePartnerChannel,
  type ConciergeProvider,
  type ConciergeService,
} from "./model";

export type BookConciergeProviderInput = {
  request_id: string;
  provider_id: string;
  booking_state: "requested" | "confirmed";
  channel: ConciergePartnerChannel;
  contact_person: string | null;
  vendor_contact: string | null;
  booking_reference: string | null;
  starts_at: string;
  ends_at: string | null;
  service_address: string;
  note: string | null;
};

export type BookConciergeProviderResponse = {
  service: ConciergeService;
  interaction_id: string;
};

const copy = {
  de: {
    title: "Partner buchen",
    description: "Empfehlung mit einem zugewiesenen Service verbinden und den Buchungsstand dokumentieren.",
    service: "Serviceanfrage",
    chooseService: "Service auswählen",
    requested: "Angefragt",
    confirmed: "Bestätigt",
    startsAt: "Beginn",
    endsAt: "Ende (optional)",
    address: "Serviceadresse",
    addressPlaceholder: "Straße, Ort, Land",
    contact: "Kontakt",
    contactPerson: "Kontaktperson (optional)",
    reference: "Buchungsnummer (optional)",
    channel: "Kontaktkanal",
    phone: "Telefon",
    email: "E-Mail",
    messaging: "Nachricht",
    in_person: "Persönlich",
    other: "Andere",
    note: "Buchungsnotiz (optional)",
    notePlaceholder: "Abholpunkt, vereinbarte Details oder Bestätigung",
    call: "Anrufen",
    write: "E-Mail",
    route: "Route",
    save: "Buchung speichern",
    saving: "Wird gespeichert",
    cancel: "Abbrechen",
    noServices: "Keine geplante Serviceanfrage kann mit diesem Partner verbunden werden.",
    confirmedHint: "Für eine bestätigte Buchung ist eine Buchungsnummer, Kontaktperson oder Notiz erforderlich.",
    overdue: "überfällig",
  },
  ru: {
    title: "Забронировать партнёра",
    description: "Свяжите рекомендацию с назначенной услугой и зафиксируйте этап бронирования.",
    service: "Запрос на услугу",
    chooseService: "Выберите услугу",
    requested: "Запрошено",
    confirmed: "Подтверждено",
    startsAt: "Начало",
    endsAt: "Окончание (необязательно)",
    address: "Адрес услуги",
    addressPlaceholder: "Улица, город, страна",
    contact: "Контакт",
    contactPerson: "Контактное лицо (необязательно)",
    reference: "Номер брони (необязательно)",
    channel: "Канал связи",
    phone: "Телефон",
    email: "E-mail",
    messaging: "Сообщение",
    in_person: "Лично",
    other: "Другое",
    note: "Примечание к брони (необязательно)",
    notePlaceholder: "Место встречи, договорённости или подтверждение",
    call: "Позвонить",
    write: "E-mail",
    route: "Маршрут",
    save: "Сохранить бронь",
    saving: "Сохранение",
    cancel: "Отмена",
    noServices: "Нет запланированного запроса, который можно связать с этим партнёром.",
    confirmedHint: "Для подтверждённой брони укажите номер, контактное лицо или примечание.",
    overdue: "просрочено",
  },
} as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-field px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

function localDateTimeValue(value: string | Date | null, fallbackToNextHour = false) {
  if (!value && !fallbackToNextHour) return "";
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function optional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

export function bookingServiceOptionLabel(service: ConciergeService, lang: Lang, now = new Date()) {
  const startsAt = service.starts_at ? new Date(service.starts_at) : null;
  const validStartsAt = startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : null;
  const date = validStartsAt
    ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(validStartsAt)
    : "—";
  const overdue = validStartsAt && validStartsAt < now ? ` · ${copy[lang].overdue}` : "";
  return `${date}${overdue} · #${service.id.slice(0, 8)} · ${conciergeServiceDisplayTitle(service, lang)} · ${service.patient_name}`;
}

export function ConciergeProviderBookingDialog({
  provider,
  services,
  lang,
  open,
  submitting,
  error,
  onOpenChange,
  onSave,
}: {
  provider: ConciergeProvider | null;
  services: ConciergeService[];
  lang: Lang;
  open: boolean;
  submitting: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSave: (serviceId: string, input: BookConciergeProviderInput) => Promise<void>;
}) {
  const labels = copy[lang];
  const eligibleServices = useMemo(
    () => (provider ? eligibleConciergeServicesForProvider(services, provider.id) : []),
    [provider, services],
  );
  const [requestId, setRequestId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [bookingState, setBookingState] = useState<"requested" | "confirmed">("requested");
  const [channel, setChannel] = useState<ConciergePartnerChannel>("phone");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [vendorContact, setVendorContact] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open || !provider) return;
    const firstService = eligibleServices[0] ?? null;
    setRequestId(crypto.randomUUID());
    setServiceId(firstService?.id ?? "");
    setBookingState(firstService?.status === "booked" ? "confirmed" : "requested");
    setChannel(provider.phone ? "phone" : provider.email ? "email" : "other");
    setStartsAt(localDateTimeValue(firstService?.starts_at ?? null, true));
    setEndsAt(localDateTimeValue(firstService?.ends_at ?? null));
    setServiceAddress(firstService?.service_address || conciergeProviderAddress(provider) || "");
    setVendorContact(firstService?.vendor_contact || provider.phone || provider.email || "");
    setContactPerson("");
    setBookingReference(firstService?.booking_reference ?? "");
    setNote("");
  }, [eligibleServices, open, provider]);

  function selectService(nextServiceId: string) {
    const nextService = eligibleServices.find((service) => service.id === nextServiceId) ?? null;
    setServiceId(nextServiceId);
    setBookingState(nextService?.status === "booked" ? "confirmed" : "requested");
    setStartsAt(localDateTimeValue(nextService?.starts_at ?? null, true));
    setEndsAt(localDateTimeValue(nextService?.ends_at ?? null));
    setServiceAddress(nextService?.service_address || conciergeProviderAddress(provider) || "");
    setVendorContact(nextService?.vendor_contact || provider?.phone || provider?.email || "");
    setBookingReference(nextService?.booking_reference ?? "");
  }

  const callUrl = conciergePartnerPhoneUrl(provider?.phone ?? null);
  const emailUrl = conciergePartnerEmailUrl(provider?.email ?? null);
  const directionsUrl = googleMapsDirectionsUrl(serviceAddress || conciergeProviderAddress(provider));
  const confirmedDetailsMissing =
    bookingState === "confirmed" &&
    !bookingReference.trim() &&
    !contactPerson.trim() &&
    !note.trim();
  const canSubmit =
    Boolean(provider && serviceId && requestId && startsAt && serviceAddress.trim()) &&
    !confirmedDetailsMissing &&
    !submitting;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!provider || !canSubmit) return;
    await onSave(serviceId, {
      request_id: requestId,
      provider_id: provider.id,
      booking_state: bookingState,
      channel,
      contact_person: optional(contactPerson),
      vendor_contact: optional(vendorContact),
      booking_reference: optional(bookingReference),
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      service_address: serviceAddress.trim(),
      note: optional(note),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader
          icon={CalendarCheck2}
          tone="orange"
          title={labels.title}
          description={labels.description}
          meta={provider ? <Badge variant="secondary" className="rounded-full">{provider.open_concierge_service_count}</Badge> : null}
        />

        {eligibleServices.length === 0 ? (
          <ConciergeDialogBody>
            <p className="rounded-lg border border-dashed border-border px-4 py-14 text-center text-sm text-muted-foreground">{labels.noServices}</p>
          </ConciergeDialogBody>
        ) : (
          <form className="flex min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
            <ConciergeDialogBody>
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(20rem,0.82fr)_minmax(0,1.18fr)]">
                <div className="space-y-4">
                  {provider ? (
                    <ConciergeDialogSection title={provider.name}>
                      <div className="flex items-start justify-between gap-3 rounded-md bg-muted/35 p-3">
                        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">{conciergeProviderAddress(provider)}</p>
                        <Badge variant="secondary" className="shrink-0 rounded-full">{provider.open_concierge_service_count}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button nativeButton={false} render={<a href={callUrl ?? "#"} />} variant="outline" size="sm" disabled={!callUrl}><Phone />{labels.call}</Button>
                        <Button nativeButton={false} render={<a href={emailUrl ?? "#"} />} variant="outline" size="sm" disabled={!emailUrl}><Mail />{labels.write}</Button>
                        <Button nativeButton={false} render={<a href={directionsUrl ?? "#"} target="_blank" rel="noreferrer" />} variant="outline" size="sm" disabled={!directionsUrl}><MapPinned />{labels.route}</Button>
                      </div>
                    </ConciergeDialogSection>
                  ) : null}

                  <ConciergeDialogSection title={labels.service} icon={CalendarCheck2}>
                    <ConciergeField label={labels.service}>
              <select className={selectClass} value={serviceId} onChange={(event) => selectService(event.target.value)} required>
                <option value="" disabled>{labels.chooseService}</option>
                {eligibleServices.map((service) => <option key={service.id} value={service.id}>{bookingServiceOptionLabel(service, lang)}</option>)}
              </select>
                    </ConciergeField>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label={labels.title}>
                      {(["requested", "confirmed"] as const).map((state) => (
                        <Button key={state} type="button" variant={bookingState === state ? "default" : "outline"} aria-pressed={bookingState === state} onClick={() => setBookingState(state)}>
                          {labels[state]}
                        </Button>
                      ))}
                    </div>
                  </ConciergeDialogSection>
                </div>

                <ConciergeDialogSection title={labels.title} icon={CalendarCheck2}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ConciergeField label={labels.startsAt}><Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></ConciergeField>
                    <ConciergeField label={labels.endsAt}><Input type="datetime-local" value={endsAt} min={startsAt} onChange={(event) => setEndsAt(event.target.value)} /></ConciergeField>
                    <ConciergeField label={labels.address} className="sm:col-span-2"><Input value={serviceAddress} onChange={(event) => setServiceAddress(event.target.value)} placeholder={labels.addressPlaceholder} maxLength={500} required /></ConciergeField>
                    <ConciergeField label={labels.contact}><Input value={vendorContact} onChange={(event) => setVendorContact(event.target.value)} maxLength={255} /></ConciergeField>
                    <ConciergeField label={labels.contactPerson}><Input value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} maxLength={160} /></ConciergeField>
                    <ConciergeField label={labels.reference}><Input value={bookingReference} onChange={(event) => setBookingReference(event.target.value)} maxLength={160} /></ConciergeField>
                    <ConciergeField label={labels.channel}>
                <select className={selectClass} value={channel} onChange={(event) => setChannel(event.target.value as ConciergePartnerChannel)}>
                  {(["phone", "email", "messaging", "in_person", "other"] as const).map((item) => <option key={item} value={item}>{labels[item]}</option>)}
                </select>
                    </ConciergeField>
                    <ConciergeField label={labels.note} className="sm:col-span-2">
                      <textarea className="min-h-28 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={note} onChange={(event) => setNote(event.target.value)} placeholder={labels.notePlaceholder} maxLength={2000} />
                    </ConciergeField>
                  </div>
                  {confirmedDetailsMissing ? <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{labels.confirmedHint}</p> : null}
                  {error ? <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
                </ConciergeDialogSection>
              </div>
            </ConciergeDialogBody>
            <ConciergeDialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
              <Button type="submit" disabled={!canSubmit}>{submitting ? <LoaderCircle className="animate-spin" /> : <CalendarCheck2 />}{submitting ? labels.saving : labels.save}</Button>
            </ConciergeDialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
