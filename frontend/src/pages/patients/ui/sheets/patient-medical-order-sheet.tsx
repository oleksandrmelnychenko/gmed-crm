import { useEffect, useState, type FormEvent } from "react";
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

const ORDER_TYPE_OPTIONS = [
  "physiotherapy",
  "diet",
  "lab_recheck",
  "imaging",
  "medication_followup",
  "procedure",
  "other",
] as const;

type OrderType = (typeof ORDER_TYPE_OPTIONS)[number];

function orderTypeLabel(
  value: string,
  l: (de: string, ru: string, en: string) => string,
): string {
  switch (value) {
    case "physiotherapy":
      return l("Physiotherapie", "Fizioterapiya", "Physiotherapy");
    case "diet":
      return l("Ernaehrung", "Dieta", "Diet");
    case "lab_recheck":
      return l("Laborkontrolle", "Povtornyy analiz", "Lab recheck");
    case "imaging":
      return l("Bildgebung", "Vizualizaciya", "Imaging");
    case "medication_followup":
      return l("Medikationskontrolle", "Kontrol medikacii", "Medication follow-up");
    case "procedure":
      return l("Eingriff", "Procedura", "Procedure");
    case "other":
      return l("Sonstiges", "Drugoe", "Other");
    default:
      return value.replaceAll("_", " ");
  }
}

function toLocalDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type FormState = {
  orderDate: string;
  orderType: OrderType;
  title: string;
  instructions: string;
  dueDate: string;
  source: string;
};

function blankForm(): FormState {
  return {
    orderDate: toLocalDateTimeInput(new Date()),
    orderType: ORDER_TYPE_OPTIONS[0],
    title: "",
    instructions: "",
    dueDate: "",
    source: "",
  };
}

const medicalOrderTextareaClassName = cn(textareaClass, "min-h-[96px]");

export function PatientMedicalOrderSheet({
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
    if (!open) setForm(blankForm());
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const orderDate = new Date(form.orderDate);
    if (Number.isNaN(orderDate.getTime())) {
      toast.error(l("Ungueltiges Datum.", "Nekorrektnaya data.", "Invalid date."));
      return;
    }
    if (!form.title.trim()) {
      toast.error(l("Titel ist erforderlich.", "Nazvanie obyazatelno.", "Title required."));
      return;
    }
    if (!form.instructions.trim()) {
      toast.error(l("Anweisungen erforderlich.", "Instrukcii obyazatelny.", "Instructions required."));
      return;
    }

    setBusy(true);
    try {
      await apiFetch(`/patients/${patientId}/medical-orders`, {
        method: "POST",
        body: JSON.stringify({
          order_date: orderDate.toISOString(),
          order_type: form.orderType,
          title: form.title.trim(),
          instructions: form.instructions.trim(),
          due_date: form.dueDate || null,
          source: form.source.trim() || null,
        }),
      });
      toast.success(l("Anordnung gespeichert.", "Naznachenie sohraneno.", "Order saved."));
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
      maxWidthClassName="sm:max-w-[540px]"
      onSubmit={handleSubmit}
      title={l("Medizinische Anordnung hinzufugen", "Dobavit medicinskoe naznachenie", "Add medical order")}
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
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-date">
            {l("Anordnungsdatum", "Data naznacheniya", "Order date")}
          </Label>
          <Input
            id="patient-medical-order-date"
            type="datetime-local"
            value={form.orderDate}
            onChange={(event) =>
              setForm((current) => ({ ...current, orderDate: event.target.value }))
            }
            className={inputClass}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-type">
            {l("Anordnungstyp", "Tip naznacheniya", "Order type")}
          </Label>
          <NativeComboboxSelect
            value={form.orderType}


            onChange={(event) => setForm((current) => ({
                ...current,
                orderType: (event.target.value ?? ORDER_TYPE_OPTIONS[0]) as OrderType,
              }))} id="patient-medical-order-type" className={cn("w-full", selectClass)}>
              {ORDER_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {orderTypeLabel(option, l)}
                </option>
              ))}
            </NativeComboboxSelect>
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-title">
            {l("Titel", "Nazvanie", "Title")}
          </Label>
          <Input
            id="patient-medical-order-title"
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            className={inputClass}
            placeholder={l("Physiotherapie 2x pro Woche", "Fizioterapiya 2 raza v nedelyu", "Physiotherapy 2x per week")}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-due-date">
            {l("Faelligkeitsdatum", "Srok", "Due date")}
          </Label>
          <Input
            id="patient-medical-order-due-date"
            type="date"
            value={form.dueDate}
            onChange={(event) =>
              setForm((current) => ({ ...current, dueDate: event.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-source">
            {l("Quelle", "Istochnik", "Source")}
          </Label>
          <Input
            id="patient-medical-order-source"
            value={form.source}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            className={inputClass}
            placeholder={l("Arzt, Klinik, Entlassungsbericht", "Vrach, klinika, vypiska", "Doctor, clinic, discharge note")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-instructions">
          {l("Anweisungen", "Instrukcii", "Instructions")}
        </Label>
        <textarea
          id="patient-medical-order-instructions"
          className={medicalOrderTextareaClassName}
          value={form.instructions}
          onChange={(event) =>
            setForm((current) => ({ ...current, instructions: event.target.value }))
          }
          required
        />
      </div>
    </PatientSheetScaffold>
  );
}
