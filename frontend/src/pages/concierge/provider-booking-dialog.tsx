import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CalendarCheck2, LoaderCircle, Mail, MapPinned, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";

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
    noServices: "Keine geplante Serviceanfrage kann mit diesem Partner verbunden werden.",
    confirmedHint: "Für eine bestätigte Buchung ist eine Buchungsnummer, Kontaktperson oder Notiz erforderlich.",
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
    noServices: "Нет запланированного запроса, который можно связать с этим партнёром.",
    confirmedHint: "Для подтверждённой брони укажите номер, контактное лицо или примечание.",
  },
} as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

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
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:max-h-[88vh] sm:w-full sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarCheck2 className="size-5 text-primary" />{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {provider ? (
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{provider.name}</p>
                <p className="truncate text-xs text-muted-foreground">{conciergeProviderAddress(provider)}</p>
              </div>
              <Badge variant="secondary">{provider.open_concierge_service_count}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <Button nativeButton={false} render={<a href={callUrl ?? "#"} />} variant="outline" size="sm" disabled={!callUrl}><Phone />{labels.call}</Button>
              <Button nativeButton={false} render={<a href={emailUrl ?? "#"} />} variant="outline" size="sm" disabled={!emailUrl}><Mail />{labels.write}</Button>
              <Button nativeButton={false} render={<a href={directionsUrl ?? "#"} target="_blank" rel="noreferrer" />} variant="outline" size="sm" disabled={!directionsUrl}><MapPinned />{labels.route}</Button>
            </div>
          </div>
        ) : null}

        {eligibleServices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{labels.noServices}</p>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <label className="grid gap-1.5 text-sm font-medium">
              {labels.service}
              <select className={selectClass} value={serviceId} onChange={(event) => selectService(event.target.value)} required>
                <option value="" disabled>{labels.chooseService}</option>
                {eligibleServices.map((service) => <option key={service.id} value={service.id}>{conciergeServiceDisplayTitle(service, lang)} · {service.patient_name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={labels.title}>
              {(["requested", "confirmed"] as const).map((state) => (
                <Button key={state} type="button" variant={bookingState === state ? "secondary" : "outline"} aria-pressed={bookingState === state} onClick={() => setBookingState(state)}>
                  {labels[state]}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">{labels.startsAt}<Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
              <label className="grid gap-1.5 text-sm font-medium">{labels.endsAt}<Input type="datetime-local" value={endsAt} min={startsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">{labels.address}<Input value={serviceAddress} onChange={(event) => setServiceAddress(event.target.value)} placeholder={labels.addressPlaceholder} maxLength={500} required /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">{labels.contact}<Input value={vendorContact} onChange={(event) => setVendorContact(event.target.value)} maxLength={255} /></label>
              <label className="grid gap-1.5 text-sm font-medium">{labels.contactPerson}<Input value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} maxLength={160} /></label>
              <label className="grid gap-1.5 text-sm font-medium">{labels.reference}<Input value={bookingReference} onChange={(event) => setBookingReference(event.target.value)} maxLength={160} /></label>
              <label className="grid gap-1.5 text-sm font-medium">
                {labels.channel}
                <select className={selectClass} value={channel} onChange={(event) => setChannel(event.target.value as ConciergePartnerChannel)}>
                  {(["phone", "email", "messaging", "in_person", "other"] as const).map((item) => <option key={item} value={item}>{labels[item]}</option>)}
                </select>
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              {labels.note}
              <textarea className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" value={note} onChange={(event) => setNote(event.target.value)} placeholder={labels.notePlaceholder} maxLength={2000} />
            </label>
            {confirmedDetailsMissing ? <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertCircle className="mt-0.5 size-4 shrink-0" />{labels.confirmedHint}</p> : null}
            {error ? <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
            <Button type="submit" className="w-full" disabled={!canSubmit}>{submitting ? <LoaderCircle className="animate-spin" /> : <CalendarCheck2 />}{submitting ? labels.saving : labels.save}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
