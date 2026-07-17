import { describe, expect, it } from "vitest";

import {
  buildEditAppointmentUpdatePayload,
  defaultEditAppointmentRecurrenceScope,
  validateEditAppointmentForm,
} from "./edit-payload";
import { buildEditAppointmentForm } from "./form-factories";
import type { AppointmentDetail, AppointmentFormState } from "./types";

const detail = {
  id: "appointment-1",
  title: "Control visit",
  date: "2026-06-30",
  time_start: "09:00",
  time_end: "10:00",
  type: "medical",
  care_path_kind: "control",
  status: "planned",
  location: "Room 1",
  interpreter_response: null,
  checklist_phase: "preparation",
  patient_id: "patient-1",
  patient_name: "Daniela Tutas",
  patient_pid: "P-20260528-0002",
  provider_id: "provider-1",
  provider_name: "Clinic QA",
  doctor_id: "doctor-1",
  doctor_name: "Dr QA",
  owner_user_id: "owner-1",
  owner_name: "System Admin",
  owner_role: "it_admin",
  interpreter_id: null,
  interpreter_name: null,
  recurrence_series_id: "series-1",
  recurrence_frequency: "weekly",
  recurrence_interval: 2,
  recurrence_end_mode: "count",
  recurrence_count: 3,
  recurrence_until: "2026-08-30",
  recurrence_index: 1,
  recurrence_series_size: 5,
  is_blocked: false,
  category: "control_visit",
  preparation_notes: null,
  followup_notes: null,
  notes: "Original note",
  order_id: null,
  order_number: null,
  recurrence_parent_series_id: null,
  recurrence_split_from_appointment_id: null,
  recurrence_split_from_index: null,
  recurring_scope_preview: [],
  recurring_lineage_history: [],
  created_at: "2026-06-01T00:00:00Z",
} satisfies AppointmentDetail;

const form = {
  patientId: "patient-1",
  providerId: "provider-2",
  providerTaxonomyNodeId: "",
  doctorId: "doctor-2",
  ownerUserId: "owner-2",
  interpreterId: "",
  appointmentType: "medical",
  carePathKind: "control",
  status: "planned",
  checklistPhase: "preparation",
  title: " Updated control visit ",
  date: "2026-07-01",
  timeStart: "11:00",
  timeEnd: "12:00",
  location: " Room 2 ",
  category: "second_opinion",
  notes: " Keep this note after changing the date ",
  skipMedicalProviderBinding: false,
  repeatEnabled: true,
  repeatFrequency: "weekly",
  repeatInterval: "2",
  repeatEndMode: "count",
  repeatCount: "7",
  repeatUntil: "2026-09-01",
} satisfies AppointmentFormState;

const validationMessages = {
  titleRequired: "Title is required",
  dateRequired: "Date is required",
  medicalProviderRequired: "Provider or opt-out required",
  timePairError: "Provide both times or neither",
  timeRangeError: "End must be after start",
  repeatIntervalError: "Repeat interval is invalid",
  repeatRequireEndError: "Choose one recurrence ending",
};

describe("buildEditAppointmentUpdatePayload", () => {
  it("defaults every recurring appointment edit to one occurrence", () => {
    expect(defaultEditAppointmentRecurrenceScope()).toBe("single");
  });

  it("preserves category, notes and recurrence edits for series saves", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form,
      recurrenceScope: "series",
      canEditAppointmentType: true,
      canManageChecklist: true,
    });

    expect(result.applyRecurrenceRule).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        appointment_type: "medical",
        category: "second_opinion",
        checklist_phase: "preparation",
        date: "2026-07-01",
        notes: "Keep this note after changing the date",
        skip_medical_provider_binding: false,
        recurrence_count: 7,
        recurrence_frequency: "weekly",
        recurrence_interval: 2,
        recurrence_scope: "series",
        recurrence_until: null,
      }),
    );
  });

  it("does not let a stale repeat-until date truncate recurrence edits when count is set", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form: {
        ...form,
        repeatFrequency: "monthly",
        repeatInterval: "1",
        repeatCount: "2",
        repeatUntil: "2026-07-01",
      },
      recurrenceScope: "series",
      canEditAppointmentType: false,
      canManageChecklist: false,
    });

    expect(result.applyRecurrenceRule).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        recurrence_count: 2,
        recurrence_frequency: "monthly",
        recurrence_interval: 1,
        recurrence_scope: "series",
        recurrence_until: null,
      }),
    );
  });

  it("sends repeat-until for recurrence edits when count is empty", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form: {
        ...form,
        repeatEndMode: "until",
        repeatCount: "",
        repeatUntil: "2026-09-01",
      },
      recurrenceScope: "series",
      canEditAppointmentType: false,
      canManageChecklist: false,
    });

    expect(result.applyRecurrenceRule).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        recurrence_count: null,
        recurrence_frequency: "weekly",
        recurrence_interval: 2,
        recurrence_scope: "series",
        recurrence_until: "2026-09-01",
      }),
    );
  });

  it("does not send recurrence rule fields for single occurrence edits", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form,
      recurrenceScope: "single",
      canEditAppointmentType: false,
      canManageChecklist: false,
    });

    expect(result.applyRecurrenceRule).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        category: "second_opinion",
        notes: "Keep this note after changing the date",
        recurrence_scope: "single",
      }),
    );
    expect(result.payload).not.toHaveProperty("recurrence_frequency");
    expect(result.payload).not.toHaveProperty("appointment_type");
    expect(result.payload).not.toHaveProperty("checklist_phase");
  });

  it("does not resend recurrence rules for notes-only series edits", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form: {
        ...buildEditAppointmentForm(detail),
        notes: "Updated note only",
      },
      recurrenceScope: "series",
      canEditAppointmentType: false,
      canManageChecklist: false,
    });

    expect(result.applyRecurrenceRule).toBe(false);
    expect(result.payload.notes).toBe("Updated note only");
    expect(result.payload.recurrence_scope).toBe("series");
    expect(result.payload).not.toHaveProperty("recurrence_frequency");
    expect(result.payload).not.toHaveProperty("recurrence_count");
    expect(result.payload).not.toHaveProperty("recurrence_until");
  });

  it("uses total series size as the unchanged count after terminal entries", () => {
    const hydrated = buildEditAppointmentForm(detail);
    expect(hydrated.repeatCount).toBe("5");

    const result = buildEditAppointmentUpdatePayload({
      detail,
      form: hydrated,
      recurrenceScope: "series",
      canEditAppointmentType: false,
      canManageChecklist: false,
    });

    expect(result.applyRecurrenceRule).toBe(false);
    expect(result.payload).not.toHaveProperty("recurrence_count");
  });

  it("sends explicit provider opt-out for an unbound medical edit", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form: {
        ...buildEditAppointmentForm(detail),
        providerId: "",
        doctorId: "",
        skipMedicalProviderBinding: true,
      },
      recurrenceScope: "single",
      canEditAppointmentType: true,
      canManageChecklist: false,
    });

    expect(result.payload.provider_id).toBeNull();
    expect(result.payload.doctor_id).toBeNull();
    expect(result.payload.skip_medical_provider_binding).toBe(true);
  });

  it("preserves one-sided times for backend validation if UI validation is bypassed", () => {
    const result = buildEditAppointmentUpdatePayload({
      detail,
      form: {
        ...buildEditAppointmentForm(detail),
        timeStart: "09:00",
        timeEnd: "",
      },
      recurrenceScope: "single",
      canEditAppointmentType: false,
      canManageChecklist: false,
    });

    expect(result.payload.time_start).toBe("09:00");
    expect(result.payload.time_end).toBeNull();
  });
});

describe("validateEditAppointmentForm", () => {
  it("rejects missing title and date before sending an update", () => {
    expect(
      validateEditAppointmentForm(
        detail,
        { ...form, title: " " },
        "single",
        validationMessages,
      ).error,
    ).toBe("Title is required");
    expect(
      validateEditAppointmentForm(
        detail,
        { ...form, date: "" },
        "single",
        validationMessages,
      ).error,
    ).toBe("Date is required");
  });

  it("rejects one-sided and non-increasing appointment times", () => {
    expect(
      validateEditAppointmentForm(
        detail,
        { ...form, timeStart: "09:00", timeEnd: "" },
        "single",
        validationMessages,
      ).error,
    ).toBe("Provide both times or neither");
    expect(
      validateEditAppointmentForm(
        detail,
        { ...form, timeStart: "10:00", timeEnd: "10:00" },
        "single",
        validationMessages,
      ).error,
    ).toBe("End must be after start");
    expect(
      validateEditAppointmentForm(
        detail,
        { ...form, timeStart: "10:00", timeEnd: "09:00" },
        "single",
        validationMessages,
      ).error,
    ).toBe("End must be after start");
  });

  it("requires a provider or explicit opt-out for medical edits", () => {
    expect(
      validateEditAppointmentForm(
        detail,
        {
          ...form,
          providerId: "",
          doctorId: "",
          skipMedicalProviderBinding: false,
        },
        "single",
        validationMessages,
      ).error,
    ).toBe("Provider or opt-out required");
  });

  it("validates only the selected recurrence end mode", () => {
    expect(
      validateEditAppointmentForm(
        detail,
        {
          ...form,
          repeatEndMode: "until",
          repeatCount: "7",
          repeatUntil: "",
        },
        "series",
        validationMessages,
      ).error,
    ).toBe("Choose one recurrence ending");
  });
});
