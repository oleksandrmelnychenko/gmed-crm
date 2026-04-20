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
      return l("Physiotherapie", "Физиотерапия", "Physiotherapy");
    case "diet":
      return l("Ernährung", "Диета", "Diet");
    case "lab_recheck":
      return l("Laborkontrolle", "Повторный анализ", "Lab recheck");
    case "imaging":
      return l("Bildgebung", "Визуализация", "Imaging");
    case "medication_followup":
      return l("Medikationskontrolle", "Контроль медикации", "Medication follow-up");
    case "procedure":
      return l("Eingriff", "Процедура", "Procedure");
    case "other":
      return l("Sonstiges", "Другое", "Other");
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

const textareaClassName =
  "min-h-[96px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

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
      toast.error(l("Ungültiges Datum.", "Некорректная дата.", "Invalid date."));
      return;
    }
    if (!form.title.trim()) {
      toast.error(l("Titel ist erforderlich.", "Название обязательно.", "Title required."));
      return;
    }
    if (!form.instructions.trim()) {
      toast.error(l("Anweisungen erforderlich.", "Инструкции обязательны.", "Instructions required."));
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
      toast.success(l("Anordnung gespeichert.", "Назначение сохранено.", "Order saved."));
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
      <SheetContent side="right" className="w-full sm:max-w-[540px] gap-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {l("Medizinische Anordnung hinzufügen", "Добавить медицинское назначение", "Add medical order")}
          </SheetTitle>
        </SheetHeader>
        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-date">
                  {l("Anordnungsdatum", "Дата назначения", "Order date")}
                </Label>
                <Input
                  id="patient-medical-order-date"
                  type="datetime-local"
                  value={form.orderDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, orderDate: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-type">
                  {l("Anordnungstyp", "Тип назначения", "Order type")}
                </Label>
                <ShadSelect
                  value={form.orderType}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      orderType: (value ?? ORDER_TYPE_OPTIONS[0]) as OrderType,
                    }))
                  }
                >
                  <SelectTrigger id="patient-medical-order-type" className="w-full">
                    <SelectValue placeholder={l("Typ wählen", "Выберите тип", "Select order type")}>
                      {form.orderType ? orderTypeLabel(form.orderType, l) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {orderTypeLabel(option, l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-title">
                  {l("Titel", "Название", "Title")}
                </Label>
                <Input
                  id="patient-medical-order-title"
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder={l("Physiotherapie 2x pro Woche", "Физиотерапия 2 раза в неделю", "Physiotherapy 2x per week")}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-due-date">
                  {l("Fälligkeitsdatum", "Срок", "Due date")}
                </Label>
                <Input
                  id="patient-medical-order-due-date"
                  type="date"
                  value={form.dueDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-source">
                  {l("Quelle", "Источник", "Source")}
                </Label>
                <Input
                  id="patient-medical-order-source"
                  value={form.source}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source: event.target.value }))
                  }
                  placeholder={l("Arzt, Klinik, Entlassungsbericht", "Врач, клиника, выписка", "Doctor, clinic, discharge note")}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-medical-order-instructions">
                {l("Anweisungen", "Инструкции", "Instructions")}
              </Label>
              <textarea
                id="patient-medical-order-instructions"
                className={textareaClassName}
                value={form.instructions}
                onChange={(event) =>
                  setForm((current) => ({ ...current, instructions: event.target.value }))
                }
                required
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
