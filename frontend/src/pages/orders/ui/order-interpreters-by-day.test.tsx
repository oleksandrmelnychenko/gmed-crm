import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  batchFailureMessage,
  batchFailures,
  defaultDaySelection,
  interpreterDays,
  needsInterpreter,
} from "../model/order-interpreters-by-day";
import type { OrderPipelineAppointment } from "../model/order-pipeline";
import { InterpreterDaysTable, OrderInterpretersByDay } from "./order-interpreters-by-day";

const auth = vi.hoisted(() => ({ capabilities: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { role: "patient_manager", capabilities: auth.capabilities } }),
}));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  hasCapability: (_actor: unknown, capability: string) => auth.capabilities.includes(capability),
}));

function appointment(
  id: string,
  overrides: Partial<OrderPipelineAppointment> = {},
): OrderPipelineAppointment {
  return {
    id,
    title: `Visit ${id}`,
    appointment_type: "medical",
    date: "2026-11-10",
    time_start: "09:00",
    time_end: "10:00",
    status: "confirmed",
    location: null,
    provider_name: "Klinik",
    doctor_name: "Dr. Weber",
    interpreter_id: null,
    interpreter_name: null,
    interpreter_response: null,
    ...overrides,
  };
}

const plan = [
  appointment("a"),
  appointment("b", {
    time_start: "11:00",
    interpreter_id: "int-1",
    interpreter_name: "Anna Dolmetsch",
    interpreter_response: "accepted",
  }),
  appointment("c", { appointment_type: "non_medical", time_start: "14:00" }),
  appointment("d", { date: "2026-11-11", status: "completed" }),
  appointment("e", { date: "2026-11-11", status: "cancelled" }),
  appointment("f", {
    date: "2026-11-12",
    interpreter_id: "int-2",
    interpreter_name: "Boris",
    interpreter_response: "declined",
  }),
];

describe("interpreter days model", () => {
  it("groups by day and counts open medical visits still without an interpreter", () => {
    const days = interpreterDays(plan);
    expect(days.map((day) => day.date)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(days[0].missingCount).toBe(1);
    expect(days[0].assignableIds).toEqual(["a", "b", "c"]);
    // A completed visit takes no interpreter; the cancelled one is not in the plan.
    expect(days[1].appointments.map((item) => item.id)).toEqual(["d"]);
    expect(days[1].assignableIds).toEqual([]);
    expect(days[1].missingCount).toBe(0);
    // A declined booking counts as missing.
    expect(needsInterpreter(plan[5])).toBe(true);
    expect(days[2].missingCount).toBe(1);
  });

  it("preselects the uncovered visits, or the whole day when every one is covered", () => {
    const [first, , third] = interpreterDays(plan);
    expect(defaultDaySelection(first)).toEqual(["a", "c"]);
    expect(defaultDaySelection(third)).toEqual(["f"]);
    const covered = interpreterDays([
      appointment("x", { interpreter_id: "i", interpreter_name: "Iwan", interpreter_response: "pending" }),
      appointment("y", { time_start: "12:00", interpreter_id: "i", interpreter_name: "Iwan" }),
    ]);
    expect(defaultDaySelection(covered[0])).toEqual(["x", "y"]);
  });

  it("reads the per-appointment refusals of the batch endpoint", () => {
    expect(
      batchFailures({
        message: "Some appointments cannot take the interpreter",
        failures: [
          { appointment_id: "a", code: "schedule_conflict", message: "Appointment conflict" },
          { code: "broken" },
        ],
      }),
    ).toEqual([{ appointment_id: "a", code: "schedule_conflict", message: "Appointment conflict" }]);
    expect(batchFailures(null)).toEqual([]);
    expect(batchFailures({ message: "x" })).toEqual([]);
  });

  it("words a refusal in the UI language, a conflict through the appointment form's formatter", () => {
    const formatConflict = vi.fn((error: unknown) =>
      `formatted:${(error as { body: { appointment_id: string } }).body.appointment_id}`,
    );
    const conflict = {
      appointment_id: "a",
      code: "schedule_conflict",
      message: "Appointment conflict: selected slot overlaps with existing interpreter booking Resource unavailable",
    };
    expect(batchFailureMessage(conflict, "ru", formatConflict)).toBe("formatted:a");
    expect(formatConflict).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409, body: conflict }),
      "Конфликт по времени с другим приёмом.",
    );
    expect(
      batchFailureMessage({ appointment_id: "b", code: "appointment_closed" }, "ru", formatConflict),
    ).toBe("Приём завершён или отменён: переводчика не изменить.");
    expect(
      batchFailureMessage({ appointment_id: "b", code: "not_in_order" }, "de", formatConflict),
    ).toBe("Der Termin gehört nicht zu diesem Auftrag.");
    expect(
      batchFailureMessage({ appointment_id: "b", code: "unknown", message: "raw" }, "ru", formatConflict),
    ).toBe("raw");
  });
});

describe("InterpreterDaysTable", () => {
  it("shows the interpreter per row and the day action in Russian", () => {
    const html = renderToStaticMarkup(
      <InterpreterDaysTable days={interpreterDays(plan)} lang="ru" locked={false} onAssignDay={() => {}} />,
    );
    expect(html).toContain("Anna Dolmetsch");
    expect(html).toContain("принял");
    expect(html).toContain("нужен переводчик");
    expect(html).toContain("без переводчика: 1");
    // Two days still take an interpreter; the day with only a completed visit does not.
    expect(html.match(/Назначить переводчика на день/g)).toHaveLength(2);
    // The answer badge may wrap on a phone instead of leaving the card.
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("flex-wrap items-center gap-x-2");
  });

  it("offers no action on a locked order", () => {
    const html = renderToStaticMarkup(
      <InterpreterDaysTable days={interpreterDays(plan)} lang="de" locked onAssignDay={() => {}} />,
    );
    expect(html).toContain("Dolmetscher nötig");
    expect(html).not.toContain("Dolmetscher für den Tag");
  });
});

describe("OrderInterpretersByDay", () => {
  it("is hidden from users who cannot assign interpreters", () => {
    auth.capabilities = [];
    expect(
      renderToStaticMarkup(
        <OrderInterpretersByDay orderId="o-1" patientId="p-1" lang="ru" reloadNonce={0} />,
      ),
    ).toBe("");
  });

  it("renders the block for users who assign interpreters", () => {
    auth.capabilities = ["appointments.assign_interpreter"];
    const html = renderToStaticMarkup(
      <OrderInterpretersByDay orderId="o-1" patientId="p-1" lang="ru" reloadNonce={0} />,
    );
    expect(html).toContain("Переводчики по дням");
    expect(
      renderToStaticMarkup(
        <OrderInterpretersByDay orderId="o-1" patientId={null} lang="ru" reloadNonce={0} />,
      ),
    ).toBe("");
  });
});
