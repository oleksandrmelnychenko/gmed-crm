import { expect, test, type Page } from "@playwright/test";

const patientId = "00000000-0000-0000-0000-000000000111";
const leadId = "00000000-0000-0000-0000-000000000222";
const caseId = "00000000-0000-0000-0000-000000000333";
const orderId = "00000000-0000-0000-0000-000000000444";
const allergyId = "00000000-0000-0000-0000-000000000555";

async function mount(page: Page, lang: "ru" | "de" = "ru", failAt?: "attach" | "create" | "clinical" | "order", withNarrative = false) {
  await page.addInitScript(value => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "repeat-intake-test-token");
  }, lang);
  const writes: {path: string; body: Record<string, unknown>}[] = [];
  const history = [
    {id: "00000000-0000-0000-0000-000000000666", case_id: "00000000-0000-0000-0000-000000000777", anamnese_aktuelle: "Previous episode", anamnese_vorgeschichte: "Preserved history", is_active: true, anamnese_at: "2025-01-01T10:00:00Z"},
    {id: "00000000-0000-0000-0000-000000000888", case_id: null, anamnese_aktuelle: "Older episode", is_active: false, anamnese_at: "2024-01-01T10:00:00Z"},
  ];
  let narrative: Record<string, unknown> | null = withNarrative ? {...history[0]} : null;
  let attachAttempts = 0;
  let failureSent = false;
  let lead: Record<string, unknown> = {
    id: leadId, first_name: "Anna", last_name: "Beispiel", qualification_status: "in_progress",
    intake_model: "patient_first", wizard_state: {}, services: [], attachments: [],
    readiness: {conversion_ready: false, blocking_reasons: [], steps: [], checks: []},
  };
  let hasOrder = false;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const post = route.request().method() === "POST";
    const body = post ? route.request().postDataJSON() as Record<string, unknown> : {};
    if (post) writes.push({path, body});
    const shouldFail = !failureSent && (
      (failAt === "create" && path === "/leads" && post)
      || (failAt === "clinical" && path.endsWith("/clinical"))
      || (failAt === "order" && path === "/orders" && post)
    );
    if (shouldFail) {
      failureSent = true;
      await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({message: "Temporary failure"})});
      return;
    }
    let response: unknown = [];
    if (path === "/leads" && post) response = {id: leadId};
    else if (path === `/leads/${leadId}/update`) { lead = {...lead, ...body}; response = {ok: true}; }
    else if (path === `/leads/${leadId}/prospect`) {
      attachAttempts += 1;
      if (failAt === "attach" && attachAttempts === 1) {
        await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({message: "Temporary attachment failure"})});
        return;
      }
      lead = {...lead, prospect_patient_id: patientId, prospect_case_id: caseId, prospect_patient_lifecycle: "active"};
      response = {patient_id: patientId, case_id: caseId, attached: true, lifecycle_status: "active"};
    } else if (path === `/leads/${leadId}`) response = {...lead};
    else if (path === "/orders") {
      if (post) hasOrder = true;
      const order = {id: orderId, lead_id: leadId, source_lead_id: leadId, status: "draft", order_number: "O-REPEAT-001"};
      response = post ? order : hasOrder ? [order] : [];
    } else if (path === `/orders/${orderId}`) response = {id: orderId, leistungen: []};
    else if (path === `/cases/${caseId}`) response = {id: caseId, hauptanfragegrund: "", zuweiser: ""};
    else if (path === `/patients/${patientId}/clinical`) response = {
      allergien: [{id: allergyId, label: "Penicillin", reaction: "Rash"}], cave: [], diagnoses: [], medications: [],
      narrative, examinations: [], procedures: [], verlauf: [],
    };
    else if (path === `/patients/${patientId}/narrative/history`) response = history;
    else if (path === `/patients/${patientId}/narrative` && post) {
      narrative = {...body, id: "00000000-0000-0000-0000-000000000999"};
      response = narrative;
    }
    await route.fulfill({contentType: "application/json", body: JSON.stringify(response)});
  });
  await page.route("**/repeat-intake-harness", route => route.fulfill({contentType: "text/html", body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx');</script></body></html>`}));
  await page.goto("/repeat-intake-harness");
  await page.getByRole("button", {name: "Repeat intake", exact: true}).click();
  return {writes, wizard: page.getByRole("dialog", {name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true})};
}

test("opening and closing a repeat intake preserves identity and creates nothing", async ({page}) => {
  const {writes, wizard} = await mount(page);
  await expect(wizard.locator('input[name="first_name"]')).toHaveValue("Anna");
  await expect(wizard.locator('input[name="last_name"]')).toHaveValue("Beispiel");
  await wizard.getByRole("button", {name: "Закрыть", exact: true}).click();
  await expect(wizard).toBeHidden();
  expect(writes).toEqual([]);
});

test("first save attaches the existing patient and displays their clinical warnings", async ({page}) => {
  const {writes, wizard} = await mount(page);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  expect(writes.filter(item => item.path === "/leads")).toHaveLength(1);
  expect(writes.find(item => item.path.endsWith("/prospect"))?.body.attach_patient_id).toBe(patientId);
  expect(writes.filter(item => item.path === "/patients")).toHaveLength(0);
});

test("a failed patient attachment stays unsaved and can be retried without another lead", async ({page}) => {
  const {writes, wizard} = await mount(page, "ru", "attach");
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Изменения не сохранены", {exact: true})).toBeVisible();
  await wizard.getByRole("button", {name: "Повторить", exact: true}).click();
  await expect(wizard.getByText("Данные сохранены", {exact: true})).toBeVisible();
  expect(writes.filter(item => item.path === "/leads")).toHaveLength(1);
  expect(writes.filter(item => item.path.endsWith("/prospect"))).toHaveLength(2);
});

for (const failAt of ["create", "clinical", "order"] as const) {
  test(`initial ${failAt} failure can be retried without losing the patient or draft`, async ({page}) => {
    const {writes, wizard} = await mount(page, "ru", failAt);
    await wizard.locator('input[name="email"]').fill("updated@example.com");
    await wizard.getByRole("button", {name: "Далее", exact: true}).click();
    await expect(wizard.getByText("Изменения не сохранены", {exact: true})).toBeVisible();
    await expect(wizard.locator('input[name="email"]')).toHaveValue("updated@example.com");
    await wizard.getByRole("button", {name: "Повторить", exact: true}).click();
    await expect(wizard.getByText("Данные сохранены", {exact: true})).toBeVisible();
    expect(writes.filter(item => item.path === "/leads")).toHaveLength(failAt === "create" ? 2 : 1);
    expect(writes.filter(item => item.path.endsWith("/prospect"))).toHaveLength(1);
    await wizard.getByRole("tab", {name: /Медицинская характеристика/}).click();
    await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  });
}

for (const lang of ["ru", "de"] as const) {
  test(`repeat intake identifies the existing patient and final action in ${lang}`, async ({page}) => {
    await page.setViewportSize({width: lang === "ru" ? 1440 : 390, height: 1000});
    const {writes, wizard} = await mount(page, lang);
    await expect(wizard.getByRole("heading", {name: "Anna Beispiel", exact: true})).toBeVisible();
    await expect(wizard.getByText(/P-REPEAT-001/)).toBeVisible();
    const next = wizard.getByRole("button", {name: lang === "ru" ? "Далее" : "Weiter", exact: true});
    await next.dblclick();
    await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
    expect(writes.filter(item => item.path === "/leads")).toHaveLength(1);
    await wizard.getByRole("tab", {name: lang === "ru" ? /Завершение обращения/ : /Anfrage abschließen/}).click();
    await expect(wizard.getByRole("button", {name: lang === "ru" ? "Завершить обращение" : "Anfrage abschließen", exact: true})).toBeDisabled();
    await expect(wizard.getByRole("button", {name: lang === "ru" ? "Создать пациента" : "Patient anlegen", exact: true})).toHaveCount(0);
    await page.screenshot({path: `../artifacts/design-qa/repeat-intake-${lang}-release.png`});
  });
}

test("closing after a changed draft asks for confirmation but reverting the field does not", async ({page}) => {
  const {writes, wizard} = await mount(page);
  await wizard.locator('input[name="email"]').fill("changed@example.com");
  await wizard.getByRole("button", {name: "Закрыть", exact: true}).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", {name: "Отмена", exact: true}).click();
  await wizard.locator('input[name="email"]').fill("anna@example.com");
  await wizard.getByRole("button", {name: "Закрыть", exact: true}).click();
  await expect(wizard).toBeHidden();
  expect(writes).toEqual([]);
});

test("repeat intake loads anamnesis history and edits an older episode as a new version", async ({page}) => {
  const {writes, wizard} = await mount(page, "ru", undefined, true);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Previous episode", {exact: true})).toBeVisible();
  await wizard.getByRole("button", {name: "Показать историю", exact: true}).click();
  await expect(wizard.getByText("Older episode", {exact: true})).toBeVisible();
  await wizard.getByRole("button", {name: "Скрыть историю", exact: true}).click();
  await wizard.getByRole("button", {name: "Редактировать", exact: true}).filter({hasText: "Редактировать"}).click();
  const editor = page.getByRole("dialog", {name: "Редактировать: Анамнез", exact: true});
  await editor.getByRole("textbox", {name: "Актуальный анамнез"}).fill("New episode concern");
  await editor.getByRole("button", {name: "Сохранить", exact: true}).click();
  await expect(editor).toBeHidden();
  const saved = writes.find(item => item.path === `/patients/${patientId}/narrative`);
  expect(saved?.body).toMatchObject({id: null, case_id: caseId, anamnese_aktuelle: "New episode concern", anamnese_vorgeschichte: "Preserved history"});
  await expect(wizard.getByText("New episode concern", {exact: true})).toBeVisible();
});

test("first save cannot be dismissed halfway through creating the linked records", async ({page}) => {
  const {wizard} = await mount(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/leads", async route => {
    await gate;
    await route.fallback();
  });
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Сохранение…", {exact: true})).toBeVisible();
  await expect(wizard.getByRole("button", {name: "Закрыть", exact: true})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(wizard).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  release();
  await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  await expect(wizard.getByRole("button", {name: "Закрыть", exact: true})).toBeVisible();
});
