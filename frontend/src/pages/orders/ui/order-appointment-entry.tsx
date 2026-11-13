import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { appointmentSelectControlClassName } from "@/pages/appointments/appearance/surface-appearance";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import { fetchSpecializations } from "@/pages/providers/data/provider-api";
import type { SpecializationItem } from "@/pages/providers/model/types";
import { fetchProvidersBySpecializations } from "@/pages/specializations/data/specialization-work-types-api";
import {
  buildCreateAppointmentPayload,
  validateCreateAppointmentForm,
} from "@/pages/appointments/model/create-payload";
import { blankAppointmentFormForCurrentUser } from "@/pages/appointments/model/form-factories";
import { doctorLabel, useAppointmentLabels } from "@/pages/appointments/model/labels";
import { useScheduleWarnings } from "@/pages/appointments/model/schedule-warnings";
import type {
  ConflictSummary,
  DoctorOption,
  ProviderSummary,
} from "@/pages/appointments/model/types";

import type { PlanningDoctor } from "../model/order-planned-appointments";

const PROVIDERS_CACHE_TTL_MS = 120_000;

type AppointmentEntryRowProps = {
  orderId: string;
  patientId: string;
  doctor: PlanningDoctor;
  lang: string;
  /** Day the row starts with: the doctor's last visit, else today. */
  defaultDate?: string;
  onCreated: (notice: string) => void;
};

/**
 * One line under a doctor to add the next visit (plan stage 3): the same
 * `POST /appointments` and checks as the appointment form, with the doctor,
 * patient and order taken from the plan. The day stays for the next line.
 */
export function AppointmentEntryRow({
  orderId,
  patientId,
  doctor,
  lang,
  defaultDate,
  onCreated,
}: AppointmentEntryRowProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const { t } = useLang();
  const { user } = useAuth();
  const { appointmentText } = useAppointmentLabels();
  const { buildScheduleNotice, formatScheduleConflictError } = useScheduleWarnings();
  const blank = useMemo(
    () => blankAppointmentFormForCurrentUser(user?.id, user?.role),
    [user?.id, user?.role],
  );
  const [date, setDate] = useState(defaultDate ?? blank.date);
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const form = {
      ...blank,
      patientId,
      orderId,
      providerId: doctor.providerId,
      doctorId: doctor.doctorId ?? "",
      appointmentType: "medical" as const,
      title,
      date,
      timeStart,
      timeEnd,
      // The appointment form fills the place from the provider the same way.
      location: doctor.providerName,
    };
    const validation = validateCreateAppointmentForm(form, {
      patientRequired: `${t.orders_patient}: ${t.cf_required}`,
      titleRequired: `${t.appointments_title_col}: ${t.cf_required}`,
      dateRequired: `${t.appointments_date}: ${t.cf_required}`,
      medicalProviderRequired: appointmentText("appointments_medical_provider_required"),
      timePairError: t.appointments_time_pair_error,
      timeRangeError: t.appointments_time_range_error,
      repeatIntervalError: t.appointments_repeat_interval_error,
      repeatRequireEndError: t.appointments_repeat_require_end_error,
    });
    if (validation.error) {
      setError(validation.error);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ id: string; conflicts?: ConflictSummary }>(
        "/appointments",
        {
          method: "POST",
          body: JSON.stringify(
            buildCreateAppointmentPayload(form, validation.repeatInterval, validation.repeatCount),
          ),
        },
      );
      setTitle("");
      setTimeStart("");
      setTimeEnd("");
      onCreated(buildScheduleNotice(result.conflicts, []));
      titleRef.current?.focus();
    } catch (submitError) {
      setError(
        formatScheduleConflictError(
          submitError,
          appointmentText("appointments_failed_to_create_appointment"),
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="order-appointment-entry"
      className="bg-orange-50/50 px-3 py-2 dark:bg-orange-950/20"
    >
      <div className="grid gap-2 sm:grid-cols-[9.5rem_6rem_6rem_minmax(0,1fr)_auto]">
        <Input
          type="date"
          aria-label={t.appointments_date}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-8 text-[13px]"
        />
        <Input
          type="time"
          aria-label={appointmentText("appointments_start")}
          value={timeStart}
          onChange={(event) => setTimeStart(event.target.value)}
          className="h-8 text-[13px]"
        />
        <Input
          type="time"
          aria-label={appointmentText("appointments_end")}
          value={timeEnd}
          onChange={(event) => setTimeEnd(event.target.value)}
          className="h-8 text-[13px]"
        />
        <Input
          ref={titleRef}
          aria-label={t.appointments_title_col}
          placeholder={tx("Название приёма", "Bezeichnung des Termins")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-8 text-[13px]"
        />
        <Button type="submit" size="sm" className="h-8 gap-1.5 rounded-lg" disabled={busy}>
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {tx("Добавить", "Hinzufügen")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}

type PlanningDoctorPickerProps = {
  lang: string;
  onAdd: (doctor: PlanningDoctor) => void;
  /** In the planning grid's narrow doctor column: fields stacked, one per line. */
  stacked?: boolean;
  /**
   * Specialization codes the request asked for (a lead's «Специализации»):
   * the picker starts on the first of them and lists them first.
   */
  preferredSpecialtyCodes?: readonly string[];
};

type PickerProvider = Pick<ProviderSummary, "id" | "name" | "address_city">;

/** Specializations with the requested ones first, the rest by the directory's order. */
export function orderSpecializations(
  items: readonly SpecializationItem[],
  preferredCodes: readonly string[],
): SpecializationItem[] {
  const rank = (item: SpecializationItem) => {
    // The lead wizard stores the code, or the English name when a code is missing.
    const index = preferredCodes.findIndex((code) => code === item.code || code === item.name_en);
    return index < 0 ? preferredCodes.length : index;
  };
  return items
    .filter((item) => item.is_active)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);
}

export function specializationName(item: SpecializationItem, lang: string) {
  return (lang === "de" ? item.name_de : item.name_ru) || item.name_de || item.name_en || item.code;
}

/** «Добавить врача»: a medical provider and, if it has them, one of its doctors. */
export function PlanningDoctorPicker({
  lang,
  onAdd,
  stacked = false,
  preferredSpecialtyCodes = [],
}: PlanningDoctorPickerProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [specializations, setSpecializations] = useState<SpecializationItem[] | null>(null);
  const [specializationId, setSpecializationId] = useState("");
  const [specializationProviders, setSpecializationProviders] = useState<{
    specializationId: string;
    items: PickerProvider[];
  } | null>(null);
  const preferredKey = preferredSpecialtyCodes.join(",");
  const [providerId, setProviderId] = useState("");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || providers) return;
    let cancelled = false;
    apiFetch<ProviderSummary[]>("/providers", { cacheTtlMs: PROVIDERS_CACHE_TTL_MS })
      .then((rows) => {
        if (!cancelled) {
          setProviders(rows.filter((provider) => provider.provider_type !== "non_medical"));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [open, providers]);

  useEffect(() => {
    if (!open || specializations) return;
    let cancelled = false;
    fetchSpecializations()
      .then((items) => {
        if (cancelled) return;
        const preferred = preferredKey ? preferredKey.split(",") : [];
        const ordered = orderSpecializations(items, preferred);
        setSpecializations(ordered);
        const first = ordered.find(
          (item) => preferred.includes(item.code) || preferred.includes(item.name_en),
        );
        if (first) setSpecializationId(first.id);
      })
      .catch(() => {
        if (!cancelled) setSpecializations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, specializations, preferredKey]);

  useEffect(() => {
    setProviderId("");
    if (!specializationId) return;
    let cancelled = false;
    fetchProvidersBySpecializations([specializationId])
      .then((items) => {
        if (cancelled) return;
        setSpecializationProviders({
          specializationId,
          items: items
            .filter((item) => item.provider_type !== "non_medical" && item.is_active)
            .map((item) => ({ id: item.id, name: item.name, address_city: item.address_city })),
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [specializationId]);

  useEffect(() => {
    setDoctorId("");
    if (!providerId) {
      setDoctors([]);
      return;
    }
    let cancelled = false;
    getProviderDoctors(providerId)
      .then((rows) => {
        if (!cancelled) setDoctors(rows);
      })
      .catch(() => {
        if (!cancelled) setDoctors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-lg"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        {tx("Добавить врача", "Arzt hinzufügen")}
      </Button>
    );
  }

  // A chosen specialization narrows the clinics to the ones that offer it.
  const shownProviders: PickerProvider[] | null = specializationId
    ? specializationProviders?.specializationId === specializationId
      ? specializationProviders.items
      : null
    : providers;
  const provider = shownProviders?.find((item) => item.id === providerId) ?? null;
  const specializationLabel = tx("Специализация", "Fachrichtung");
  const doctor = doctors.find((item) => item.id === doctorId) ?? null;
  const providerLabel = tx("Клиника / провайдер", "Klinik / Anbieter");
  const doctorFieldLabel = tx("Врач", "Arzt");

  return (
    <div
      data-testid="order-planning-doctor-picker"
      className={cn(
        "space-y-2 rounded-lg border border-border/70 bg-muted/20",
        stacked ? "p-2" : "p-3",
      )}
    >
      <div
        className={cn(
          "grid gap-2",
          stacked
            ? "grid-cols-1"
            : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]",
        )}
      >
        <NativeComboboxSelect
          aria-label={specializationLabel}
          value={specializationId}
          onChange={(event) => setSpecializationId(event.target.value)}
          missingValueLabel={specializations ? undefined : tx("Загрузка…", "Wird geladen…")}
          className={appointmentSelectControlClassName}
        >
          <option value="">{tx("Все специализации", "Alle Fachrichtungen")}</option>
          {(specializations ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {preferredSpecialtyCodes.some((code) => code === item.code || code === item.name_en)
                ? `${specializationName(item, lang)} · ${tx("в запросе", "angefragt")}`
                : specializationName(item, lang)}
            </option>
          ))}
        </NativeComboboxSelect>
        <NativeComboboxSelect
          aria-label={providerLabel}
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
          missingValueLabel={shownProviders ? undefined : tx("Загрузка…", "Wird geladen…")}
          className={appointmentSelectControlClassName}
        >
          <option value="">
            {shownProviders && shownProviders.length === 0
              ? tx("Нет клиник с этой специализацией", "Keine Klinik mit dieser Fachrichtung")
              : providerLabel}
          </option>
          {(shownProviders ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.address_city ? `${item.name} · ${item.address_city}` : item.name}
            </option>
          ))}
        </NativeComboboxSelect>
        <NativeComboboxSelect
          aria-label={doctorFieldLabel}
          value={doctorId}
          disabled={!providerId || doctors.length === 0}
          onChange={(event) => setDoctorId(event.target.value)}
          className={appointmentSelectControlClassName}
        >
          <option value="">
            {providerId && doctors.length === 0
              ? tx("Без врача", "Ohne Arzt")
              : doctorFieldLabel}
          </option>
          {doctors.map((item) => (
            <option key={item.id} value={item.id}>
              {doctorLabel(item, de ? "de" : "ru")}
            </option>
          ))}
        </NativeComboboxSelect>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg"
          disabled={!provider}
          onClick={() => {
            if (!provider) return;
            onAdd({
              providerId: provider.id,
              providerName: provider.name,
              doctorId: doctor?.id ?? null,
              doctorName: doctor?.name ?? null,
            });
            setOpen(false);
            setProviderId("");
          }}
        >
          {tx("Добавить", "Hinzufügen")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          onClick={() => setOpen(false)}
        >
          {tx("Отмена", "Abbrechen")}
        </Button>
      </div>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
