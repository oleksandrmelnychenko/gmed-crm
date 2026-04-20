import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

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
      return l("Medizinisch", "Медицинский", "Medical");
    case "non_medical":
      return l("Nicht-medizinisch", "Немедицинский", "Non-medical");
    case "internal":
      return l("Intern", "Внутренний", "Internal");
  }
}

function carePathLabel(
  value: CarePathKind,
  l: (de: string, ru: string, en: string) => string,
): string {
  switch (value) {
    case "regular":
      return l("Regulär", "Обычный", "Regular");
    case "preventive":
      return l("Präventiv", "Профилактика", "Preventive");
    case "control":
      return l("Kontrolle", "Контроль", "Control");
    case "followup":
      return l("Nachsorge", "Наблюдение", "Follow-up");
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

const textareaClassName =
  "min-h-[96px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

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
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(blankForm());
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error(l("Titel ist erforderlich.", "Название обязательно.", "Title required."));
      return;
    }
    if (!form.date) {
      toast.error(l("Datum ist erforderlich.", "Дата обязательна.", "Date required."));
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
      toast.success(l("Termin erstellt.", "Приём создан.", "Appointment created."));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] gap-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {l("Neuer Termin", "Новый приём", "New appointment")}
          </SheetTitle>
        </SheetHeader>
        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="patient-appointment-title"
              >
                {l("Titel", "Название", "Title")}
              </Label>
              <Input
                id="patient-appointment-title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="patient-appointment-type"
                >
                  {l("Typ", "Тип", "Type")}
                </Label>
                <ShadSelect
                  value={form.appointmentType}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      appointmentType: (value as AppointmentKind) ?? current.appointmentType,
                      carePathKind:
                        value === "medical" ? current.carePathKind : "regular",
                    }))
                  }
                >
                  <SelectTrigger id="patient-appointment-type" className="w-full">
                    <SelectValue>{typeLabel(form.appointmentType, l)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {typeLabel(option, l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="patient-appointment-care-path"
                >
                  {l("Versorgungspfad", "Траектория лечения", "Care path")}
                </Label>
                <ShadSelect
                  value={form.carePathKind}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      carePathKind: (value as CarePathKind) ?? current.carePathKind,
                    }))
                  }
                  disabled={form.appointmentType !== "medical"}
                >
                  <SelectTrigger id="patient-appointment-care-path" className="w-full">
                    <SelectValue>{carePathLabel(form.carePathKind, l)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CARE_PATH_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {carePathLabel(option, l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="patient-appointment-date"
                >
                  {l("Datum", "Дата", "Date")}
                </Label>
                <Input
                  id="patient-appointment-date"
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, date: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="patient-appointment-time-start"
                >
                  {l("Beginn", "Начало", "Start")}
                </Label>
                <Input
                  id="patient-appointment-time-start"
                  type="time"
                  value={form.timeStart}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, timeStart: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="patient-appointment-time-end"
                >
                  {l("Ende", "Окончание", "End")}
                </Label>
                <Input
                  id="patient-appointment-time-end"
                  type="time"
                  value={form.timeEnd}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, timeEnd: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="patient-appointment-location"
              >
                {l("Ort", "Место", "Location")}
              </Label>
              <Input
                id="patient-appointment-location"
                value={form.location}
                onChange={(event) =>
                  setForm((current) => ({ ...current, location: event.target.value }))
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="patient-appointment-notes"
              >
                {l("Notizen", "Заметки", "Notes")}
              </Label>
              <textarea
                id="patient-appointment-notes"
                className={textareaClassName}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 px-4 py-3">
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
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
