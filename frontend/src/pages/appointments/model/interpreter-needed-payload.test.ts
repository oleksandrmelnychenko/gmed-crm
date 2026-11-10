import { describe, expect, it } from "vitest";

import { buildCreateAppointmentPayload } from "./create-payload";
import { buildEditAppointmentUpdatePayload } from "./edit-payload";
import {
  blankAppointmentForm,
  buildEditAppointmentForm,
  hasAppointmentFormChanges,
} from "./form-factories";
import type { AppointmentDetail } from "./types";

const detail = {
  id: "appointment-1",
  title: "Control visit",
  date: "2026-06-30",
  time_start: "09:00",
  time_end: "10:00",
  type: "medical",
  care_path_kind: "regular",
  status: "planned",
  location: null,
  interpreter_response: null,
  checklist_phase: "preparation",
  patient_id: "patient-1",
  provider_id: "provider-1",
  doctor_id: null,
  owner_user_id: null,
  interpreter_id: null,
  interpreter_name: null,
  recurrence_frequency: null,
  recurrence_interval: null,
  recurrence_end_mode: null,
  recurrence_count: null,
  recurrence_until: null,
  recurrence_series_size: 1,
  category: null,
  notes: null,
  order_id: null,
} as unknown as AppointmentDetail;

function editPayload(
  current: AppointmentDetail,
  interpreterNeeded: boolean | undefined,
) {
  return buildEditAppointmentUpdatePayload({
    detail: current,
    form: { ...buildEditAppointmentForm(current), interpreterNeeded },
    recurrenceScope: "single",
    canEditAppointmentType: true,
    canManageChecklist: false,
  }).payload;
}

describe("the visit's mark «an interpreter is needed»", () => {
  const createForm = {
    ...blankAppointmentForm(),
    patientId: "patient-1",
    title: "Visit",
    date: "2026-10-02",
  };

  it("is not sent for a new visit nobody marked: the order's planning decides", () => {
    expect("interpreter_needed" in buildCreateAppointmentPayload(createForm)).toBe(
      false,
    );
  });

  it("is sent for a new medical visit that was marked", () => {
    expect(
      buildCreateAppointmentPayload({ ...createForm, interpreterNeeded: true }),
    ).toMatchObject({ interpreter_needed: true });
  });

  it("is never sent for a non-medical visit", () => {
    expect(
      "interpreter_needed" in
        buildCreateAppointmentPayload({
          ...createForm,
          appointmentType: "non_medical",
          interpreterNeeded: true,
        }),
    ).toBe(false);
  });

  it("is not sent by an edit that did not touch it", () => {
    expect("interpreter_needed" in editPayload(detail, undefined)).toBe(false);
    expect(
      "interpreter_needed" in
        editPayload({ ...detail, interpreter_needed: true }, undefined),
    ).toBe(false);
    // Ticked and unticked again: the same answer as stored.
    expect("interpreter_needed" in editPayload(detail, false)).toBe(false);
  });

  it("is sent by an edit that changed it, in both directions", () => {
    expect(editPayload(detail, true).interpreter_needed).toBe(true);
    expect(
      editPayload({ ...detail, interpreter_needed: true }, false).interpreter_needed,
    ).toBe(false);
  });

  it("counts as a change of the edit form", () => {
    const initial = buildEditAppointmentForm(detail);
    expect(hasAppointmentFormChanges(initial, initial)).toBe(false);
    expect(
      hasAppointmentFormChanges({ ...initial, interpreterNeeded: true }, initial),
    ).toBe(true);
  });
});
