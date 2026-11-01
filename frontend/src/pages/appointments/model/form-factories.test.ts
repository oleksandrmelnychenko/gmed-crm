import { describe, expect, it } from "vitest";

import {
  appointmentCreateContextFromSearch,
  applyAppointmentCreateContext,
  blankAppointmentForm,
  buildEditAppointmentForm,
  blankAppointmentFormForCurrentUser,
  appointmentReturnPath,
  defaultAppointmentOwnerUserId,
  nextAppointmentForm,
  restoreEditAppointmentRecurrenceFields,
} from "./form-factories";
import type { AppointmentDetail } from "./types";

describe("appointment form factories", () => {
  it("keeps the doctor, place and day for the next appointment of an order", () => {
    const next = nextAppointmentForm({
      ...blankAppointmentForm(),
      patientId: "patient-1",
      orderId: "order-1",
      providerId: "provider-1",
      doctorId: "doctor-1",
      ownerUserId: "user-1",
      interpreterId: "interpreter-1",
      location: "Klinik",
      date: "2026-11-20",
      title: "MRT",
      timeStart: "10:00",
      timeEnd: "11:00",
      category: "Radiologie",
      notes: "nüchtern",
      repeatEnabled: true,
      repeatCount: "8",
    });

    expect(next).toMatchObject({
      patientId: "patient-1",
      orderId: "order-1",
      providerId: "provider-1",
      doctorId: "doctor-1",
      ownerUserId: "user-1",
      location: "Klinik",
      date: "2026-11-20",
      interpreterId: "",
      title: "",
      timeStart: "",
      timeEnd: "",
      category: "",
      notes: "",
      repeatEnabled: false,
      repeatCount: "4",
    });
  });

  it("returns only to a path inside the console", () => {
    const returnPath = (value: string) =>
      appointmentReturnPath(new URLSearchParams({ return_to: value }));

    expect(returnPath("/orders/order-1?section=planning")).toBe(
      "/orders/order-1?section=planning",
    );
    expect(returnPath("//evil.example")).toBe("");
    expect(returnPath("/\\evil.example")).toBe("");
    expect(returnPath("https://evil.example")).toBe("");
    expect(appointmentReturnPath(new URLSearchParams())).toBe("");
  });

  it("defaults the owner to the current non-interpreter user", () => {
    expect(defaultAppointmentOwnerUserId("user-1", "patient_manager")).toBe(
      "user-1",
    );
    expect(blankAppointmentFormForCurrentUser("it-1", "it_admin").ownerUserId).toBe(
      "it-1",
    );
  });

  it("keeps interpreter-created forms without an owner default", () => {
    expect(defaultAppointmentOwnerUserId("interpreter-1", "interpreter")).toBe(
      "",
    );
    expect(
      blankAppointmentFormForCurrentUser("interpreter-1", "interpreter")
      .ownerUserId,
    ).toBe("");
  });

  it("hydrates edit forms with category, notes and recurrence values", () => {
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
      notes: "Keep this note after changing the date",
      order_id: null,
      order_number: null,
      recurrence_parent_series_id: null,
      recurrence_split_from_appointment_id: null,
      recurrence_split_from_index: null,
      recurring_scope_preview: [],
      recurring_lineage_history: [],
      created_at: "2026-06-01T00:00:00Z",
    } satisfies AppointmentDetail;

    const form = buildEditAppointmentForm(detail);

    expect(form.category).toBe("control_visit");
    expect(form.notes).toBe("Keep this note after changing the date");
    expect(form.repeatEnabled).toBe(true);
    expect(form.repeatFrequency).toBe("weekly");
    expect(form.repeatInterval).toBe("2");
    expect(form.repeatEndMode).toBe("count");
    expect(form.repeatCount).toBe("5");
    expect(form.repeatUntil).toBe("");
    expect(
      buildEditAppointmentForm({
        ...detail,
        recurrence_end_mode: undefined,
      }).repeatEndMode,
    ).toBe("count");
  });

  it("restores saved recurrence values when single-scope edits should not update the series rule", () => {
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
      notes: "Keep this note after changing the date",
      order_id: null,
      order_number: null,
      recurrence_parent_series_id: null,
      recurrence_split_from_appointment_id: null,
      recurrence_split_from_index: null,
      recurring_scope_preview: [],
      recurring_lineage_history: [],
      created_at: "2026-06-01T00:00:00Z",
    } satisfies AppointmentDetail;

    const restored = restoreEditAppointmentRecurrenceFields(
      {
        ...buildEditAppointmentForm(detail),
        repeatFrequency: "monthly",
        repeatInterval: "1",
        repeatCount: "9",
        repeatUntil: "",
      },
      detail,
    );

    expect(restored.repeatFrequency).toBe("weekly");
    expect(restored.repeatInterval).toBe("2");
    expect(restored.repeatEndMode).toBe("count");
    expect(restored.repeatCount).toBe("5");
    expect(restored.repeatUntil).toBe("");
  });
});

describe("appointment create context", () => {
  it("reads the patient and order the calendar was opened for", () => {
    expect(
      appointmentCreateContextFromSearch(
        new URLSearchParams("order=order-1&patient=patient-1&view=week"),
      ),
    ).toEqual({ patientId: "patient-1", orderId: "order-1" });
    expect(appointmentCreateContextFromSearch(new URLSearchParams())).toEqual({
      patientId: "",
      orderId: "",
    });
  });

  it("preselects patient and order of the order workspace", () => {
    const form = applyAppointmentCreateContext(
      blankAppointmentFormForCurrentUser("user-1", "patient_manager"),
      { patientId: "patient-1", orderId: "order-1" },
    );

    expect(form.patientId).toBe("patient-1");
    expect(form.orderId).toBe("order-1");
    expect(form.ownerUserId).toBe("user-1");
  });

  it("preselects only the patient when no order is in context", () => {
    const form = applyAppointmentCreateContext(
      { ...blankAppointmentForm(), patientId: "patient-2", orderId: "order-2" },
      { patientId: "patient-1" },
    );

    expect(form.patientId).toBe("patient-1");
    expect(form.orderId).toBe("");
  });

  it("does not take over an order without its patient", () => {
    const blank = blankAppointmentForm();

    expect(applyAppointmentCreateContext(blank, { orderId: "order-1" })).toBe(
      blank,
    );
  });
});
