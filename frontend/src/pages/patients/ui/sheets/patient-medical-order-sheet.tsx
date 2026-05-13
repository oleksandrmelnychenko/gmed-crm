import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Field as FormField,
  Section as FormSection,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { formatUnknownValue, useLang } from "@/lib/i18n";
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
  l: (key: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
): string {
  switch (value) {
    case "physiotherapy":
      return l("patients_physiotherapy");
    case "diet":
      return l("patients_diet");
    case "lab_recheck":
      return l("patients_lab_recheck");
    case "imaging":
      return l("patients_imaging");
    case "medication_followup":
      return l("patients_medication_follow_up");
    case "procedure":
      return l("patients_procedure");
    case "other":
      return l("patients_other_2");
    default:
      return formatUnknownValue(value, translations);
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setForm(blankForm());
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const orderDate = new Date(form.orderDate);
    if (Number.isNaN(orderDate.getTime())) {
      toast.error(l("patients_invalid_date_2"));
      return;
    }
    if (!form.title.trim()) {
      toast.error(l("patients_title_required"));
      return;
    }
    if (!form.instructions.trim()) {
      toast.error(l("patients_instructions_required"));
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
      toast.success(l("patients_order_saved"));
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
      title={l("patients_add_medical_order")}
      bodyClassName="px-4 py-4 space-y-3"
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
      <FormSection title={l("patients_order_2")}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField
            label={l("patients_order_date_2")}
            htmlFor="patient-medical-order-date"
          >
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
          </FormField>
          <FormField
            label={l("patients_order_type")}
            htmlFor="patient-medical-order-type"
          >
            <NativeComboboxSelect
              id="patient-medical-order-type"
              value={form.orderType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  orderType: (event.target.value ?? ORDER_TYPE_OPTIONS[0]) as OrderType,
                }))
              }
              className={cn("w-full", selectClass)}
            >
              {ORDER_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {orderTypeLabel(option, l, t)}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>
        </div>

        <FormField label={l("patients_title")} htmlFor="patient-medical-order-title">
          <Input
            id="patient-medical-order-title"
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            className={inputClass}
            placeholder={l("patients_physiotherapy_2x_per_week")}
            required
          />
        </FormField>
      </FormSection>

      <FormSection title={l("appointments_coordination")}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField
            label={l("patients_due_date_2")}
            htmlFor="patient-medical-order-due-date"
          >
            <Input
              id="patient-medical-order-due-date"
              type="date"
              value={form.dueDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, dueDate: event.target.value }))
              }
              className={inputClass}
            />
          </FormField>
          <FormField label={l("patients_source")} htmlFor="patient-medical-order-source">
            <Input
              id="patient-medical-order-source"
              value={form.source}
              onChange={(event) =>
                setForm((current) => ({ ...current, source: event.target.value }))
              }
              className={inputClass}
              placeholder={l("patients_doctor_clinic_discharge_note")}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={l("patients_details")}>
        <FormField
          label={l("patients_instructions")}
          htmlFor="patient-medical-order-instructions"
        >
          <textarea
            id="patient-medical-order-instructions"
            className={medicalOrderTextareaClassName}
            value={form.instructions}
            onChange={(event) =>
              setForm((current) => ({ ...current, instructions: event.target.value }))
            }
            required
          />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}
