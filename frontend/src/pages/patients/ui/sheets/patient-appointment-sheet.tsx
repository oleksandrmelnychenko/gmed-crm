import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  checkboxClass,
  Field as FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type {
  DoctorOption,
  ProviderSummary,
} from "@/pages/appointments/model/types";
import { useProviderTaxonomyNodes } from "@/pages/providers/data/use-provider-taxonomy-nodes";
import { doctorSpecialtyLabel, type SpecializationLabelLang } from "@/pages/providers/model/specialization-labels";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
import { FormSection } from "../shared/patient-form-primitives";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type AppointmentKind = "medical" | "non_medical" | "internal";
type CarePathKind = "regular" | "preventive" | "control" | "followup";

const TYPE_OPTIONS: AppointmentKind[] = ["medical", "non_medical", "internal"];
const CARE_PATH_KIND_OPTIONS: CarePathKind[] = [
  "regular",
  "preventive",
  "control",
  "followup",
];

function typeLabel(
  value: AppointmentKind,
  l: (key: string) => string,
): string {
  switch (value) {
    case "medical":
      return l("patients_medical");
    case "non_medical":
      return l("patients_non_medical");
    case "internal":
      return l("patients_internal");
  }
}

function carePathLabel(
  value: CarePathKind,
  l: (key: string) => string,
): string {
  switch (value) {
    case "regular":
      return l("patients_regular");
    case "preventive":
      return l("patients_preventive");
    case "control":
      return l("patients_control");
    case "followup":
      return l("patients_follow_up");
  }
}

function providerLabel(provider: ProviderSummary) {
  return provider.address_city
    ? `${provider.name} - ${provider.address_city}`
    : provider.name;
}

function doctorLabel(doctor: DoctorOption, lang: SpecializationLabelLang) {
  const specialty = doctorSpecialtyLabel(doctor, lang);
  return specialty ? `${doctor.name} (${specialty})` : doctor.name;
}

function todayDateString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type FormState = {
  title: string;
  appointmentType: AppointmentKind;
  carePathKind: CarePathKind;
  providerId: string;
  doctorId: string;
  skipMedicalProviderBinding: boolean;
  date: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  notes: string;
};

type PatientAppointmentTranslations = ReturnType<typeof useLang>["t"];
type PatientAppointmentText = (key: string) => string;
type PatientAppointmentFormSetter = (
  value: FormState | ((current: FormState) => FormState),
) => void;

function blankForm(): FormState {
  return {
    title: "",
    appointmentType: "medical",
    carePathKind: "regular",
    providerId: "",
    doctorId: "",
    skipMedicalProviderBinding: false,
    date: todayDateString(),
    timeStart: "",
    timeEnd: "",
    location: "",
    notes: "",
  };
}

const appointmentTextareaClassName = cn(textareaClass, "min-h-[96px]");

export function PatientAppointmentSheet({
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
  return (
    <PatientAppointmentSheetContent
      key={`${patientId}:${open ? "open" : "closed"}`}
      patientId={patientId}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function PatientAppointmentBasicsSection({
  form,
  providers,
  setForm,
  l,
}: {
  form: FormState;
  providers: ProviderSummary[];
  setForm: PatientAppointmentFormSetter;
  l: PatientAppointmentText;
}) {
  return (
    <FormSection title={l("patients_appointment")}>
      <FormField label={l("patients_title")} htmlFor="patient-appointment-title">
        <Input
          id="patient-appointment-title"
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          className={inputClass}
          required
        />
      </FormField>

      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("patients_appointment_type")} htmlFor="patient-appointment-type">
          <NativeComboboxSelect
            id="patient-appointment-type"
            value={form.appointmentType}
            onChange={(event) => {
              const appointmentType =
                (event.target.value as AppointmentKind) ?? form.appointmentType;
              setForm((current) => {
                const currentProvider =
                  providers.find((item) => item.id === current.providerId) ?? null;
                const shouldClearProvider =
                  appointmentType === "internal" ||
                  ((appointmentType === "medical" || appointmentType === "non_medical") &&
                    currentProvider !== null &&
                    currentProvider.provider_type !== appointmentType);
                return {
                  ...current,
                  appointmentType,
                  carePathKind:
                    appointmentType === "medical" ? current.carePathKind : "regular",
                  providerId: shouldClearProvider ? "" : current.providerId,
                  doctorId: shouldClearProvider ? "" : current.doctorId,
                  skipMedicalProviderBinding:
                    appointmentType === "medical"
                      ? current.skipMedicalProviderBinding
                      : false,
                };
              });
            }}
            className={cn("w-full", selectClass)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {typeLabel(option, l)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
        <FormField
          label={l("patients_appointment_care_path")}
          htmlFor="patient-appointment-care-path"
        >
          <NativeComboboxSelect
            id="patient-appointment-care-path"
            value={form.carePathKind}
            disabled={form.appointmentType !== "medical"}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                carePathKind: (event.target.value as CarePathKind) ?? current.carePathKind,
              }))
            }
            className={cn("w-full", selectClass)}
          >
            {CARE_PATH_KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {carePathLabel(option, l)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
      </div>
    </FormSection>
  );
}

function PatientAppointmentScheduleSection({
  doctors,
  form,
  providerOptions,
  providersLoading,
  providers,
  selectedProvider,
  setForm,
  taxonomyNodes,
  t,
  l,
  lang,
}: {
  doctors: DoctorOption[];
  form: FormState;
  lang: SpecializationLabelLang;
  providerOptions: ProviderSummary[];
  providersLoading: boolean;
  providers: ProviderSummary[];
  selectedProvider: ProviderSummary | null;
  setForm: PatientAppointmentFormSetter;
  taxonomyNodes: ProviderTaxonomyNode[];
  t: PatientAppointmentTranslations;
  l: PatientAppointmentText;
}) {
  return (
    <FormSection title={l("patients_time_and_place")}>
      <div className="grid gap-3 md:grid-cols-3">
        <FormField label={l("patients_date")} htmlFor="patient-appointment-date">
          <Input
            id="patient-appointment-date"
            type="date"
            value={form.date}
            onChange={(event) =>
              setForm((current) => ({ ...current, date: event.target.value }))
            }
            className={inputClass}
            required
          />
        </FormField>
        <FormField label={l("patients_start")} htmlFor="patient-appointment-time-start">
          <Input
            id="patient-appointment-time-start"
            type="time"
            value={form.timeStart}
            onChange={(event) =>
              setForm((current) => ({ ...current, timeStart: event.target.value }))
            }
            className={inputClass}
          />
        </FormField>
        <FormField label={l("patients_end")} htmlFor="patient-appointment-time-end">
          <Input
            id="patient-appointment-time-end"
            type="time"
            value={form.timeEnd}
            onChange={(event) =>
              setForm((current) => ({ ...current, timeEnd: event.target.value }))
            }
            className={inputClass}
          />
        </FormField>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={t.common_provider} htmlFor="patient-appointment-provider">
          <ProviderSelectWithTaxonomyFilter
            value={form.providerId}
            providers={providerOptions}
            taxonomyNodes={taxonomyNodes}
            providerType={
              form.appointmentType === "medical" || form.appointmentType === "non_medical"
                ? form.appointmentType
                : ""
            }
            providerPlaceholder={
              providersLoading ? t.common_loading : t.common_not_set
            }
            taxonomyPlaceholder={t.providers_category}
            taxonomyAllLabel={t.providers_all}
            disabled={form.appointmentType === "internal"}
            providerDisabled={providersLoading && providerOptions.length === 0}
            containerClassName="grid-cols-1 sm:grid-cols-2"
            taxonomySelectClassName={cn("w-full", selectClass)}
            providerSelectClassName={cn("w-full", selectClass)}
            providerLabel={providerLabel}
            aria-label={t.common_provider}
            onChange={(providerId) => {
              const provider = providers.find((item) => item.id === providerId);
              setForm((current) => ({
                ...current,
                providerId,
                doctorId: "",
                skipMedicalProviderBinding: providerId
                  ? false
                  : current.skipMedicalProviderBinding,
                location:
                  provider && !current.location.trim()
                    ? providerLabel(provider)
                    : current.location,
              }));
            }}
          />
        </FormField>
        <FormField label={t.common_doctor} htmlFor="patient-appointment-doctor">
          <NativeComboboxSelect
            id="patient-appointment-doctor"
            value={form.doctorId}
            disabled={!form.providerId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                doctorId: event.target.value,
              }))
            }
            className={cn("w-full", selectClass)}
          >
            <option value="">{t.common_not_set}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctorLabel(doctor, lang)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
      </div>

      {form.appointmentType === "medical" ? (
        <div className="space-y-2">
          <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-foreground">
            <input
              id="patient-appointment-skip-provider-binding"
              type="checkbox"
              checked={form.skipMedicalProviderBinding}
              disabled={Boolean(form.providerId)}
              aria-labelledby="patient-appointment-skip-provider-binding-label"
              aria-describedby="patient-appointment-skip-provider-binding-hint"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  skipMedicalProviderBinding: event.target.checked,
                }))
              }
              className={cn(checkboxClass, "mt-0.5")}
            />
            <span>
              <span
                id="patient-appointment-skip-provider-binding-label"
                className="block font-medium text-foreground"
              >
                {l("appointments_medical_provider_opt_out")}
              </span>
              <span
                id="patient-appointment-skip-provider-binding-hint"
                className="block text-xs text-muted-foreground"
              >
                {l("appointments_medical_provider_opt_out_hint")}
              </span>
            </span>
          </div>
          {!form.providerId && !form.skipMedicalProviderBinding ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {l("appointments_medical_provider_required_hint")}
            </div>
          ) : null}
        </div>
      ) : null}

      <FormField label={l("patients_location")} htmlFor="patient-appointment-location">
        <Input
          id="patient-appointment-location"
          value={form.location}
          onChange={(event) =>
            setForm((current) => ({ ...current, location: event.target.value }))
          }
          placeholder={
            selectedProvider ? providerLabel(selectedProvider) : l("patients_location")
          }
          className={inputClass}
        />
      </FormField>
    </FormSection>
  );
}

function PatientAppointmentAdditionalSection({
  form,
  setForm,
  l,
}: {
  form: FormState;
  setForm: PatientAppointmentFormSetter;
  l: PatientAppointmentText;
}) {
  return (
    <FormSection title={l("patients_additional")}>
      <FormField label={l("appointments_notes")} htmlFor="patient-appointment-notes">
        <textarea
          id="patient-appointment-notes"
          className={appointmentTextareaClassName}
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </FormField>
    </FormSection>
  );
}

function PatientAppointmentSheetContent({
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
  const l = (key: string) => t.uiText[key] ?? key;
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const taxonomyNodes = useProviderTaxonomyNodes();
  const [doctorOptionsState, setDoctorOptionsState] = useState<{
    providerId: string;
    doctors: DoctorOption[];
  }>({ providerId: "", doctors: [] });
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === form.providerId) ?? null,
    [form.providerId, providers],
  );
  const doctors =
    doctorOptionsState.providerId === form.providerId
      ? doctorOptionsState.doctors
      : [];
  const providerOptions = useMemo(
    () =>
      form.appointmentType === "medical" || form.appointmentType === "non_medical"
        ? providers.filter((provider) => provider.provider_type === form.appointmentType)
        : providers,
    [form.appointmentType, providers],
  );

  useEffect(() => {
    if (!open) return;

    let active = true;
    setProvidersLoading(true);
    void apiFetch<ProviderSummary[]>("/providers", {
      cacheTtlMs: 60_000,
      forceFresh: true,
    })
      .then((rows) => {
        if (active) setProviders(rows);
      })
      .catch(() => {
        if (active) setProviders([]);
      })
      .finally(() => {
        if (active) setProvidersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!form.providerId) return;

    let active = true;
    const providerId = form.providerId;
    void getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) setDoctorOptionsState({ providerId, doctors: rows });
      })
      .catch(() => {
        if (active) setDoctorOptionsState({ providerId, doctors: [] });
      });

    return () => {
      active = false;
    };
  }, [form.providerId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error(l("patients_title_required"));
      return;
    }
    if (!form.date) {
      toast.error(l("patients_date_required"));
      return;
    }
    if (
      form.appointmentType === "medical" &&
      !form.providerId &&
      !form.skipMedicalProviderBinding
    ) {
      toast.error(l("appointments_medical_provider_required"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: patientId,
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: null,
          interpreter_id: null,
          appointment_type: form.appointmentType,
          skip_medical_provider_binding:
            form.appointmentType === "medical" &&
            !form.providerId &&
            form.skipMedicalProviderBinding,
          care_path_kind:
            form.appointmentType === "medical" ? form.carePathKind : "regular",
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          category: null,
          notes: form.notes.trim() || null,
          recurrence_frequency: null,
          recurrence_interval: null,
          recurrence_count: null,
          recurrence_until: null,
        }),
      });
      toast.success(l("patients_appointment_created"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="default"
      onSubmit={handleSubmit}
      title={t.appointments_new}
      bodyClassName="space-y-4 px-5 py-4"
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
      <PatientAppointmentBasicsSection
        form={form}
        providers={providers}
        setForm={setForm}
        l={l}
      />
      <PatientAppointmentScheduleSection
        doctors={doctors}
        form={form}
        providerOptions={providerOptions}
        providersLoading={providersLoading}
        providers={providers}
        selectedProvider={selectedProvider}
        setForm={setForm}
        taxonomyNodes={taxonomyNodes}
        t={t}
        l={l}
        lang={lang}
      />
      <PatientAppointmentAdditionalSection form={form} setForm={setForm} l={l} />
    </PatientSheetScaffold>
  );
}
