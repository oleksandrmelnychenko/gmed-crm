import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  checkboxClass,
  inputClass,
  selectClass,
} from "@/components/ui-shell";
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
import { FormSection } from "../shared/patient-form-primitives";
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

type RelationEditorState = {
  form: RelationFormState;
  busy: boolean;
  patientSearch: string;
};

type RelationEditorPatch =
  | Partial<RelationEditorState>
  | ((current: RelationEditorState) => Partial<RelationEditorState>);

function createRelationEditorState(): RelationEditorState {
  return {
    form: blankRelationForm(),
    busy: false,
    patientSearch: "",
  };
}

function relationEditorReducer(
  state: RelationEditorState,
  patch: RelationEditorPatch,
): RelationEditorState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

type PatientRelationEditorFooterProps = {
  busy: boolean;
  dictionary: Record<string, string>;
  onCancel: () => void;
};

function PatientRelationEditorFooter({
  busy,
  dictionary,
  onCancel,
}: PatientRelationEditorFooterProps) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-lg"
        onClick={onCancel}
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
  );
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
  const l = (key: string) => t.uiText[key] ?? key;
  const [relationState, dispatchRelationState] = useReducer(
    relationEditorReducer,
    undefined,
    createRelationEditorState,
  );
  const { form, busy, patientSearch } = relationState;
  const deferredPatientSearch = useDeferredValue(patientSearch);
  const { patientOptions, patientOptionsLoading } = usePatientLookupOptions({
    enabled: open && canManageRelations,
  });
  useEffect(() => {
    if (!open) {
      dispatchRelationState({
        form: blankRelationForm(),
        busy: false,
        patientSearch: "",
      });
      return;
    }

    dispatchRelationState({
      form: editingRelation ? relationToForm(editingRelation) : blankRelationForm(),
      patientSearch:
        editingRelation?.related_display_name || editingRelation?.related_name || "",
    });
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
      if (!patientId) {
        onError(dictionary.common_failed_create);
        return;
      }
      if (!form.relatedPatientId && !form.relatedName.trim()) {
        onError(`${t.patient_relation_name}: ${t.cf_required}`);
        return;
      }

      dispatchRelationState({ busy: true });
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
        dispatchRelationState({ busy: false });
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
      bodyClassName="space-y-4 px-5 py-4"
      footer={
        <PatientRelationEditorFooter
          busy={busy}
          dictionary={dictionary}
          onCancel={() => onOpenChange(false)}
        />
      }
    >
      <FormSection title={l("patients_linked_patient")}>
        <FormField
          label={t.patient_relation_search_existing}
          htmlFor="relation-patient-search"
        >
          <Input
            id="relation-patient-search"
            value={patientSearch}
            onChange={(event) =>
              dispatchRelationState({ patientSearch: event.target.value })
            }
            className={inputClass}
            placeholder={t.patient_relation_search_placeholder}
          />
        </FormField>

        <FormField
          label={t.patient_relation_link_patient}
          htmlFor="relation-linked-patient"
        >
          <NativeComboboxSelect
            id="relation-linked-patient"
            className={selectClass}
            value={form.relatedPatientId}
            onChange={(event) => {
              const nextPatientId = event.target.value;
              const selectedPatient =
                patientOptions.find((option) => option.id === nextPatientId) ?? null;
              dispatchRelationState((current) => ({
                patientSearch: selectedPatient
                  ? formatRelatedPatientOption(selectedPatient)
                  : "",
                form: {
                  ...current.form,
                  relatedPatientId: nextPatientId,
                  relatedName: selectedPatient
                    ? formatRelatedPatientName(selectedPatient)
                    : current.form.relatedName,
                },
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
          <p className="mt-1.5 text-[11.5px] leading-tight text-muted-foreground">
            {patientOptionsLoading
              ? t.patient_relation_loading_directory
              : selectedRelatedPatient
                ? t.patient_relation_linked_sync_hint
                : t.patient_relation_unlinked_hint}
          </p>
        </FormField>
      </FormSection>

      <FormSection title={l("patients_relation_details")}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label={t.patient_relation_name} htmlFor="relation-name">
            <Input
              id="relation-name"
              value={form.relatedName}
              onChange={(event) =>
                dispatchRelationState((current) => ({
                  form: { ...current.form, relatedName: event.target.value },
                }))
              }
              className={inputClass}
              placeholder={t.patient_relation_name_placeholder}
              disabled={Boolean(form.relatedPatientId)}
            />
          </FormField>

          <FormField label={t.patient_relation_type_label} htmlFor="relation-type">
            <NativeComboboxSelect
              id="relation-type"
              className={selectClass}
              value={form.relationType}
              onChange={(event) =>
                dispatchRelationState((current) => ({
                  form: { ...current.form, relationType: event.target.value },
                }))
              }
            >
              {RELATION_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {patientRelationTypeLabel(option)}
                </option>
              ))}
            </NativeComboboxSelect>
          </FormField>

          <FormField label={t.patient_relation_phone} htmlFor="relation-phone">
            <Input
              id="relation-phone"
              value={form.phone}
              onChange={(event) =>
                dispatchRelationState((current) => ({
                  form: { ...current.form, phone: event.target.value },
                }))
              }
              className={inputClass}
              placeholder={t.patient_relation_phone_placeholder}
            />
          </FormField>

          <label className="flex min-h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={form.isEmergencyContact}
              onChange={(event) =>
                dispatchRelationState((current) => ({
                  form: {
                    ...current.form,
                    isEmergencyContact: event.target.checked,
                  },
                }))
              }
            />
            {t.patient_relation_emergency_contact}
          </label>
        </div>
      </FormSection>

      <FormSection title={l("patients_additional")}>
        <FormField label={t.patient_relation_notes} htmlFor="relation-notes">
          <textarea
            id="relation-notes"
            className={textareaClassName}
            value={form.notes}
            onChange={(event) =>
              dispatchRelationState((current) => ({
                form: { ...current.form, notes: event.target.value },
              }))
            }
            placeholder={t.patient_relation_notes_placeholder}
          />
        </FormField>
      </FormSection>
    </PatientSheetScaffold>
  );
}

export const MemoizedPatientRelationEditorSheet = memo(PatientRelationEditorSheet);
