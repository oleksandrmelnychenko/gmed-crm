import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ClipboardPenLine, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import type { Lang } from "@/lib/i18n";

import {
  availableConciergeServiceStatuses,
  type ConciergeService,
  type ConciergeServiceStatus,
} from "./model";
import {
  ConciergeDialogBody,
  ConciergeDialogFooter,
  ConciergeDialogHeader,
  ConciergeDialogSection,
  ConciergeField,
  conciergeDialogContentClassName,
} from "./dialog-layout";

const copy = {
  de: {
    title: "Anfrage bearbeiten",
    description: "Status und operative Details dieser Concierge-Anfrage aktualisieren.",
    request: "Anfrage",
    requestTitle: "Bezeichnung",
    patient: "Patient",
    status: "Status",
    planned: "Geplant",
    booked: "Gebucht",
    confirmed: "Bestätigt",
    in_service: "In Durchführung",
    completed: "Abgeschlossen",
    cancelled: "Storniert",
    bookingHint: "Gebucht und Bestätigt werden über den Partner- und Buchungsablauf gesetzt.",
    provider: "Partner / Dienstleister",
    contact: "Kontakt",
    startsAt: "Beginn",
    endsAt: "Ende",
    address: "Ort oder Adresse",
    actualCost: "Ist-Kosten",
    notes: "Operative Notiz",
    details: "Operative Details",
    cancel: "Abbrechen",
    save: "Speichern",
    saving: "Wird gespeichert",
  },
  ru: {
    title: "Изменить запрос",
    description: "Обновите статус и операционные данные запроса консьерж-сервиса.",
    request: "Запрос",
    requestTitle: "Название",
    patient: "Пациент",
    status: "Статус",
    planned: "Запланировано",
    booked: "Забронировано",
    confirmed: "Подтверждено",
    in_service: "Выполняется",
    completed: "Завершено",
    cancelled: "Отменено",
    bookingHint: "Статусы «Забронировано» и «Подтверждено» устанавливаются через работу с партнёром и бронированием.",
    provider: "Партнёр или исполнитель",
    contact: "Контакт",
    startsAt: "Начало",
    endsAt: "Окончание",
    address: "Место или адрес",
    actualCost: "Фактические затраты",
    notes: "Операционная заметка",
    details: "Операционные данные",
    cancel: "Отмена",
    save: "Сохранить",
    saving: "Сохранение",
  },
} as const;

type EditableStatus = "planned" | "booked" | "confirmed" | "in_service" | "completed" | "cancelled";

export type UpdateConciergeServiceInput = {
  expected_updated_at: string;
  title?: string;
  status?: EditableStatus;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  service_address: string | null;
  actual_cost: number | null;
  service_notes: string | null;
};

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function optional(value: string) {
  return value.trim() || null;
}

export function requestStatusOptions(
  lang: Lang,
  service?: Pick<ConciergeService, "status">,
  canReopen = false,
): SelectFieldOption[] {
  const labels = copy[lang];
  const allowed = new Set<ConciergeServiceStatus>(
    service
      ? availableConciergeServiceStatuses(service, canReopen)
      : ["planned", "in_service", "completed", "cancelled"],
  );
  return (["planned", "booked", "confirmed", "in_service", "completed", "cancelled"] as const).map((value) => ({
    value,
    label: labels[value],
    disabled: !allowed.has(value),
  }));
}

export function ConciergeServiceRequestDialog({
  service,
  lang,
  open,
  submitting,
  error,
  canEditTitle,
  canReopen,
  onOpenChange,
  onSave,
}: {
  service: ConciergeService | null;
  lang: Lang;
  open: boolean;
  submitting: boolean;
  error: string;
  canEditTitle: boolean;
  canReopen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpdateConciergeServiceInput) => Promise<void>;
}) {
  const labels = copy[lang];
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<EditableStatus>("planned");
  const [vendorName, setVendorName] = useState("");
  const [vendorContact, setVendorContact] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [address, setAddress] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !service) return;
    setTitle(service.title);
    setStatus(service.status as EditableStatus);
    setVendorName(service.vendor_name ?? service.provider_name ?? "");
    setVendorContact(service.vendor_contact ?? "");
    setStartsAt(localDateTimeValue(service.starts_at));
    setEndsAt(localDateTimeValue(service.ends_at));
    setAddress(service.service_address ?? "");
    setActualCost(service.actual_cost ?? "");
    setNotes(service.service_notes ?? "");
  }, [open, service]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!service || !title.trim() || submitting) return;
    const nextStatus = status === service.status ? undefined : status;
    await onSave({
      expected_updated_at: service.updated_at,
      ...(canEditTitle ? { title: title.trim() } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      vendor_name: optional(vendorName),
      vendor_contact: optional(vendorContact),
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      service_address: optional(address),
      actual_cost: actualCost.trim() ? Number(actualCost) : null,
      service_notes: optional(notes),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader
          icon={ClipboardPenLine}
          tone="plain"
          title={labels.title}
          description={labels.description}
          meta={service ? <Badge variant="secondary" className="rounded-full font-mono">#{service.id.slice(0, 8)}</Badge> : null}
        />
        <form className="flex min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
          <ConciergeDialogBody>
            <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
              <ConciergeDialogSection title={labels.request}>
                <div className="space-y-3">
                  <ConciergeField label={labels.patient}>
                    <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-sm">
                      <span className="font-medium">{service?.patient_name ?? "—"}</span>
                      {service?.patient_pid ? <span className="ml-2 font-mono text-xs text-muted-foreground">{service.patient_pid}</span> : null}
                    </div>
                  </ConciergeField>
                  <ConciergeField label={labels.requestTitle}>
                    <Input value={title} disabled={!canEditTitle} maxLength={255} required onChange={(event) => setTitle(event.target.value)} />
                  </ConciergeField>
                  <ConciergeField label={labels.status}>
                    <SelectField value={status} options={requestStatusOptions(lang, service ?? undefined, canReopen)} onValueChange={(value) => setStatus(value as EditableStatus)} />
                  </ConciergeField>
                  <p className="text-xs leading-5 text-muted-foreground">{labels.bookingHint}</p>
                </div>
              </ConciergeDialogSection>

              <ConciergeDialogSection title={labels.details}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ConciergeField label={labels.provider}><Input value={vendorName} maxLength={255} onChange={(event) => setVendorName(event.target.value)} /></ConciergeField>
                  <ConciergeField label={labels.contact}><Input value={vendorContact} maxLength={255} onChange={(event) => setVendorContact(event.target.value)} /></ConciergeField>
                  <ConciergeField label={labels.startsAt}><Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></ConciergeField>
                  <ConciergeField label={labels.endsAt}><Input type="datetime-local" min={startsAt || undefined} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></ConciergeField>
                  <ConciergeField label={labels.address} className="sm:col-span-2"><Input value={address} maxLength={500} onChange={(event) => setAddress(event.target.value)} /></ConciergeField>
                  <ConciergeField label={labels.actualCost}>
                    <div className="flex gap-2"><Input type="number" min="0" step="0.01" value={actualCost} onChange={(event) => setActualCost(event.target.value)} /><span className="flex h-9 items-center rounded-lg border border-border/70 bg-muted/25 px-3 text-sm text-muted-foreground">{service?.currency || "EUR"}</span></div>
                  </ConciergeField>
                  <ConciergeField label={labels.notes} className="sm:col-span-2">
                    <textarea className="min-h-28 w-full resize-y rounded-lg border border-input bg-field px-3 py-2 text-sm text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
                  </ConciergeField>
                </div>
                {error ? <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
              </ConciergeDialogSection>
            </div>
          </ConciergeDialogBody>
          <ConciergeDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" disabled={!service || !title.trim() || submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <ClipboardPenLine />}{submitting ? labels.saving : labels.save}</Button>
          </ConciergeDialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
