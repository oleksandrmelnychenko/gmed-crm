import { NativeComboboxSelect } from "@/components/ui/combobox-select";
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
import { toast } from "@/components/ui/toast";
import { checkboxClass, inputClass, selectClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";

import { usePatientLookupOptions } from "../../data/use-patient-lookup-options";
import { upsertPatientRelation } from "../../data/patient-detail-mutations";
import {
  formatRelatedPatientName,
  formatRelatedPatientOption,
  patientRelationTypeLabel,
} from "../../model/detail-model";
import type { RelationItem } from "../../model/detail-tab-types";
import {
  blankRelationForm,
  relationToForm,
  type RelationFormState,
} from "../../model/sheet-forms";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

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
  textareaClassName,
  onOpenChange,
  onSaved,
  onError,
}: PatientRelationEditorSheetProps) {
  const { t } = useLang();
  const [form, setForm] = useState<RelationFormState>(blankRelationForm);
  const [busy, setBusy] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const deferredPatientSearch = useDeferredValue(patientSearch);
  const { patientOptions, patientOptionsLoading } = usePatientLookupOptions({
    enabled: open && canManageRelations,
  });
  useEffect(() => {
    if (!open) {
      setForm(blankRelationForm());
      setBusy(false);
      setPatientSearch("");
      return;
    }

    setForm(editingRelation ? relationToForm(editingRelation) : blankRelationForm());
    setPatientSearch(
      editingRelation?.related_display_name || editingRelation?.related_name || "",
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
    [form.relatedPatientId, patientOptions],
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
          error instanceof Error ? error.message : dictionary.common_failed_update,
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
    ],
  );

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="narrow"
      onSubmit={handleSubmit}
      title={
        editingRelation
          ? t.patient_relation_title_edit
          : t.patient_relation_title_add
      }
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
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="relation-patient-search"
        >
          {t.patient_relation_search_existing}
        </Label>
        <Input
          id="relation-patient-search"
          value={patientSearch}
          onChange={(event) => setPatientSearch(event.target.value)}
          className={inputClass}
          placeholder={t.patient_relation_search_placeholder}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="relation-linked-patient"
        >
          {t.patient_relation_link_patient}
        </Label>
        <NativeComboboxSelect
          id="relation-linked-patient"
          className={selectClass}
          value={form.relatedPatientId}
          onChange={(event) => {
            const nextPatientId = event.target.value;
            const selectedPatient =
              patientOptions.find((option) => option.id === nextPatientId) ?? null;
            setPatientSearch(
              selectedPatient ? formatRelatedPatientOption(selectedPatient) : "",
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
            {t.patient_relation_standalone_contact}
          </option>
          {filteredPatientOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {formatRelatedPatientOption(option)}
            </option>
          ))}
        </NativeComboboxSelect>
        <p className="text-[11.5px] leading-tight text-muted-foreground">
          {patientOptionsLoading
            ? t.patient_relation_loading_directory
            : selectedRelatedPatient
              ? t.patient_relation_linked_sync_hint
              : t.patient_relation_unlinked_hint}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="relation-name"
          >
            {t.patient_relation_name}
          </Label>
          <Input
            id="relation-name"
            value={form.relatedName}
            onChange={(event) =>
              setForm((current) => ({ ...current, relatedName: event.target.value }))
            }
            className={inputClass}
            placeholder={t.patient_relation_name_placeholder}
            disabled={Boolean(form.relatedPatientId)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="relation-type"
          >
            {t.patient_relation_type_label}
          </Label>
          <NativeComboboxSelect
            id="relation-type"
            className={selectClass}
            value={form.relationType}
            onChange={(event) =>
              setForm((current) => ({ ...current, relationType: event.target.value }))
            }
          >
            {RELATION_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {patientRelationTypeLabel(option)}
              </option>
            ))}
          </NativeComboboxSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="relation-phone"
          >
            {t.patient_relation_phone}
          </Label>
          <Input
            id="relation-phone"
            value={form.phone}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
            className={inputClass}
            placeholder="+49 ..."
          />
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={form.isEmergencyContact}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isEmergencyContact: event.target.checked,
              }))
            }
          />
          {t.patient_relation_emergency_contact}
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="relation-notes"
        >
          {t.patient_relation_notes}
        </Label>
        <textarea
          id="relation-notes"
          className={textareaClassName}
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder={t.patient_relation_notes_placeholder}
        />
      </div>
    </PatientSheetScaffold>
  );
}

export const MemoizedPatientRelationEditorSheet = memo(PatientRelationEditorSheet);
