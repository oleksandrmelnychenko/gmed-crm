import { describe, expect, it } from "vitest";

import {
  buildCreateAppointmentPayload,
  validateCreateAppointmentForm,
  type CreateAppointmentValidationMessages,
} from "./create-payload";
import { blankAppointmentForm } from "./form-factories";

const messages = {
  patientRequired: "Patient: required",
  titleRequired: "Title: required",
  dateRequired: "Date: required",
  medicalProviderRequired: "Medical appointments require a provider",
  timePairError: "Provide both times or neither",
  timeRangeError: "End must be after start",
  repeatIntervalError: "Repeat interval is invalid",
  repeatRequireEndError: "Repeat needs count or end",
} satisfies CreateAppointmentValidationMessages;

describe("validateCreateAppointmentForm", () => {
  it("returns user-facing required field errors in form order", () => {
    expect(validateCreateAppointmentForm(blankAppointmentForm(), messages).error).toBe(
      "Patient: required",
    );

    expect(
      validateCreateAppointmentForm(
        {
          ...blankAppointmentForm(),
          patientId: "patient-1",
        },
        messages,
      ).error,
    ).toBe("Title: required");

    expect(
      validateCreateAppointmentForm(
        {
          ...blankAppointmentForm(),
          patientId: "patient-1",
          title: "Consultation",
          date: "",
        },
        messages,
      ).error,
    ).toBe("Date: required");
  });

  it("allows explicit medical provider opt-out but validates recurrence endings", () => {
    const form = {
      ...blankAppointmentForm(),
      patientId: "patient-1",
      title: "Consultation",
      date: "2026-06-30",
      appointmentType: "medical",
      providerId: "",
      skipMedicalProviderBinding: true,
      repeatEnabled: true,
      repeatInterval: "1",
      repeatCount: "",
      repeatUntil: "",
    } as const;

    expect(validateCreateAppointmentForm(form, messages).error).toBe(
      "Repeat needs count or end",
    );
  });

  it("rejects one-sided and non-increasing appointment times", () => {
    const validBase = {
      ...blankAppointmentForm(),
      patientId: "patient-1",
      title: "Consultation",
      date: "2026-06-30",
      appointmentType: "non_medical",
    } as const;

    expect(
      validateCreateAppointmentForm(
        { ...validBase, timeStart: "09:00", timeEnd: "" },
        messages,
      ).error,
    ).toBe("Provide both times or neither");
    expect(
      validateCreateAppointmentForm(
        { ...validBase, timeStart: "10:00", timeEnd: "10:00" },
        messages,
      ).error,
    ).toBe("End must be after start");
    expect(
      validateCreateAppointmentForm(
        { ...validBase, timeStart: "10:00", timeEnd: "09:00" },
        messages,
      ).error,
    ).toBe("End must be after start");
  });
});

describe("buildCreateAppointmentPayload", () => {
  it("keeps time, category, notes and recurrence fields in create payloads", () => {
    const payload = buildCreateAppointmentPayload(
      {
        ...blankAppointmentForm(),
        patientId: "patient-1",
        providerId: "provider-1",
        doctorId: "doctor-1",
        ownerUserId: "owner-1",
        appointmentType: "medical",
        carePathKind: "control",
        title: " Follow-up ",
        date: "2026-06-30",
        timeStart: "18:20",
        timeEnd: "22:20",
        location: " Room 4 ",
        category: "second_opinion",
        notes: " Bring previous reports ",
        repeatEnabled: true,
        repeatFrequency: "weekly",
        repeatInterval: "2",
        repeatCount: "6",
        repeatUntil: "",
      },
      2,
      6,
    );

    expect(payload).toEqual(
      expect.objectContaining({
        care_path_kind: "control",
        category: "second_opinion",
        date: "2026-06-30",
        notes: "Bring previous reports",
        recurrence_count: 6,
        recurrence_frequency: "weekly",
        recurrence_interval: 2,
        recurrence_until: null,
        time_end: "22:20",
        time_start: "18:20",
        title: "Follow-up",
      }),
    );
  });

  it("uses only the explicitly selected count recurrence ending", () => {
    const payload = buildCreateAppointmentPayload(
      {
        ...blankAppointmentForm(),
        patientId: "patient-1",
        providerId: "provider-1",
        appointmentType: "medical",
        title: "Monthly follow-up",
        date: "2026-06-02",
        repeatEnabled: true,
        repeatFrequency: "monthly",
        repeatInterval: "1",
        repeatEndMode: "count",
        repeatCount: "2",
        repeatUntil: "2026-06-09",
      },
      1,
      2,
    );

    expect(payload).toEqual(
      expect.objectContaining({
        recurrence_count: 2,
        recurrence_frequency: "monthly",
        recurrence_interval: 1,
        recurrence_until: null,
      }),
    );
  });

  it("uses only the explicitly selected until recurrence ending", () => {
    const payload = buildCreateAppointmentPayload(
      {
        ...blankAppointmentForm(),
        patientId: "patient-1",
        providerId: "provider-1",
        appointmentType: "medical",
        title: "Weekly follow-up",
        date: "2026-06-02",
        repeatEnabled: true,
        repeatFrequency: "weekly",
        repeatInterval: "1",
        repeatEndMode: "until",
        repeatCount: "",
        repeatUntil: "2026-06-30",
      },
      1,
      null,
    );

    expect(payload).toEqual(
      expect.objectContaining({
        recurrence_count: null,
        recurrence_frequency: "weekly",
        recurrence_interval: 1,
        recurrence_until: "2026-06-30",
      }),
    );
  });

  it("sends the medical provider binding opt-out only for providerless medical appointments", () => {
    const payload = buildCreateAppointmentPayload({
      ...blankAppointmentForm(),
      patientId: "patient-1",
      appointmentType: "medical",
      providerId: "",
      skipMedicalProviderBinding: true,
      title: "No provider case",
      date: "2026-06-30",
    });

    expect(payload.skip_medical_provider_binding).toBe(true);
    expect(payload.provider_id).toBeNull();
  });

  it("preserves a one-sided time so backend validation cannot be bypassed", () => {
    const payload = buildCreateAppointmentPayload({
      ...blankAppointmentForm(),
      patientId: "patient-1",
      appointmentType: "non_medical",
      title: "All-day fallback",
      date: "2026-06-30",
      timeStart: "09:00",
      timeEnd: "",
    });

    expect(payload.time_start).toBe("09:00");
    expect(payload.time_end).toBeNull();
  });
});
