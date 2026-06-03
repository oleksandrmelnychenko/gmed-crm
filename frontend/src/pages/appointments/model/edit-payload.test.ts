import { describe, expect, it } from "vitest";

import {
  buildEditAppointmentUpdatePayload,
  defaultEditAppointmentRecurrenceScope,
} from "./edit-payload";
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
  recurrence_count: 5,
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
  repeatCount: "7",
  repeatUntil: "2026-09-01",
} satisfies AppointmentFormState;

describe("buildEditAppointmentUpdatePayload", () => {
  it("defaults recurring appointment edits to the whole series scope", () => {
    expect(defaultEditAppointmentRecurrenceScope(detail)).toBe("series");
    expect(
      defaultEditAppointmentRecurrenceScope({
        ...detail,
        recurrence_frequency: null,
        recurrence_series_id: null,
      }),
    ).toBe("single");
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
        recurrence_count: 7,
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
});
