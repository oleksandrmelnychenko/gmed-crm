import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import {
  CARE_PATH_KIND_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from "@/pages/appointments/model/constants";
import {
  appointmentText,
  appointmentTypeLabel,
  carePathKindLabel,
  doctorLabel,
  patientName,
  roleLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import {
  filterProvidersForAppointmentScope,
  providerSelectionFitsAppointmentScope,
  providerTaxonomyTreeOptions,
} from "@/pages/appointments/model/provider-taxonomy";
import type {
  DoctorOption,
  FiltersState,
  InterpreterOption,
  PatientSummary,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import {
  AppointmentEditorSheet,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

export type SearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FiltersState;
  setFilters: Dispatch<SetStateAction<FiltersState>>;
  patients: PatientSummary[];
  providers: ProviderSummary[];
  taxonomyNodes: ProviderTaxonomyNode[];
  filterDoctors: DoctorOption[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  onReset: () => void;
  onPatientChange: (patientId: string) => void;
  onProviderChange: (providerId: string) => void;
  onDoctorChange: (doctorId: string) => void;
};

function withEllipsis(value: string) {
  return value.endsWith("...") || value.endsWith("…") ? value : `${value}…`;
}

function SearchSheet({
  open,
  onOpenChange,
  filters,
  setFilters,
  patients,
  providers,
  taxonomyNodes,
  filterDoctors,
  staff,
  interpreters,
  onReset,
  onPatientChange,
  onProviderChange,
  onDoctorChange,
}: SearchSheetProps) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const providerTaxonomyOptions = useMemo(
    () => providerTaxonomyTreeOptions(taxonomyNodes, filters.appointmentType, lang),
    [filters.appointmentType, lang, taxonomyNodes],
  );
  const providerOptions = useMemo(
    () =>
      filterProvidersForAppointmentScope(
        providers,
        filters.appointmentType,
        filters.providerTaxonomyNodeId,
      ),
    [filters.appointmentType, filters.providerTaxonomyNodeId, providers],
  );

  return (
    <AppointmentEditorSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.common_search}
      maxWidthClassName="sm:max-w-[460px]"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={onReset}
          >
            {t.common_reset}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            {t.common_cancel}
          </Button>
        </>
      }
    >
      <Field label={t.common_search}>
        <Input
          value={filters.search}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              search: event.target.value,
            }))
          }
          placeholder={withEllipsis(tr.common_search)}
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <Field label={t.appointments_type}>
        <NativeComboboxSelect
          value={filters.appointmentType}
          onChange={(event) => {
            const appointmentType = event.target.value;
            setFilters((current) => {
              const keepProvider = providerSelectionFitsAppointmentScope(
                providers,
                current.providerId,
                appointmentType,
              );
              return {
                ...current,
                appointmentType,
                providerTaxonomyNodeId: "",
                providerId: keepProvider ? current.providerId : "",
                doctorId: keepProvider ? current.doctorId : "",
              };
            });
          }}
          className={selectClass}
        >
          <option value="">{t.providers_all}</option>
          {TYPE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {appointmentTypeLabel(value, tr)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field
        label={appointmentText("appointments_care_path")}
      >
        <NativeComboboxSelect
          value={filters.carePathKind}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              carePathKind: event.target.value,
            }))
          }
          className={selectClass}
        >
          <option value="">{t.providers_all}</option>
          {CARE_PATH_KIND_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {carePathKindLabel(value)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.users_status}>
        <NativeComboboxSelect
          value={filters.status}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.value,
            }))
          }
          className={selectClass}
        >
          <option value="">{t.providers_all}</option>
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.orders_patient}>
        <NativeComboboxSelect
          value={filters.patientId}
          onChange={(event) => onPatientChange(event.target.value)}
          className={selectClass}
        >
          <option value="">{tr.providers_all}</option>
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.patient_id} · {patientName(patient)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.appointments_provider_category}>
        <NativeComboboxSelect
          value={filters.providerTaxonomyNodeId}
          onChange={(event) => {
            const providerTaxonomyNodeId = event.target.value;
            setFilters((current) => {
              const keepProvider = providerSelectionFitsAppointmentScope(
                providers,
                current.providerId,
                current.appointmentType,
                providerTaxonomyNodeId,
              );
              return {
                ...current,
                providerTaxonomyNodeId,
                providerId: keepProvider ? current.providerId : "",
                doctorId: keepProvider ? current.doctorId : "",
              };
            });
          }}
          className={selectClass}
          disabled={filters.appointmentType === "internal" || providerTaxonomyOptions.length === 0}
        >
          <option value="">{tr.providers_all}</option>
          {providerTaxonomyOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.common_provider}>
        <NativeComboboxSelect
          value={filters.providerId}
          onChange={(event) => onProviderChange(event.target.value)}
          className={selectClass}
        >
          <option value="">{tr.providers_all}</option>
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.common_doctor}>
        <NativeComboboxSelect
          value={filters.doctorId}
          onChange={(event) => onDoctorChange(event.target.value)}
          className={selectClass}
          disabled={!filters.providerId}
        >
          <option value="">{t.providers_all}</option>
          {filterDoctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctorLabel(doctor, lang)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.patients_assign_owner}>
        <NativeComboboxSelect
          value={filters.ownerUserId}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              ownerUserId: event.target.value,
            }))
          }
          className={selectClass}
        >
          <option value="">{tr.providers_all}</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name} · {roleLabel(member.role)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field
        label={
          tr.role_interpreter ??
          appointmentText("appointments_interpreter")
        }
      >
        <NativeComboboxSelect
          value={filters.interpreterId}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              interpreterId: event.target.value,
            }))
          }
          className={selectClass}
        >
          <option value="">{t.providers_all}</option>
          {interpreters.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name} · {roleLabel(member.role)}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
        <Field label={tr.providers_service_valid_from}>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                dateFrom: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
        <Field label={tr.providers_service_valid_to}>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                dateTo: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
      </div>
    </AppointmentEditorSheet>
  );
}

export const MemoizedSearchSheet = memo(SearchSheet);
