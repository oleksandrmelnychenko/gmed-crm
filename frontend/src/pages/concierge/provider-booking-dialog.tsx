import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CalendarCheck2, LoaderCircle, Mail, MapPinned, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiRequestError, apiFetch, clearApiCache } from "@/lib/api";
import { berlinLocalInputToIso, isoToBerlinLocalInput } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
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
  googleMapsDirectionsUrl,
  type ConciergePartnerChannel,
  type ConciergeProvider,
} from "./model";

/** The fields of a concierge service the partner booking reads. */
export type BookableConciergeService = {
  id: string;
  title: string;
  title_redacted?: boolean;
  status: string;
  billing_status: string;
  provider_id: string | null;
  provider_name: string | null;
  booking_reference: string | null;
  vendor_contact: string | null;
  service_address?: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

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

export type BookConciergeProviderResponse<TService = BookableConciergeService> = {
  service: TService;
  interaction_id: string;
};

/** Billing states after which a service is closed for new bookings. */
const CLOSED_BILLING_STATUSES = new Set(["billed", "settled", "waived", "reversed"]);

/**
 * Whether this person may book the partner for the service now: the server
 * lets the CEO and the concierge book a planned service ("Забронировано") and
 * confirm a requested booking ("Подтверждено") until the service is billed.
 */
export function canBookConciergeService(
  service: Pick<BookableConciergeService, "status" | "billing_status">,
  role: string | null | undefined,
): boolean {
  return (
    (role === "ceo" || role === "concierge") &&
    (service.status === "planned" || service.status === "booked") &&
    !CLOSED_BILLING_STATUSES.has(service.billing_status)
  );
}

const copy = {
  de: {
    book: "Beim Partner buchen",
    confirm: "Buchung bestätigen",
    title: "Buchung beim Partner",
    description: "Buchungsstand, Buchungsnummer und Kontakt beim Partner festhalten. Eine bestätigte Buchung setzt den Service auf „Bestätigt“.",
    provider: "Partner",
    chooseProvider: "Partner auswählen",
    providerFixed: "Der Service ist mit diesem Partner verknüpft.",
    state: "Buchungsstand",
    requested: "Angefragt",
    confirmed: "Bestätigt",
    alreadyRequested: "Die Buchung ist angefragt – jetzt kann sie bestätigt werden.",
    startsAt: "Beginn",
    endsAt: "Ende (optional)",
    address: "Serviceadresse",
    addressPlaceholder: "Straße, Ort, Land",
    contact: "Kontakt beim Partner",
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
    loading: "Wird geladen…",
    confirmedHint: "Für eine bestätigte Buchung ist eine Buchungsnummer, Kontaktperson oder Notiz erforderlich.",
    loadFailed: "Der Service konnte nicht geladen werden.",
    errors: {
      notBookable: "Nur geplante oder angefragte Services können gebucht werden.",
      alreadyRequested: "Die Buchung ist bereits angefragt – bestätigen Sie sie.",
      billingClosed: "Der Service ist abrechnungsseitig abgeschlossen und kann nicht mehr gebucht werden.",
      otherProvider: "Der Service ist bereits mit einem anderen Partner verknüpft.",
      taskClosed: "Die Aufgabe des Service ist geschlossen. Öffnen Sie sie erneut, um zu buchen.",
      taskHasChildren: "Eine Serviceaufgabe mit Unteraufgaben kann nicht zur Buchung werden.",
      provider: "Wählen Sie einen aktiven nicht-medizinischen Partner.",
      address: "Geben Sie die Serviceadresse an – beim Partner ist keine Adresse hinterlegt.",
      confirmedDetails: "Für eine bestätigte Buchung ist eine Buchungsnummer, Kontaktperson oder Notiz erforderlich.",
      endBeforeStart: "Das Ende muss nach dem Beginn liegen.",
      startRequired: "Geben Sie den Beginn an.",
      forbidden: "Sie dürfen diesen Service nicht buchen.",
      notFound: "Der Service wurde nicht gefunden.",
      failed: "Die Buchung konnte nicht gespeichert werden.",
    },
  },
  ru: {
    book: "Забронировать у партнёра",
    confirm: "Подтвердить бронь",
    title: "Бронирование у партнёра",
    description: "Зафиксируйте этап брони, номер брони и контакт партнёра. Подтверждённая бронь переводит сервис в статус «Подтверждено».",
    provider: "Партнёр",
    chooseProvider: "Выберите партнёра",
    providerFixed: "Сервис уже связан с этим партнёром.",
    state: "Этап брони",
    requested: "Запрошено",
    confirmed: "Подтверждено",
    alreadyRequested: "Бронь уже запрошена — теперь её можно подтвердить.",
    startsAt: "Начало",
    endsAt: "Окончание (необязательно)",
    address: "Адрес услуги",
    addressPlaceholder: "Улица, город, страна",
    contact: "Контакт партнёра",
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
    loading: "Загрузка…",
    confirmedHint: "Для подтверждённой брони укажите номер брони, контактное лицо или примечание.",
    loadFailed: "Не удалось загрузить сервис.",
    errors: {
      notBookable: "Бронировать можно только запланированный сервис или сервис с запрошенной бронью.",
      alreadyRequested: "Бронь уже запрошена — подтвердите её.",
      billingClosed: "Сервис закрыт в расчётах, бронирование больше невозможно.",
      otherProvider: "Сервис уже связан с другим партнёром.",
      taskClosed: "Задача сервиса закрыта. Откройте её снова, чтобы бронировать.",
      taskHasChildren: "Задачу сервиса с подзадачами нельзя превратить в бронь.",
      provider: "Выберите активного немедицинского партнёра.",
      address: "Укажите адрес услуги — у партнёра адрес не указан.",
      confirmedDetails: "Для подтверждённой брони укажите номер брони, контактное лицо или примечание.",
      endBeforeStart: "Окончание должно быть позже начала.",
      startRequired: "Укажите начало.",
      forbidden: "У вас нет прав бронировать этот сервис.",
      notFound: "Сервис не найден.",
      failed: "Не удалось сохранить бронь.",
    },
  },
} as const;

const SERVER_ERROR_KEYS: Record<string, keyof (typeof copy)["ru"]["errors"]> = {
  "Only planned or booked services can enter the booking flow": "notBookable",
  "Booking was already requested; confirm it instead": "alreadyRequested",
  "Closed billing service cannot be booked": "billingClosed",
  "Service is already linked to a different provider": "otherProvider",
  "The service task is closed; reopen it before booking": "taskClosed",
  "A service task with sub-tasks cannot become a booked event": "taskHasChildren",
  "provider_id must reference an active non-medical provider": "provider",
  "service_address is required when provider address is unavailable": "address",
  "Confirmed booking requires a reference, contact person, or note": "confirmedDetails",
  "ends_at must be later than starts_at": "endBeforeStart",
  "starts_at is required (RFC3339)": "startRequired",
  "Concierge service not found": "notFound",
};

/** The booking refusal in the UI language; the server answers in English. */
export function conciergeBookingErrorMessage(error: unknown, lang: Lang): string {
  const errors = copy[lang].errors;
  const message = error instanceof Error ? error.message : "";
  const key = SERVER_ERROR_KEYS[message];
  if (key) return errors[key];
  const status = error instanceof ApiRequestError ? error.status : undefined;
  if (status === 403) return errors.forbidden;
  if (status === 404) return errors.notFound;
  return errors.failed;
}

/** Label of the action: book a planned service, confirm a requested booking. */
export function conciergeBookingActionLabel(status: string, lang: Lang): string {
  return status === "booked" ? copy[lang].confirm : copy[lang].book;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-field px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

function localDateTimeValue(value: string | null) {
  return value ? isoToBerlinLocalInput(value) : "";
}

function optional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

/**
 * Books the partner of a concierge service, or confirms a requested booking.
 * Opened from the service detail (/services), the appointment "Сервисы" tab
 * and a service task in the task manager. Pass the service when the caller
 * has it; with only `serviceId` the dialog loads it.
 */
export function ConciergeProviderBookingDialog<TService extends BookableConciergeService>({
  service: serviceProp,
  serviceId,
  lang,
  open,
  onOpenChange,
  onBooked,
}: {
  service?: TService | null;
  serviceId?: string | null;
  lang: Lang;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBooked: (service: TService) => void;
}) {
  const labels = copy[lang];
  const [loadedService, setLoadedService] = useState<TService | null>(null);
  const [loadError, setLoadError] = useState("");
  const [providers, setProviders] = useState<ConciergeProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [bookingState, setBookingState] = useState<"requested" | "confirmed">("requested");
  const [channel, setChannel] = useState<ConciergePartnerChannel>("phone");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [vendorContact, setVendorContact] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const service = serviceProp ?? loadedService;
  const targetServiceId = serviceProp?.id ?? serviceId ?? null;

  useEffect(() => {
    if (!open || serviceProp || !serviceId) return;
    let cancelled = false;
    setLoadedService(null);
    setLoadError("");
    apiFetch<TService>(`/concierge-services/${serviceId}`, { forceFresh: true })
      .then((row) => {
        if (!cancelled) setLoadedService(row);
      })
      .catch(() => {
        if (!cancelled) setLoadError(copy[lang].loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, open, serviceId, serviceProp]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProvidersLoading(true);
    apiFetch<ConciergeProvider[]>("/providers?provider_type=non_medical&active_only=true")
      .then((rows) => {
        if (!cancelled) setProviders(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // A fresh form (and request id) each time the dialog opens for a service.
  useEffect(() => {
    if (!open || !service) return;
    setRequestId(crypto.randomUUID());
    setProviderId(service.provider_id ?? "");
    setBookingState(service.status === "booked" ? "confirmed" : "requested");
    setChannel("phone");
    setStartsAt(localDateTimeValue(service.starts_at));
    setEndsAt(localDateTimeValue(service.ends_at));
    setServiceAddress(service.service_address ?? "");
    setVendorContact(service.vendor_contact ?? "");
    setContactPerson("");
    setBookingReference(service.booking_reference ?? "");
    setNote("");
    setError("");
    setSubmitting(false);
  }, [open, service?.id]);

  const provider = useMemo(
    () => providers.find((item) => item.id === providerId) ?? null,
    [providerId, providers],
  );
  const providerFixed = Boolean(service?.provider_id);
  const providerAddress = conciergeProviderAddress(provider);
  const effectiveAddress = serviceAddress.trim() || providerAddress;
  const callUrl = conciergePartnerPhoneUrl(provider?.phone ?? null);
  const emailUrl = conciergePartnerEmailUrl(provider?.email ?? null);
  const directionsUrl = googleMapsDirectionsUrl(effectiveAddress);
  const confirmedDetailsMissing =
    bookingState === "confirmed" && !bookingReference.trim() && !contactPerson.trim() && !note.trim();
  const canSubmit =
    Boolean(service && providerId && requestId && startsAt && effectiveAddress) &&
    !confirmedDetailsMissing &&
    !submitting;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const startsAtIso = berlinLocalInputToIso(startsAt);
    if (!service || !targetServiceId || !canSubmit || !startsAtIso) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await apiFetch<BookConciergeProviderResponse<TService>>(
        `/concierge-services/${targetServiceId}/book-provider`,
        {
          method: "POST",
          body: JSON.stringify({
            request_id: requestId,
            provider_id: providerId,
            booking_state: bookingState,
            channel,
            contact_person: optional(contactPerson),
            vendor_contact: optional(vendorContact),
            booking_reference: optional(bookingReference),
            starts_at: startsAtIso,
            ends_at: berlinLocalInputToIso(endsAt),
            service_address: effectiveAddress,
            note: optional(note),
          } satisfies BookConciergeProviderInput),
        },
      );
      clearApiCache("/concierge-services");
      clearApiCache("/concierge-operational-items");
      onBooked(response.service);
      onOpenChange(false);
    } catch (bookingFailure) {
      setError(conciergeBookingErrorMessage(bookingFailure, lang));
    } finally {
      setSubmitting(false);
    }
  }

  const serviceTitle = service && !service.title_redacted ? service.title : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader
          icon={CalendarCheck2}
          tone="orange"
          title={labels.title}
          description={serviceTitle ? `${serviceTitle} · ${labels.description}` : labels.description}
        />
        {!service ? (
          <ConciergeDialogBody>
            <p className="rounded-lg border border-dashed border-border px-4 py-14 text-center text-sm text-muted-foreground">
              {loadError || labels.loading}
            </p>
          </ConciergeDialogBody>
        ) : (
          <form className="flex min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
            <ConciergeDialogBody>
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
                <div className="space-y-4">
                  <ConciergeDialogSection title={labels.provider} icon={CalendarCheck2}>
                    <div className="space-y-3">
                      <ConciergeField label={labels.provider}>
                        <NativeComboboxSelect
                          className={selectClass}
                          value={providerId}
                          disabled={providerFixed || providersLoading}
                          required
                          onChange={(event) => setProviderId(event.target.value)}
                        >
                          <option value="" disabled>
                            {providersLoading ? labels.loading : labels.chooseProvider}
                          </option>
                          {providerFixed && !provider && service.provider_id ? (
                            <option value={service.provider_id}>{service.provider_name ?? service.provider_id}</option>
                          ) : null}
                          {providers.map((item) => (
                            <option key={item.id} value={item.id}>
                              {[item.name, item.address_city].filter(Boolean).join(" · ")}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </ConciergeField>
                      {providerFixed ? <p className="text-xs text-muted-foreground">{labels.providerFixed}</p> : null}
                      {provider ? (
                        <div className="grid grid-cols-3 gap-2">
                          <Button nativeButton={false} render={<a href={callUrl ?? "#"} />} variant="outline" size="sm" disabled={!callUrl}><Phone />{labels.call}</Button>
                          <Button nativeButton={false} render={<a href={emailUrl ?? "#"} />} variant="outline" size="sm" disabled={!emailUrl}><Mail />{labels.write}</Button>
                          <Button nativeButton={false} render={<a href={directionsUrl ?? "#"} target="_blank" rel="noreferrer" />} variant="outline" size="sm" disabled={!directionsUrl}><MapPinned />{labels.route}</Button>
                        </div>
                      ) : null}
                    </div>
                  </ConciergeDialogSection>

                  <ConciergeDialogSection title={labels.state} icon={CalendarCheck2}>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label={labels.state}>
                      {(["requested", "confirmed"] as const).map((state) => (
                        <Button
                          key={state}
                          type="button"
                          variant={bookingState === state ? "default" : "outline"}
                          aria-pressed={bookingState === state}
                          disabled={state === "requested" && service.status === "booked"}
                          onClick={() => setBookingState(state)}
                        >
                          {labels[state]}
                        </Button>
                      ))}
                    </div>
                    {service.status === "booked" ? (
                      <p className="mt-2 text-xs text-muted-foreground">{labels.alreadyRequested}</p>
                    ) : null}
                  </ConciergeDialogSection>
                </div>

                <ConciergeDialogSection title={labels.title} icon={CalendarCheck2}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ConciergeField label={labels.startsAt}>
                      <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
                    </ConciergeField>
                    <ConciergeField label={labels.endsAt}>
                      <Input type="datetime-local" value={endsAt} min={startsAt || undefined} onChange={(event) => setEndsAt(event.target.value)} />
                    </ConciergeField>
                    <ConciergeField label={labels.address} className="sm:col-span-2">
                      <Input
                        value={serviceAddress}
                        onChange={(event) => setServiceAddress(event.target.value)}
                        placeholder={providerAddress || labels.addressPlaceholder}
                        maxLength={500}
                        required={!providerAddress}
                      />
                    </ConciergeField>
                    <ConciergeField label={labels.contact}>
                      <Input
                        value={vendorContact}
                        onChange={(event) => setVendorContact(event.target.value)}
                        placeholder={provider?.phone || provider?.email || ""}
                        maxLength={255}
                      />
                    </ConciergeField>
                    <ConciergeField label={labels.contactPerson}>
                      <Input value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} maxLength={160} />
                    </ConciergeField>
                    <ConciergeField label={labels.reference}>
                      <Input value={bookingReference} onChange={(event) => setBookingReference(event.target.value)} maxLength={160} />
                    </ConciergeField>
                    <ConciergeField label={labels.channel}>
                      <select className={selectClass} value={channel} onChange={(event) => setChannel(event.target.value as ConciergePartnerChannel)}>
                        {(["phone", "email", "messaging", "in_person", "other"] as const).map((item) => (
                          <option key={item} value={item}>{labels[item]}</option>
                        ))}
                      </select>
                    </ConciergeField>
                    <ConciergeField label={labels.note} className="sm:col-span-2">
                      <textarea
                        className="min-h-24 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={labels.notePlaceholder}
                        maxLength={2000}
                      />
                    </ConciergeField>
                  </div>
                  {confirmedDetailsMissing ? (
                    <p className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      {labels.confirmedHint}
                    </p>
                  ) : null}
                  {error ? (
                    <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      {error}
                    </p>
                  ) : null}
                </ConciergeDialogSection>
              </div>
            </ConciergeDialogBody>
            <ConciergeDialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? <LoaderCircle className="animate-spin" /> : <CalendarCheck2 />}
                {submitting ? labels.saving : labels.save}
              </Button>
            </ConciergeDialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const keepBookingCopy = {
  de: {
    hint: "Der Termin wurde abgesagt – prüfen Sie die Buchung beim Partner: behalten oder den Service stornieren.",
    keep: "Buchung behalten",
    failed: "Die Buchung konnte nicht behalten werden.",
  },
  ru: {
    hint: "Приём отменён — проверьте бронь у партнёра: сохраните её или отмените сервис.",
    keep: "Сохранить бронирование",
    failed: "Не удалось сохранить бронирование.",
  },
} as const;

/**
 * After its appointment was cancelled, a service booked with a partner waits
 * for a decision: keep the booking (this action) or cancel the service.
 */
export function ConciergeKeepBookingAction<TService extends BookableConciergeService>({
  service,
  lang,
  onKept,
}: {
  service: TService & { booking_decision_required_at?: string | null };
  lang: Lang;
  onKept: (service: TService) => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labels = keepBookingCopy[lang];
  if (!service.booking_decision_required_at) return null;
  if (!["ceo", "patient_manager", "concierge"].includes(user?.role ?? "")) return null;

  async function keep() {
    setBusy(true);
    setError("");
    try {
      const updated = await apiFetch<TService>(`/concierge-services/${service.id}/keep-booking`, { method: "POST" });
      clearApiCache("/concierge-services");
      onKept(updated);
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span className="min-w-0 flex-1">{error || labels.hint}</span>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void keep()}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
        {labels.keep}
      </Button>
    </div>
  );
}

/**
 * The booking action of a service task in the task manager: loads the task's
 * service (only for the roles that may book) and offers the booking while the
 * service is planned or booked.
 */
export function ConciergeServiceBookingActionById({
  serviceId,
  lang,
  onBooked,
}: {
  serviceId: string;
  lang: Lang;
  onBooked?: (service: BookableConciergeService) => void;
}) {
  const { user } = useAuth();
  const mayBook = user?.role === "ceo" || user?.role === "concierge";
  const [service, setService] = useState<BookableConciergeService | null>(null);

  useEffect(() => {
    setService(null);
    if (!mayBook) return;
    let cancelled = false;
    apiFetch<BookableConciergeService>(`/concierge-services/${serviceId}`, { forceFresh: true })
      .then((row) => {
        if (!cancelled) setService(row);
      })
      .catch(() => {
        if (!cancelled) setService(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mayBook, serviceId]);

  if (!service) return null;
  return (
    <ConciergeProviderBookingAction
      service={service}
      lang={lang}
      onBooked={(updated) => {
        setService(updated);
        onBooked?.(updated);
      }}
    />
  );
}

/**
 * The booking action of a concierge service: shown to the CEO and the
 * concierge while the service is planned (book) or booked (confirm).
 */
export function ConciergeProviderBookingAction<TService extends BookableConciergeService>({
  service,
  lang,
  onBooked,
  size = "sm",
  className,
}: {
  service: TService;
  lang: Lang;
  onBooked: (service: TService) => void;
  size?: "sm" | "default";
  className?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canBookConciergeService(service, user?.role)) return null;
  return (
    <>
      <Button type="button" size={size} variant="outline" className={className} onClick={() => setOpen(true)}>
        <CalendarCheck2 className="size-3.5" />
        {conciergeBookingActionLabel(service.status, lang)}
      </Button>
      <ConciergeProviderBookingDialog
        service={service}
        lang={lang}
        open={open}
        onOpenChange={setOpen}
        onBooked={onBooked}
      />
    </>
  );
}
