import { expect, test, type Page } from "@playwright/test";

const patientId = "00000000-0000-0000-0000-000000000111";
const leadId = "00000000-0000-0000-0000-000000000222";
const caseId = "00000000-0000-0000-0000-000000000333";
const orderId = "00000000-0000-0000-0000-000000000444";
const allergyId = "00000000-0000-0000-0000-000000000555";

async function mount(page: Page, lang: "ru" | "de" = "ru", failAt?: "attach" | "create" | "clinical" | "order", withNarrative = false, withDocuments = false, asLead = false, convertedLead = false, linkedPatientLifecycle?: "active" | "inactive") {
  await page.addInitScript(value => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "repeat-intake-test-token");
  }, lang);
  const reviewReads: string[] = [];
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
    intake_model: "patient_first", repeat_patient_id: patientId, wizard_state: withDocuments && asLead ? {framework_contract_id: "valid-contract"} : {}, services: [], attachments: [],
    ...(convertedLead || linkedPatientLifecycle ? {converted_patient_id: convertedLead ? patientId : null, prospect_patient_id: patientId, prospect_patient_lifecycle: linkedPatientLifecycle ?? "active"} : {}),
    readiness: {conversion_ready: false, blocking_reasons: [], steps: [], checks: []},
  };
  let hasOrder = false;
  let passportExpiry = "2020-01-01";
  const reviewContracts = [
    { id: "valid-contract", patient_id: patientId, contract_number: "FC-PREVIOUS", status: "signed", signed_at: "2025-01-01T10:00:00Z", valid_from: "2025-01-01", valid_to: "2030-12-31" },
    { id: "terminated-contract", patient_id: patientId, contract_number: "FC-TERMINATED", status: "terminated", signed_at: "2019-01-01T10:00:00Z", valid_from: "2019-01-01", valid_to: "2020-12-31" },
    { id: "unsigned-contract", patient_id: patientId, contract_number: "FC-UNSIGNED", status: "sent", signed_at: "2025-01-01T10:00:00Z", valid_from: "2025-01-01", valid_to: "2030-09-05" },
  ];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const post = route.request().method() === "POST";
    const body = post ? route.request().postDataJSON() as Record<string, unknown> : {};
    if (post) writes.push({path, body});
    if (!post && path.endsWith("/recheck")) reviewReads.push(path);
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
    else if (path === `/patients/${patientId}/repeat-intakes`) response = hasOrder ? [{id:leadId,created_at:"2026-09-13T10:00:00Z",concern:"Saved repeat"}] : [];
    else if (path === `/patients/${patientId}/previous-requests`) response = [{id: "00000000-0000-0000-0000-000000000aaa", created_at: "2026-03-01T09:00:00Z", concern: "Knee pain after sports injury", specialties: [], order_number: "A-PREVIOUS-001", date_from: "2026-03-02", date_to: "2026-03-06"}];
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
      const order = {id: orderId, lead_id: leadId, source_lead_id: leadId, status: "draft", order_number: "O-REPEAT-001", ...(withDocuments ? {date_from: "2030-09-01", date_to: "2030-09-15"} : {})};
      response = post ? order : hasOrder ? [order] : [];
    } else if (path === `/orders/${orderId}`) response = {id: orderId, leistungen: []};
    else if (path === `/cases/${caseId}`) response = {id: caseId, hauptanfragegrund: "", zuweiser: ""};
    else if (path === `/patients/${patientId}/clinical`) response = {
      revision: 0,
      allergien: [{id: allergyId, label: "Penicillin", reaction: "Rash"}], cave: [], diagnoses: [], medications: [],
      narrative, examinations: [], procedures: [], verlauf: [],
    };
    else if (path === `/patients/${patientId}/recheck` && withDocuments) response = {
      requires_recheck: true, passport_expiry: passportExpiry, identity_ready: true, compliance_ready: true,
      confidentiality_release_ready: true, document_pack_ready: true,
      document_alerts: {missing_count: 0, missing_documents: []},
    };
    else if (path === `/patients/${patientId}/update` && post) { passportExpiry = body.passport_expiry as string; response = {ok: true}; }
    else if (path === "/framework-contracts" && new URL(route.request().url()).searchParams.get("patient_id") === patientId && withDocuments) response = reviewContracts;
    else if (path === "/framework-contracts/valid-contract") response = reviewContracts[0];
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
  await page.getByRole("button", {name: asLead ? "Lead intake" : "Repeat intake", exact: true}).click();
  return {writes, reviewReads, wizard: page.getByRole("dialog", {name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true})};
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

for (const lang of ["ru", "de"] as const) {
  test(`repeat lead wizard reviews old contracts and explicitly updates passport ${lang}`, async ({page}) => {
    const tx = (ru: string, de: string) => lang === "de" ? de : ru;
    await page.setViewportSize({width: 1440, height: 1100});
    const {writes, wizard} = await mount(page, lang, undefined, true, true);
    await expect(wizard.getByRole("tab")).toHaveCount(7);
    await wizard.getByRole("button", {name: tx("Далее", "Weiter"), exact: true}).click();
    await expect(wizard.getByText("Previous episode", {exact: true})).toBeVisible();
    await wizard.getByRole("tab", {name: tx("Сервисная история", "Servicehistorie"), exact: false}).click();
    for (const [field, day] of [["program_date_from", "01"], ["program_date_to", "15"]]) {
      const date = wizard.locator(`input[name="${field}"]`).locator("..").getByRole("spinbutton");
      await expect(date).toHaveCount(3);
      await date.nth(0).fill(day!);
      await date.nth(1).fill("09");
      await date.nth(2).fill("2030");
      await date.nth(2).press("Tab");
    }
    await wizard.getByRole("tab", {name: tx("Проверка документов", "Dokumentenprüfung"), exact: false}).click();
    await expect(wizard.getByText(tx("Паспорт просрочен", "Reisepass abgelaufen"), {exact: true}).filter({visible: true})).toBeVisible();
    const useContract = wizard.getByRole("button", {name: tx("Использовать договор: FC-PREVIOUS", "Vertrag verwenden: FC-PREVIOUS"), exact: true});
    await expect(useContract).toBeVisible();
    await expect(wizard.getByRole("button", {name: /(?:Использовать договор|Vertrag verwenden): FC-(?:TERMINATED|UNSIGNED)/})).toHaveCount(0);
    await useContract.click();
    await expect.poll(() => writes.some(item => item.path.endsWith("/update") && (item.body.wizard_state as Record<string, unknown>)?.framework_contract_id === "valid-contract")).toBe(true);
    expect(writes.filter(item => item.path === "/framework-contracts" || item.path.includes("/framework-contracts/"))).toEqual([]);
    await wizard.getByRole("button", {name: tx("Обновить срок", "Gültigkeit ändern"), exact: true}).click();
    const group = wizard.getByRole("group", {name: tx("Паспорт действителен до", "Reisepass gültig bis"), exact: true});
    const segments = group.getByRole("spinbutton");
    await segments.nth(0).fill("20");
    await segments.nth(1).fill("12");
    await segments.nth(2).fill("2035");
    await segments.nth(2).press("Tab");
    await wizard.getByRole("button", {name: tx("Сохранить срок в карточке пациента", "Gültigkeit in Patientenakte speichern"), exact: true}).click();
    await expect(wizard.getByText(tx("Паспорт действителен", "Reisepass gültig"), {exact: true}).filter({visible: true})).toBeVisible();
    expect(writes.filter(item => item.path === `/patients/${patientId}/update`).map(item => item.body)).toEqual([{passport_expiry: "2035-12-20"}]);
    await page.screenshot({path: `../artifacts/design-qa/repeat-lead-documents-${lang}-desktop.png`, animations: "disabled"});
    await page.setViewportSize({width: 390, height: 844});
    expect(await wizard.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await expect(wizard.getByRole("button", {name: tx("Далее", "Weiter"), exact: true})).toBeInViewport();
    await page.screenshot({path: `../artifacts/design-qa/repeat-lead-documents-${lang}-mobile.png`, animations: "disabled"});
  });
}

for (const lang of ["ru", "de"] as const) {
  for (const lifecycle of ["new", "active", "inactive", "converted"] as const) test(`ordinary ${lifecycle} lead keeps seven stages without patient review ${lang}`, async ({page}) => {
    const tx = (ru: string, de: string) => lang === "de" ? de : ru;
    const {wizard, reviewReads} = await mount(page, lang, undefined, false, false, true, lifecycle === "converted", lifecycle === "active" || lifecycle === "inactive" ? lifecycle : undefined);
    await expect(wizard.getByRole("tab")).toHaveCount(7);
    await wizard.getByRole("tab", {name: tx("Медицинская характеристика", "Medizinische Merkmale"), exact: false}).click();
    await expect(wizard.getByRole("heading", {name: tx("Анамнез", "Anamnese"), exact: true})).toBeVisible();
    await wizard.getByRole("tab", {name: tx("Документы", "Unterlagen"), exact: false}).click();
    await expect(wizard.getByText(tx("Проверка документов пациента", "Patientendokumente prüfen"), {exact: true})).toHaveCount(0);
    await expect(wizard.getByRole("tab", {name: tx("Проверка документов", "Dokumentenprüfung"), exact: false})).toHaveCount(0);
    expect(reviewReads).toEqual([]);
  });
}


test("lead entry preserves an already selected patient contract without starting document review", async ({page}) => {
  const {wizard, reviewReads, writes} = await mount(page, "ru", undefined, false, true, true, false, "active");
  await wizard.getByRole("tab", {name: /Договор и смета/}).click();
  await expect(wizard.getByText(/Используется подписанный договор.*FC-PREVIOUS/)).toBeVisible();
  await expect(wizard.getByText("Сохранённые договоры пациента", {exact: true})).toHaveCount(0);
  expect(reviewReads).toEqual([]);
  expect(writes.filter(item => item.path.startsWith("/framework-contracts"))).toEqual([]);
});


test("saved repeat is resumed through the patient entry without creating another record", async ({page}) => {
  const {writes,wizard}=await mount(page);
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  await expect(wizard.getByText("Данные сохранены",{exact:true})).toBeVisible();
  await wizard.getByRole("button",{name:"Закрыть",exact:true}).click();
  await page.getByRole("button",{name:"Repeat intake",exact:true}).click();
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  await expect(wizard).toBeVisible();
  await wizard.getByRole("tab",{name:/Медицинская характеристика/}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  expect(writes.filter(x=>x.path==="/leads")).toHaveLength(1);
});

test("saved repeat drafts can be removed from the picker", async ({page}) => {
  const {wizard} = await mount(page);
  await wizard.getByRole("button", {name: "Закрыть", exact: true}).click();

  const firstLeadId = "00000000-0000-0000-0000-000000000901";
  const secondLeadId = "00000000-0000-0000-0000-000000000902";
  let drafts = [
    {id: firstLeadId, created_at: "2026-09-12T10:00:00Z", concern: "First saved draft"},
    {id: secondLeadId, created_at: "2026-09-10T10:00:00Z", concern: null},
  ];
  const discarded: {path: string; body: Record<string, unknown>}[] = [];

  await page.route(`**/api/v1/patients/${patientId}/repeat-intakes`, route =>
    route.fulfill({contentType: "application/json", body: JSON.stringify(drafts)}),
  );
  await page.route("**/api/v1/leads/*/failed-flow", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const body = route.request().postDataJSON() as Record<string, unknown>;
    discarded.push({path, body});
    drafts = drafts.filter(item => !path.includes(item.id));
    await route.fulfill({contentType: "application/json", body: "{}"});
  });

  await page.getByRole("button", {name: "Repeat intake", exact: true}).click();
  const picker = page.getByRole("dialog", {name: "Повторное обращение", exact: true});
  await expect(picker.getByText("First saved draft", {exact: true})).toBeVisible();
  await picker.getByRole("button", {name: "Удалить черновик: First saved draft", exact: true}).click();

  const confirmation = page.getByRole("dialog", {name: "Удалить черновик?", exact: true});
  await confirmation.getByRole("button", {name: "Отмена", exact: true}).click();
  await expect(picker.getByText("First saved draft", {exact: true})).toBeVisible();
  expect(discarded).toEqual([]);

  await picker.getByRole("button", {name: "Удалить черновик: First saved draft", exact: true}).click();
  await confirmation.getByRole("button", {name: "Удалить черновик", exact: true}).click();
  await expect(picker.getByText("First saved draft", {exact: true})).toHaveCount(0);
  await expect(picker.getByText("Черновик обращения", {exact: true})).toBeVisible();
  expect(discarded).toEqual([{
    path: `/leads/${firstLeadId}/failed-flow`,
    body: {resolution: "archive", reason: "draft_discarded"},
  }]);

  await picker.getByRole("button", {name: "Удалить черновик: Черновик обращения", exact: true}).click();
  await confirmation.getByRole("button", {name: "Удалить черновик", exact: true}).click();
  await expect(picker.getByText("Сохранённых черновиков нет.", {exact: true})).toBeVisible();
  expect(discarded.map(item => item.path)).toEqual([
    `/leads/${firstLeadId}/failed-flow`,
    `/leads/${secondLeadId}/failed-flow`,
  ]);
});

test("uncertain first save retries the same durable creation key",async({page})=>{
  const {wizard}=await mount(page);
  const requests:Record<string,unknown>[]=[];
  await page.route("**/api/v1/leads",route=>{
    if(route.request().method()!=="POST") return route.fallback();
    requests.push(route.request().postDataJSON());
    return requests.length===1 ? route.abort("connectionreset") : route.fallback();
  });
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText("Изменения не сохранены",{exact:true})).toBeVisible();
  await wizard.getByRole("button",{name:"Повторить",exact:true}).click();
  await expect(wizard.getByText("Данные сохранены",{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[0].creation_key).toBeTruthy();
  expect(requests[0].creation_key).toEqual(requests[1].creation_key);
  expect(requests[0].repeat_patient_id).toBe(patientId);
});

test("viewing completion never rewrites existing clinical data",async({page})=>{
  const {writes,wizard}=await mount(page);
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  await wizard.locator("#lead-wizard-concern").fill("Synthetic repeat concern");
  await wizard.getByRole("tab",{name:/Завершение обращения/}).click();
  await expect(wizard.getByRole("tab",{name:/Завершение обращения/})).toHaveAttribute("aria-selected","true");
  expect(writes.filter(x=>x.path.startsWith(`/patients/${patientId}/`))).toEqual([]);
  expect(writes.filter(x=>x.path.endsWith("/intake"))).toEqual([]);
});

test("removing an allergy sends its explicit id and snapshot revision",async({page})=>{
  const {wizard}=await mount(page);let deleted=false;let savedUrl="";
  await page.route(`**/api/v1/patients/${patientId}/clinical-warnings*`,async route=>{
    const body=route.request().postDataJSON();
    if(body.kind==="allergie"){savedUrl=route.request().url();deleted=true;}
    await route.fulfill({contentType:"application/json",body:'{"ok":true}'});
  });
  await page.route(`**/api/v1/patients/${patientId}/clinical`,route=> deleted
    ?route.fulfill({contentType:"application/json",body:JSON.stringify({revision:1,allergien:[],cave:[],diagnoses:[],medications:[],narrative:null})})
    :route.fallback());
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  const section=wizard.locator("section").filter({has:page.locator("header").filter({hasText:"Аллергии"})}).last();
  await section.getByRole("button",{name:"Удалить",exact:true}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toHaveCount(0);
  const query=new URL(savedUrl).searchParams;
  expect(query.get("remove_ids")).toBe(allergyId);expect(query.get("expected_revision")).toBe("0");expect(query.get("operation_id")).toBeTruthy();
});


test("clinical retry after a committed save and failed reload reuses the operation key", async ({page}) => {
  const {wizard}=await mount(page);
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  let saved: Record<string,unknown>[]=[]; let failReload=true;
  const urls:string[]=[];
  await page.route(`**/api/v1/patients/${patientId}/clinical-warnings*`, async route=>{
    urls.push(route.request().url());
    saved=route.request().postDataJSON().items.map((item:Record<string,unknown>)=>({...item,id:item.id || "00000000-0000-0000-0000-000000000991"}));
    await route.fulfill({contentType:"application/json",body:'{"ok":true}'});
  });
  await page.route(`**/api/v1/patients/${patientId}/clinical`,route=>{
    if(failReload){failReload=false;return route.abort("connectionreset");}
    return route.fulfill({contentType:"application/json",body:JSON.stringify({revision:1,allergien:saved,cave:[],diagnoses:[],medications:[],narrative:null})});
  });
  const section=wizard.locator("section").filter({has:page.locator("header").filter({hasText:"Аллергии"})}).last();
  await section.getByRole("button",{name:"Добавить",exact:true}).click();
  const editor=page.getByRole("dialog",{name:"Добавить: Аллергии",exact:true});
  await editor.getByPlaceholder("Пенициллин",{exact:true}).fill("Synthetic new allergy");
  await editor.getByRole("button",{name:"Сохранить",exact:true}).click();
  await expect.poll(()=>urls.length).toBe(1);
  await expect(editor.getByRole("button",{name:"Сохранить",exact:true})).toBeEnabled();
  await editor.getByRole("button",{name:"Сохранить",exact:true}).click();
  await expect(editor).toBeHidden();
  expect(urls).toHaveLength(2);
  expect(new URL(urls[0]).search).toEqual(new URL(urls[1]).search);
  await expect(wizard.getByText("Synthetic new allergy",{exact:true})).toBeVisible();
  await section.getByRole("button",{name:"Редактировать",exact:true}).last().click();
  const editAgain=page.getByRole("dialog",{name:"Редактировать: Аллергии",exact:true});
  await editAgain.getByPlaceholder("Сыпь, отёк",{exact:true}).fill("Synthetic update");
  await editAgain.getByRole("button",{name:"Сохранить",exact:true}).click();
  await expect(editAgain).toBeHidden();
  expect(saved).toHaveLength(2);expect(saved[1].id).toBe("00000000-0000-0000-0000-000000000991");
  expect(new URL(urls[2]).searchParams.get("expected_revision")).toBe("1");
});

test("a clinical conflict requires a fresh record before another save", async ({page})=>{
  const {wizard}=await mount(page);
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  let writes=0;
  await page.route(`**/api/v1/patients/${patientId}/clinical-warnings*`,route=>{
    writes++;
    return route.fulfill({status:409,contentType:"application/json",body:'{"message":"Clinical data changed"}'});
  });
  const section=wizard.locator("section").filter({has:page.locator("header").filter({hasText:"Аллергии"})}).last();
  await section.getByRole("button",{name:"Удалить",exact:true}).click();
  await expect.poll(()=>writes).toBe(1);
  await expect(section.getByRole("button",{name:"Удалить",exact:true})).toBeEnabled();
  await section.getByRole("button",{name:"Удалить",exact:true}).click();
  await expect(section.getByRole("button",{name:"Удалить",exact:true})).toBeEnabled();
  expect(writes).toBe(1);
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
});

test("a role without clinical access can continue repeat administration", async ({page})=>{
  const {wizard,writes}=await mount(page);
  await page.route(`**/api/v1/patients/${patientId}/clinical`,route=>route.fulfill({status:403,contentType:"application/json",body:'{"message":"Forbidden"}'}));
  await wizard.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(wizard.getByText(/У вашей роли нет доступа к медицинской карте/)).toBeVisible();
  await wizard.getByRole("tab",{name:/Сервисная история/}).click();
  await expect(wizard.getByRole("tab",{name:/Сервисная история/})).toHaveAttribute("aria-selected","true");
  expect(writes.filter(item=>item.path.startsWith(`/patients/${patientId}/`))).toEqual([]);
});

test("repeat intake offers earlier reasons and copies one into the required field", async ({page}) => {
  const {wizard} = await mount(page);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  const previous = wizard.getByRole("region", {name: "Предыдущие обращения"});
  await expect(previous.getByText("Knee pain after sports injury", {exact: true})).toBeVisible();
  await expect(previous.getByText(/A-PREVIOUS-001 · 02\.03\.2026 – 06\.03\.2026/)).toBeVisible();
  await previous.getByRole("button", {name: "Взять причину обращения от 01.03.2026"}).click();
  await expect(wizard.locator("#lead-wizard-concern")).toHaveValue("Knee pain after sports injury");
  await expect(previous.getByRole("button", {name: "Взять причину обращения от 01.03.2026"})).toBeDisabled();
  await expect(previous.getByText("Уже в поле", {exact: true})).toBeVisible();
});

test("document review shows that consents of this request are still missing", async ({page}) => {
  const {wizard} = await mount(page, "ru", undefined, false, true);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await wizard.getByRole("tab", {name: /Проверка документов/}).click();
  await expect(wizard.getByText("Согласия в этом обращении", {exact: true}).first()).toBeVisible();
  await expect(wizard.getByText("Не отмечены: согласия из карточки не переносятся", {exact: true}).first()).toBeVisible();
  await expect(wizard.getByTestId("repeat-consent-note")).toBeVisible();
  await wizard.getByRole("button", {name: "Отметить согласия", exact: true}).first().click();
  await expect(page.locator("#lead-wizard-privacy-consent")).toBeFocused();
});
