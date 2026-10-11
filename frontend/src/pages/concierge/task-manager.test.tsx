import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Lang } from "@/lib/i18n";

import type { ConciergeAssignee, ConciergeTask } from "./model";
import { ConciergeTaskManager } from "./task-manager";

const task = {
  id: "task-1",
  kind: "task",
  title: "Fahrer bestätigen",
  note: null,
  assigned_to: "user-2",
  assigned_to_name: "Test Assistenz",
  assigned_to_active: false,
  assigned_by: "user-1",
  assigned_by_name: "Test Leitung",
  concierge_service_id: null,
  due_at: "2026-10-12T10:00:00.000Z",
  starts_at: null,
  ends_at: null,
  location: null,
  priority: "normal",
  status: "open",
  reminder_at: null,
  reminder_sent_at: null,
  checklist_total: 0,
  checklist_completed: 0,
  comment_count: 0,
  completed_at: null,
  archived_at: null,
  archived_by: null,
  archived_by_name: null,
  created_at: "2026-10-10T08:00:00.000Z",
  updated_at: "2026-10-10T08:00:00.000Z",
  task_audience: "internal",
  patient_id: null,
  patient_name: null,
  provider_id: null,
  provider_name: null,
  project_id: null,
  project_name: null,
  external_assignee_type: null,
  external_assignee_name: null,
} as unknown as ConciergeTask;

const assignees: ConciergeAssignee[] = [
  { id: "user-1", name: "Test Leitung", email: "lead@example.test", role: "ceo", is_active: true },
  { id: "user-2", name: "Test Assistenz", email: "assist@example.test", role: "concierge", is_active: true },
];

function renderManager(lang: Lang) {
  return renderToStaticMarkup(
    createElement(ConciergeTaskManager, {
      tasks: [task],
      refreshing: false,
      assignees,
      lang,
      now: new Date("2026-10-11T08:00:00.000Z"),
      canManageTeam: true,
      updatingTaskId: null,
      deletingTaskId: null,
      archivingTaskId: null,
      canModifyTask: () => true,
      canDeleteTask: () => true,
      canChangeTaskStatus: () => true,
      canAddExpenseToTask: () => false,
      availableStatusesForTask: () => ["open", "in_progress"],
      onEdit: () => undefined,
      onDelete: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onOpen: () => undefined,
      onExpense: () => undefined,
      onStatusChange: async () => null,
    }),
  );
}

describe("ConciergeTaskManager", () => {
  it("labels a deactivated assignee in the language it is given", () => {
    const de = renderManager("de");
    const ru = renderManager("ru");

    expect(de).toContain("Konto deaktiviert – neu zuweisen");
    expect(de).not.toContain("Учётная запись отключена");
    expect(ru).toContain("Учётная запись отключена — переназначьте");
  });

  it("keeps the team list folded on phones with a toggle to open it", () => {
    const html = renderManager("ru");

    expect(html).toContain('data-testid="task-team-workload-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Показать команду (2)");
    expect(html).toMatch(/id="task-manager-team-workload" class="[^"]*\bhidden md:block\b/);
  });
});
