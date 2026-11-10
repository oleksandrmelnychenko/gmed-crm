import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ActiveOrderPhase, TaskItem } from "../model/staff-dashboard-types";
import { ExecutiveBusinessMap } from "./executive-business-map";

function openTasks(count: number): TaskItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`,
    title: `Synthetic task ${index}`,
    priority: "medium",
    status: "open",
  }));
}

function render({
  taskCount = 0,
  phases = [],
  orders = 0,
  newPatients = 0,
}: {
  taskCount?: number;
  phases?: ActiveOrderPhase[];
  orders?: number;
  newPatients?: number;
}) {
  return renderToStaticMarkup(
    <ExecutiveBusinessMap
      activeOrderPhases={phases}
      activePatientCount={22}
      finance={null}
      greeting="Добрый день, Synthetic CEO"
      loading={false}
      monthly={[]}
      newPatientsThisMonth={newPatients}
      openTasksCount={taskCount}
      operations={null}
      overview={{ patients: 22, leads: 0, orders, appointments: 0, cases: 0, users: 0 }}
      tasks={openTasks(taskCount)}
      upcoming={[]}
      go={() => undefined}
    />,
  );
}

describe("ExecutiveBusinessMap", () => {
  it("declines the open actions by their count", () => {
    expect(render({ taskCount: 1 })).toContain("1 действие требует внимания");
    expect(render({ taskCount: 3 })).toContain("3 действия требуют внимания");
    expect(render({ taskCount: 7 })).toContain("7 действий требуют внимания");
    expect(render({ taskCount: 15 })).toContain("15 действий требуют внимания");
    expect(render({ taskCount: 21 })).toContain("21 действие требует внимания");
    // Open actions and "the company runs stable" are not said together.
    expect(render({ taskCount: 7 })).not.toContain("Компания работает стабильно");
    expect(render({ taskCount: 0 })).toContain("Компания работает стабильно");
  });

  it("counts the phases of the same open orders the number shows", () => {
    const html = render({
      orders: 32,
      phases: [
        { phase: "intake", count: 11 },
        { phase: "discovery", count: 17 },
        { phase: "execution", count: 2 },
        { phase: "closure", count: 1 },
        { phase: "followup", count: 1 },
      ],
    });
    expect(html).toContain("Открытые заказы по фазам:");
    expect(html).toContain("в 5 фазах");
    expect(html).not.toContain("фаз,");

    expect(render({ orders: 4, phases: [{ phase: "intake", count: 4 }] })).toContain("в 1 фазе");
    expect(render({ orders: 0 })).toContain("открытых заказов нет");
  });

  it("says how many of the open actions the queue lists", () => {
    const badge = (html: string) =>
      html.match(/data-testid="executive-queue-count">([^<]*)</)?.[1];
    expect(badge(render({ taskCount: 7 }))).toBe("5 из 7");
    expect(badge(render({ taskCount: 3 }))).toBe("3");
    expect(badge(render({ taskCount: 0 }))).toBe("0");
  });

  it("declines the new patients of the month", () => {
    expect(render({ newPatients: 1 })).toContain("+1 новый в этом месяце");
    expect(render({ newPatients: 4 })).toContain("+4 новых в этом месяце");
  });
});
