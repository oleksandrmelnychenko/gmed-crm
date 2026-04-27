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
import { inputClass, selectClass } from "@/components/ui-shell";

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
          ? l("Beziehung bearbeiten", "Redaktirovat svyaz", "Edit relation")
          : l("Beziehung hinzufugen", "Dobavit svyaz", "Add relation")
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
          {l(
            "Bestehenden Patienten suchen",
            "Poisk suschestvuyuschego pacienta",
            "Search existing patient",
          )}
        </Label>
        <Input
          id="relation-patient-search"
          value={patientSearch}
          onChange={(event) => setPatientSearch(event.target.value)}
          className={inputClass}
          placeholder={l("PID oder Patientenname", "PID ili imya pacienta", "PID or patient name")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="relation-linked-patient"
        >
          {l(
            "Patient im System verknupfen",
            "Svyazat pacienta v sisteme",
            "Link patient in system",
          )}
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
            {l("Eigenstandiger Kontakt", "Samostoyatelnyy kontakt", "Standalone contact")}
          </option>
          {filteredPatientOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {formatRelatedPatientOption(option)}
            </option>
          ))}
        </NativeComboboxSelect>
        <p className="text-[11.5px] leading-tight text-muted-foreground">
          {patientOptionsLoading
            ? l(
                "Patientenverzeichnis wird geladen...",
                "Zagruzka spravochnika pacientov...",
                "Loading patient directory...",
              )
            : selectedRelatedPatient
              ? l(
                  "Verknupfte Beziehungen bleiben mit einem bestehenden Patientendatensatz synchronisiert.",
                  "Svyazannye otnosheniya sinhroniziruyutsya s suschestvuyuschim pacientom.",
                  "Linked relations stay synced to an existing patient record.",
                )
              : l(
                  "Leer lassen fur Kontakte, die keine Patienten im System sind.",
                  "Ostavte pustym dlya kontaktov, kotorye ne yavlyayutsya pacientami v sisteme.",
                  "Keep this empty for contacts who are not patients in the system.",
                )}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="relation-name"
          >
            {l("Name", "Imya", "Name")}
          </Label>
          <Input
            id="relation-name"
            value={form.relatedName}
            onChange={(event) =>
              setForm((current) => ({ ...current, relatedName: event.target.value }))
            }
            className={inputClass}
            placeholder={l(
              "Name eines Angehorigen oder Betreuers",
              "Imya rodstvennika ili opekuna",
              "Relative or caregiver name",
            )}
            disabled={Boolean(form.relatedPatientId)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="relation-type"
          >
            {l("Beziehungstyp", "Tip svyazi", "Relation type")}
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
                {option}
              </option>
            ))}
          </NativeComboboxSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            className="text-[11.5px] font-medium text-muted-foreground leading-tight"
            htmlFor="relation-phone"
          >
            {l("Telefon", "Telefon", "Phone")}
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
            checked={form.isEmergencyContact}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isEmergencyContact: event.target.checked,
              }))
            }
          />
          {l("Notfallkontakt", "Ekstrennyy kontakt", "Emergency contact")}
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          className="text-[11.5px] font-medium text-muted-foreground leading-tight"
          htmlFor="relation-notes"
        >
          {l("Notizen", "Zametki", "Notes")}
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
            "Dostupnost, zametki po kontaktu ili osobye instrukcii",
            "Availability, contact notes or special instructions",
          )}
        />
      </div>
    </PatientSheetScaffold>
  );
}

export const MemoizedPatientRelationEditorSheet = memo(PatientRelationEditorSheet);
