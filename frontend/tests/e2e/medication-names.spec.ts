import { expect, test, type Page } from "@playwright/test";

type Pair = { handelsname: string; wirkstoff: string; name_pair_confirmation?: { handelsname: string; wirkstoff: string } | null };
const key = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
const seed: Pair[] = [
  { handelsname: "Unique Brand", wirkstoff: "Unique Substance" },
  { handelsname: "Brand Alpha", wirkstoff: "Shared Substance" },
  { handelsname: "Brand Beta", wirkstoff: "Shared Substance" },
  { handelsname: "Brand Alpha", wirkstoff: "Other Substance" },
];

async function mount(page: Page, pairs = seed, lang = "de") {
  const savedPairs = pairs.map((pair) => ({ ...pair }));
  const saves: Pair[][] = [];
  await page.addInitScript((lang) => {
    localStorage.setItem("gmed_lang", lang);
    localStorage.setItem("gmed_access_token", "name-test-token");
  }, lang);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname.endsWith("/medication-name-pairs/check")) {
      const handelsname = url.searchParams.get("handelsname") ?? "";
      const wirkstoff = url.searchParams.get("wirkstoff") ?? "";
      body = {
        known_pair: savedPairs.some(pair => key(pair.handelsname) === key(handelsname) && key(pair.wirkstoff) === key(wirkstoff)),
        handelsname: { exact: savedPairs.find(pair => key(pair.handelsname) === key(handelsname))?.handelsname ?? null, similar: handelsname === "Unqiue Brand" ? ["Unique Brand"] : [] },
        wirkstoff: { exact: savedPairs.find(pair => key(pair.wirkstoff) === key(wirkstoff))?.wirkstoff ?? null, similar: [] },
      };
    } else if (url.pathname.endsWith("/medication-names")) {
      const field = url.searchParams.get("field") as "handelsname" | "wirkstoff";
      const opposite = field === "handelsname" ? "wirkstoff" : "handelsname";
      const related = url.searchParams.get("related");
      const q = key(url.searchParams.get("q") ?? "");
      const items = [...new Set(savedPairs.filter((pair) => (!related || key(pair[opposite]) === key(related)) && key(pair[field]).includes(q)).map((pair) => pair[field]))].sort();
      body = { items: items.slice(0, 50), has_more: items.length > 50 };
    } else if (url.pathname.endsWith("/medications") && route.request().method() === "POST") {
      const items = route.request().postDataJSON().items as Pair[];
      saves.push(items);
      for (const item of items) {
        if (item.name_pair_confirmation && key(item.name_pair_confirmation.handelsname) === key(item.handelsname)
          && key(item.name_pair_confirmation.wirkstoff) === key(item.wirkstoff) && item.wirkstoff.trim()
          && !savedPairs.some((pair) => key(pair.handelsname) === key(item.handelsname) && key(pair.wirkstoff) === key(item.wirkstoff))) savedPairs.push(item);
      }
      body = { ok: true, count: items.length };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/medication-names-harness", (route) => route.fulfill({ contentType: "text/html", body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/medication-names-harness.tsx');
    </script></body></html>` }));
  await page.goto("/medication-names-harness");
  await page.getByRole("button", { name: lang === "de" ? /Hinzufügen/ : /Добавить/ }).click();
  return { saves, savedPairs };
}

function input(page: Page, field: "handelsname" | "wirkstoff") {
  return page.getByLabel(field === "handelsname" ? "Handelsname" : "Wirkstoff", { exact: true });
}

async function choose(page: Page, field: "handelsname" | "wirkstoff", query: string, option: string) {
  await input(page, field).fill(query);
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("unique names complete the opposite field in both directions", async ({ page }) => {
  await mount(page);
  await choose(page, "handelsname", "Unique B", "Unique Brand");
  await expect(input(page, "wirkstoff")).toHaveValue("Unique Substance");
  await input(page, "handelsname").fill("");
  await choose(page, "wirkstoff", "Unique S", "Unique Substance");
  await expect(input(page, "handelsname")).toHaveValue("Unique Brand");
});

for (const width of [390, 1440]) {
  test(`medication name text has standard input padding at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mount(page);
    await input(page, "handelsname").fill("65656");
    await input(page, "wirkstoff").fill("65656");
    await input(page, "wirkstoff").press("Escape");
    for (const field of ["handelsname", "wirkstoff"] as const) {
      const style = await input(page, field).evaluate(element => {
        const style = getComputedStyle(element);
        return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), top: parseFloat(style.paddingTop) };
      });
      expect(style.left).toBeGreaterThanOrEqual(10);
      expect(style.right).toBeGreaterThanOrEqual(10);
      expect(style.top).toBeGreaterThanOrEqual(4);
    }
    await page.screenshot({ path: test.info().outputPath(`medication-name-padding-${width}.png`) });
  });
}

test("ambiguous pairs open the other autocomplete and a second choice completes the pair", async ({ page }) => {
  await mount(page);
  await choose(page, "wirkstoff", "Shared", "Shared Substance");
  await expect(input(page, "handelsname")).toBeFocused();
  await expect(page.getByRole("option", { name: "Brand Alpha", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Brand Beta", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Brand Alpha", exact: true }).click();
  await expect(input(page, "handelsname")).toHaveValue("Brand Alpha");
  await expect(input(page, "wirkstoff")).toHaveValue("Shared Substance");
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("a brand with multiple substances offers a choice in the reverse direction", async ({ page }) => {
  await mount(page);
  await choose(page, "handelsname", "Brand A", "Brand Alpha");
  await expect(input(page, "wirkstoff")).toBeFocused();
  await expect(page.getByRole("option", { name: "Other Substance", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Shared Substance", exact: true }).click();
  await expect(input(page, "handelsname")).toHaveValue("Brand Alpha");
  await expect(input(page, "wirkstoff")).toHaveValue("Shared Substance");
});

test("a new saved pair is suggested after reopening the medication form", async ({ page }) => {
  const { saves } = await mount(page);
  await input(page, "handelsname").fill("New Brand");
  await input(page, "wirkstoff").fill("New Substance");
  await input(page, "wirkstoff").press("Escape");
  expect(saves).toHaveLength(0);
  await page.getByRole("combobox", { name: "Darreichungsform", exact: true }).click();
  await page.getByRole("option", { name: "Tabletten", exact: true }).click();
  await page.getByRole("combobox", { name: "Einnahmeform", exact: true }).click();
  await page.getByRole("option", { name: "Oral / Per os (p.o.)", exact: true }).click();
  await page.getByRole("checkbox", { name: /Namen geprüft/ }).check();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  await page.getByRole("button", { name: /Hinzufügen/ }).click();
  await choose(page, "wirkstoff", "New S", "New Substance");
  await expect(input(page, "handelsname")).toHaveValue("New Brand");
});

test("spelling suggestions need an explicit choice and do not silently replace names", async ({ page }) => {
  await mount(page);
  await input(page, "handelsname").fill("Unqiue Brand");
  await input(page, "wirkstoff").fill("Unreviewed Compound");
  await input(page, "wirkstoff").press("Escape");
  const suggestion = page.getByRole("button", { name: "Unique Brand", exact: true });
  await expect(suggestion).toBeVisible();
  await expect(input(page, "handelsname")).toHaveValue("Unqiue Brand");
  await expect(page.getByRole("checkbox", { name: /Namen geprüft/ })).not.toBeChecked();
  await page.screenshot({ path: test.info().outputPath("smart-insert-de.png") });
  await suggestion.click();
  await expect(input(page, "handelsname")).toHaveValue("Unique Brand");
  await expect(input(page, "wirkstoff")).toHaveValue("Unique Substance");
  await expect(page.getByText("Diese Namenskombination ist bereits im Verzeichnis vorhanden.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Namen geprüft/ })).toHaveCount(0);
});

test("smart name review fits the Russian mobile medication editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, seed, "ru");
  await page.getByLabel("Торговое название", { exact: true }).fill("Unqiue Brand");
  await page.getByLabel("Действующее вещество", { exact: true }).fill("Новое вещество");
  await page.getByLabel("Действующее вещество", { exact: true }).press("Escape");
  await expect(page.getByRole("checkbox", { name: /Названия проверены/ })).not.toBeChecked();
  const candidate = page.getByRole("button", { name: "Unique Brand", exact: true });
  await expect(candidate).toBeVisible();
  const bounds = await candidate.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("smart-insert-ru-mobile.png") });
});

test("editing a reviewed name clears consent and saves only the patient medication", async ({ page }) => {
  const { saves, savedPairs } = await mount(page);
  await input(page, "handelsname").fill("New Brand");
  await input(page, "wirkstoff").fill("New Substance");
  await input(page, "wirkstoff").press("Escape");
  await page.getByRole("checkbox", { name: /Namen geprüft/ }).check();
  await input(page, "handelsname").fill("Changed Brand");
  await input(page, "handelsname").press("Escape");
  await expect(page.getByRole("checkbox", { name: /Namen geprüft/ })).not.toBeChecked();
  await page.getByRole("combobox", { name: "Darreichungsform", exact: true }).click();
  await page.getByRole("option", { name: "Tabletten", exact: true }).click();
  await page.getByRole("combobox", { name: "Einnahmeform", exact: true }).click();
  await page.getByRole("option", { name: "Oral / Per os (p.o.)", exact: true }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0][0].handelsname).toBe("Changed Brand");
  expect(saves[0][0].name_pair_confirmation).toBeNull();
  expect(savedPairs.some(pair => pair.handelsname === "Changed Brand")).toBe(false);
});

test("late lookup results cannot overwrite a newer manual edit", async ({ page }) => {
  await mount(page);
  let release!: () => void;
  let requested = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/medication-names?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("related") !== "Unique Brand") return route.fallback();
    requested = true;
    await gate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: ["Stale Substance"], has_more: false }) });
  });
  try {
    await choose(page, "handelsname", "Unique B", "Unique Brand");
    await expect.poll(() => requested).toBe(true);
    await input(page, "wirkstoff").fill("Manual Substance");
  } finally { release(); }
  await input(page, "wirkstoff").press("Escape");
  await page.getByRole("combobox", { name: "Einnahmeform", exact: true }).click();
  await expect(input(page, "wirkstoff")).toHaveValue("Manual Substance");
});

test("unknown names remain editable when suggestions fail", async ({ page }) => {
  const { saves } = await mount(page);
  await page.route("**/medication-names?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
  await input(page, "handelsname").fill("Manual Brand");
  await expect(page.getByText("Vorschläge nicht verfügbar. Namen manuell eingeben.")).toBeVisible();
  await input(page, "wirkstoff").fill("Manual Substance");
  await expect(input(page, "handelsname")).toHaveValue("Manual Brand");
  expect(saves).toHaveLength(0);
});

test("keyboard selection completes a unique pair without submitting the form", async ({ page }) => {
  const { saves } = await mount(page);
  const brand = input(page, "handelsname");
  await brand.fill("Unique B");
  await expect(page.getByRole("option", { name: "Unique Brand", exact: true })).toBeVisible();
  await brand.press("ArrowDown");
  await brand.press("Enter");
  await expect(input(page, "wirkstoff")).toHaveValue("Unique Substance");
  expect(saves).toHaveLength(0);
});

test("typing an exact name resolves on blur and choices fit a mobile form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  await input(page, "handelsname").fill("Unique Brand");
  await input(page, "handelsname").press("Tab");
  await expect(input(page, "wirkstoff")).toHaveValue("Unique Substance");
  await choose(page, "wirkstoff", "Shared", "Shared Substance");
  const option = page.getByRole("option", { name: "Brand Beta", exact: true });
  await expect(option).toBeVisible();
  const bounds = await option.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("medication-names-mobile.png") });
});
