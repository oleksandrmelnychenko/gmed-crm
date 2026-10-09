import { expect, test, type Locator, type Page } from "@playwright/test";

// Lead cabinet, who acts for the lead (owner spec "Patientenformular",
// section 3; contract phase 1b-2): an adult's representative and legal
// guardian, and the legal representatives of a minor in a parent's login.
// Mocked API that behaves like the contract, synthetic data.

const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Upload = {
  id: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by_me: boolean;
  reviewed: boolean;
  can_delete: boolean;
};

const PERSON_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "citizenships",
  "street",
  "zip",
  "city",
  "country",
  "email",
  "phone",
] as const;

type Person = {
  id: string;
  role: "legal_representative" | "authorised_representative" | "legal_guardian";
  relation: string;
  mine: boolean;
  email_locked: boolean;
  can_remove: boolean;
  identity_documents: Upload[];
  authority_documents: Upload[];
} & Record<(typeof PERSON_FIELDS)[number], unknown>;

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: ANNA,
    role: "legal_representative",
    relation: "parent",
    mine: false,
    email_locked: false,
    can_remove: true,
    first_name: null,
    last_name: null,
    date_of_birth: null,
    birth_place: null,
    birth_country: null,
    citizenships: [],
    street: null,
    zip: null,
    city: null,
    country: null,
    email: null,
    phone: null,
    identity_documents: [],
    authority_documents: [],
    ...overrides,
  };
}

/** The parent whose login fills in the child's request: on file with name, date of birth and sign-in address. */
function anna(): Person {
  return person({
    id: ANNA,
    mine: true,
    email_locked: true,
    can_remove: false,
    first_name: "Anna",
    last_name: "Muster",
    date_of_birth: "1985-03-02",
    email: "anna.muster@example.com",
  });
}

function upload(id: string, fileName: string): Upload {
  return {
    id,
    file_name: fileName,
    size_bytes: 4096,
    mime_type: fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    uploaded_at: "2026-10-05T09:20:00Z",
    uploaded_by_me: true,
    reviewed: false,
    can_delete: true,
  };
}

/** A request with everything entered but the representation: an adult's own, or a child's in a parent's login. */
function leadRequest(minor: boolean) {
  return {
    lead_id: "lead-1",
    access_kind: minor ? "guardian" : "self",
    created_at: "2026-10-05T08:00:00Z",
    personal_data: {
      first_name: minor ? "Mia" : "Anna",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: minor ? "2015-06-01" : "1988-05-01",
      legal_sex: "female",
      citizenships: ["DE"],
      street_address: "Musterstraße 1",
      zip_code: "10115",
      city: "Berlin",
      country: "DE",
      phone: null,
      primary_language: null,
      has_insurance: null,
      insurance_type: null,
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    } as Record<string, unknown>,
    // Recomputed before every response.
    progress: { filled: 9, total: 12, missing_for_submit: [] as string[] },
    payer: {
      payer_kind: "self",
      first_name: null,
      last_name: null,
      date_of_birth: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      citizenships: [],
      relationship: null,
      email: null,
      phone: null,
      acts_on_own_account: true,
      beneficial_owner: null,
      payer_type: null,
      organisation_name: null,
      relationship_kind: null,
      contact_consent_at: null,
    },
    payer_self_template: null,
    identification: {
      salutation: null,
      former_names: null,
      birth_place: "Berlin",
      birth_country: "DE",
      habitual_residence_country: null,
      contact_channels: ["email"],
      pep_self: false,
      pep_related: false,
      sanctions_links: false,
      payment_background: null,
      declared_correct_at: null as string | null,
    },
    identity_documents: [upload("id-doc-0", "reisepass.jpg")],
    representation: {
      has_representative: null as boolean | null,
      under_guardianship: null as boolean | null,
      custody: (minor ? "joint" : null) as "joint" | "sole_parent" | "guardian" | null,
      custody_stated: false,
      representatives: [] as Person[],
    },
    minor,
    documents: [] as Upload[],
    max_documents: 30,
    consents: {
      health_data_processing: {
        type: "health_data_processing",
        version: "2026-10-03",
        texts: { de: "Ich willige ein …" },
        given_at: null as string | null,
      },
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: "2026-10-03",
        texts: { de: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden." },
        given_at: "2026-10-05T09:15:00Z" as string | null,
      },
    } as Record<string, { type: string; version: string; texts: Record<string, string>; given_at: string | null }>,
    submitted_at: null as string | null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-19T08:00:00Z",
  };
}

type Request = ReturnType<typeof leadRequest>;

// What the request cannot be sent without about a person (contract 2.6).
const ADULT_REQUIRED = [
  "first_name",
  "last_name",
  "date_of_birth",
  "street",
  "zip",
  "city",
  "country",
] as const;
const MINOR_REQUIRED = [
  "first_name",
  "last_name",
  "date_of_birth",
  "birth_place",
  "citizenships",
  "street",
  "zip",
  "city",
  "country",
  "email",
  "phone",
] as const;

/** Opens a step of the cabinet by its tab. */
const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`).click();

/** The place a person has in the form, like the server: by role and answer, or by order and custody. */
function slotOf(request: Request, who: Person): string | null {
  const answers = request.representation;
  if (request.minor) {
    const index = answers.representatives.filter((item) => item.role === "legal_representative").indexOf(who);
    if (index === 0) return "rep1";
    return index === 1 && answers.custody === "joint" ? "rep2" : null;
  }
  if (who.role === "authorised_representative") return answers.has_representative ? "agent" : null;
  return who.role === "legal_guardian" && answers.under_guardianship ? "guardian" : null;
}

function missingForSubmit(request: Request): string[] {
  const answers = request.representation;
  const inSlot = (slot: string) => answers.representatives.find((item) => slotOf(request, item) === slot);
  const empty = (value: unknown) => (Array.isArray(value) ? value.length === 0 : !value);
  // A slot's whole list is emitted while its person does not exist.
  const personKeys = (slot: string, fields: readonly (typeof PERSON_FIELDS)[number][], authority: boolean) => {
    const who = inSlot(slot);
    const keys = fields
      .filter((field) => !who || empty(who[field]))
      .map((field) => `${slot}_${field}`);
    if (!who || who.identity_documents.length === 0) keys.push(`${slot}_id_upload`);
    if (authority && (!who || who.authority_documents.length === 0)) keys.push(`${slot}_authority_upload`);
    return keys;
  };
  if (request.minor) {
    return [
      ...personKeys("rep1", MINOR_REQUIRED, answers.custody === "guardian"),
      ...(answers.custody === "joint" ? personKeys("rep2", MINOR_REQUIRED, false) : []),
    ];
  }
  // The legal-guardianship question is switched off in the cabinet (owner 2026-10-09): not needed to send.
  return [
    ...(answers.has_representative == null ? ["has_representative"] : []),
    ...(answers.has_representative ? personKeys("agent", ADULT_REQUIRED, true) : []),
    ...(answers.under_guardianship ? personKeys("guardian", ADULT_REQUIRED, true) : []),
  ];
}

/** The request object as the server answers it: every person with the slot, and what is missing. */
function answer(request: Request) {
  request.progress.missing_for_submit = missingForSubmit(request);
  return {
    ...request,
    representation: {
      ...request.representation,
      representatives: request.representation.representatives.map((item) => ({ ...item, slot: slotOf(request, item) })),
    },
  };
}

async function setDatePickerValue(input: Locator, value: string) {
  const displayValue = value.split("-").reverse().join(".");
  await input.evaluate((node, nextValue) => {
    const nativeInput = node as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(nativeInput, nextValue);
    nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
    nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, displayValue);
  await expect(input).toHaveValue(displayValue);
}

/** Picks an option of one of the cabinet's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  // The list fades out: the next select must not find this one's options.
  await expect(page.getByRole("option")).toHaveCount(0);
}

/** Answers the next question of the page ("remove this person?") and notes what was asked. */
function onNextConfirm(page: Page, accept: boolean, asked: string[]) {
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
}

const scan = { name: "ausweis.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic image") };
const proof = { name: "nachweis.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") };

async function setup(page: Page, options: { minor: boolean; prepare?: (request: Request) => void }) {
  const request = leadRequest(options.minor);
  options.prepare?.(request);
  const calls = {
    /** Bodies of `POST …/representation`. */
    answers: [] as Record<string, unknown>[],
    /** Every `POST …/representatives/{id}` with the status it was answered with. */
    persons: [] as { id: string; status: number; body: Record<string, unknown> }[],
    removed: [] as string[],
    uploads: [] as { id: string; kind: string }[],
    submits: 0,
    /** Writes of the other parts of the form; none is expected here. */
    other: [] as string[],
  };
  const changed = () => {
    if (request.submitted_at) request.changed_since_submit = true;
  };

  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "lead-cabinet-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    const method = req.method();
    const base = "/me/lead-requests/lead-1";
    const answers = request.representation;

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "lead-user",
          email: "anna.muster@example.com",
          name: "Anna Muster",
          role: "patient",
          capabilities: [],
          created_at: "2026-10-05T08:00:00Z",
          preferred_language: "de",
          password_change_required: false,
          portal_mode: "lead",
          lead_portal: { requests: 1 },
        },
      });
    }
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [answer(request)] } });

    if (path === `${base}/representation` && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.answers.push(patch);
      // A key that does not fit the lead's age is refused.
      const allowed = request.minor ? ["custody"] : ["has_representative", "under_guardianship"];
      const unknown = Object.keys(patch).find((key) => !allowed.includes(key));
      if (unknown) return route.fulfill({ status: 422, json: { code: "invalid_field", field: unknown } });
      if (request.minor) {
        const custody = patch.custody as Request["representation"]["custody"];
        if (custody !== "joint") {
          // Everybody but the first representative whom the cabinet may remove goes; the others stay on file.
          const first = answers.representatives.find((item) => item.role === "legal_representative");
          answers.representatives = answers.representatives.filter((item) => item === first || !item.can_remove);
        }
        answers.custody = custody;
        answers.custody_stated = true;
      } else {
        const roles = [
          ["has_representative", "authorised_representative"],
          ["under_guardianship", "legal_guardian"],
        ] as const;
        // A person that cannot be removed: nothing is saved.
        for (const [key, role] of roles) {
          const held = answers.representatives.find((item) => item.role === role);
          if (key in patch && patch[key] !== true && held && !held.can_remove) {
            return route.fulfill({ status: 409, json: { code: "representative_in_use", message: "In use" } });
          }
        }
        for (const [key, role] of roles) {
          if (!(key in patch)) continue;
          if (patch[key] !== true) answers.representatives = answers.representatives.filter((item) => item.role !== role);
          answers[key] = patch[key] as boolean | null;
        }
      }
      changed();
      return route.fulfill({ json: answer(request) });
    }

    const personPath = path.match(/^\/me\/lead-requests\/lead-1\/representatives\/([^/]+)(?:\/(identity|authority)-document)?$/);
    if (personPath) {
      const id = decodeURIComponent(personPath[1]);
      const kind = personPath[2];
      const known = answers.representatives.find((item) => item.id === id);
      if (kind && method === "POST") {
        if (!request.consents.lead_inquiry_processing.given_at) {
          return route.fulfill({ status: 403, json: { code: "inquiry_consent_required", message: "Consent required" } });
        }
        if (!known) return route.fulfill({ status: 404, json: { error: "Not found" } });
        calls.uploads.push({ id, kind });
        const file = kind === "identity" ? upload(`rep-doc-${calls.uploads.length}`, "ausweis.jpg") : upload(`rep-doc-${calls.uploads.length}`, "nachweis.pdf");
        (kind === "identity" ? known.identity_documents : known.authority_documents).push(file);
        changed();
        return route.fulfill({ status: 201, json: answer(request) });
      }
      if (!kind && method === "DELETE") {
        calls.removed.push(id);
        if (!known) return route.fulfill({ status: 404, json: { error: "Not found" } });
        if (!known.can_remove) return route.fulfill({ status: 409, json: { code: "representative_in_use", message: "In use" } });
        answers.representatives = answers.representatives.filter((item) => item !== known);
        changed();
        return route.fulfill({ json: answer(request) });
      }
      if (!kind && method === "POST") {
        const body = req.postDataJSON() as Record<string, unknown>;
        const { role, ...fields } = body;
        const refuse = (status: number, code: string, field?: string) => {
          calls.persons.push({ id, status, body });
          return route.fulfill({ status, json: { code, message: code, ...(field ? { field } : {}) } });
        };
        const unknown = Object.keys(fields).find((key) => !(PERSON_FIELDS as readonly string[]).includes(key));
        // The identity document's data are staff's since the trigger flow.
        if (unknown) return refuse(422, unknown.startsWith("id_") ? "staff_only" : "invalid_field", unknown);
        // The two refusals of an e-mail name no field: the code says which one it is.
        if ("email" in fields && known?.email_locked) return refuse(422, "representative_email_is_login");
        const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
        if (email && answers.representatives.some((item) => item.id !== id && String(item.email ?? "").toLowerCase() === email)) {
          return refuse(422, "representative_email_duplicate");
        }
        let target = known;
        if (!target) {
          // An unknown id creates the person: it needs the role and a last name, and a free place.
          if (role !== "legal_representative" && role !== "authorised_representative" && role !== "legal_guardian") {
            return refuse(422, "representative_role_invalid");
          }
          if (typeof fields.last_name !== "string" || !fields.last_name.trim()) return refuse(422, "invalid_field", "last_name");
          if (request.minor) {
            const places = answers.custody === "joint" ? 2 : 1;
            if (role !== "legal_representative") return refuse(422, "representative_role_invalid");
            if (answers.representatives.filter((item) => item.role === "legal_representative").length >= places) {
              return refuse(409, "representative_limit");
            }
          } else {
            if (role === "legal_representative") return refuse(422, "representative_role_invalid");
            const declared = role === "authorised_representative" ? answers.has_representative : answers.under_guardianship;
            if (declared !== true) return refuse(409, "representation_not_declared");
            if (answers.representatives.some((item) => item.role === role)) return refuse(409, "representative_limit");
          }
          target = person({
            id,
            role,
            relation: role === "authorised_representative" ? "representative" : role === "legal_guardian" ? "guardian" : "parent",
          });
          answers.representatives.push(target);
        }
        for (const [key, value] of Object.entries(fields)) {
          target[key as (typeof PERSON_FIELDS)[number]] = value === "" ? null : value;
        }
        const status = known ? 200 : 201;
        calls.persons.push({ id, status, body });
        changed();
        return route.fulfill({ status, json: answer(request) });
      }
    }

    if (path.startsWith(`${base}/documents/`) && method === "DELETE") {
      // One route withdraws every kind of upload.
      const id = path.split("/").at(-1);
      request.identity_documents = request.identity_documents.filter((item) => item.id !== id);
      for (const item of answers.representatives) {
        item.identity_documents = item.identity_documents.filter((file) => file.id !== id);
        item.authority_documents = item.authority_documents.filter((file) => file.id !== id);
      }
      changed();
      return route.fulfill({ json: answer(request) });
    }
    if (path === `${base}/consent` && method === "POST") {
      const body = req.postDataJSON() as { purpose: string; version: string };
      request.consents[body.purpose].given_at = "2026-10-05T09:15:00Z";
      return route.fulfill({ status: 201, json: { purpose: body.purpose, given_at: "2026-10-05T09:15:00Z", version: body.version } });
    }
    if (path === `${base}/submit` && method === "POST") {
      const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : null;
      if (body?.declared_correct !== true) {
        return route.fulfill({ status: 422, json: { code: "declaration_required", message: "Declaration required" } });
      }
      if (missingForSubmit(request).length > 0) {
        return route.fulfill({ status: 422, json: { code: "personal_data_incomplete", missing: missingForSubmit(request) } });
      }
      calls.submits += 1;
      request.identification.declared_correct_at = "2026-10-05T09:30:00Z";
      request.submitted_at = "2026-10-05T09:30:00Z";
      request.changed_since_submit = false;
      return route.fulfill({ json: answer(request) });
    }
    if (path.startsWith(`${base}/`) && method === "POST") {
      // Personal data, payer, identification: complete from the start, nothing of them is saved here.
      calls.other.push(path);
      return route.fulfill({ json: answer(request) });
    }
    if (path === "/me/profile") {
      return route.fulfill({ json: { id: "lead-user", email: "anna.muster@example.com", name: "Anna Muster", role: "patient", phone: null, preferred_language: "de" } });
    }
    if (path.startsWith("/me/") || path.startsWith("/notifications")) {
      return route.fulfill({ status: 403, json: { error: "Forbidden", code: "lead_portal_only", message: "Lead portal only" } });
    }
    return route.fulfill({ json: [] });
  });
  return { request, calls };
}

test.describe("lead cabinet: who acts for an adult", () => {
  test("nobody acts for the patient: one answer, and the request can be sent", async ({ page }) => {
    const { calls } = await setup(page, { minor: false });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");
    const acts = block.getByRole("combobox", { name: "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?" });
    // The legal-guardianship question is switched off (owner 2026-10-09).
    await expect(block.getByRole("combobox", { name: "Stehen Sie unter rechtlicher Betreuung?" })).toHaveCount(0);

    // The block closes the first step, after the person, the address and the contact (owner 2026-10-09: one tab).
    await expect(page.getByRole("heading", { name: "Vertretung", exact: true })).toBeVisible();
    const order = await page
      .getByTestId("lead-request-step-person")
      .locator("h3")
      .evaluateAll((titles) => titles.map((title) => title.textContent));
    expect(order).toEqual(["Datenschutz und Einwilligung", "Persönliche Daten", "Adresse", "Kontakt", "Vertretung"]);

    // Until the question is answered the request cannot be sent.
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing.getByRole("listitem")).toHaveText([
      "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?",
    ]);
    await expect(page.getByTestId("lead-request-summary-representation")).toContainText("Noch keine Angaben");
    await expect(page.getByTestId("lead-request-submit")).toBeDisabled();

    await step(page, "person");
    await choose(page, acts, "Nein");
    await expect.poll(() => calls.answers).toEqual([{ has_representative: false }]);
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
    // "No" names nobody.
    await expect(page.getByTestId("lead-request-representative-agent")).toHaveCount(0);

    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    const summary = page.getByTestId("lead-request-summary-representation");
    await expect(summary.locator("dd")).toHaveText(["Nein"]);
    await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("05.10.2026");
    expect(calls.submits).toBe(1);
    expect(calls.persons).toEqual([]);
    expect(calls.other).toEqual([]);
  });

  test("a representative is named with data, identity document and uploads", async ({ page }) => {
    const { request, calls } = await setup(page, {
      minor: false,
      prepare: (prepared) => {
        // The request consent is not given yet: nothing can be uploaded.
        prepared.consents.lead_inquiry_processing.given_at = null;
      },
    });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");
    const acts = block.getByRole("combobox", { name: /Handelt jemand für Sie/ });
    const agent = page.getByTestId("lead-request-representative-agent");

    // "Yes" opens the form of one person.
    await expect(agent).toHaveCount(0);
    await choose(page, acts, "Ja");
    await expect(agent).toBeVisible();
    expect(calls.answers).toEqual([{ has_representative: true }]);
    // The person's details are a card of their own (owner 2026-10-09).
    await expect(agent.getByRole("heading", { name: "Angaben zur vertretenden Person" })).toBeVisible();
    await expect(page.getByTestId("lead-request-representative-guardian")).toHaveCount(0);
    // An adult's representative is asked for the place of birth and the citizenship, not for the country of birth.
    await expect(agent.getByRole("textbox", { name: "Geburtsort" })).toBeVisible();
    await expect(page.locator("#lead-request-agent_citizenships")).toBeVisible();
    await expect(agent.getByRole("combobox", { name: "Geburtsland" })).toHaveCount(0);
    await expect(agent.getByRole("button", { name: "Adresse des Kindes übernehmen" })).toHaveCount(0);

    // Without a last name there is no person: nothing is saved, and the form says what it waits for.
    await agent.getByRole("textbox", { name: "Vorname" }).fill("Ben");
    await expect(page.locator("#lead-request-agent_last_name-error")).toHaveText("Pflichtfeld");
    await page.waitForTimeout(1000);
    expect(calls.persons).toEqual([]);

    // The first save creates the person, with an id made in the browser and the role of the question.
    await agent.getByRole("textbox", { name: "Nachname" }).fill(" Muster ");
    await expect.poll(() => calls.persons.length).toBe(1);
    expect(calls.persons[0]).toMatchObject({
      status: 201,
      body: { role: "authorised_representative", first_name: "Ben", last_name: "Muster" },
    });
    expect(Object.keys(calls.persons[0].body).sort()).toEqual(["first_name", "last_name", "role"]);
    const id = calls.persons[0].id;
    expect(id).toMatch(UUID);
    await expect(page.locator("#lead-request-agent_last_name-error")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");

    // Afterwards only what changed is sent, to the same person and without the role.
    await setDatePickerValue(page.locator("#lead-request-agent_date_of_birth"), "1980-01-15");
    await expect.poll(() => calls.persons.at(-1)).toEqual({ id, status: 200, body: { date_of_birth: "1980-01-15" } });
    await agent.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Musterstraße 2");
    await choose(page, agent.getByRole("combobox", { name: "Wohnsitzland" }), "Deutschland");
    await expect
      .poll(() => Object.assign({}, ...calls.persons.slice(2).map((call) => call.body)))
      .toEqual({ street: "Musterstraße 2", country: "DE" });
    // The identity document's data are entered by GMED from the copy: no such fields.
    await expect(agent.getByRole("combobox", { name: "Art des Dokuments" })).toHaveCount(0);
    await expect(page.locator("#lead-request-agent_id_valid_until")).toHaveCount(0);
    expect(calls.persons.every((call) => call.id === id)).toBe(true);
    expect(request.representation.representatives).toHaveLength(1);

    // The uploads need the request consent, like the lead's own identity document.
    const identity = page.getByTestId("lead-request-agent-identity-upload");
    const authority = page.getByTestId("lead-request-agent-authority-upload");
    await expect(identity).toContainText("Foto oder Scan des Ausweises");
    await expect(authority).toContainText("Nachweis der Vertretungsmacht (z. B. Vollmacht)");
    await expect(identity.getByRole("button", { name: /Dateien auswählen/ })).toBeDisabled();
    await expect(identity).toContainText(
      "Zum Hochladen bitte zuerst im Schritt „Einwilligung & Person“ der Verarbeitung Ihrer Angaben zustimmen.",
    );
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(identity.getByRole("button", { name: "Foto oder Scan des Ausweises: Dateien auswählen" })).toBeEnabled();
    await page.locator("#lead-request-agent-identity-files").setInputFiles(scan);
    await expect(page.getByTestId("lead-request-agent-identity-list")).toContainText("ausweis.jpg");
    await expect(page.getByTestId("lead-request-agent-authority-list")).toHaveText("");
    await page.locator("#lead-request-agent-authority-files").setInputFiles(proof);
    await expect(page.getByTestId("lead-request-agent-authority-list")).toContainText("nachweis.pdf");
    expect(calls.uploads).toEqual([
      { id, kind: "identity" },
      { id, kind: "authority" },
    ]);
    // A representative's scan is not the lead's own identity document.
    await step(page, "identity");
    await expect(page.getByTestId("lead-request-identity-list").getByRole("listitem")).toHaveText([/reisepass\.jpg/]);

    // The send step names what is still missing about that person, with the caption.
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing.getByRole("listitem")).toHaveText([
      "Angaben zur vertretenden Person: Postleitzahl",
      "Angaben zur vertretenden Person: Ort",
    ]);
    const summary = page.getByTestId("lead-request-summary-representation");
    await expect(summary).toContainText("Handelt jemand für Sie");
    const summarized = page.getByTestId("lead-request-summary-representation-agent");
    await expect(summarized).toContainText("Angaben zur vertretenden Person");
    await expect(summarized).toContainText("Ben");
    await expect(summarized).toContainText("15.01.1980");
    await expect(summarized).toContainText("ausweis.jpg");
    await expect(summarized).toContainText("nachweis.pdf");

    // Back on the step the person is there; an own upload can be taken back.
    await step(page, "person");
    await expect(agent.getByRole("textbox", { name: "Nachname" })).toHaveValue("Muster");
    await expect(page.locator("#lead-request-agent_date_of_birth")).toHaveValue("15.01.1980");
    await page.getByTestId("lead-request-agent-authority-list").getByRole("button", { name: "Entfernen" }).click();
    await expect(page.getByTestId("lead-request-agent-authority-list")).toHaveText("");

    // From yes to no the form asks first: the person entered would be removed.
    const asked: string[] = [];
    onNextConfirm(page, false, asked);
    await choose(page, acts, "Nein");
    expect(asked).toEqual(["Ben Muster: Alle Angaben und hochgeladenen Dateien zu dieser Person werden entfernt. Fortfahren?"]);
    await expect(acts).toContainText("Ja");
    await expect(agent).toBeVisible();
    expect(calls.answers).toHaveLength(1);

    onNextConfirm(page, true, asked);
    await choose(page, acts, "Nein");
    await expect(agent).toHaveCount(0);
    await expect.poll(() => calls.answers.at(-1)).toEqual({ has_representative: false });
    await expect.poll(() => request.representation.representatives).toEqual([]);
    const savedPersons = calls.persons.length;
    // The form that was taken away saves nothing more.
    await page.waitForTimeout(1000);
    expect(calls.persons).toHaveLength(savedPersons);
    await page.locator('[data-step="send"]').click();
    // Nothing else is missing: the legal-guardianship question is switched off (owner 2026-10-09).
    await expect(missing).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary-representation-agent")).toHaveCount(0);
  });

  test("the legal-guardianship question is switched off: no question and no guardian's form", async ({ page }) => {
    const { calls } = await setup(page, { minor: false });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");

    // Owner 2026-10-09: the cabinet does not ask about a legal guardianship (rechtliche Betreuung) for now.
    await expect(block.getByRole("combobox", { name: /Handelt jemand für Sie/ })).toBeVisible();
    await expect(block.getByRole("combobox", { name: "Stehen Sie unter rechtlicher Betreuung?" })).toHaveCount(0);
    await expect(page.getByTestId("lead-request-representative-guardian")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-guardian-identity-upload")).toHaveCount(0);

    // Nor is it missing to send the request.
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("Handelt jemand für Sie");
    await expect(missing).not.toContainText("Stehen Sie unter rechtlicher Betreuung?");
    await expect(missing).not.toContainText("Betreuer/in");
    expect(calls.answers).toEqual([]);
  });

  test("a person the cabinet may not remove stays, and the answer goes back", async ({ page }) => {
    const { calls } = await setup(page, {
      minor: false,
      prepare: (prepared) => {
        prepared.representation.has_representative = true;
        prepared.representation.under_guardianship = false;
        // Staff have taken the upload over: the person is in use.
        prepared.representation.representatives.push(
          person({
            id: BEN,
            role: "authorised_representative",
            relation: "representative",
            can_remove: false,
            first_name: "Ben",
            last_name: "Muster",
            identity_documents: [{ ...upload("rep-doc-0", "ausweis.jpg"), reviewed: true, can_delete: false }],
          }),
        );
      },
    });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");
    const acts = block.getByRole("combobox", { name: /Handelt jemand für Sie/ });
    const agent = page.getByTestId("lead-request-representative-agent");

    await expect(agent.getByRole("textbox", { name: "Vorname" })).toHaveValue("Ben");
    await expect(agent.getByRole("button", { name: "Entfernen" })).toHaveCount(0);
    await expect(page.getByTestId("lead-request-agent-identity-list")).toContainText("Von uns übernommen");

    const asked: string[] = [];
    onNextConfirm(page, true, asked);
    await choose(page, acts, "Nein");
    expect(asked).toHaveLength(1);
    await expect(page.getByTestId("lead-request-representation-problem")).toHaveText(
      "Diese Person kann hier nicht entfernt werden. Bitte sprechen Sie uns an.",
    );
    expect(calls.answers).toEqual([{ has_representative: false }]);
    // Nothing was saved: the stored answer and the person are shown again.
    await expect(acts).toContainText("Ja");
    await expect(agent.getByRole("textbox", { name: "Nachname" })).toHaveValue("Muster");
    // The refused answer is not sent again on its own.
    await page.waitForTimeout(1000);
    expect(calls.answers).toHaveLength(1);
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
  });
});

test.describe("lead cabinet: the legal representatives of a minor", () => {
  test("both parents are asked for; the second is created with the last name and removed with sole custody", async ({ page }) => {
    const { request, calls } = await setup(page, {
      minor: true,
      prepare: (prepared) => prepared.representation.representatives.push(anna()),
    });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");
    const custody = block.getByRole("combobox", { name: "Wer vertritt das Kind?" });
    const first = page.getByTestId("lead-request-representative-rep1");
    const second = page.getByTestId("lead-request-representative-rep2");

    // A parent's login is no patient: the side bar names it.
    await expect(page.getByText("Elternteil / gesetzliche Vertretung", { exact: true })).toBeVisible();
    // Nobody is asked whether the patient is a minor: the request says so, and the block asks for the parents.
    await expect(page.getByRole("heading", { name: "Gesetzliche Vertreter", exact: true })).toBeVisible();
    await expect(block).toContainText(
      "Für Minderjährige handeln die gesetzlichen Vertreter. Einwilligung und Unterschriften werden von beiden Elternteilen benötigt.",
    );
    await expect(block.getByRole("combobox", { name: /Handelt jemand für Sie/ })).toHaveCount(0);
    await expect(custody).toContainText("Beide Eltern gemeinsam");
    await custody.click();
    await expect(page.getByRole("option")).toHaveText([
      "Beide Eltern gemeinsam",
      "Ein Elternteil allein (alleiniges Sorgerecht)",
      "Vormund oder Pfleger",
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);

    // The parent at the form is the first representative: filled in, with the sign-in address that cannot be changed here.
    await expect(first.getByRole("heading", { name: "1. Vertreter/in – Sie" })).toBeVisible();
    await expect(first.getByRole("textbox", { name: "Vorname" })).toHaveValue("Anna");
    await expect(first.getByRole("textbox", { name: "Nachname" })).toHaveValue("Muster");
    await expect(page.locator("#lead-request-rep1_date_of_birth")).toHaveValue("02.03.1985");
    const firstEmail = first.getByRole("textbox", { name: "E-Mail" });
    await expect(firstEmail).toHaveValue("anna.muster@example.com");
    await expect(firstEmail).toHaveAttribute("readonly", "");
    await expect(first).toContainText("Ihre Anmeldeadresse");
    await expect(first.getByRole("button", { name: "Entfernen" })).toHaveCount(0);
    await expect(first.getByRole("combobox", { name: "Geburtsland" })).toBeVisible();
    // Parents with joint custody show no proof of authority.
    await expect(page.getByTestId("lead-request-rep1-authority-upload")).toHaveCount(0);

    // The child's address is taken over into the parent's form and saved as the parent's.
    await first.getByRole("button", { name: "Adresse des Kindes übernehmen" }).click();
    await expect(first.getByRole("textbox", { name: "Straße und Hausnummer" })).toHaveValue("Musterstraße 1");
    await expect(first.getByRole("textbox", { name: "Postleitzahl" })).toHaveValue("10115");
    await expect(first.getByRole("textbox", { name: "Ort", exact: true })).toHaveValue("Berlin");
    await expect(first.getByRole("combobox", { name: "Wohnsitzland" })).toContainText("Deutschland");
    await expect.poll(() => calls.persons).toEqual([
      { id: ANNA, status: 200, body: { street: "Musterstraße 1", zip: "10115", city: "Berlin", country: "DE" } },
    ]);

    // The other parent: an empty form with what the address is used for.
    await expect(second.getByRole("heading", { name: "2. Vertreter/in – anderer Elternteil" })).toBeVisible();
    await expect(second).toContainText("Bitte informieren Sie diese Person darüber, dass Sie ihre Daten angeben.");
    await expect(second).toContainText("An diese Adresse senden wir die Einladung zur Unterschrift.");
    await expect(second.getByRole("textbox", { name: "Nachname" })).toHaveValue("");
    await expect(second.getByRole("button", { name: "Entfernen" })).toHaveCount(0);

    // Entering the last name creates the second representative.
    await second.getByRole("textbox", { name: "Vorname" }).fill("Ben");
    await second.getByRole("textbox", { name: "Nachname" }).fill("Muster");
    await expect.poll(() => calls.persons.length).toBe(2);
    expect(calls.persons[1]).toMatchObject({
      status: 201,
      body: { role: "legal_representative", first_name: "Ben", last_name: "Muster" },
    });
    const benId = calls.persons[1].id;
    expect(benId).toMatch(UUID);
    expect(benId).not.toBe(ANNA);
    await expect(second.getByRole("button", { name: "Entfernen" })).toBeVisible();
    await second.getByRole("textbox", { name: "E-Mail" }).fill("ben.muster@example.com");
    await expect.poll(() => calls.persons.at(-1)).toEqual({ id: benId, status: 200, body: { email: "ben.muster@example.com" } });
    await page.locator("#lead-request-rep2-identity-files").setInputFiles(scan);
    await expect(page.getByTestId("lead-request-rep2-identity-list")).toContainText("ausweis.jpg");
    expect(calls.uploads).toEqual([{ id: benId, kind: "identity" }]);

    // The summary shows both parents; what is missing carries the caption of the person.
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("1. Vertreter/in: Geburtsort");
    await expect(missing).toContainText("1. Vertreter/in: Foto oder Scan des Ausweises");
    await expect(missing).toContainText("2. Vertreter/in: Geburtsdatum");
    await expect(missing).toContainText("2. Vertreter/in: Telefon");
    await expect(missing).not.toContainText("1. Vertreter/in: Straße und Hausnummer");
    await expect(missing).not.toContainText("2. Vertreter/in: E-Mail");
    await expect(missing).not.toContainText("2. Vertreter/in: Foto oder Scan des Ausweises");
    const summary = page.getByTestId("lead-request-summary-representation");
    await expect(summary).toContainText("Gesetzliche Vertreter");
    await expect(summary).toContainText("Beide Eltern gemeinsam");
    await expect(page.getByTestId("lead-request-summary-representation-rep1")).toContainText("1. Vertreter/in – Sie");
    await expect(page.getByTestId("lead-request-summary-representation-rep2")).toContainText("ben.muster@example.com");
    await expect(page.getByTestId("lead-request-summary-representation-rep2")).toContainText("ausweis.jpg");

    // Sole custody needs one representative: the form asks before the second one is removed.
    await step(page, "person");
    await expect(second.getByRole("textbox", { name: "Vorname" })).toHaveValue("Ben");
    const asked: string[] = [];
    onNextConfirm(page, false, asked);
    await choose(page, custody, "Ein Elternteil allein (alleiniges Sorgerecht)");
    expect(asked).toEqual(["Ben Muster: Alle Angaben und hochgeladenen Dateien zu dieser Person werden entfernt. Fortfahren?"]);
    await expect(custody).toContainText("Beide Eltern gemeinsam");
    await expect(second).toBeVisible();
    expect(calls.answers).toEqual([]);

    onNextConfirm(page, true, asked);
    await choose(page, custody, "Ein Elternteil allein (alleiniges Sorgerecht)");
    await expect(second).toHaveCount(0);
    // Who consents and signs follows the custody: not both parents any more.
    await expect(page.getByTestId("lead-request-custody-note")).toHaveText(
      "Für Minderjährige handeln die gesetzlichen Vertreter. Einwilligung und Unterschrift gibt der allein sorgeberechtigte Elternteil.",
    );
    await expect.poll(() => calls.answers).toEqual([{ custody: "sole_parent" }]);
    await expect.poll(() => request.representation.representatives.map((item) => item.id)).toEqual([ANNA]);
    await expect(first.getByRole("textbox", { name: "Vorname" })).toHaveValue("Anna");
    // A parent with sole custody may show the proof of it; it is not required.
    const soleCustody = page.getByTestId("lead-request-rep1-authority-upload");
    await expect(soleCustody).toContainText("Nachweis des alleinigen Sorgerechts");
    await expect(soleCustody).not.toContainText("*");
    await page.locator('[data-step="send"]').click();
    await expect(missing).not.toContainText("2. Vertreter/in");
    await expect(missing).not.toContainText("Nachweis des alleinigen Sorgerechts");
    await expect(summary).toContainText("Ein Elternteil allein (alleiniges Sorgerecht)");
    await expect(page.getByTestId("lead-request-summary-representation-rep2")).toHaveCount(0);

    // A guardian shows the certificate of appointment, and the request needs it.
    await step(page, "person");
    await choose(page, custody, "Vormund oder Pfleger");
    await expect.poll(() => calls.answers.at(-1)).toEqual({ custody: "guardian" });
    expect(asked).toHaveLength(2);
    await expect(page.getByTestId("lead-request-custody-note")).toHaveText(
      "Für Minderjährige handeln die gesetzlichen Vertreter. Einwilligung und Unterschrift gibt der Vormund / die Pflegerin.",
    );
    // The person at the form is the guardian, not "the 1st representative".
    await expect(first.getByRole("heading", { name: "Vormund / Pfleger/in – Sie" })).toBeVisible();
    const appointment = page.getByTestId("lead-request-rep1-authority-upload");
    await expect(appointment).toContainText("Bestallungsurkunde");
    await expect(appointment).toContainText("*");
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("1. Vertreter/in: Bestallungsurkunde");
    await step(page, "person");
    await page.locator("#lead-request-rep1-authority-files").setInputFiles(proof);
    await expect(page.getByTestId("lead-request-rep1-authority-list")).toContainText("nachweis.pdf");
    expect(calls.uploads.at(-1)).toEqual({ id: ANNA, kind: "authority" });
    // Nothing but the representation was written.
    expect(calls.other).toEqual([]);
  });

  test("a refused e-mail is shown at its field and not sent again", async ({ page }) => {
    const { calls } = await setup(page, {
      minor: true,
      prepare: (prepared) =>
        prepared.representation.representatives.push(anna(), person({ id: BEN, first_name: "Ben", last_name: "Muster" })),
    });
    await page.goto("/");
    const second = page.getByTestId("lead-request-representative-rep2");
    const email = second.getByRole("textbox", { name: "E-Mail" });
    const emailError = page.locator("#lead-request-rep2_email-error");
    const saveState = page.getByTestId("lead-request-save-state");

    // Two signers of one request need different addresses.
    await email.fill("Anna.Muster@example.com");
    await expect(emailError).toHaveText(
      "Diese E-Mail-Adresse ist bereits bei einer anderen Person angegeben. Für die Unterschrift braucht jede Person eine eigene Adresse.",
    );
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(saveState).toHaveText("Nicht gespeichert");
    expect(calls.persons).toEqual([{ id: BEN, status: 422, body: { email: "Anna.Muster@example.com" } }]);

    // Another field is saved on its own; the refused address stays out and stays marked.
    await second.getByRole("textbox", { name: "Telefon" }).fill("+49 30 1234567");
    await expect.poll(() => calls.persons.at(-1)).toEqual({ id: BEN, status: 200, body: { phone: "+49 30 1234567" } });
    await expect(emailError).toBeVisible();
    await expect(saveState).toHaveText("Nicht gespeichert");
    expect(calls.persons.filter((call) => "email" in call.body)).toHaveLength(1);

    // A changed value goes through, and the message goes with the refused value.
    await email.fill("ben.muster@example.com");
    await expect(emailError).toHaveCount(0);
    await expect.poll(() => calls.persons.at(-1)).toEqual({ id: BEN, status: 200, body: { email: "ben.muster@example.com" } });
    await expect(saveState).toHaveText("Gespeichert");
    // The identity document's data are staff's: the form has none to refuse.
    await expect(page.locator("#lead-request-rep2_id_valid_until")).toHaveCount(0);
  });

  test("the second representative can be removed and leaves an empty form", async ({ page }) => {
    const { request, calls } = await setup(page, {
      minor: true,
      prepare: (prepared) =>
        prepared.representation.representatives.push(
          anna(),
          person({ id: BEN, first_name: "Ben", last_name: "Muster", identity_documents: [upload("rep-doc-0", "ausweis.jpg")] }),
        ),
    });
    await page.goto("/");
    const second = page.getByTestId("lead-request-representative-rep2");
    await expect(second.getByRole("textbox", { name: "Vorname" })).toHaveValue("Ben");
    await expect(page.getByTestId("lead-request-rep2-identity-list")).toContainText("ausweis.jpg");

    const asked: string[] = [];
    onNextConfirm(page, true, asked);
    await second.getByRole("button", { name: "Entfernen" }).first().click();
    await expect(second.getByRole("textbox", { name: "Vorname" })).toHaveValue("");
    expect(asked).toEqual(["Ben Muster: Alle Angaben und hochgeladenen Dateien zu dieser Person werden entfernt. Fortfahren?"]);
    expect(calls.removed).toEqual([BEN]);
    expect(request.representation.representatives.map((item) => item.id)).toEqual([ANNA]);
    await expect(second.getByRole("textbox", { name: "Nachname" })).toHaveValue("");
    await expect(page.getByTestId("lead-request-rep2-identity-list")).toHaveText("");
    await expect(second.getByRole("button", { name: "Entfernen" })).toHaveCount(0);

    // Somebody else can be named in the same place: a new person with a new id.
    await second.getByRole("textbox", { name: "Nachname" }).fill("Beispiel");
    await expect.poll(() => calls.persons.at(-1)).toMatchObject({ status: 201, body: { role: "legal_representative", last_name: "Beispiel" } });
    expect(calls.persons.at(-1)?.id).not.toBe(BEN);
    expect(calls.persons).toHaveLength(1);
  });

  test("a second parent whom staff entered stays on file when one parent has custody alone", async ({ page }) => {
    const { request, calls } = await setup(page, {
      minor: true,
      prepare: (prepared) => {
        prepared.representation.custody = "sole_parent";
        prepared.representation.custody_stated = true;
        prepared.representation.representatives.push(
          anna(),
          person({ id: BEN, can_remove: false, first_name: "Ben", last_name: "Muster", email: "ben.muster@example.com" }),
        );
      },
    });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");
    const custody = block.getByRole("combobox", { name: "Wer vertritt das Kind?" });
    const second = page.getByTestId("lead-request-representative-rep2");
    const note = page.getByTestId("lead-request-representative-on-file");

    await expect(custody).toContainText("Ein Elternteil allein (alleiniges Sorgerecht)");
    await expect(page.getByTestId("lead-request-representative-rep1")).toBeVisible();
    await expect(second).toHaveCount(0);
    await expect(note).toHaveText(
      "Bei GMED ist eine weitere sorgeberechtigte Person hinterlegt: Ben Muster. Bitte sprechen Sie uns an.",
    );

    // With joint custody that person is the second representative, with the data on file.
    await choose(page, custody, "Beide Eltern gemeinsam");
    await expect(second.getByRole("textbox", { name: "Vorname" })).toHaveValue("Ben");
    await expect(second.getByRole("textbox", { name: "E-Mail" })).toHaveValue("ben.muster@example.com");
    await expect(second.getByRole("button", { name: "Entfernen" })).toHaveCount(0);
    await expect(note).toHaveCount(0);
    expect(calls.answers).toEqual([{ custody: "joint" }]);

    // Back to sole custody nobody is removed, so nothing is asked.
    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await choose(page, custody, "Ein Elternteil allein (alleiniges Sorgerecht)");
    await expect(second).toHaveCount(0);
    await expect(note).toContainText("Ben Muster");
    expect(asked).toEqual([]);
    expect(request.representation.representatives).toHaveLength(2);
    expect(calls.persons).toEqual([]);
  });

  test("the representatives fit a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, {
      minor: true,
      prepare: (prepared) => {
        prepared.representation.representatives.push(
          anna(),
          person({
            id: BEN,
            // Entered by staff: with another custody this parent stays on file and is named in a note.
            can_remove: false,
            first_name: "Benedikt-Maximilian-Alexander",
            last_name: "Muster-Beispielhausen-von-und-zu-Langenname",
            email: "benedikt-maximilian.muster-beispielhausen@example.com",
            city: "Landeshauptstadt-Musterstadt-Bezirk-Mitte-Nord",
            identity_documents: [upload("rep-doc-0", "ausweis-vorderseite-und-rückseite-benedikt-maximilian-muster.jpg")],
          }),
        );
      },
    });
    await page.goto("/");
    const block = page.getByTestId("lead-request-representation");
    await expect(page.getByTestId("lead-request-representative-rep2")).toBeVisible();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const overhang = (testId: string) =>
      page.getByTestId(testId).evaluate((step) => {
        const width = document.documentElement.clientWidth;
        return Math.max(0, ...Array.from(step.querySelectorAll("*"), (node) => node.getBoundingClientRect().right - width));
      });
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await overhang("lead-request-step-person")).toBeLessThanOrEqual(1);
    // The fields are stacked: each is as wide as the person's form allows.
    const first = page.getByTestId("lead-request-representative-rep1");
    const width = async (locator: Locator) => Math.round((await locator.boundingBox())?.width ?? 0);
    const fieldWidth = await width(page.locator("#lead-request-rep1_street"));
    for (const field of ["first_name", "last_name", "zip", "city", "email", "phone"]) {
      expect(await width(page.locator(`#lead-request-rep1_${field}`)), field).toBe(fieldWidth);
    }
    expect(fieldWidth).toBeGreaterThan(((await width(first)) * 4) / 5);

    // The long custody answer and the guardian's proof wrap as well.
    await choose(page, block.getByRole("combobox", { name: "Wer vertritt das Kind?" }), "Vormund oder Pfleger");
    await expect(page.getByTestId("lead-request-rep1-authority-upload")).toBeVisible();
    await expect(page.getByTestId("lead-request-representative-on-file")).toContainText("Langenname");
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await overhang("lead-request-step-person")).toBeLessThanOrEqual(1);

    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-representation-rep1")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await overhang("lead-request-send")).toBeLessThanOrEqual(1);
  });
});
