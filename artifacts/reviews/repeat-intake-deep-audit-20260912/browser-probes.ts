import { expect, test, type Page } from "@playwright/test";

const patientId = "00000000-0000-0000-0000-000000000111";
const leadId = "00000000-0000-0000-0000-000000000222";
const caseId = "00000000-0000-0000-0000-000000000333";
const orderId = "00000000-0000-0000-0000-000000000444";
const allergyId = "00000000-0000-4000-8000-000000000555";

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
    intake_model: "patient_first", wizard_state: withDocuments && asLead ? {framework_contract_id: "valid-contract"} : {}, services: [], attachments: [],
    ...(convertedLead || linkedPatientLifecycle ? {converted_patient_id: convertedLead ? patientId : null, prospect_patient_id: patientId, prospect_patient_lifecycle: linkedPatientLifecycle ?? "active"} : {}),
    readiness: {conversion_ready: false, blocking_reasons: [], steps: [], checks: []},
  };
  let hasOrder = false;
  let passportExpiry = "2020-01-01";
  const reviewContracts = [
    { id: "valid-contract", patient_id: patientId, contract_number: "FC-PREVIOUS", status: "signed", signed_at: "2025-01-01T10:00:00Z", valid_from: "2025-01-01", valid_to: "2030-12-31" },
    { id: "expired-contract", patient_id: patientId, contract_number: "FC-EXPIRED", status: "signed", signed_at: "2019-01-01T10:00:00Z", valid_from: "2019-01-01", valid_to: "2020-12-31" },
    { id: "short-contract", patient_id: patientId, contract_number: "FC-SHORT", status: "signed", signed_at: "2025-01-01T10:00:00Z", valid_from: "2025-01-01", valid_to: "2030-09-05" },
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


test("audit: saved repeat reopened from patient starts a second lead", async ({page}) => {
  const {writes, wizard} = await mount(page);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  await expect(wizard.getByText("Данные сохранены", {exact: true})).toBeVisible();
  await wizard.getByRole("button", {name: "Закрыть", exact: true}).click();
  await expect(wizard).toBeHidden();
  await page.getByRole("button", {name: "Repeat intake", exact: true}).click();
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  expect(writes.filter(item => item.path === "/leads")).toHaveLength(2);
  expect(writes.filter(item => item.path.endsWith("/prospect"))).toHaveLength(2);
  console.log("AUDIT reopened draft: create lead POST count =", writes.filter(item => item.path === "/leads").length);
});

test("audit: uncertain first create result is retried without any idempotency token", async ({page}) => {
  const {writes, wizard} = await mount(page);
  let committed = 0;
  const requests: {headers: Record<string,string>; body: Record<string,unknown>}[]=[];
  await page.route("**/api/v1/leads", async route => {
    if(route.request().method()!=="POST") return route.fallback();
    committed++;
    requests.push({headers:route.request().headers(),body:route.request().postDataJSON()});
    if(committed===1) return route.abort("connectionreset");
    return route.fallback();
  });
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Изменения не сохранены", {exact: true})).toBeVisible();
  await wizard.getByRole("button", {name: "Повторить", exact: true}).click();
  await expect(wizard.getByText("Данные сохранены", {exact: true})).toBeVisible();
  expect(committed).toBe(2);
  expect(requests[0].headers["idempotency-key"]).toBeUndefined();
  expect(requests[1].body).toEqual(requests[0].body);
  console.log("AUDIT ambiguous create: identical POST retried, commits modeled =", committed);
});


test("audit: opening completion overwrites a concurrent clinical edit with old local data", async ({page}) => {
  const {writes, wizard} = await mount(page);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  await page.waitForLoadState("networkidle");
  let freshReads=0;
  await page.route(`**/api/v1/patients/${patientId}/clinical`, route => {
    freshReads++;
    return route.fulfill({contentType:"application/json",body:JSON.stringify({
      allergien:[{id:allergyId,label:"Penicillin",reaction:"Updated by another clinician"}],
      cave:[], diagnoses:[], medications:[], narrative:null,examinations:[],procedures:[],verlauf:[],
    })});
  });
  await wizard.locator("#lead-wizard-concern").fill("Synthetic new concern");
  await wizard.getByRole("tab",{name:/Завершение обращения/}).click();
  await expect.poll(()=>writes.filter(x=>x.path.endsWith("/clinical-warnings")).length).toBeGreaterThan(0);
  const allergySave=writes.find(x=>x.path.endsWith("/clinical-warnings") && x.body.kind==="allergie");
  expect(freshReads).toBeGreaterThan(0);
  expect(allergySave?.body.items).toEqual([{id:allergyId,label:"Penicillin",reaction:"Rash"}]);
  console.log("AUDIT concurrent clinical edit: fetched fresh reaction, then submitted stale Rash without user editing allergy");
});


test("audit: deleting an existing allergy through repeat intake returns it after reload", async ({page}) => {
  const {writes, wizard} = await mount(page);
  await wizard.getByRole("button", {name: "Далее", exact: true}).click();
  await expect(wizard.getByText("Penicillin", {exact: true})).toBeVisible();
  await page.waitForLoadState("networkidle");
  const section=wizard.locator("section").filter({has:page.locator("header").filter({hasText:"Аллергии"})}).last();
  await section.getByRole("button",{name:"Удалить",exact:true}).click();
  await expect.poll(()=>writes.some(x=>x.path.endsWith("/clinical-warnings")&&x.body.kind==="allergie")).toBe(true);
  expect(writes.find(x=>x.path.endsWith("/clinical-warnings")&&x.body.kind==="allergie")?.body.items).toEqual([]);
  await wizard.getByRole("button",{name:"Закрыть",exact:true}).click();
  await expect(wizard).toBeHidden();
  await page.getByRole("button",{name:"Lead intake",exact:true}).click();
  await wizard.getByRole("tab",{name:/Медицинская характеристика/}).click();
  await expect(wizard.getByText("Penicillin",{exact:true})).toBeVisible();
  console.log("AUDIT delete: UI issued empty merge list; existing clinical entry reappears from server");
});
