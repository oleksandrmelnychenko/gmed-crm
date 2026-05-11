import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type AppointmentKind = "medical" | "non_medical" | "internal";
type CarePathKind = "regular" | "preventive" | "control" | "followup";

const TYPE_OPTIONS: AppointmentKind[] = ["medical", "non_medical", "internal"];
const CARE_PATH_KIND_OPTIONS: CarePathKind[] = [
  "regular",
  "preventive",
  "control",
  "followup",
];

function typeLabel(
  value: AppointmentKind,
  l: (de: string, ru: string, en: string) => string,
): string {
  switch (value) {
    case "medical":
      return l("Medizinisch", "Medicinskiy", "Medical");
    case "non_medical":
      return l("Nicht-medizinisch", "Nemedicinskiy", "Non-medical");
    case "internal":
      return l("Intern", "Vnutrenniy", "Internal");
  }
}

function carePathLabel(
  value: CarePathKind,
  l: (de: string, ru: string, en: string) => string,
): string {
  switch (value) {
    case "regular":
      return l("Regulaer", "Obychniy", "Regular");
    case "preventive":
      return l("Praeventiv", "Profilaktika", "Preventive");
    case "control":
      return l("Kontrolle", "Kontrol", "Control");
    case "followup":
      return l("Nachsorge", "Nablyudenie", "Follow-up");
  }
}

function todayDateString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type FormState = {
  title: string;
  appointmentType: AppointmentKind;
  carePathKind: CarePathKind;
  date: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  notes: string;
};

function blankForm(): FormState {
  return {
    title: "",
    appointmentType: "medical",
    carePathKind: "regular",
    date: todayDateString(),
    timeStart: "",
    timeEnd: "",
    location: "",
    notes: "",
  };
}

const appointmentTextareaClassName = cn(textareaClass, "min-h-[96px]");

export function PatientAppointmentSheet({
  patientId,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <PatientAppointmentSheetContent
      key={`${patientId}:${open ? "open" : "closed"}`}
      patientId={patientId}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function PatientAppointmentSheetContent({
  patientId,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error(l("Titel ist erforderlich.", "Nazvanie obyazatelno.", "Title required."));
      return;
    }
    if (!form.date) {
      toast.error(l("Datum ist erforderlich.", "Data obyazatelna.", "Date required."));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: patientId,
          provider_id: null,
          doctor_id: null,
          owner_user_id: null,
          interpreter_id: null,
          appointment_type: form.appointmentType,
          care_path_kind:
            form.appointmentType === "medical" ? form.carePathKind : "regular",
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          category: null,
          notes: form.notes.trim() || null,
          recurrence_frequency: null,
          recurrence_interval: null,
          recurrence_count: null,
          recurrence_until: null,
        }),
      });
      toast.success(l("Termin erstellt.", "Priyom sozdan.", "Appointment created."));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="narrow"
      onSubmit={handleSubmit}
      title={l("Neuer Termin", "Novyy priyom", "New appointment")}
      bodyClassName="px-4 py-4 space-y-4"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            {t.common_cancel}
          </Button>
          <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={busy}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t.common_save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-appointment-title"
        >
          {l("Titel", "Nazvanie", "Title")}
        </Label>
        <Input
          id="patient-appointment-title"
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          className={inputClass}
          required
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-appointment-type"
          >
            {l("Typ", "Tip", "Type")}
          </Label>
          <NativeComboboxSelect
            value={form.appointmentType}


            onChange={(event) => setForm((current) => ({
                ...current,
                appointmentType: (event.target.value as AppointmentKind) ?? current.appointmentType,
                carePathKind:
                  event.target.value === "medical" ? current.carePathKind : "regular",
              }))} id="patient-appointment-type" className={cn("w-full", selectClass)}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {typeLabel(option, l)}
                </option>
              ))}
            </NativeComboboxSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-appointment-care-path"
          >
            {l("Versorgungspfad", "Traektoriya lecheniya", "Care path")}
          </Label>
          <NativeComboboxSelect
            value={form.carePathKind}

            disabled={form.appointmentType !== "medical"}

            onChange={(event) => setForm((current) => ({
                ...current,
                carePathKind: (event.target.value as CarePathKind) ?? current.carePathKind,
              }))} id="patient-appointment-care-path" className={cn("w-full", selectClass)}>
              {CARE_PATH_KIND_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {carePathLabel(option, l)}
                </option>
              ))}
            </NativeComboboxSelect>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-appointment-date"
          >
            {l("Datum", "Data", "Date")}
          </Label>
          <Input
            id="patient-appointment-date"
            type="date"
            value={form.date}
            onChange={(event) =>
              setForm((current) => ({ ...current, date: event.target.value }))
            }
            className={inputClass}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-appointment-time-start"
          >
            {l("Beginn", "Nachalo", "Start")}
          </Label>
          <Input
            id="patient-appointment-time-start"
            type="time"
            value={form.timeStart}
            onChange={(event) =>
              setForm((current) => ({ ...current, timeStart: event.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="patient-appointment-time-end"
          >
            {l("Ende", "Okonchanie", "End")}
          </Label>
          <Input
            id="patient-appointment-time-end"
            type="time"
            value={form.timeEnd}
            onChange={(event) =>
              setForm((current) => ({ ...current, timeEnd: event.target.value }))
            }
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-appointment-location"
        >
          {l("Ort", "Mesto", "Location")}
        </Label>
        <Input
          id="patient-appointment-location"
          value={form.location}
          onChange={(event) =>
            setForm((current) => ({ ...current, location: event.target.value }))
          }
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-appointment-notes"
        >
          {l("Notizen", "Zametki", "Notes")}
        </Label>
        <textarea
          id="patient-appointment-notes"
          className={appointmentTextareaClassName}
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </div>
    </PatientSheetScaffold>
  );
}
