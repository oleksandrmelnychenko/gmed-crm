import { expect, test, type Locator, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";

// Layout checks of the global browser QA of 2026-11-11 (mocked API, synthetic
// data): B-14 — the list toolbars wrap, so «Фильтр», «Сортировка» and
// «Колонки» stay on screen at common desktop widths; B-05 — the appointment
// sheet at tablet width (384 px) stacks its fields, so date and times are
// readable.

const USER_ID = "a0000000-0000-0000-0000-0000000000f1";
const PATIENT_ID = "b0000000-0000-0000-0000-0000000000f1";

function visit(id: string, timeStart: string, timeEnd: string, title: string) {
  return {
    id, title, date: "2026-10-12", time_start: timeStart, time_end: timeEnd, type: "medical", care_path_kind: "regular",
    status: "planned", location: null, interpreter_response: null, checklist_phase: "planning",
    patient_id: PATIENT_ID, patient_name: "Anna Beispiel", patient_pid: "P-0091",
    provider_id: null, provider_name: null, doctor_id: null, doctor_name: null,
    owner_user_id: USER_ID, owner_name: "PM QA", owner_role: "ceo", interpreter_id: null, interpreter_name: null,
    recurrence_series_id: null, recurrence_frequency: null, recurrence_interval: null, recurrence_count: null,
    recurrence_until: null, recurrence_index: 0, recurrence_series_size: 1, is_blocked: false, can_edit: true,
  };
}

async function mount(page: Page, lang: "ru" | "de", appointments: unknown[] = []) {
  await startClockAt(page);
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "layout-qa-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({ json: { id: USER_ID, email: "pm@example.com", name: "PM QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" } });
    }
    if (path === "/patients") {
      return route.fulfill({ json: [{ id: PATIENT_ID, patient_id: "P-0091", first_name: "Anna", last_name: "Beispiel", is_active: true, created_at: "2026-10-01T09:00:00Z" }] });
    }
    if (path === "/appointments") return route.fulfill({ json: appointments });
    if (path === "/appointments/meta/staff") return route.fulfill({ json: [{ id: USER_ID, name: "PM QA", role: "ceo" }] });
    if (path.startsWith("/appointments/meta/conflicts")) {
      return route.fulfill({ json: { patient_conflict_count: 0, interpreter_conflict_count: 0, has_conflicts: false, patient_conflicts: [], interpreter_conflicts: [] } });
    }
    return route.fulfill({ json: [] });
  });
}

/** The control is inside the viewport and is what a click at its centre hits. */
async function expectReachable(page: Page, control: Locator, label: string) {
  await expect(control, label).toBeVisible();
  const reachable = await control.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.left >= 0 && box.right <= window.innerWidth + 0.5 && box.width > 0 && Boolean(hit && node.contains(hit));
  });
  expect(reachable, label).toBe(true);
}

const TOOLBAR = {
  // The sort button names the active sort («Создан ↓») once there is one.
  ru: { filter: /Фильтр/, sort: /Сортировк|[↑↓]/, columns: /Колонки/ },
  de: { filter: /Filter/, sort: /Sortier|[↑↓]/, columns: /Spalten/ },
} as const;

for (const width of [1280, 1024]) {
  for (const { path, lang } of [
    { path: "/leads", lang: "ru" },
    { path: "/leads", lang: "de" },
    { path: "/patients", lang: "ru" },
    { path: "/services", lang: "ru" },
  ] as const) {
    test(`B-14: ${path} (${lang}) keeps filter, sort and columns on screen at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mount(page, lang);
      await page.goto(path);
      const names = TOOLBAR[lang];
      const main = page.locator("main");
      await expectReachable(page, main.getByRole("button", { name: names.filter }).first(), "filter");
      await expectReachable(page, main.getByRole("button", { name: names.sort }).first(), "sort");
      await expectReachable(page, main.getByRole("button", { name: names.columns }).first(), "columns");
      // No toolbar hides controls behind its own horizontal scrollbar.
      const scrollingToolbars = await main.evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>("*")].filter((node) => {
          const style = getComputedStyle(node);
          return (style.overflowX === "auto" || style.overflowX === "scroll")
            && node.scrollWidth > node.clientWidth + 1
            && node.querySelector("button")
            && !node.closest('[role="table"], table, [data-slot="data-table"]');
        }).map((node) => node.className),
      );
      expect(scrollingToolbars).toEqual([]);
    });
  }
}

test("B-05: the new-appointment sheet at 768 px shows the whole date and times", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await mount(page, "ru");
  await page.goto(`/appointments?patient=${PATIENT_ID}&create=1`);
  const sheet = page.getByRole("dialog").filter({ has: page.locator(".MuiPickersSectionList-root") }).first();
  await expect(sheet).toBeVisible();
  const fields = sheet.locator(".MuiPickersSectionList-root");
  await expect(fields.first()).toBeVisible();
  expect(await fields.count()).toBeGreaterThanOrEqual(3);
  const cut = await fields.evaluateAll((nodes) =>
    nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent),
  );
  expect(cut).toEqual([]);
  // One field per row in the narrow sheet: date, start and end lie below each other.
  const tops = await fields.evaluateAll((nodes) => nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(3);
});

test("B-05: the new-appointment sheet at 1440 px keeps date and times in one row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, "ru");
  await page.goto(`/appointments?patient=${PATIENT_ID}&create=1`);
  const sheet = page.getByRole("dialog").filter({ has: page.locator(".MuiPickersSectionList-root") }).first();
  const fields = sheet.locator(".MuiPickersSectionList-root");
  await expect(fields.first()).toBeVisible();
  const tops = await fields.evaluateAll((nodes) => nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
});

test("B-01/B-04: back-to-back 15-minute visits in the week view never cover each other", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, "ru", [
    visit("c0000000-0000-0000-0000-0000000000a1", "10:00", "10:15", "Kontrolle A"),
    visit("c0000000-0000-0000-0000-0000000000a2", "10:15", "10:30", "Kontrolle B"),
  ]);
  await page.goto("/appointments");
  const first = page.locator(".fc-timegrid-event").filter({ hasText: "Kontrolle A" });
  const second = page.locator(".fc-timegrid-event").filter({ hasText: "Kontrolle B" });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(a && b && a.y + a.height <= b.y + 1, JSON.stringify({ a, b })).toBe(true);
  // One line with the start time; the line lies inside its own tile and is what a click hits.
  const primary = first.locator(".fc-apt-event-row-primary");
  await expect(primary).toHaveAttribute("data-event-time", "10:00");
  const inOwnTile = await primary.evaluate((node) => {
    const tile = node.closest(".fc-timegrid-event")!;
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && tile.contains(hit)) && box.bottom <= tile.getBoundingClientRect().bottom + 0.5;
  });
  expect(inOwnTile).toBe(true);
  // The empty all-day row keeps no month-cell height.
  const allDay = page.locator(".fc-timegrid .fc-daygrid-body").first();
  expect((await allDay.boundingBox())?.height ?? 0).toBeLessThan(60);
});
