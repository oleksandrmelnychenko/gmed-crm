import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { selectClass } from "@/components/ui-shell";

import { usePatientLookupOptions } from "../../data/use-patient-lookup-options";
import { upsertPatientRelation } from "../../data/patient-detail-mutations";
import {
  formatRelatedPatientName,
  formatRelatedPatientOption,
} from "../../model/detail-model";
import type { RelationItem } from "../../model/detail-tab-types";
import {
  blankRelationForm,
  relationToForm,
  type RelationFormState,
} from "../../model/sheet-forms";

const RELATION_TYPE_OPTIONS = [
  "spouse",
  "parent",
  "child",
  "sibling",
  "relative",
  "guardian",
  "caregiver",
  "friend",
  "other",
] as const;

type PatientRelationEditorSheetProps = {
  open: boolean;
  patientId: string | undefined;
  selfPatientId: string;
  canManageRelations: boolean;
  editingRelation: RelationItem | null;
  dictionary: Record<string, string>;
  lang: string;
  textareaClassName: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function PatientRelationEditorSheet({
  open,
  patientId,
  selfPatientId,
  canManageRelations,
  editingRelation,
  dictionary,
  lang,
  textareaClassName,
  onOpenChange,
  onSaved,
  onError,
}: PatientRelationEditorSheetProps) {
  const [form, setForm] = useState<RelationFormState>(blankRelationForm);
  const [busy, setBusy] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const deferredPatientSearch = useDeferredValue(patientSearch);
  const { patientOptions, patientOptionsLoading } = usePatientLookupOptions({
    enabled: open && canManageRelations,
  });
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  useEffect(() => {
    if (!open) {
      setForm(blankRelationForm());
      setBusy(false);
      setPatientSearch("");
      return;
    }

    setForm(editingRelation ? relationToForm(editingRelation) : blankRelationForm());
    setPatientSearch(
      editingRelation?.related_display_name || editingRelation?.related_name || ""
    );
  }, [editingRelation, open]);

  const filteredPatientOptions = useMemo(() => {
    const normalizedSearch = deferredPatientSearch.trim().toLowerCase();

    return patientOptions.filter((option) => {
      if (option.id === selfPatientId) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return formatRelatedPatientOption(option).toLowerCase().includes(normalizedSearch);
    });
  }, [deferredPatientSearch, patientOptions, selfPatientId]);

  const selectedRelatedPatient = useMemo(
    () => patientOptions.find((option) => option.id === form.relatedPatientId) ?? null,
    [form.relatedPatientId, patientOptions]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!patientId || (!form.relatedPatientId && !form.relatedName.trim())) {
        onError(dictionary.common_failed_create);
        return;
      }

      setBusy(true);
      onError("");
      try {
        const selectedPatientName = selectedRelatedPatient
          ? formatRelatedPatientName(selectedRelatedPatient)
          : null;
        const payload = {
          related_patient_id: form.relatedPatientId || undefined,
          related_name: (selectedPatientName ?? form.relatedName).trim(),
          relation_type: form.relationType,
          is_emergency_contact: form.isEmergencyContact,
          phone: toOptional(form.phone),
          notes: toOptional(form.notes),
        };
        await upsertPatientRelation(patientId, payload, editingRelation?.id);
        toast.success(dictionary.common_active);
        onOpenChange(false);
        onSaved();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : dictionary.common_failed_update
        );
      } finally {
        setBusy(false);
      }
    },
    [
      dictionary.common_active,
      dictionary.common_failed_create,
      dictionary.common_failed_update,
      editingRelation?.id,
      form,
      onError,
      onOpenChange,
      onSaved,
      patientId,
      selectedRelatedPatient,
    ]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] gap-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {editingRelation
              ? l("Beziehung bearbeiten", "Редактировать связь", "Edit relation")
              : l("Beziehung hinzufügen", "Добавить связь", "Add relation")}
          </SheetTitle>
        </SheetHeader>
        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="relation-patient-search"
              >
                {l(
                  "Bestehenden Patienten suchen",
                  "Поиск существующего пациента",
                  "Search existing patient"
                )}
              </Label>
              <Input
                id="relation-patient-search"
                value={patientSearch}
                onChange={(event) => setPatientSearch(event.target.value)}
                placeholder={l("PID oder Patientenname", "PID или имя пациента", "PID or patient name")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="relation-linked-patient"
              >
                {l(
                  "Patient im System verknüpfen",
                  "Связать пациента в системе",
                  "Link patient in system"
                )}
              </Label>
              <select
                id="relation-linked-patient"
                className={selectClass}
                value={form.relatedPatientId}
                onChange={(event) => {
                  const nextPatientId = event.target.value;
                  const selectedPatient =
                    patientOptions.find((option) => option.id === nextPatientId) ?? null;
                  setPatientSearch(
                    selectedPatient ? formatRelatedPatientOption(selectedPatient) : ""
                  );
                  setForm((current) => ({
                    ...current,
                    relatedPatientId: nextPatientId,
                    relatedName: selectedPatient
                      ? formatRelatedPatientName(selectedPatient)
                      : current.relatedName,
                  }));
                }}
                disabled={patientOptionsLoading}
              >
                <option value="">
                  {l("Eigenständiger Kontakt", "Самостоятельный контакт", "Standalone contact")}
                </option>
                {filteredPatientOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {formatRelatedPatientOption(option)}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] text-muted-foreground leading-tight">
                {patientOptionsLoading
                  ? l(
                      "Patientenverzeichnis wird geladen...",
                      "Загрузка справочника пациентов...",
                      "Loading patient directory..."
                    )
                  : selectedRelatedPatient
                    ? l(
                        "Verknüpfte Beziehungen bleiben mit einem bestehenden Patientendatensatz synchronisiert.",
                        "Связанные отношения синхронизируются с существующим пациентом.",
                        "Linked relations stay synced to an existing patient record."
                      )
                    : l(
                        "Leer lassen für Angehörige oder Betreuer, die keine Patienten im System sind.",
                        "Оставьте пустым для родственников или опекунов, которые не являются пациентами в системе.",
                        "Keep this empty for relatives or caregivers who are not patients in the system."
                      )}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="relation-name"
                >
                  {l("Name", "Имя", "Name")}
                </Label>
                <Input
                  id="relation-name"
                  value={form.relatedName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, relatedName: event.target.value }))
                  }
                  placeholder={l(
                    "Name eines Angehörigen oder Betreuers",
                    "Имя родственника или опекуна",
                    "Relative or caregiver name"
                  )}
                  disabled={Boolean(form.relatedPatientId)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="relation-type"
                >
                  {l("Beziehungstyp", "Тип связи", "Relation type")}
                </Label>
                <select
                  id="relation-type"
                  className={selectClass}
                  value={form.relationType}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, relationType: event.target.value }))
                  }
                >
                  {RELATION_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="relation-phone"
                >
                  {l("Telefon", "Телефон", "Phone")}
                </Label>
                <Input
                  id="relation-phone"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  placeholder="+49 ..."
                />
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.isEmergencyContact}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isEmergencyContact: event.target.checked,
                    }))
                  }
                />
                {l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}
              </label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="relation-notes"
              >
                {l("Notizen", "Заметки", "Notes")}
              </Label>
              <textarea
                id="relation-notes"
                className={textareaClassName}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder={l(
                  "Erreichbarkeit, Kontakthinweise oder besondere Anweisungen",
                  "Доступность, заметки по контакту или особые инструкции",
                  "Availability, contact notes or special instructions"
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
              {dictionary.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={busy}
            >
              {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
              {dictionary.common_save}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export const MemoizedPatientRelationEditorSheet = memo(PatientRelationEditorSheet);
