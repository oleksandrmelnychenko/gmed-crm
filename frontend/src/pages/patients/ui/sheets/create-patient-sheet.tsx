import {
  memo,
  useEffect,
  useReducer,
  type FormEvent,
  type SetStateAction,
} from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui-shell";

import { createPatient } from "../../data/patient-mutations";
import {
  blankPatientForm,
  parseLanguages,
  toOptional,
  type PatientFormState,
  type PatientsDictionary,
} from "../../model/list-model";
import { parseFunctionalLabels } from "../shared/patient-form-primitives";
import { PatientFormFields } from "../shared/patient-form-fields";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

export type CreatePatientSheetProps = {
  open: boolean;
  dictionary: PatientsDictionary;
  onOpenChange: (open: boolean) => void;
  onCreated: (patientId: string) => void;
};

type CreatePatientSheetState = {
  form: PatientFormState;
  busy: boolean;
  error: string;
};

type CreatePatientSheetPatch =
  | Partial<CreatePatientSheetState>
  | ((current: CreatePatientSheetState) => Partial<CreatePatientSheetState>);

function createPatientSheetReducer(
  state: CreatePatientSheetState,
  patch: CreatePatientSheetPatch,
): CreatePatientSheetState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function CreatePatientSheet({
  open,
  dictionary,
  onOpenChange,
  onCreated,
}: CreatePatientSheetProps) {
  const [sheetState, dispatchSheetState] = useReducer(
    createPatientSheetReducer,
    undefined,
    () => ({
      form: blankPatientForm(),
      busy: false,
      error: "",
    }),
  );
  const { form, busy, error } = sheetState;
  const setForm = (nextValue: SetStateAction<PatientFormState>) => {
    dispatchSheetState((current) => ({
      form:
        typeof nextValue === "function"
          ? nextValue(current.form)
          : nextValue,
    }));
  };

  useEffect(() => {
    if (!open) {
      dispatchSheetState({
        form: blankPatientForm(),
        busy: false,
        error: "",
      });
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchSheetState({
      busy: true,
      error: "",
    });

    try {
      const created = await createPatient({
        title: toOptional(form.title),
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        birth_date: form.birthDate,
        gender: form.gender,
        nationality: toOptional(form.nationality),
        residence_country: toOptional(form.residenceCountry),
        languages: parseLanguages(form.languages),
        functional_labels: parseFunctionalLabels(form.functionalLabels),
        phone_primary: toOptional(form.phonePrimary),
        phone_secondary: toOptional(form.phoneSecondary),
        email: toOptional(form.email),
        address_street: toOptional(form.addressStreet),
        address_city: toOptional(form.addressCity),
        address_zip: toOptional(form.addressZip),
        address_country: toOptional(form.addressCountry),
        insurance_provider: toOptional(form.insuranceProvider),
        insurance_number: toOptional(form.insuranceNumber),
        insurance_type: toOptional(form.insuranceType),
        emergency_contact_name: toOptional(form.emergencyContactName),
        emergency_contact_phone: toOptional(form.emergencyContactPhone),
        emergency_contact_relation: toOptional(form.emergencyContactRelation),
        notes: toOptional(form.notes),
      });
      onOpenChange(false);
      onCreated(created.id);
    } catch (submitError) {
      dispatchSheetState({
        error:
          submitError instanceof Error
            ? submitError.message
            : dictionary.common_failed_create,
      });
    } finally {
      dispatchSheetState({ busy: false });
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      title={dictionary.patients_create}
      width="default"
      onSubmit={handleSubmit}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            {dictionary.common_cancel}
          </Button>
          <Button
            type="submit"
            className="h-9 rounded-lg gap-1.5 px-3.5"
            disabled={busy}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {busy ? dictionary.patients_creating : dictionary.common_create}
          </Button>
        </>
      }
    >
      {error ? <Banner tone="error">{error}</Banner> : null}
      <PatientFormFields
        form={form}
        onChange={(field, value) =>
          setForm((current) => ({ ...current, [field]: value }))
        }
        includeBirthAndGender
      />
    </PatientSheetScaffold>
  );
}

export const MemoizedCreatePatientSheet = memo(CreatePatientSheet);
