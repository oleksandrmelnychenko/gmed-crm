import {
  memo,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

export type CreatePatientSheetProps = {
  open: boolean;
  dictionary: PatientsDictionary;
  onOpenChange: (open: boolean) => void;
  onCreated: (patientId: string) => void;
};

function CreatePatientSheet({
  open,
  dictionary,
  onOpenChange,
  onCreated,
}: CreatePatientSheetProps) {
  const [form, setForm] = useState<PatientFormState>(blankPatientForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setForm(blankPatientForm());
      setBusy(false);
      setError("");
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

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
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.common_failed_create,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[720px]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
            <SheetTitle>{dictionary.patients_create}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
            {error ? <Banner tone="error">{error}</Banner> : null}
            <PatientFormFields
              form={form}
              onChange={(field, value) =>
                setForm((current) => ({ ...current, [field]: value }))
              }
              includeBirthAndGender
            />
          </div>

          <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {dictionary.common_cancel}
            </Button>
            <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? dictionary.patients_creating : dictionary.common_create}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export const MemoizedCreatePatientSheet = memo(CreatePatientSheet);
