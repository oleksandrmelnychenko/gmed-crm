import { expect, test, type Page } from "@playwright/test";

const projectA = "10000000-0000-0000-0000-000000000001";
const projectB = "20000000-0000-0000-0000-000000000002";
const taskA = "aa000001-0000-0000-0000-000000000001";
const taskB = "bb000002-0000-0000-0000-000000000002";
const taskC = "cc000003-0000-0000-0000-000000000003";
const taskD = "dd000004-0000-0000-0000-000000000004";

function task(id: string, title: string, projectId = projectA, status = "open") {
  return {
    id, title, project_id: projectId, kind: "task", status, priority: "normal",
    assigned_to: "tester", assigned_to_name: "Workflow Tester", assigned_by: "tester",
    assigned_by_name: "Workflow Tester", task_audience: "internal", note: null,
    due_at: "2026-01-01T12:00:00Z", starts_at: null, ends_at: null, reminder_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    checklist_total: 0, checklist_completed: 0, comment_count: 0, attachment_count: 0,
    archived_at: null, patient_id: null, patient_name: null, provider_id: null,
  };
}

async function mockWorkflow(page: Page, role = "ceo") {
  const projects = [projectA, projectB].map((id, index) => ({
    id, name: index ? "Second project" : "Document digitisation", description: "Project workflow audit",
    status: "active", priority: "normal", owner_id: "owner", owner_name: "Project Owner",
    patient_id: null, patient_name: null, starts_on: null, due_on: "2026-12-01",
    created_by: "owner", created_by_name: "Project Owner", created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z", task_total: index ? 1 : 3, task_completed: index ? 0 : 1,
    member_count: 1, members: [{ id: "tester", name: "Workflow Tester", role, member_role: "member" }],
  }));
  const state = {
    dependencyFailure: false, saveFailure: false, deleteFailure: false,
    dependencyReads: 0, creates: 0, deletes: 0,
    tasks: [task(taskA, "Prepare documents"), task(taskB, "Sign documents"), task(taskC, "Completed milestone", projectA, "completed"), task(taskD, "Second project task", projectB)],
    dependencies: [
      { id: "edge-ab", task_id: taskB, depends_on_task_id: taskA },
      { id: "edge-ac", task_id: taskC, depends_on_task_id: taskA },
    ],
  };
  let held: { projectId: string; started: () => void; wait: Promise<void> } | null = null;
  let saveGate: Promise<void> | null = null;
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "workflow-test-token");
    localStorage.setItem("gmed_refresh_token", "workflow-test-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = [];
    let status = 200;
    if (path === "/me") body = { id: "tester", email: "tester@example.com", name: "Workflow Tester", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/projects") body = projects.map((project) => ({ ...project, members: undefined }));
    if (path === "/concierge-operational-items/assignees") body = [{ id: "tester", name: "Workflow Tester", email: "tester@example.com", role, is_active: true }];
    const project = projects.find((entry) => path === `/projects/${entry.id}`);
    if (project) body = project;
    if (path === "/concierge-operational-items") {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        const saved = { ...task("new-task", payload.title, payload.project_id), ...payload };
        state.tasks.push(saved);
        body = saved;
      } else body = state.tasks.filter((entry) => !url.searchParams.get("project_id") || entry.project_id === url.searchParams.get("project_id"));
    }
    const dependencyProject = projects.find((entry) => path === `/projects/${entry.id}/workflow/dependencies`);
    if (dependencyProject) {
      if (route.request().method() === "POST") {
        state.creates += 1;
        if (saveGate) await saveGate;
        if (state.saveFailure) { status = 422; body = { error: "Workflow dependency would create a cycle" }; }
        else {
          const created = { id: "edge-new", ...route.request().postDataJSON() };
          state.dependencies.push(created);
          body = created;
        }
      } else {
        state.dependencyReads += 1;
        body = dependencyProject.id === projectA ? structuredClone(state.dependencies) : [];
        if (held?.projectId === dependencyProject.id) {
          const pending = held;
          held = null;
          pending.started();
          await pending.wait;
        }
        if (state.dependencyFailure) { status = 503; body = { error: "Dependencies temporarily unavailable" }; }
      }
    }
    if (path.endsWith("/delete") && path.includes("/workflow/dependencies/")) {
      state.deletes += 1;
      if (state.deleteFailure) { status = 500; body = { error: "Cannot delete dependency right now" }; }
      else {
        const id = path.split("/").at(-2);
        state.dependencies = state.dependencies.filter((edge) => edge.id !== id);
        body = {};
      }
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return {
    state,
    projects,
    holdNextDependencies(projectId: string) {
      let started!: () => void;
      let release!: () => void;
      const began = new Promise<void>((resolve) => { started = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      held = { projectId, started, wait };
      return { began, release };
    },
    holdSave() {
      let release!: () => void;
      saveGate = new Promise<void>((resolve) => { release = resolve; });
      return release;
    },
  };
}

async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
    detail: { type: "crm_project.workflow_updated", entity_type: "crm_project", entity_id: "workflow-test" },
  })));
}

async function openWorkflow(page: Page) {
  await page.goto(`/projects?view=workflow&project=${projectA}`);
  await expect(page.getByTestId("project-workflow-canvas").getByRole("button", { name: /Sign documents/ })).toBeVisible();
}

test("filters keep blockers and let the details panel reveal a hidden prerequisite", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1050 });
  await mockWorkflow(page);
  await openWorkflow(page);
  const canvas = page.getByTestId("project-workflow-canvas");
  const search = page.getByRole("textbox", { name: "Найти задачу, исполнителя или ID" });
  await search.fill(taskB);
  const card = canvas.getByRole("button", { name: /Sign documents.*Заблокировано: 1/ });
  await expect(card).toBeVisible();
  await expect(canvas.getByRole("button", { name: /Prepare documents/ })).toHaveCount(0);
  await card.click();
  await page.locator("aside").getByRole("button", { name: /Prepare documents/ }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator("aside h3")).toHaveText("Prepare documents");
  await page.screenshot({ path: test.info().outputPath("workflow-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Уменьшить канвас", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сбросить масштаб", exact: true })).toContainText("75%");
  await expect(page.getByRole("button", { name: "Уменьшить канвас", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Сбросить масштаб", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сбросить масштаб", exact: true })).toContainText("100%");
  await page.getByRole("combobox", { name: "Все задачи", exact: true }).click();
  await page.getByRole("option", { name: "С блокерами", exact: true }).click();
  await expect(canvas.getByRole("button", { name: /TASK-/ })).toHaveCount(1);
});

test("dependency drafts survive realtime refresh and errors; saving locks controls", async ({ page }) => {
  const mock = await mockWorkflow(page);
  await openWorkflow(page);
  await page.getByTestId("project-workflow-canvas").getByRole("button", { name: /Sign documents/ }).click();
  await page.locator("aside").getByRole("button", { name: "Добавить зависимость", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Добавить зависимость", exact: true });
  const prerequisite = dialog.getByRole("combobox").nth(1);
  await prerequisite.click();
  await page.getByRole("option", { name: "Completed milestone", exact: true }).click();
  const reads = mock.state.dependencyReads;
  await refresh(page);
  await expect.poll(() => mock.state.dependencyReads).toBeGreaterThan(reads);
  await expect(prerequisite).toContainText("Completed milestone");
  mock.state.dependencyFailure = true;
  await refresh(page);
  await expect(dialog.getByRole("alert")).toContainText("Dependencies temporarily unavailable");
  await expect(dialog.getByRole("button", { name: "Связать задачи", exact: true })).toBeDisabled();
  mock.state.dependencyFailure = false;
  await refresh(page);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(prerequisite).toContainText("Completed milestone");
  mock.state.saveFailure = true;
  await dialog.getByRole("button", { name: "Связать задачи", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("создаст цикл");
  await expect(prerequisite).toContainText("Completed milestone");
  mock.state.saveFailure = false;
  const release = mock.holdSave();
  await dialog.getByRole("button", { name: "Связать задачи", exact: true }).click();
  await expect(prerequisite).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeDisabled();
  release();
  await expect(dialog).toHaveCount(0);
  expect(mock.state.creates).toBe(2);
  mock.state.deleteFailure = true;
  await page.locator("aside").getByRole("button", { name: "Удалить связь", exact: true }).first().click();
  const confirmation = page.getByRole("dialog", { name: "Удалить зависимость?", exact: true });
  await confirmation.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toContainText("Cannot delete dependency");
  mock.state.deleteFailure = false;
  await confirmation.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(mock.state.dependencies.some((edge) => edge.id === "edge-ab")).toBe(false);
});

test("a delayed background response cannot overwrite another project's workflow", async ({ page }) => {
  const mock = await mockWorkflow(page);
  await openWorkflow(page);
  const held = mock.holdNextDependencies(projectA);
  await refresh(page);
  await held.began;
  await page.getByRole("combobox", { name: "Проект", exact: true }).click();
  await page.getByRole("option", { name: "Second project", exact: true }).click();
  const canvas = page.getByTestId("project-workflow-canvas");
  await expect(canvas.getByRole("button", { name: /Second project task/ })).toBeVisible();
  const finished = page.waitForResponse((response) => response.url().includes(`/projects/${projectA}/workflow/dependencies`));
  held.release();
  await finished;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(canvas.getByRole("button", { name: /Second project task/ })).toBeVisible();
  await expect(canvas.getByRole("button", { name: /Sign documents/ })).toHaveCount(0);
});

test("dependency load failures offer retry instead of a misleading empty workflow", async ({ page }) => {
  const mock = await mockWorkflow(page);
  mock.state.dependencyFailure = true;
  await page.goto(`/projects?view=workflow&project=${projectA}`);
  await expect(page.getByRole("alert")).toContainText("Dependencies temporarily unavailable");
  await expect(page.getByText("В проекте пока нет задач", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Добавить зависимость", exact: true })).toHaveCount(0);
  mock.state.dependencyFailure = false;
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(page.getByTestId("project-workflow-canvas").getByRole("button", { name: /Sign documents/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a newer refresh wins when responses for the same project arrive out of order", async ({ page }) => {
  const mock = await mockWorkflow(page);
  await openWorkflow(page);
  const held = mock.holdNextDependencies(projectA);
  await refresh(page);
  await held.began;
  mock.state.tasks[0].title = "Updated prerequisite";
  await refresh(page);
  const canvas = page.getByTestId("project-workflow-canvas");
  await expect(canvas.getByRole("button", { name: /Updated prerequisite/ })).toBeVisible();
  const finished = page.waitForResponse((response) => response.url().includes(`/projects/${projectA}/workflow/dependencies`));
  held.release();
  await finished;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(canvas.getByRole("button", { name: /Updated prerequisite/ })).toBeVisible();
});

test("project managers keep workflow permissions when project details arrive before the list", async ({ page }) => {
  const mock = await mockWorkflow(page, "concierge");
  mock.projects[0].members[0].member_role = "manager";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/projects", async (route) => {
    await gate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(mock.projects.map((project) => ({ ...project, members: undefined }))) });
  });
  const detailResponse = page.waitForResponse((response) => response.url().endsWith(`/projects/${projectA}`));
  await page.goto(`/projects?view=workflow&project=${projectA}`);
  await detailResponse;
  await expect.poll(() => mock.state.dependencyReads).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  release();
  await expect(page.getByRole("button", { name: "Добавить зависимость", exact: true }).first()).toBeVisible();
});

test("new task drafts survive refresh and tasks assigned elsewhere stay out of this graph", async ({ page }) => {
  const mock = await mockWorkflow(page);
  await openWorkflow(page);
  await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const title = dialog.getByRole("textbox", { name: "Название", exact: true });
  await title.fill("New task for second project");
  const reads = mock.state.dependencyReads;
  await refresh(page);
  await expect.poll(() => mock.state.dependencyReads).toBeGreaterThan(reads);
  await expect(title).toHaveValue("New task for second project");
  await dialog.getByRole("combobox", { name: "Проект", exact: true }).click();
  await page.getByRole("option", { name: "Second project", exact: true }).click();
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.state.tasks.at(-1)?.project_id).toBe(projectB);
  await expect(page.getByTestId("project-workflow-canvas").getByRole("button", { name: /New task for second project/ })).toHaveCount(0);
});

test("mobile workflow stays within the viewport and read-only members cannot edit dependencies", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkflow(page, "concierge");
  await page.goto(`/projects?view=workflow&project=${projectA}`);
  const card = page.getByRole("button", { name: /TASK-.*Sign documents/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator("aside h3")).toHaveText("Sign documents");
  await expect(page.getByRole("button", { name: "Добавить зависимость", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Удалить связь", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("workflow-mobile.png"), fullPage: true });
});
