import { expect, test, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";

// Fresh audit regressions: every request is synthetic and all API traffic is mocked.
async function setup(page: Page, firstPersonalReply?: Promise<void>, scenario?: "representative" | "extra", secondPersonalReply?: Promise<void>, failure?: { enabled: boolean; status: number; endpoint: string; field?: string }) {
  await startClockAt(page);
  const request = {
    lead_id: "person-recheck", access_kind: "self", created_at: "2026-10-12T08:00:00Z",
    personal_data: {
      first_name: "Anna", middle_name: null, last_name: "Muster", date_of_birth: "1980-02-03",
      legal_sex: "female", citizenships: ["DE"], street_address: "Teststrasse 1", zip_code: "10115",
      city: "Berlin", country: "DE", phone: "+4915112345678", primary_language: "de",
      has_insurance: false, insurance_type: "self_pay", insurance_provider: null,
      insurance_number: null, insurance_covers_germany: null,
    } as Record<string, unknown>,
    identification: {
      salutation: null, contact_channels: [] as string[], former_names: "Original name",
      request_reason: "Synthetic concern",
    } as Record<string, unknown>,
    progress: { filled: 12, total: 12, missing_for_submit: [] }, minor: false,
    documents: [], identity_documents: [], max_documents: 30,
    consents: { lead_inquiry_processing: {
      type: "lead_inquiry_processing", version: "2026-10-03", texts: { de: "Synthetic consent" },
      given_at: "2026-10-12T08:00:00Z",
    } },
    representation: {
      has_representative: scenario === "representative", under_guardianship: false, custody: null, custody_stated: false,
      representatives: scenario === "representative" ? [{
        id: "11111111-1111-4111-8111-111111111111", slot: "agent", role: "authorised_representative",
        first_name: "Ben", last_name: "Muster", date_of_birth: "1980-01-02", city: "Berlin",
        street: "Teststrasse 2", zip: "10115", country: "DE", citizenships: ["DE"],
        phone: "+4915112345670", email: "agent@example.invalid", mine: false, email_locked: false,
        can_remove: true, identity_documents: [], authority_documents: [],
      } as Record<string, unknown>] : [],
    },
    // Own financial answers and proof uploads require an explicit payer declaration.
    payer: scenario === "extra" ? {
      payer_kind: "self", first_name: "Anna", last_name: "Muster", date_of_birth: "1980-02-03",
      street: "Teststrasse 1", zip: "10115", city: "Berlin", country: "DE", citizenships: ["DE"],
      relationship: null, email: null, phone: "+4915112345678", acts_on_own_account: true,
    } : null,
    follow_up: {
      required: scenario === "extra", blocks: scenario === "extra" ? ["A"] : [], missing: {}, answered_at: null,
      answers: { occupation: "Engineer", sector: "Old sector", funds_source: "income", funds_description: "Salary" } as Record<string, unknown>,
      funds_source_options: ["income", "savings"], funds_proof_documents: [], relationship_proof_documents: [], identity_documents: [],
    },
    submitted_at: scenario === "extra" ? "2026-10-12T08:00:00Z" : null,
    changed_since_submit: false, retention_deadline_at: null,
  };
  const calls = {
    personal: [] as Record<string, unknown>[], identification: [] as Record<string, unknown>[],
    representative: [] as Record<string, unknown>[], extra: [] as Record<string, unknown>[], fundsUploads: 0,
    submits: [] as Record<string, unknown>[],
  };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "synthetic-person-recheck-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (failure?.enabled && path.endsWith(failure.endpoint)) {
      return route.fulfill({ status: failure.status, json: { code: "invalid_field", field: failure.field } });
    }
    if (path === "/me") return route.fulfill({ json: {
      id: "synthetic-person-user", email: "person-recheck@example.invalid", name: "Anna Muster",
      role: "patient", capabilities: [], created_at: "2026-10-12T08:00:00Z", preferred_language: "de",
      password_change_required: false, portal_mode: "lead", lead_portal: { requests: 1 },
    } });
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [request] } });
    if (path.endsWith("/submit")) {
      calls.submits.push(structuredClone(request.personal_data));
      request.submitted_at = "2026-10-13T17:00:00Z";
      return route.fulfill({ json: request });
    }
    if (path.endsWith("/funds-proof")) {
      calls.fundsUploads++;
      request.follow_up.answers.occupation = "Staff-corrected profession";
      return route.fulfill({ json: request });
    }
    if (path.includes("/representatives/")) {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      calls.representative.push(patch);
      Object.assign(request.representation.representatives[0], patch);
      if (calls.representative.length === 1) {
        request.representation.representatives[0].city = "Munich";
        await firstPersonalReply;
      }
      return route.fulfill({ json: request });
    }
    if (path.endsWith("/enhanced-details")) {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      calls.extra.push(patch);
      Object.assign(request.follow_up.answers, patch);
      if (calls.extra.length === 1) {
        request.follow_up.answers.sector = "Corrected sector";
        await firstPersonalReply;
      }
      return route.fulfill({ json: request });
    }
    if (path.endsWith("/personal-data")) {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      calls.personal.push(patch);
      Object.assign(request.personal_data, patch);
      // A concurrent staff edit is already in the complete server response.
      if (calls.personal.length === 1 && !failure) {
        request.personal_data.city = "Munich";
        await firstPersonalReply;
      }
      if (calls.personal.length === 2 && secondPersonalReply) {
        request.personal_data.city = "Hamburg";
        await secondPersonalReply;
      }
      return route.fulfill({ json: request });
    }
    if (path.endsWith("/identification")) {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      calls.identification.push(patch);
      Object.assign(request.identification, patch);
      if (calls.identification.length === 1) request.identification.former_names = "Corrected by staff";
      return route.fulfill({ json: request });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/my/request");
  if (scenario === "extra") await expect(page.getByTestId("lead-request-follow-up-A")).toBeVisible();
  else await expect(page.locator("#lead-request-first_name")).toHaveValue("Anna");
  return { calls, request };
}

test("recheck: personal autosave preserves a concurrent staff edit to an untouched field", async ({ page }) => {
  const { calls, request } = await setup(page);
  await page.locator("#lead-request-first_name").fill("Annette");
  await expect.poll(() => calls.personal.length).toBe(1);
  await page.locator("#lead-request-phone").fill("+4915112345679");
  await expect.poll(() => calls.personal.length).toBe(2);
  expect(calls.personal[1]).toEqual({ phone: "+4915112345679" });
  expect(request.personal_data.city).toBe("Munich");
});

test("recheck: identification autosave preserves a staff correction to a hidden field", async ({ page }) => {
  const { calls, request } = await setup(page);
  const channels = page.getByTestId("lead-request-contact-channels");
  await channels.getByRole("checkbox", { name: "E-Mail", exact: true }).check();
  await expect.poll(() => calls.identification.length).toBe(1);
  await channels.getByRole("checkbox", { name: "Telefon", exact: true }).check();
  await expect.poll(() => calls.identification.length).toBe(2);
  expect(calls.identification[1]).toEqual({ contact_channels: ["email", "phone"] });
  expect(request.identification.former_names).toBe("Corrected by staff");
});

test("recheck: an already queued autosave cannot restore stale values from its snapshot", async ({ page }) => {
  let release = () => {};
  const firstReply = new Promise<void>((resolve) => { release = resolve; });
  const { calls, request } = await setup(page, firstReply);
  await page.locator("#lead-request-first_name").fill("Annette");
  await expect.poll(() => calls.personal.length).toBe(1);
  await page.locator("#lead-request-phone").fill("+4915112345679");
  // Let the 700 ms debounce enqueue this draft while the first response is held.
  await page.waitForTimeout(850);
  release();
  await expect.poll(() => calls.personal.length).toBe(2);
  expect(calls.personal[1]).toEqual({ phone: "+4915112345679" });
  expect(request.personal_data.city).toBe("Munich");
  await expect(page.locator("#lead-request-city")).toHaveValue("Munich");
  await page.reload();
  await expect(page.locator("#lead-request-city")).toHaveValue("Munich");
  await expect(page.locator("#lead-request-phone")).toHaveValue("+4915112345679");
});

test("recheck: reverting a name while its earlier edit is in flight persists the final value", async ({ page }) => {
  let release = () => {};
  const firstReply = new Promise<void>((resolve) => { release = resolve; });
  const { calls, request } = await setup(page, firstReply);
  await page.locator("#lead-request-first_name").fill("Annette");
  await expect.poll(() => calls.personal.length).toBe(1);
  await page.locator("#lead-request-first_name").fill("Anna");
  await page.waitForTimeout(850);
  release();
  await expect.poll(() => calls.personal.length).toBe(2);
  expect(calls.personal[1]).toEqual({ first_name: "Anna" });
  expect(request.personal_data.first_name).toBe("Anna");
});

test("recheck: a queued representative edit preserves the server correction of another field", async ({ page }) => {
  let release = () => {};
  const firstReply = new Promise<void>((resolve) => { release = resolve; });
  const { calls, request } = await setup(page, firstReply, "representative");
  const block = page.getByTestId("lead-request-representative-agent");
  await block.getByRole("textbox", { name: "Vorname", exact: true }).fill("Benjamin");
  await expect.poll(() => calls.representative.length).toBe(1);
  await block.getByRole("textbox", { name: "Telefon", exact: true }).fill("+4915112345679");
  await page.waitForTimeout(850);
  release();
  await expect.poll(() => calls.representative.length).toBe(2);
  expect(calls.representative[1]).toEqual({ phone: "+4915112345679" });
  expect(request.representation.representatives[0].city).toBe("Munich");
});

test("recheck: a queued extra answer preserves the server correction of another answer", async ({ page }) => {
  let release = () => {};
  const firstReply = new Promise<void>((resolve) => { release = resolve; });
  const { calls, request } = await setup(page, firstReply, "extra");
  await page.locator("#lead-request-occupation").fill("Architect");
  await expect.poll(() => calls.extra.length).toBe(1);
  await page.locator("#lead-request-funds_description").fill("Salary and savings");
  await page.waitForTimeout(850);
  release();
  await expect.poll(() => calls.extra.length).toBe(2);
  expect(calls.extra[1]).toEqual({ funds_description: "Salary and savings" });
  expect(request.follow_up.answers.sector).toBe("Corrected sector");
});

test("recheck: successive server corrections are never mistaken for patient edits", async ({ page }) => {
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  const firstReply = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondReply = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const { calls, request } = await setup(page, firstReply, undefined, secondReply);
  await page.locator("#lead-request-first_name").fill("Annette");
  await expect.poll(() => calls.personal.length).toBe(1);
  await page.locator("#lead-request-phone").fill("+4915112345679");
  await page.waitForTimeout(850);
  releaseFirst();
  await expect.poll(() => calls.personal.length).toBe(2);
  // The first response rebases the draft. Its resulting debounce must not
  // classify that server-provided city as a new patient edit.
  await expect(page.locator("#lead-request-city")).toHaveValue("Munich");
  await page.waitForTimeout(850);
  releaseSecond();
  await expect(page.locator("#lead-request-city")).toHaveValue("Hamburg");
  await page.waitForTimeout(850);
  expect(calls.personal).toEqual([{ first_name: "Annette" }, { phone: "+4915112345679" }]);
  expect(request.personal_data.city).toBe("Hamburg");
});

test("recheck: a funds upload response cannot replace unsaved typing in an extra answer", async ({ page }) => {
  const { calls, request } = await setup(page, undefined, "extra");
  await page.locator("#lead-request-occupation").fill("Architect");
  await page.locator("#lead-request-funds-proof-files").setInputFiles({
    name: "synthetic-proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect.poll(() => calls.fundsUploads).toBe(1);
  await expect(page.locator("#lead-request-occupation")).toHaveValue("Architect");
  await expect.poll(() => request.follow_up.answers.occupation).toBe("Architect");
});

for (const status of [503, 422]) {
  test(`failed autosave ${status} retains the draft and prevents leaving until recovery`, async ({ page }) => {
    const failure = { enabled: true, status, endpoint: '/personal-data', field: status === 422 ? 'city' : undefined };
    const { calls, request } = await setup(page, undefined, undefined, undefined, failure);
    await page.locator('#lead-request-city').fill('Hamburg');
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId('lead-request-save-blocked')).toBeVisible();
    await expect(page.locator('#lead-request-city')).toHaveValue('Hamburg');
    await expect(page.getByTestId('lead-request-submit')).toHaveCount(0);
    expect(request.personal_data.city).toBe('Berlin');
    failure.enabled = false;
    // A validation refusal requires correcting the rejected value; a network
    // failure can retry the identical draft through the same navigation action.
    if (status === 422) await page.locator('#lead-request-city').fill('Bremen');
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId('lead-request-submit')).toBeVisible();
    expect(calls.personal.at(-1)).toEqual({ city: status === 422 ? 'Bremen' : 'Hamburg' });
    await page.getByTestId('lead-request-declaration').getByRole('checkbox').check();
    await page.getByTestId('lead-request-submit').click();
    await expect(page.getByTestId('lead-request-sent')).toBeVisible();
    expect(calls.submits).toHaveLength(1);
    expect(calls.submits[0].city).toBe(status === 422 ? 'Bremen' : 'Hamburg');
    await page.locator('[data-step="person"]').click();
    await expect(page.locator('#lead-request-city')).toHaveValue(status === 422 ? 'Bremen' : 'Hamburg');
  });
}

test('the "could not be saved" banner goes once the corrected entry has saved itself', async ({ page }) => {
  const failure = { enabled: true, status: 422, endpoint: '/personal-data', field: 'city' };
  const { calls } = await setup(page, undefined, undefined, undefined, failure);
  await page.locator('#lead-request-city').fill('Hamburg');
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId('lead-request-save-blocked')).toBeVisible();
  failure.enabled = false;
  await page.locator('#lead-request-city').fill('Bremen');
  // Saved by the autosave alone, without another step change: the banner would now be untrue.
  await expect.poll(() => calls.personal.at(-1)).toEqual({ city: 'Bremen' });
  await expect(page.getByTestId('lead-request-save-blocked')).toHaveCount(0);
  await expect(page.locator('[data-step="person"]')).toHaveAttribute('aria-current', 'step');
});

test('failed identification autosave retains channel choices across a refused step change', async ({ page }) => {
  const failure = { enabled: true, status: 503, endpoint: '/identification' };
  const { request } = await setup(page, undefined, undefined, undefined, failure);
  const email = page.getByTestId('lead-request-contact-channels').getByRole('checkbox', { name: 'E-Mail', exact: true });
  await email.check();
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId('lead-request-save-blocked')).toBeVisible();
  await expect(email).toBeChecked();
  expect(request.identification.contact_channels).toEqual([]);
  failure.enabled = false;
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId('lead-request-submit')).toBeVisible();
  expect(request.identification.contact_channels).toEqual(['email']);
});

test('clearing a required name cannot silently send the previously saved name', async ({ page }) => {
  const { request } = await setup(page);
  await page.locator('#lead-request-first_name').fill('');
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId('lead-request-save-blocked')).toBeVisible();
  await expect(page.locator('#lead-request-first_name')).toHaveValue('');
  expect(request.personal_data.first_name).toBe('Anna');
  await page.locator('#lead-request-first_name').fill('Annette');
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId('lead-request-submit')).toBeVisible();
  expect(request.personal_data.first_name).toBe('Annette');
});

test('typing while another section saves is included before leaving the step', async ({ page }) => {
  let release = () => {};
  const reply = new Promise<void>((resolve) => { release = resolve; });
  const { request, calls } = await setup(page, undefined, undefined, undefined, { enabled: false, status: 503, endpoint: '/personal-data' });
  let identificationStarted = false;
  await page.route('**/me/lead-requests/person-recheck/identification', async (route) => {
    identificationStarted = true;
    Object.assign(request.identification, route.request().postDataJSON());
    await reply;
    await route.fulfill({ json: request });
  });
  await page.getByTestId('lead-request-contact-channels').getByRole('checkbox', { name: 'E-Mail', exact: true }).check();
  await page.locator('[data-step="send"]').click();
  await expect.poll(() => identificationStarted).toBe(true);
  await page.locator('#lead-request-city').fill('Bremen');
  release();
  await expect(page.getByTestId('lead-request-submit')).toBeVisible();
  expect(calls.personal.at(-1)).toEqual({ city: 'Bremen' });
  expect(request.personal_data.city).toBe('Bremen');
});

test('leaving after save preserves server corrections without a stale unmount write', async ({ page }) => {
  const { request, calls } = await setup(page);
  await page.locator('#lead-request-first_name').fill('Annette');
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId('lead-request-submit')).toBeVisible();
  await page.locator('[data-step="person"]').click();
  await expect(page.locator('#lead-request-city')).toHaveValue('Munich');
  expect(request.personal_data.city).toBe('Munich');
  expect(calls.personal).toEqual([{ first_name: 'Annette' }]);
});
