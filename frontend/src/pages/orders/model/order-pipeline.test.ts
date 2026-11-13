import { describe, expect, it } from "vitest";

import { BLOCKED_MEDICAL_SLOT_TITLE } from "@/lib/blocked-appointment";

import { ORDER_WORKSPACE_SECTIONS, normalizeOrderSectionKey } from "../sections";
import {
  currentPipelineStage,
  localizePipelineAppointments,
  pipelineMissingLabel,
  pipelineStageSection,
  type OrderPipelineStage,
} from "./order-pipeline";

const stage = (key: OrderPipelineStage["key"], state: OrderPipelineStage["state"]): OrderPipelineStage => ({
  key,
  state,
  missing: [],
});

describe("order pipeline", () => {
  it("points at the first stage that still needs work", () => {
    expect(
      currentPipelineStage([
        stage("medical", "not_required"),
        stage("care_team", "done"),
        stage("appointments", "active"),
        stage("execution", "pending"),
        stage("closure", "pending"),
      ]),
    ).toBe("appointments");
    expect(currentPipelineStage([stage("medical", "done"), stage("closure", "done")])).toBeNull();
  });

  it("sends every stage to an existing order section", () => {
    const sections = new Set(ORDER_WORKSPACE_SECTIONS.map((section) => section.key));
    for (const key of ["medical", "care_team", "appointments", "execution", "closure"] as const) {
      expect(sections.has(pipelineStageSection(key))).toBe(true);
    }
    expect(normalizeOrderSectionKey("pipeline")).toBe("pipeline");
  });

  it("localises known reasons and passes unknown ones through", () => {
    expect(pipelineMissingLabel("doctor_missing", "de")).toBe("Kein Arzt ausgewählt");
    expect(pipelineMissingLabel("doctor_missing", "ru")).toBe("Врач не выбран");
    expect(pipelineMissingLabel("something_new", "ru")).toBe("something_new");
  });

  it("localizes only the blocked medical slots of the pipeline", () => {
    const base = {
      appointment_type: "medical",
      date: "2026-11-20",
      time_start: null,
      time_end: null,
      status: "planned",
      location: null,
      provider_name: null,
      doctor_name: null,
      interpreter_name: null,
      interpreter_response: null,
    };
    const localized = localizePipelineAppointments({
      appointments: [
        { ...base, id: "a", title: BLOCKED_MEDICAL_SLOT_TITLE, is_blocked: true },
        { ...base, id: "b", title: "Cardiology follow-up" },
      ],
    });
    expect(localized.appointments[0].title).not.toBe(BLOCKED_MEDICAL_SLOT_TITLE);
    expect(localized.appointments[1].title).toBe("Cardiology follow-up");
  });
});
