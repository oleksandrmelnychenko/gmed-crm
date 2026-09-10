import { expect, test, type Page } from "@playwright/test";
import type { ConciergeTask } from "../../src/pages/concierge/model";

const titles = { root: "Подготовить визит", child: "Проверить документы", event: "Встреча с врачом", nested: "Уточнить время", done: "Отправить маршрут", archived: "Прошлая поездка" };
const updatedAt = "2026-09-10T10:00:00Z";

function task(id: string, patch: Partial<ConciergeTask> = {}): ConciergeTask {
  return {
    id, kind: "task", title: id, note: null, assigned_to: "tester", assigned_to_name: "Test Manager", assigned_by: "tester", assigned_by_name: "Test Manager", assigned_by_role: "ceo",
    concierge_service_id: null, due_at: "2026-09-11T15:00:00Z", starts_at: "2026-09-10T12:00:00Z", ends_at: "2026-09-11T15:00:00Z", location: null,
    priority: "high", status: "open", reminder_at: null, reminder_sent_at: null, checklist_total: 0, checklist_completed: 0, comment_count: 0,
    completed_at: null, archived_at: null, archived_by: null, archived_by_name: null, created_at: updatedAt, updated_at: updatedAt,
    task_audience: "internal", patient_id: null, patient_name: null, patient_birth_date: null, provider_id: null, provider_name: null, provider_phone: null, provider_email: null,
    project_id: null, project_name: null, external_assignee_type: null, external_assignee_name: null, external_assignee_phone: null, external_assignee_email: null,
    parent_task_id: null, child_count: 0, ...patch,
  };
}

async function setup(page: Page, lang: "ru" | "de" = "ru", readonly = false) {
  const state = {
    rows: [
      task("root", { title: titles.root, status: "in_progress", child_count: 4 }),
      task("child", { title: titles.child, parent_task_id: "root", child_count: 1 }),
      task("event", { title: titles.event, parent_task_id: "root", kind: "event", status: "in_progress" }),
      task("nested", { title: titles.nested, parent_task_id: "child", kind: "event", status: "on_hold" }),
      task("done", { title: titles.done, parent_task_id: "root", status: "completed", completed_at: updatedAt }),
      task("archived", { title: titles.archived, parent_task_id: "root", status: "completed", completed_at: updatedAt, archived_at: updatedAt }),
      task("unrelated", { title: "Другая задача" }),
      task("empty", { title: "Без подзадач" }),
    ],
    mutations: [] as { id: string; status: string; expected_updated_at: string }[],
    fail: 0, delay: 0, reads: 0,
  };
  if (readonly) state.rows = state.rows.map(row => ({ ...row, assigned_to: "owner", assigned_by: "owner", assigned_by_role: "ceo" }));
  await page.addInitScript(language => {
    localStorage.setItem("gmed_access_token", "task-workflow-test");
    localStorage.setItem("gmed_refresh_token", "task-workflow-refresh");
    localStorage.setItem("gmed_lang", language);
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: { id: "tester", name: "Test Manager", email: "tester@example.test", role: readonly ? "ceo_assistant" : "ceo" } });
    if (path === "/concierge-operational-items") { state.reads++; return route.fulfill({ json: state.rows }); }
    if (path === "/concierge-operational-items/assignees") return route.fulfill({ json: [{ id: "tester", name: "Test Manager", role: readonly ? "ceo_assistant" : "ceo", is_active: true }] });
    const match = path.match(/^\/concierge-operational-items\/([^/]+)\/status$/);
    if (match) {
      const input = route.request().postDataJSON();
      state.mutations.push({ id: match[1], ...input });
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.fail) return route.fulfill({ status: state.fail, json: { message: state.fail === 409 ? "Operational item was changed by another user" : "Temporary failure" } });
      const item = state.rows.find(row => row.id === match[1])!;
      expect(input.expected_updated_at).toBe(item.updated_at);
      item.status = input.status;
      item.updated_at = `2026-09-10T11:00:${String(state.mutations.length).padStart(2, "0")}Z`;
      return route.fulfill({ json: item });
    }
    const detail = state.rows.find(row => path === `/concierge-operational-items/${row.id}`);
    if (detail) return route.fulfill({ json: { item: detail, checklist: [], comments: [], history: [] } });
    if (path.endsWith("/expenses")) return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/expense-context")) return route.fulfill({ json: { patient: null, service: null, task: null, mapped_order: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/task-manager");
  await expect(page.locator('[data-workflow-task-id="root"]')).toBeVisible();
  return state;
}

for (const lang of ["ru", "de"] as const) {
  test(`workflow keeps all descendants and persists independent play/stop in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1720, height: 1120 });
    const state = await setup(page, lang);
    const search = page.getByPlaceholder(lang === "ru" ? "Поиск по задаче, адресу или исполнителю" : "Aufgabe, Ort oder zuständige Person suchen");
    await search.fill(titles.root);
    await page.locator('[data-workflow-task-id="root"]').click();
    const dialog = page.getByTestId("task-workflow-dialog");
    await expect(dialog.getByRole("listitem")).toHaveCount(6);
    await expect(dialog).not.toContainText("Другая задача");
    const child = dialog.getByTestId("workflow-item-child");
    await child.getByRole("button", { name: `${lang === "ru" ? "Запустить" : "Starten"}: ${titles.child}` }).click();
    await expect(child.getByText(lang === "ru" ? "В работе" : "In Arbeit", { exact: true })).toBeVisible();
    expect(state.mutations).toEqual([{ id: "child", status: "in_progress", expected_updated_at: updatedAt }]);
    await dialog.getByTestId("workflow-item-event").getByRole("button", { name: `${lang === "ru" ? "Остановить" : "Stoppen"}: ${titles.event}` }).click();
    await expect(dialog.getByTestId("workflow-item-event").getByText(lang === "ru" ? "На паузе" : "Pausiert", { exact: true })).toBeVisible();
    await dialog.getByTestId("workflow-item-root").getByRole("button", { name: `${lang === "ru" ? "Остановить" : "Stoppen"}: ${titles.root}` }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("workflow-item-root").getByText(lang === "ru" ? "На паузе" : "Pausiert", { exact: true })).toBeVisible();
    expect(state.rows.find(row => row.id === "child")!.status).toBe("in_progress");
    expect(state.rows.find(row => row.id === "nested")!.status).toBe("on_hold");
    await expect(dialog.getByTestId("workflow-item-done").getByRole("button")).toHaveCount(2);
    await expect(dialog.getByTestId("workflow-item-archived").getByRole("button")).toHaveCount(2);
    await page.screenshot({ path: `../artifacts/design-qa/task-workflow-${lang}-desktop.png`, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.x).toBeGreaterThanOrEqual(0);
    const close = dialog.getByRole("button", { name: lang === "ru" ? "Закрыть" : "Schließen", exact: true }).last();
    await expect(close).toBeInViewport();
    await page.screenshot({ path: `../artifacts/design-qa/task-workflow-${lang}-mobile.png`, animations: "disabled" });
    await close.click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.locator('[data-workflow-task-id="root"]').click();
    await expect(dialog.getByTestId("workflow-item-child").getByText(lang === "ru" ? "В работе" : "In Arbeit", { exact: true })).toBeVisible();
    await dialog.getByTestId("workflow-item-nested").getByRole("button", { name: `${lang === "ru" ? "Продолжить" : "Fortsetzen"}: ${titles.nested}` }).click();
    await expect(dialog.getByTestId("workflow-item-nested").getByText(lang === "ru" ? "В работе" : "In Arbeit", { exact: true })).toBeVisible();
  });
}

test("workflow respects permissions and provides an empty state", async ({ page }) => {
  const state = await setup(page, "ru", true);
  await page.locator('[data-workflow-task-id="root"]').click();
  const dialog = page.getByTestId("task-workflow-dialog");
  for (const id of ["root", "child", "event", "nested"]) await expect(dialog.getByTestId(`workflow-item-${id}`).getByRole("button").last()).toBeDisabled();
  expect(state.mutations).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-workflow-task-id="root"]')).toBeFocused();
  await page.locator('[data-workflow-task-id="empty"]').click();
  await expect(dialog.getByText("Подзадач и событий пока нет.")).toBeVisible();
});

test("workflow refreshes a conflicting version and keeps errors next to controls", async ({ page }) => {
  const state = await setup(page);
  await page.locator('[data-workflow-task-id="root"]').click();
  const dialog = page.getByTestId("task-workflow-dialog");
  const start = dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Запустить: ${titles.child}` });
  state.rows.find(row => row.id === "child")!.updated_at = "2026-09-10T10:30:00Z";
  state.fail = 409;
  const reads = state.reads;
  await start.click();
  await expect(dialog.getByRole("alert")).toContainText("Задача уже изменена");
  await expect.poll(() => state.reads).toBeGreaterThan(reads);
  await expect(dialog.getByTestId("workflow-item-child").getByText("Открыта", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toBeInViewport();
  state.fail = 0;
  await start.click();
  await expect(dialog.getByTestId("workflow-item-child").getByText("В работе", { exact: true })).toBeVisible();
  expect(state.mutations[1].expected_updated_at).toBe("2026-09-10T10:30:00Z");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("workflow serializes writes and recovers from a failed status request", async ({ page }) => {
  const state = await setup(page);
  await page.locator('[data-workflow-task-id="root"]').click();
  const dialog = page.getByTestId("task-workflow-dialog");
  state.delay = 500;
  state.fail = 500;
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Запустить: ${titles.child}` }).click();
  await expect(dialog.getByTestId("workflow-item-event").getByRole("button").last()).toBeDisabled();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Не удалось обновить задачу.");
  expect(state.mutations).toHaveLength(1);
  expect(state.rows.find(row => row.id === "child")!.status).toBe("open");
  state.fail = 0;
  state.delay = 0;
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Запустить: ${titles.child}` }).click();
  await expect(dialog.getByTestId("workflow-item-child").getByText("В работе", { exact: true })).toBeVisible();
});

test("subtask count stays stable and paused subtasks have a linked Kanban card", async ({ page }) => {
  await page.setViewportSize({ width: 1720, height: 1120 });
  const state = await setup(page);
  await expect(page.getByTestId("task-sub-count-root")).toHaveText("5");
  await expect(page.getByTestId("task-sub-count-child")).toHaveText("1");
  await page.locator('[data-workflow-task-id="root"]').click();
  const dialog = page.getByTestId("task-workflow-dialog");
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Запустить: ${titles.child}` }).click();
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Остановить: ${titles.child}` }).click();
  await expect(dialog.getByTestId("workflow-item-child").getByText("На паузе", { exact: true })).toBeVisible();
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Показать на доске: ${titles.child}` }).click();
  await expect(dialog).toHaveCount(0);
  const pausedCard = page.getByTestId("task-column-on_hold").getByTestId("task-card-child");
  await expect(pausedCard).toBeInViewport();
  await expect(pausedCard).toBeFocused();
  await expect(pausedCard.getByText("↳ Подзадача", { exact: true })).toBeVisible();
  await expect(page.getByTestId("task-column-in_progress").getByTestId("task-card-root")).toBeVisible();
  await expect(page.getByTestId("task-sub-count-root")).toHaveText("5");
  await page.screenshot({ path: "../artifacts/design-qa/task-workflow-paused-kanban.png" });
  await pausedCard.getByRole("button", { name: `В составе: ${titles.root}` }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(6);
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Продолжить: ${titles.child}` }).click();
  await dialog.getByTestId("workflow-item-child").getByRole("button", { name: `Показать на доске: ${titles.child}` }).click();
  await expect(page.getByTestId("task-column-in_progress").getByTestId("task-card-child")).toBeFocused();
  expect(state.rows.find(row => row.id === "root")!.status).toBe("in_progress");
});

test("show on board reveals a sub-event excluded by current filters", async ({ page }) => {
  await setup(page);
  await page.getByPlaceholder("Поиск по задаче, адресу или исполнителю").fill(titles.root);
  await expect(page.getByTestId("task-sub-count-root")).toHaveText("5");
  await expect(page.getByTestId("task-card-event")).toHaveCount(0);
  await page.locator('[data-workflow-task-id="root"]').click();
  const dialog = page.getByTestId("task-workflow-dialog");
  await dialog.getByTestId("workflow-item-event").getByRole("button", { name: `Остановить: ${titles.event}` }).click();
  await expect(dialog.getByTestId("workflow-item-event").getByText("На паузе", { exact: true })).toBeVisible();
  await dialog.getByTestId("workflow-item-event").getByRole("button", { name: `Показать на доске: ${titles.event}` }).click();
  await expect(page.getByTestId("task-column-on_hold").getByTestId("task-card-event")).toBeFocused();
  await expect(page.getByPlaceholder("Поиск по задаче, адресу или исполнителю")).toHaveValue("");
});

for (const lang of ["ru", "de"] as const) {
  test(`task children use the shared table and keep navigation in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1100 });
    await setup(page, lang);
    await page.getByRole("heading", { name: titles.root, exact: true }).click();
    const section = page.getByTestId("task-children-table");
    const table = section.getByRole("table");
    await expect(table).toHaveAttribute("aria-rowcount", "4");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    await expect(table).not.toContainText(titles.nested);

    const titleLabel = lang === "ru" ? "Название" : "Titel";
    await table.getByRole("columnheader", { name: new RegExp(`^${titleLabel}`) }).click();
    await expect(table.locator('[role="row"][aria-rowindex="2"]')).toContainText(titles.event);

    await section.getByRole("button", { name: lang === "ru" ? "Фильтр" : "Filter", exact: true }).click();
    await section.getByRole("menuitem", { name: titleLabel, exact: true }).click();
    await section.locator("[data-table-filter-editor]").getByRole("textbox").fill(titles.event);
    await section.getByRole("heading").click();
    await expect(table).toHaveAttribute("aria-rowcount", "1");
    await expect(table).toContainText(titles.event);
    await section.locator('[data-filter-field="title"] button[aria-label]').click();
    await expect(table).toHaveAttribute("aria-rowcount", "4");

    const columns = section.getByRole("button", { name: lang === "ru" ? /Колонки/ : /Spalten/ });
    await columns.click();
    await section.getByRole("menuitemcheckbox", { name: "ID", exact: true }).click();
    await columns.click();
    await expect(table.getByRole("columnheader", { name: /^ID/ })).toBeVisible();
    await expect(table).toContainText("TASK-EVENT");
    await columns.click();
    await section.getByRole("menuitemcheckbox", { name: "ID", exact: true }).click();
    await columns.click();
    await page.screenshot({ path: `../artifacts/design-qa/task-children-table-${lang}-desktop.png`, animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 844 });
    const titleButton = section.getByRole("button", { name: titles.event, exact: true });
    await titleButton.scrollIntoViewIfNeeded();
    const box = (await section.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `../artifacts/design-qa/task-children-table-${lang}-mobile.png`, animations: "disabled" });
    await titleButton.click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: titles.event, exact: true })).toBeVisible();
    await page.getByRole("button", { name: lang === "ru" ? "К основной задаче" : "Zur übergeordneten Aufgabe", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: titles.root, exact: true })).toBeVisible();
  });
}
