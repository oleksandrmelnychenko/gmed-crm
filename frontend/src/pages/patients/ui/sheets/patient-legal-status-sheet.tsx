import { useReducer, useState, type FormEvent, type SetStateAction } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { selectClass, textareaClass } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  PATIENT_CONTRACT_STATUS_OPTIONS,
  patientContractStatusLabel,
  serializePatientLegalStatus,
  type PatientLegalStatus,
} from "../../model/legal-status";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const legalNotesTextareaClassName = cn(textareaClass, "min-h-[80px]");

type ChecklistKey =
  | "dsgvoSigned"
  | "confidentialityReleaseSigned"
  | "identityVerified"
  | "documentPackComplete"
  | "complianceCompleted";

function legalStatusFormReducer(
  state: PatientLegalStatus,
  action: SetStateAction<PatientLegalStatus>,
): PatientLegalStatus {
  return typeof action === "function"
    ? (action as (previous: PatientLegalStatus) => PatientLegalStatus)(state)
    : action;
}

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
  return (
    <PatientLegalStatusSheetContent
      key={`${patientId}:${open ? "open" : "closed"}:${serializePatientLegalStatus(initial)}`}
      patientId={patientId}
      initial={initial}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function PatientLegalStatusSheetContent({
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
  const { t } = useLang();
  const [form, setForm] = useReducer(legalStatusFormReducer, initial);
  const [busy, setBusy] = useState(false);

  function toggle(key: ChecklistKey) {
    setForm((current) => ({ ...current, [key]: !current[key] }));
  }

  const checklist: Array<{ key: ChecklistKey; label: string }> = [
    { key: "dsgvoSigned", label: t.patient_legal_check_dsgvo },
    {
      key: "confidentialityReleaseSigned",
      label: t.patient_legal_check_confidentiality,
    },
    { key: "identityVerified", label: t.patient_legal_check_identity },
    { key: "documentPackComplete", label: t.patient_legal_check_document_pack },
    { key: "complianceCompleted", label: t.patient_legal_check_compliance },
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
      toast.success(t.patient_legal_sheet_saved);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      title={t.patient_legal_sheet_title}
      maxWidthClassName="sm:max-w-[480px]"
      onSubmit={handleSubmit}
      bodyClassName="px-4 py-4 space-y-5"
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
          htmlFor="patient-legal-contract-status"
        >
          {t.patient_legal_sheet_contract_status}
        </Label>
        <NativeComboboxSelect
          value={form.contractStatus}


          onChange={(event) => setForm((current) => ({ ...current, contractStatus: event.target.value ?? "not_started" }))} id="patient-legal-contract-status" className={cn("w-full", selectClass)}>
            {PATIENT_CONTRACT_STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {patientContractStatusLabel(option)}
              </option>
            ))}
          </NativeComboboxSelect>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
          {t.patient_legal_sheet_checklist}
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
                    : "bg-card text-foreground hover:bg-muted/40",
                )}
              >
                <span>{item.label}</span>
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    active
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border bg-transparent",
                  )}
                >
                  {active ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="patient-legal-notes"
        >
          {t.patient_legal_sheet_notes}
        </Label>
        <textarea
          id="patient-legal-notes"
          className={legalNotesTextareaClassName}
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder={t.patient_legal_sheet_notes_placeholder}
        />
      </div>
    </PatientSheetScaffold>
  );
}
