import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, role = "concierge", lang = "ru") {
  const state = {
    deleted: [] as string[], writes: [] as Record<string, unknown>[], failDelete: false,
    projects: ["own", "foreign"].map(id => ({
      id, name: id === "own" ? "My own project" : "Foreign project", description: "Test project",
      status: "active", priority: "normal", owner_id: id === "own" ? "peer" : "actor", owner_name: "Peer",
      created_by: id === "own" ? "actor" : "peer", created_by_name: "Author",
      patient_id: null, patient_name: null, starts_on: null, due_on: null,
      created_at: "2026-09-10T10:00:00Z", updated_at: "2026-09-10T10:00:00Z",
      task_total: 0, task_completed: 0, member_count: 1,
      members: [{ id: "actor", name: "Actor", role, member_role: id === "own" ? "member" : "manager" }],
    })),
  };
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_lang", lang);
    localStorage.setItem("gmed_access_token", "project-permissions-test");
  }, { lang });
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let json: unknown = [];
    if (path === "/me") json = { id: "actor", name: "Actor", email: "actor@example.com", role };
    if (path === "/stats/overview") json = {};
    if (path === "/concierge-operational-items/assignees") json = [{ id: "actor", name: "Actor", email: "actor@example.com", role, is_active: true }, { id: "peer", name: "Peer", email: "peer@example.com", role: "concierge", is_active: true }];
    if (path === "/projects") {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        state.writes.push(input);
        const created = { ...state.projects[0], ...input, id: "created", created_by: "actor" };
        state.projects.push(created);
        json = created;
      } else json = state.projects; // Deliberately broad: UI must not expose foreign concierge projects.
    }
    const project = state.projects.find(project => path === `/projects/${project.id}`);
    if (project) json = project;
    const edited = state.projects.find(project => path === `/projects/${project.id}/update`);
    if (edited) {
      const input = route.request().postDataJSON();
      state.writes.push(input);
      Object.assign(edited, input, { updated_at: "2026-09-10T11:00:00Z" });
      json = edited;
    }
    if (path.endsWith("/delete")) {
      if (state.failDelete) return route.fulfill({ status: 409, json: { error: "Project was changed by another user" } });
      const id = path.split("/")[2];
      state.deleted.push(id);
      state.projects = state.projects.filter(project => project.id !== id);
      return route.fulfill({ status: 204 });
    }
    await route.fulfill({ json });
  });
  return state;
}

test("concierge creates, edits and deletes own project after ownership was transferred", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/projects?project=own");
  await expect(page.getByRole("link", { name: "Проекты", exact: true })).toBeVisible();
  await expect(page.getByText("Foreign project", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Изменить проект", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill("Edited own project");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("complementary").getByRole("heading", { name: "Edited own project", exact: true })).toBeVisible();
  expect(state.writes[0].expected_updated_at).toBe("2026-09-10T10:00:00Z");
  await page.getByRole("button", { name: "Удалить проект", exact: true }).filter({ visible: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Связанные задачи и их история сохранятся");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(state.deleted).toHaveLength(0);
  await page.getByRole("button", { name: "Удалить проект", exact: true }).filter({ visible: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("Edited own project", { exact: true })).toHaveCount(0);
  expect(state.deleted).toEqual(["own"]);
  await page.getByRole("button", { name: "Новый проект", exact: true }).filter({ visible: true }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill("Created by concierge");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("complementary").getByRole("heading", { name: "Created by concierge", exact: true })).toBeVisible();
});

test("concierge cannot open foreign project through a direct URL even as owner or manager", async ({ page }) => {
  await setup(page);
  await page.goto("/projects?project=foreign");
  await expect(page.getByRole("button", { name: "Новый проект", exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Foreign project", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Удалить проект", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Изменить проект", exact: true })).toHaveCount(0);
});

test("CEO deletes another user's project and failed deletion keeps the project visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, "ceo", "de");
  state.failDelete = true;
  await page.goto("/projects?project=foreign");
  await page.getByRole("button", { name: "Projekt löschen", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("ceo-delete-project-mobile.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Project was changed");
  expect(state.deleted).toHaveLength(0);
  state.failDelete = false;
  await dialog.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.deleted).toEqual(["foreign"]);
  await expect(page.getByText("Foreign project", { exact: true })).toHaveCount(0);
});
