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
import { emailDomainWarningText } from "@/components/email-domain-warning";
import { useLang } from "@/lib/i18n";

import { createPatient } from "../../data/patient-mutations";
import {
  blankPatientForm,
  computeAge,
  patientContactFormsToPayload,
  patientTrustedContactsToPayload,
  parseLanguages,
  toOptional,
  type PatientFormState,
  type PatientsDictionary,
} from "../../model/list-model";
import {
  validateNewPatientForm,
  withMinorGuardianRelations,
  type NewPatientValidationMessages,
} from "../../model/profile-validation";
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
  /** Field errors show after the first create attempt and then follow the input. */
  validationAttempted: boolean;
};

function newPatientValidationMessages(
  dictionary: PatientsDictionary,
  lang: string,
): NewPatientValidationMessages {
  return {
    noMailEmail: (email) => emailDomainWarningText(email, lang),
    required: dictionary.patient_profile_editor_required_field,
    invalidEmail: dictionary.patient_profile_editor_invalid_email,
    invalidPhone: dictionary.patient_profile_editor_invalid_phone,
    zipGermany: dictionary.patient_form_zip_invalid_germany,
    zipInvalid: dictionary.patient_form_zip_invalid,
    minorNeedsGuardian: dictionary.patient_form_minor_needs_guardian,
  };
}

/** The checks of the form as the patient would be saved. */
function newPatientFieldErrors(form: PatientFormState, dictionary: PatientsDictionary, lang: string) {
  const age = computeAge(form.birthDate);
  const isMinor = age !== null && age < 18;
  return validateNewPatientForm(
    { ...form, trustedContacts: withMinorGuardianRelations(form.trustedContacts, isMinor) },
    isMinor,
    newPatientValidationMessages(dictionary, lang),
  );
}

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
  const { lang } = useLang();
  const [sheetState, dispatchSheetState] = useReducer(
    createPatientSheetReducer,
    undefined,
    () => ({
      form: blankPatientForm(),
      busy: false,
      error: "",
      validationAttempted: false,
    }),
  );
  const { form, busy, error, validationAttempted } = sheetState;
  const fieldErrors = validationAttempted ? newPatientFieldErrors(form, dictionary, lang) : undefined;
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
        validationAttempted: false,
      });
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // The app's own checks and messages (the form has `noValidate`): the
    // browser's bubble spoke the browser's language, not the app's.
    const formElement = event.currentTarget;
    if (Object.keys(newPatientFieldErrors(form, dictionary, lang)).length > 0) {
      dispatchSheetState({
        validationAttempted: true,
        error: dictionary.patient_profile_editor_check_fields,
      });
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    dispatchSheetState({
      busy: true,
      error: "",
    });

    try {
      const age = computeAge(form.birthDate);
      const isMinor = age !== null && age < 18;
      const contactPayload = patientContactFormsToPayload(form.contacts);
      const trustedContacts = patientTrustedContactsToPayload(
        withMinorGuardianRelations(form.trustedContacts, isMinor),
      );
      const primaryTrustedContact = trustedContacts[0];
      const patientRelations = trustedContacts.map((contact) => ({
        related_patient_id: contact.relatedPatientId,
        related_name: contact.name,
        email: toOptional(contact.email),
        relation_type: contact.relation,
        is_emergency_contact: true,
        phone: toOptional(contact.phone),
        notes: toOptional(contact.notes),
      }));
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
        phone_primary: toOptional(contactPayload.phonePrimary),
        phone_secondary: toOptional(contactPayload.phoneSecondary),
        email: toOptional(contactPayload.email),
        contacts: contactPayload.contacts,
        address_street: toOptional(form.addressStreet),
        address_city: toOptional(form.addressCity),
        address_zip: toOptional(form.addressZip),
        address_country: toOptional(form.addressCountry),
        insurance_provider: toOptional(form.insuranceProvider),
        insurance_number: toOptional(form.insuranceNumber),
        insurance_type: toOptional(form.insuranceType),
        emergency_contact_name: toOptional(primaryTrustedContact?.name ?? ""),
        emergency_contact_phone: toOptional(primaryTrustedContact?.phone ?? ""),
        emergency_contact_relation: toOptional(primaryTrustedContact?.relation ?? ""),
        patient_relations: patientRelations,
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
      noValidate
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
        onContactsChange={(contacts) =>
          setForm((current) => ({ ...current, contacts }))
        }
        onTrustedContactsChange={(trustedContacts) =>
          setForm((current) => ({ ...current, trustedContacts }))
        }
        contactMode="multiple"
        includeBirthAndGender
        fieldErrors={fieldErrors}
      />
    </PatientSheetScaffold>
  );
}

export const MemoizedCreatePatientSheet = memo(CreatePatientSheet);
