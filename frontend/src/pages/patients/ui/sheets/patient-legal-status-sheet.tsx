import { useEffect, useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  PATIENT_CONTRACT_STATUS_OPTIONS,
  serializePatientLegalStatus,
  type PatientLegalStatus,
} from "../../model/legal-status";

const textareaClassName =
  "min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

function contractStatusLabel(
  value: string,
  l: (de: string, ru: string, en: string) => string,
): string {
  switch (value) {
    case "not_started":
      return l("Nicht gestartet", "Не начато", "Not started");
    case "pending":
      return l("In Bearbeitung", "В работе", "Pending");
    case "sent":
      return l("Versendet", "Отправлено", "Sent");
    case "signed":
      return l("Signiert", "Подписано", "Signed");
    case "expired":
      return l("Abgelaufen", "Истекло", "Expired");
    case "terminated":
      return l("Beendet", "Расторгнуто", "Terminated");
    default:
      return value;
  }
}

type ChecklistKey =
  | "dsgvoSigned"
  | "confidentialityReleaseSigned"
  | "identityVerified"
  | "documentPackComplete"
  | "complianceCompleted";

export function PatientLegalStatusSheet({
  patientId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  initial: PatientLegalStatus;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const [form, setForm] = useState<PatientLegalStatus>(initial);
  const [busy, setBusy] = useState(false);

  // Reset to current value every time the sheet opens.
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  function toggle(key: ChecklistKey) {
    setForm((current) => ({ ...current, [key]: !current[key] }));
  }

  const checklist: Array<{ key: ChecklistKey; label: string }> = [
    { key: "dsgvoSigned", label: l("DSGVO", "DSGVO", "DSGVO") },
    {
      key: "confidentialityReleaseSigned",
      label: l("Schweigepflicht", "Соглашение о конфиденциальности", "Confidentiality release"),
    },
    { key: "identityVerified", label: l("Identität verifiziert", "Личность подтверждена", "ID verified") },
    { key: "documentPackComplete", label: l("Dokumentenpaket", "Пакет документов", "Document pack") },
    { key: "complianceCompleted", label: l("Compliance vollständig", "Compliance завершён", "Compliance complete") },
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/patients/${patientId}/update`, {
        method: "POST",
        body: JSON.stringify({
          legal_status: serializePatientLegalStatus(form),
        }),
      });
      toast.success(l("Status gespeichert.", "Статус сохранён.", "Status saved."));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] gap-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {l("Rechtsstatus aktualisieren", "Обновить правовой статус", "Update legal status")}
          </SheetTitle>
        </SheetHeader>

        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Contract status */}
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="patient-legal-contract-status"
              >
                {l("Vertragsstatus", "Статус договора", "Contract status")}
              </Label>
              <ShadSelect
                value={form.contractStatus}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, contractStatus: value ?? "not_started" }))
                }
              >
                <SelectTrigger id="patient-legal-contract-status" className="w-full">
                  <SelectValue>
                    {contractStatusLabel(form.contractStatus, l)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PATIENT_CONTRACT_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {contractStatusLabel(option, l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>

            {/* Checklist as toggle pills */}
            <div className="flex flex-col gap-2">
              <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                {l("Compliance-Checkliste", "Compliance-чеклист", "Compliance checklist")}
              </span>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {checklist.map((item) => {
                  const active = form[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggle(item.key)}
                      className={cn(
                        "flex items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] transition-colors",
                        active
                          ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                          : "bg-card text-foreground hover:bg-muted/40"
                      )}
                    >
                      <span>{item.label}</span>
                      <span
                        className={cn(
                          "inline-flex items-center justify-center size-5 rounded-full border-2 transition-colors shrink-0",
                          active
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-border bg-transparent"
                        )}
                      >
                        {active ? <Check className="size-3" strokeWidth={3} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="patient-legal-notes"
              >
                {l("Notizen", "Заметки", "Notes")}
              </Label>
              <textarea
                id="patient-legal-notes"
                className={textareaClassName}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder={l(
                  "Kontext, Blocker oder nächste Schritte dokumentieren.",
                  "Контекст, блокеры или следующие шаги.",
                  "Context, blockers or next steps.",
                )}
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
