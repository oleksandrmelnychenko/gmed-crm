import {
  memo,
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
import type {
  DoctorOption,
  FiltersState,
  InterpreterOption,
  PatientSummary,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
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
  filterDoctors,
  staff,
  interpreters,
  onReset,
  onPatientChange,
  onProviderChange,
  onDoctorChange,
}: SearchSheetProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

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
        <select
          value={filters.appointmentType}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              appointmentType: event.target.value,
            }))
          }
          className={selectClass}
        >
          <option value="">{t.providers_all}</option>
          {TYPE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {appointmentTypeLabel(value, tr)}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={appointmentText(
          "Versorgungspfad",
          "Траектория лечения",
          "Care path",
        )}
      >
        <select
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
        </select>
      </Field>
      <Field label={t.users_status}>
        <select
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
        </select>
      </Field>
      <Field label={t.orders_patient}>
        <select
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
        </select>
      </Field>
      <Field label={t.common_provider}>
        <select
          value={filters.providerId}
          onChange={(event) => onProviderChange(event.target.value)}
          className={selectClass}
        >
          <option value="">{tr.providers_all}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.common_doctor}>
        <select
          value={filters.doctorId}
          onChange={(event) => onDoctorChange(event.target.value)}
          className={selectClass}
          disabled={!filters.providerId}
        >
          <option value="">{t.providers_all}</option>
          {filterDoctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctorLabel(doctor)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.patients_assign_owner}>
        <select
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
        </select>
      </Field>
      <Field
        label={
          tr.role_interpreter ??
          appointmentText("Dolmetscher", "Переводчик", "Interpreter")
        }
      >
        <select
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
        </select>
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
