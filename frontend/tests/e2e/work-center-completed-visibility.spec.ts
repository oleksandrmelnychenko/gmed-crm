import { expect, test, type Page } from "@playwright/test";

const now = new Date("2026-09-10T12:00:00Z");
const oldId = "10000000-0000-0000-0000-000000000003";

async function mockTasks(page: Page, lang: "ru" | "de", role = "ceo") {
  await page.clock.install({ time: now });
  await page.addInitScript(language => {
    localStorage.setItem("gmed_lang", language);
    localStorage.setItem("gmed_access_token", "completed-visibility-test");
    localStorage.setItem("gmed_refresh_token", "completed-visibility-refresh");
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  const base = {
    kind: "task", note: null, priority: "normal", assigned_to: "tester", assigned_by: "tester",
    assigned_to_name: "Test Manager", assigned_by_name: "Test Manager", assigned_by_role: "ceo",
    task_audience: "internal", concierge_service_id: null, patient_id: null, provider_id: null, project_id: null,
    starts_at: null, ends_at: null, due_at: null, parent_task_id: null, child_count: 0,
    reminder_at: null, reminder_sent_at: null, archived_at: null, archived_by: null, archived_by_name: null,
    completed_at: null, created_at: "2026-08-01T12:00:00Z", updated_at: now.toISOString(),
    checklist_total: 0, checklist_completed: 0, comment_count: 0, attachment_count: 0,
  };
  const state = {
    tasks: [
      { ...base, id: "active", title: "Active task", status: "in_progress" },
      { ...base, id: "recent", title: "Recent completion", status: "completed", completed_at: "2026-09-09T12:00:00Z" },
      { ...base, id: oldId, title: "Old completion", status: "completed", completed_at: "2026-09-01T12:00:00Z" },
      { ...base, id: "archived", title: "Manually archived", status: "completed", completed_at: "2026-08-01T12:00:00Z", archived_at: "2026-08-02T12:00:00Z" },
    ],
    mutations: [] as string[],
  };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const method = route.request().method();
    let body: unknown = [];
    if (path === "/me") body = { id: "tester", name: "Test Manager", email: "test@example.test", role, created_at: base.created_at };
    if (path === "/concierge-operational-items/assignees") body = [{ id: "tester", name: "Test Manager", role, is_active: true }];
    if (path === "/concierge-operational-items") body = state.tasks;
    if (path.endsWith("/expense-context")) body = { patient: null, service: null, task: { currency: "EUR" }, mapped_order: null };
    if (path.endsWith("/expenses")) body = { items: [] };
    if (path === `/concierge-operational-items/${oldId}`) body = { item: state.tasks[2], checklist: [], comments: [], history: [] };
    const archivedTask = state.tasks.find(task => path === `/concierge-operational-items/${task.id}/archive` || path === `/concierge-operational-items/${task.id}/restore`);
    if (archivedTask && method === "POST") {
      state.mutations.push(path);
      archivedTask.archived_at = path.endsWith("/archive") ? now.toISOString() : null;
      return route.fulfill({ json: archivedTask });
    }
    if (path === `/concierge-operational-items/${oldId}/status` && method === "POST") {
      state.mutations.push(path);
      state.tasks[2] = { ...state.tasks[2], status: route.request().postDataJSON().status, completed_at: null };
      body = state.tasks[2];
    } else if (method !== "GET") state.mutations.push(path);
    await route.fulfill({ json: body });
  });
  return state;
}

for (const lang of ["ru", "de"] as const) {
  test(`old completions hide automatically and remain searchable and reopenable in ${lang}`, async ({ page }, info) => {
    const state = await mockTasks(page, lang);
    await page.goto("/task-manager");
    await expect(page.getByRole("heading", { name: "Active task", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent completion", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Old completion", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Manually archived", exact: true })).toHaveCount(0);
    const showCompleted = page.getByRole("button", { name: lang === "ru" ? "Показать выполненные" : "Erledigte anzeigen", exact: true });
    await expect(showCompleted).toBeVisible();
    expect(state.mutations).toEqual([]);
    await page.screenshot({ path: info.outputPath("completed-hidden.png"), fullPage: true });

    const search = page.getByRole("textbox", { name: lang === "ru" ? "Поиск по задаче, адресу или исполнителю" : "Aufgabe, Ort oder zuständige Person suchen" });
    await search.fill("Old completion");
    await expect(page.getByRole("heading", { name: "Old completion", exact: true })).toBeVisible();
    await search.clear();
    await expect(page.getByRole("heading", { name: "Old completion", exact: true })).toHaveCount(0);
    await showCompleted.click();
    const oldCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Old completion", exact: true }) });
    await expect(oldCard).toBeVisible();
    await oldCard.getByRole("combobox", { name: lang === "ru" ? "Изменить статус" : "Status ändern", exact: true }).click();
    await page.getByRole("option", { name: lang === "ru" ? "В работе" : "In Arbeit", exact: true }).click();
    await expect.poll(() => state.tasks[2].status).toBe("in_progress");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Old completion", exact: true })).toBeVisible();
    expect(state.mutations).toEqual([`/concierge-operational-items/${oldId}/status`]);
  });
}

test("an open work center hides a completion when it reaches seven days without a reload", async ({ page }) => {
  const state = await mockTasks(page, "ru");
  state.tasks = [{ ...state.tasks[1], title: "Crossing seven days", completed_at: "2026-09-03T12:00:30Z" }];
  await page.goto("/task-manager");
  await expect(page.getByRole("heading", { name: "Crossing seven days" })).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("heading", { name: "Crossing seven days" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Показать выполненные" })).toBeVisible();
  expect(state.mutations).toEqual([]);
});

for (const lang of ["ru", "de"] as const) {
  test(`completed status offers archive, persists it and restores from the archive in ${lang}`, async ({ page }) => {
    const state = await mockTasks(page, lang);
    await page.goto("/task-manager");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Recent completion", exact: true }) });
    await card.getByRole("combobox", { name: lang === "ru" ? "Изменить статус" : "Status ändern", exact: true }).click();
    await page.getByRole("option", { name: lang === "ru" ? "В архив" : "Archivieren", exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(state.tasks[1].status).toBe("completed");
    expect(state.tasks[1].completed_at).toBe("2026-09-09T12:00:00Z");
    expect(state.tasks[1].archived_at).not.toBeNull();
    await page.reload();
    await page.getByRole("combobox", { name: lang === "ru" ? "Активные" : "Aktiv", exact: true }).click();
    await page.getByRole("option", { name: lang === "ru" ? "Архив" : "Archiv", exact: true }).click();
    await expect(card).toBeVisible();
    const status = card.getByRole("combobox", { name: lang === "ru" ? "Изменить статус" : "Status ändern", exact: true });
    await expect(status).toHaveText(lang === "ru" ? "В архиве" : "Archiviert");
    await expect(status).toBeDisabled();
    await card.getByRole("button", { name: lang === "ru" ? "Восстановить" : "Wiederherstellen", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(card).toBeVisible();
    expect(state.mutations).toEqual(["/concierge-operational-items/recent/archive", "/concierge-operational-items/recent/restore"]);
  });
}

test("archiving from task details preserves a failed choice and supports restoring without closing", async ({ page }) => {
  const state = await mockTasks(page, "ru");
  let reject = true;
  await page.route(`**/concierge-operational-items/${oldId}/archive`, route => reject
    ? route.fulfill({ status: 503, json: { message: "Temporary archive failure" } }) : route.fallback());
  await page.goto(`/task-manager?task=${oldId}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Статус", exact: true }).click();
  await page.getByRole("option", { name: "В архив", exact: true }).click();
  expect(state.mutations).toEqual([]);
  await dialog.getByRole("button", { name: "ОК", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Temporary archive failure");
  expect(state.tasks[2].archived_at).toBeNull();
  reject = false;
  await dialog.getByRole("button", { name: "ОК", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Восстановить", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Статус", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Восстановить", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Статус", exact: true })).toHaveText("Выполнена");
  expect(state.mutations).toEqual([`/concierge-operational-items/${oldId}/archive`, `/concierge-operational-items/${oldId}/restore`]);
});

test("archive status is unavailable for unfinished tasks and assignees without archive rights", async ({ page }) => {
  const state = await mockTasks(page, "ru", "concierge");
  state.tasks[1].assigned_by = "manager";
  state.tasks[2].assigned_by = "manager";
  await page.goto("/task-manager");
  for (const title of ["Active task", "Recent completion"]) {
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.getByRole("combobox", { name: "Изменить статус", exact: true }).click();
    await expect(page.getByRole("option", { name: "В архив", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.goto(`/task-manager?task=${oldId}`);
  await page.getByRole("dialog").getByRole("combobox", { name: "Статус", exact: true }).click();
  await expect(page.getByRole("option", { name: "В архив", exact: true })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});
