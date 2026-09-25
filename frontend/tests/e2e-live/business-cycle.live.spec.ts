/* eslint-disable @typescript-eslint/no-explicit-any -- live API payloads are untyped JSON checked field by field */
/**
 * Live end-to-end business cycle through the real API (no UI clicks).
 *
 * Runs against a disposable local stack (backend with ENABLE_E2E_SUPPORT). Every
 * fixture carries a unique tag; nothing is wiped. Each test is independent and
 * builds its own patient so a failure in one business area does not hide others.
 *
 *   PLAYWRIGHT_LIVE_SKIP_SETUP=1 PLAYWRIGHT_LIVE_BASE_URL=http://127.0.0.1:4174 \
 *     npx playwright test -c playwright.live.config.ts business-cycle
 *
 * Optional: GMED_LIVE_DB_CONTAINER (default gmed-local-postgres-1) and DOCKER_BIN
 * enable read-only SQL assertions via `docker exec psql`.
 */
import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  type BootstrapScenario,
  type LiveApiClient,
} from "./support/live-helpers";
import { FRONTEND_ROOT } from "./support/process-state";

// ---------------------------------------------------------------------------
// Evidence-capturing API client
// ---------------------------------------------------------------------------

type Evidence = {
  at: string;
  actor: string;
  method: string;
  path: string;
  status: number;
  request?: unknown;
  response: unknown;
};

type ApiResult<T = any> = {
  status: number;
  body: T;
  text: string;
  headers: Record<string, string>;
  bytes?: Buffer;
};

const evidence: Evidence[] = [];

function truncate(value: unknown, max = 4_000): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return value;
  if (text.length <= max) return value;
  return `${text.slice(0, max)}… [${text.length} chars]`;
}

class Actor {
  constructor(
    private readonly request: APIRequestContext,
    readonly name: string,
    private readonly client: LiveApiClient,
  ) {}

  async call<T = any>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    apiPath: string,
    data?: unknown,
    options: { binary?: boolean; multipart?: Record<string, any> } = {},
  ): Promise<ApiResult<T>> {
    const url = `${this.client.backendUrl}/api/v1${apiPath}`;
    const response = await this.request.fetch(url, {
      method,
      headers: this.client.headers,
      ...(options.multipart
        ? { multipart: options.multipart }
        : data === undefined
          ? {}
          : { data }),
      failOnStatusCode: false,
    });
    const headers = response.headers();
    const contentType = headers["content-type"] ?? "";
    let body: any = null;
    let text = "";
    let bytes: Buffer | undefined;
    if (contentType.includes("json")) {
      text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else if (options.binary || contentType.includes("pdf")) {
      bytes = await response.body();
      text = `[${bytes.length} bytes ${contentType}]`;
    } else {
      text = await response.text();
      body = text;
    }
    evidence.push({
      at: new Date().toISOString(),
      actor: this.name,
      method,
      path: apiPath,
      status: response.status(),
      request: options.multipart ? "[multipart]" : truncate(data, 1_500),
      response: truncate(body ?? text),
    });
    return { status: response.status(), body: body as T, text, headers, bytes };
  }

  get<T = any>(apiPath: string) {
    return this.call<T>("GET", apiPath);
  }

  post<T = any>(apiPath: string, data: unknown = {}) {
    return this.call<T>("POST", apiPath, data);
  }

  del<T = any>(apiPath: string) {
    return this.call<T>("DELETE", apiPath);
  }

  /** POST/GET that must succeed; throws with request/response evidence otherwise. */
  async ok<T = any>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    apiPath: string,
    data?: unknown,
    expected: number[] = [200, 201],
  ): Promise<T> {
    const result = await this.call<T>(method, apiPath, data);
    if (!expected.includes(result.status)) {
      throw new Error(
        `${this.name} ${method} ${apiPath} -> ${result.status} (expected ${expected.join("/")})\n` +
          `request: ${JSON.stringify(truncate(data, 1_500))}\nresponse: ${result.text.slice(0, 2_000)}`,
      );
    }
    return result.body;
  }
}

function describeResult(result: ApiResult) {
  return `HTTP ${result.status}: ${result.text.slice(0, 1_500)}`;
}

async function actorFor(
  request: APIRequestContext,
  scenario: BootstrapScenario,
  role: keyof BootstrapScenario["credentials"],
): Promise<Actor> {
  const credentials = scenario.credentials[role];
  if (typeof credentials === "string") throw new Error(`invalid role ${String(role)}`);
  const client = await authenticateApiClient(
    request,
    credentials.email,
    scenario.credentials.password,
  );
  return new Actor(request, String(role), client);
}

// ---------------------------------------------------------------------------
// Read-only SQL helper (optional; assertions degrade to API-only when absent)
// ---------------------------------------------------------------------------

const DB_CONTAINER = process.env.GMED_LIVE_DB_CONTAINER ?? "gmed-local-postgres-1";
const DOCKER_CANDIDATES = [
  process.env.DOCKER_BIN,
  "C:\\Users\\oleks\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe",
  "docker",
].filter(Boolean) as string[];

function sql(query: string): string[][] | null {
  for (const docker of DOCKER_CANDIDATES) {
    try {
      const output = execFileSync(
        docker,
        ["exec", DB_CONTAINER, "psql", "-U", "gmed", "-d", "gmed", "-AtF", "\t", "-c", query],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      return output
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => line.split("\t"));
    } catch (error) {
      if (docker === DOCKER_CANDIDATES.at(-1)) {
        console.warn(`SQL helper unavailable: ${String(error).slice(0, 300)}`);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PDF text extraction (pdfjs-dist is a frontend dependency)
// ---------------------------------------------------------------------------

async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item: any) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : ""))
        .join(""),
    );
  }
  return pages.join("\n");
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function uniqueTag(label: string) {
  return `bc-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isoDate(offsetDays: number) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function money(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  return Math.round(Number(value) * 100) / 100;
}

function writeEvidence(testInfo: TestInfo) {
  const directory = path.join(FRONTEND_ROOT, "test-results", "business-cycle");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(
    directory,
    `${testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2), "utf8");
  evidence.length = 0;
}

test.afterEach(async ({ request }, testInfo) => {
  void request; // Playwright needs a destructured fixture argument here.
  writeEvidence(testInfo);
});

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/** Minimal valid PDF used for uploaded compliance evidence (synthetic). */
const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

type ServiceLineInput = {
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  agency_service_id?: string;
  agency_service_price_version_id?: string;
  is_cost_passthrough?: boolean;
};

type OnboardedPatient = {
  tag: string;
  leadId: string;
  patientId: string;
  patientPid: string;
  contractId: string;
  contractNumber: string;
  orderId: string;
  orderNumber: string;
  quoteId: string;
  lineIds: string[];
  estimateGross: number;
  documents: Record<string, { id: string; document_number?: string }>;
};

function lineNet(line: ServiceLineInput) {
  return money(line.quantity * line.unit_price);
}

function lineGross(line: ServiceLineInput) {
  const net = lineNet(line);
  return money(net + Math.round(net * line.vat_rate) / 100);
}

async function uploadComplianceEvidence(
  pm: Actor,
  leadId: string,
  art: string,
  complianceKind: string,
) {
  const upload = await pm.call("POST", "/documents/upload", undefined, {
    multipart: {
      file: { name: `${art}-synthetic.pdf`, mimeType: "application/pdf", buffer: TINY_PDF },
      lead_id: leadId,
      art,
      auto_name: `${art} synthetic evidence`,
      category: "administrative",
    },
  });
  expect(upload.status, describeResult(upload)).toBe(200);
  const signed = await pm.post(`/documents/${upload.body.id}/mark-signed`, {
    compliance_kind: complianceKind,
  });
  expect(signed.status, describeResult(signed)).toBe(200);
  return upload.body.id as string;
}

type CommercialTemplate =
  | "framework_contract"
  | "single_order"
  | "order_cost_estimate"
  | "cost_estimate";

async function generateCommercialDocument(
  pm: Actor,
  input: {
    templateId: CommercialTemplate;
    leadId?: string;
    patientId?: string;
    orderId: string;
    estimateGross: number;
    lines: ServiceLineInput[];
    period?: { from: string; to: string };
  },
) {
  const financial = ["order_cost_estimate", "cost_estimate"].includes(input.templateId);
  return pm.post("/documents/generate", {
    template_id: input.templateId,
    ...(input.leadId ? { lead_id: input.leadId } : {}),
    ...(input.patientId ? { patient_id: input.patientId } : {}),
    order_id: input.orderId,
    language: "de",
    document_language: "de",
    document_direction: "outgoing",
    document_variant: "original",
    access_category: financial ? "financial" : "patient",
    status: "active",
    bindings: {
      party_city: "Berlin",
      party_sign_place: "Berlin",
      specialties: "Kardiologie",
      ...(input.period ? { period_from: input.period.from, period_to: input.period.to } : {}),
      estimate_total: `${input.estimateGross.toFixed(2)} EUR`,
      service_lines: input.lines.map((line) => ({
        description: line.description,
        quantity: String(line.quantity),
        fee: `${line.unit_price.toFixed(2)} EUR`,
        line_total: `${(line.quantity * line.unit_price).toFixed(2)} EUR`,
        vat_rate: String(line.vat_rate),
      })),
    },
  });
}

async function downloadPdf(actor: Actor, documentId: string) {
  return actor.call("GET", `/documents/${documentId}/download`, undefined, { binary: true });
}

async function expectPdf(actor: Actor, documentId: string, label: string) {
  const download = await downloadPdf(actor, documentId);
  expect(download.status, `${label} download: ${describeResult(download)}`).toBe(200);
  expect(download.headers["content-type"], `${label} content-type`).toContain("application/pdf");
  expect(download.bytes?.length ?? 0, `${label} size`).toBeGreaterThan(1_000);
  expect(download.bytes?.subarray(0, 5).toString("latin1"), `${label} magic`).toBe("%PDF-");
  return pdfText(download.bytes!);
}

const DEFAULT_LINES: ServiceLineInput[] = [
  { description: "Dolmetscherleistung (Stunden)", quantity: 4, unit_price: 95, vat_rate: 19 },
  { description: "Koordination Klinikaufenthalt", quantity: 1, unit_price: 200, vat_rate: 19 },
];

/**
 * New lead -> patient purely via the API, mirroring the staff lead wizard:
 * lead + gate fields, qualification, prospect patient + case, signed compliance
 * evidence, framework contract, order with service lines and signatures, quote,
 * generated commercial documents, contract signature, quote acceptance, convert.
 */
async function onboardNewPatient(
  pm: Actor,
  label: string,
  options: {
    lines?: ServiceLineInput[];
    prepaymentAmount?: string;
    period?: { from: string; to: string };
  } = {},
): Promise<OnboardedPatient> {
  const tag = uniqueTag(label);
  const lines = options.lines ?? DEFAULT_LINES;
  const period = options.period ?? { from: isoDate(7), to: isoDate(37) };
  const estimateGross = money(lines.reduce((sum, line) => sum + lineGross(line), 0));

  const lead = await pm.ok("POST", "/leads", {
    first_name: "Bc",
    last_name: tag,
    email: `${tag}@example.com`,
    phone: `+49 30 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    source: "website",
    country: "Germany",
  });
  const leadId = lead.id as string;

  await pm.ok("POST", `/leads/${leadId}/update`, {
    primary_language: "de",
    date_of_birth: "1984-03-14",
    legal_sex: "female",
    compliance_status: "signed",
    consent_healthcare: true,
    consent_privacy_practices: true,
    street_address: "Teststr. 5",
    city: "Berlin",
    zip_code: "10115",
    primary_concern_text: "Kardiologische Abklaerung (synthetisch)",
    requested_specialties: ["cardiology"],
  });
  await pm.ok("POST", `/leads/${leadId}/qualify`, { status: "qualified" });

  const prospect = await pm.ok("POST", `/leads/${leadId}/prospect`, {
    hauptanfragegrund: "Kardiologische Abklaerung",
    zuweiser: "Selbstzuweiser",
  });
  expect(prospect.patient_id, JSON.stringify(prospect)).toBeTruthy();

  await uploadComplianceEvidence(pm, leadId, "identity", "identity");
  await uploadComplianceEvidence(pm, leadId, "privacy_consents", "dsgvo");
  await uploadComplianceEvidence(pm, leadId, "confidentiality_release", "confidentiality_release");

  const contract = await pm.ok("POST", "/framework-contracts", {
    lead_id: leadId,
    status: "sent",
    client_reference: `lead-onboarding:${leadId}:framework`,
  });

  const order = await pm.ok("POST", "/orders", {
    source_lead_id: leadId,
    contract_id: contract.id,
    needs_description: `Business-cycle ${tag}`,
    date_from: period.from,
    date_to: period.to,
  });

  const lineIds: string[] = [];
  for (const [index, line] of lines.entries()) {
    const created = await pm.ok("POST", `/orders/${order.id}/leistungen`, {
      ...line,
      client_reference: `lead-wizard:${leadId}:bc-${index}`,
    });
    lineIds.push(created.id);
  }

  await pm.ok("POST", `/orders/${order.id}/commercial-basis`, {
    contract_id: contract.id,
    total_estimated: estimateGross.toFixed(2),
    prepayment_required: Boolean(options.prepaymentAmount),
    ...(options.prepaymentAmount ? { prepayment_amount: options.prepaymentAmount } : {}),
    signed_patient: true,
    signed_agency: true,
  });

  const quote = await pm.ok("POST", `/orders/${order.id}/quotes`, {});
  expect(money(quote.total_gross), JSON.stringify(quote).slice(0, 500)).toBe(estimateGross);

  const documents: OnboardedPatient["documents"] = {};
  for (const templateId of [
    "framework_contract",
    "single_order",
    "order_cost_estimate",
    "cost_estimate",
  ] as const) {
    const generated = await generateCommercialDocument(pm, {
      templateId,
      leadId,
      orderId: order.id,
      estimateGross,
      lines,
      period,
    });
    expect(generated.status, `${templateId}: ${describeResult(generated)}`).toBe(200);
    expect(generated.body.mime_type).toBe("application/pdf");
    documents[templateId] = {
      id: generated.body.id,
      document_number: generated.body.document_number,
    };
  }

  await pm.ok("POST", `/framework-contracts/${contract.id}/status`, { status: "signed" });
  await pm.ok("POST", `/documents/${documents.framework_contract.id}/mark-signed`, {
    compliance_kind: "framework_contract",
  });
  await pm.ok("POST", `/quotes/${quote.id}/status`, { status: "accepted" });

  const readyLead = await pm.ok("GET", `/leads/${leadId}`);
  expect(
    readyLead.readiness.blocking_reasons,
    "lead should have no conversion blockers after the full onboarding",
  ).toEqual([]);
  expect(readyLead.readiness.conversion_ready).toBe(true);

  const converted = await pm.ok("POST", `/leads/${leadId}/wizard-convert`, { confirmed: true });
  expect(converted.patient_id).toBe(prospect.patient_id);

  return {
    tag,
    leadId,
    patientId: converted.patient_id,
    patientPid: converted.patient_pid,
    contractId: contract.id,
    contractNumber: contract.contract_number,
    orderId: order.id,
    orderNumber: order.order_number,
    quoteId: quote.id,
    lineIds,
    estimateGross,
    documents,
  };
}

function berlinDate(value: string | Date = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

// ---------------------------------------------------------------------------
// 1. New lead -> patient with generated commercial documents
// ---------------------------------------------------------------------------

test.describe("business cycle (live API)", () => {
  test.describe.configure({ timeout: 300_000 });

  test("1 new lead becomes a patient with signed contract, order, quote and PDFs", async ({
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const onboarded = await onboardNewPatient(pm, "onboard");

    await test.step("generated PDFs download and carry the contractual wording", async () => {
      const frameworkText = await expectPdf(pm, onboarded.documents.framework_contract.id, "framework_contract");
      const singleOrderText = await expectPdf(pm, onboarded.documents.single_order.id, "single_order");
      const estimateText = await expectPdf(pm, onboarded.documents.order_cost_estimate.id, "order_cost_estimate");
      await expectPdf(pm, onboarded.documents.cost_estimate.id, "cost_estimate");

      const flatSingleOrder = singleOrderText.replace(/\s+/g, " ");
      expect.soft(flatSingleOrder).toMatch(
        /^1\. EINZELAUFTRAG VOM \d{2}\.\d{2}\.\d{4} ZUM RAHMENDIENSTLEISTUNGSVERTRAG VOM \d{2}\.\d{2}\.\d{4}/,
      );
      expect.soft(flatSingleOrder).toContain(`Auftragsnummer: ${onboarded.orderNumber}`);
      expect.soft(flatSingleOrder).toContain(`Rahmendienstleistungsvertrag Nr.: ${onboarded.contractNumber}`);
      expect.soft(flatSingleOrder).toContain("Skribble");
      expect.soft(flatSingleOrder.toLowerCase()).not.toContain("docusign");

      const flatFramework = frameworkText.replace(/\s+/g, " ");
      const paragraphSix = flatFramework.slice(flatFramework.indexOf("§ 6"));
      expect.soft(paragraphSix.slice(0, 400)).toContain("unbefristete Dauer");
      expect.soft(flatFramework.toLowerCase()).not.toContain("docusign");

      const flatEstimate = estimateText.replace(/\s+/g, " ");
      expect.soft(flatEstimate).toContain("1. EINZELAUFTRAG");
      expect.soft(flatEstimate).toContain(
        onboarded.estimateGross.toLocaleString("de-DE", { minimumFractionDigits: 2 }),
      );
    });

    await test.step("conversion hands contract, order and documents over to the patient", async () => {
      const contract = await pm.ok("GET", `/framework-contracts/${onboarded.contractId}`);
      expect(contract.status).toBe("signed");
      expect(contract.patient_id).toBe(onboarded.patientId);
      expect(contract.signed_at).toBeTruthy();

      const order = await pm.ok("GET", `/orders/${onboarded.orderId}`);
      expect(order.patient_id).toBe(onboarded.patientId);
      expect(order.status).toBe("active");
      expect(order.contract_id).toBe(onboarded.contractId);
      expect(order.signed_patient && order.signed_agency).toBe(true);
      expect(money(order.total_estimated)).toBe(onboarded.estimateGross);
      expect(order.leistungen.map((line: any) => line.status)).toEqual(["planned", "planned"]);

      const lead = await pm.ok("GET", `/leads/${onboarded.leadId}`);
      expect(lead.converted_patient_id).toBe(onboarded.patientId);
      expect(lead.qualification_status).toBe("converted");

      const documents = await pm.ok("GET", `/documents?patient_id=${onboarded.patientId}`);
      const templates = (documents as any[])
        .map((document) => document.generated_template_id)
        .filter(Boolean)
        .sort();
      expect(templates).toEqual(
        ["cost_estimate", "framework_contract", "order_cost_estimate", "single_order"].sort(),
      );

      const quote = await pm.ok("GET", `/quotes/${onboarded.quoteId}`);
      expect(quote.status).toBe("accepted");
      expect(money(quote.total_net)).toBe(580);
      expect(money(quote.total_vat)).toBe(110.2);
      expect(money(quote.total_gross)).toBe(690.2);
    });

    await test.step("PDF date matches the contract (UTC calendar day)", async () => {
      const singleOrderText = await pdfText(
        (await downloadPdf(pm, onboarded.documents.single_order.id)).bytes!,
      );
      expect.soft(singleOrderText.replace(/\s+/g, " ")).toContain(
        `ZUM RAHMENDIENSTLEISTUNGSVERTRAG VOM ${berlinDate()}`,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Repeat-intake helpers
// ---------------------------------------------------------------------------

function randomUuid() {
  return crypto.randomUUID();
}

function listOf(body: any): any[] {
  return Array.isArray(body) ? body : (body?.items ?? []);
}

async function startRepeatIntake(pm: Actor, patientId: string, creationKey = randomUuid()) {
  const created = await pm.post("/leads", {
    first_name: "ignored",
    last_name: "ignored",
    repeat_patient_id: patientId,
    creation_key: creationKey,
  });
  expect(created.status, describeResult(created)).toBe(201);
  const leadId = created.body.id as string;
  const orders = listOf(await pm.ok("GET", `/orders?lead_id=${leadId}`));
  expect(orders.length, `draft orders for repeat lead ${leadId}`).toBe(1);
  // The order list omits the contract link; the detail carries it.
  const order = await pm.ok("GET", `/orders/${orders[0].id}`);
  return { leadId, orderId: orders[0].id as string, order, creationKey };
}

async function orderSequenceFromSingleOrderPdf(pm: Actor, documentId: string) {
  const text = (await pdfText((await downloadPdf(pm, documentId)).bytes!)).replace(/\s+/g, " ");
  const match = text.match(/^(\d+)\. EINZELAUFTRAG VOM/);
  return { ordinal: match ? Number(match[1]) : null, head: text.slice(0, 160) };
}

/**
 * Completes a repeat intake and converts it into a confirmed order. Without a
 * contractId the draft keeps the contract it inherited on creation.
 */
async function completeRepeatIntake(
  pm: Actor,
  input: {
    leadId: string;
    orderId: string;
    contractId?: string;
    lines?: ServiceLineInput[];
    period?: { from: string; to: string };
  },
) {
  const lines = input.lines ?? [
    { description: "Folgetermin Kardiologie Koordination", quantity: 1, unit_price: 150, vat_rate: 19 },
  ];
  const period = input.period ?? { from: isoDate(14), to: isoDate(21) };
  const estimateGross = money(lines.reduce((sum, line) => sum + lineGross(line), 0));

  await pm.ok("POST", `/leads/${input.leadId}/update`, {
    primary_concern_text: "Kontrolluntersuchung (synthetisch)",
    requested_specialties: ["cardiology"],
    compliance_status: "signed",
    consent_healthcare: true,
    consent_privacy_practices: true,
  });
  await pm.ok("POST", `/leads/${input.leadId}/qualify`, { status: "qualified" });
  const attach = await pm.post(`/orders/${input.orderId}/commercial-basis`, {
    ...(input.contractId ? { contract_id: input.contractId } : {}),
    needs_description: "Kontrolluntersuchung",
    date_from: period.from,
    date_to: period.to,
  });
  if (attach.status !== 200) {
    return { attach, lead: null as any, convert: null as any, quote: null, documents: {} as Record<string, string>, estimateGross };
  }
  for (const [index, line] of lines.entries()) {
    await pm.ok("POST", `/orders/${input.orderId}/leistungen`, {
      ...line,
      client_reference: `lead-wizard:${input.leadId}:repeat-${index}`,
    });
  }
  await pm.ok("POST", `/orders/${input.orderId}/commercial-basis`, {
    total_estimated: estimateGross.toFixed(2),
    prepayment_required: false,
  });
  const quote = await pm.ok("POST", `/orders/${input.orderId}/quotes`, {});
  const documents: Record<string, string> = {};
  for (const templateId of ["single_order", "order_cost_estimate", "cost_estimate"] as const) {
    const generated = await generateCommercialDocument(pm, {
      templateId,
      leadId: input.leadId,
      orderId: input.orderId,
      estimateGross,
      lines,
      period,
    });
    expect(generated.status, `${templateId}: ${describeResult(generated)}`).toBe(200);
    documents[templateId] = generated.body.id;
  }
  await pm.ok("POST", `/quotes/${quote.id}/status`, { status: "accepted" });
  await pm.ok("POST", `/orders/${input.orderId}/commercial-basis`, {
    signed_patient: true,
    signed_agency: true,
  });
  const lead = await pm.ok("GET", `/leads/${input.leadId}`);
  const convert = await pm.post(`/leads/${input.leadId}/wizard-convert`, { confirmed: true });
  return { attach, lead, convert, quote, documents, estimateGross };
}

// ---------------------------------------------------------------------------
// 4. Repeat intakes for an existing patient
// ---------------------------------------------------------------------------

test.describe("business cycle (live API) - repeat intake", () => {
  test.describe.configure({ timeout: 300_000 });

  test("4 repeat intakes reuse the signed contract, number single orders without gaps and are idempotent", async ({
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const first = await onboardNewPatient(pm, "repeat");

    const contractsBefore = listOf(await pm.ok("GET", `/framework-contracts?patient_id=${first.patientId}`));
    expect(contractsBefore.map((contract) => contract.id)).toEqual([first.contractId]);

    // (d) double click / concurrent start: same creation key twice in parallel and
    // a second key right after -> one draft, one order.
    const key = randomUuid();
    const body = {
      first_name: "ignored",
      last_name: "ignored",
      repeat_patient_id: first.patientId,
      creation_key: key,
    };
    const [a, b] = await Promise.all([pm.post("/leads", body), pm.post("/leads", body)]);
    await test.step("(d) concurrent repeat intake starts collapse into one draft", async () => {
      expect(a.status, describeResult(a)).toBe(201);
      expect(b.status, describeResult(b)).toBe(201);
      expect(b.body.id).toBe(a.body.id);
      const otherKey = await pm.post("/leads", { ...body, creation_key: randomUuid() });
      expect(otherKey.status, describeResult(otherKey)).toBe(201);
      expect(otherKey.body.id, "a second click with a new key reuses the active draft").toBe(a.body.id);
      const [c, d] = await Promise.all([
        pm.post("/leads", { ...body, creation_key: randomUuid() }),
        pm.post("/leads", { ...body, creation_key: randomUuid() }),
      ]);
      expect([c.body.id, d.body.id]).toEqual([a.body.id, a.body.id]);
      const drafts = await pm.ok("GET", `/patients/${first.patientId}/repeat-intakes`);
      expect((drafts as any[]).map((item) => item.id)).toEqual([a.body.id]);
      expect(listOf(await pm.ok("GET", `/orders?lead_id=${a.body.id}`)).length).toBe(1);
    });
    const discardedLeadId = a.body.id as string;
    const discardedOrder = listOf(await pm.ok("GET", `/orders?lead_id=${discardedLeadId}`))[0];

    await test.step("(a) repeat draft inherits the signed framework contract right after creation", async () => {
      const order = await pm.ok("GET", `/orders/${discardedOrder.id}`);
      expect(order.patient_id).toBe(first.patientId);
      expect(order.contract_id, "repeat draft order links the patient's signed contract").toBe(
        first.contractId,
      );
      const lead = await pm.ok("GET", `/leads/${discardedLeadId}`);
      const contractCheck = (lead.readiness.checks as any[]).find((check) => check.key === "contract_signed");
      expect(contractCheck?.passed, JSON.stringify(contractCheck)).toBe(true);
      expect(lead.readiness.blocking_reasons as string[]).not.toContain(
        "Framework contract is not signed",
      );
    });

    // (b) a draft that points at the contract and got its own single-order document, then cancelled.
    await test.step("(b) cancelled repeat draft does not consume an Einzelauftrag ordinal", async () => {
      const attach = await pm.post(`/orders/${discardedOrder.id}/commercial-basis`, {
        contract_id: first.contractId,
      });
      expect(attach.status, describeResult(attach)).toBe(200);
      const draftDoc = await generateCommercialDocument(pm, {
        templateId: "single_order",
        leadId: discardedLeadId,
        orderId: discardedOrder.id,
        estimateGross: 0,
        lines: [],
      });
      expect(draftDoc.status, describeResult(draftDoc)).toBe(200);
      const draftOrdinal = await orderSequenceFromSingleOrderPdf(pm, draftDoc.body.id);
      expect.soft(draftOrdinal.ordinal, draftOrdinal.head).toBe(2);

      const archived = await pm.post(`/leads/${discardedLeadId}/failed-flow`, {
        resolution: "archive",
        reason: "duplicate_request",
        note: "business-cycle: discard draft",
      });
      expect(archived.status, describeResult(archived)).toBe(200);
      // Discarded drafts are intentionally hidden from the order API (403 for every role).
      const hidden = await pm.get(`/orders/${discardedOrder.id}`);
      expect(hidden.status, describeResult(hidden)).toBe(403);
      const row = sql(
        `SELECT status, intake_state, COALESCE(cancellation_reason,'') FROM orders WHERE id='${discardedOrder.id}'`,
      );
      if (row) expect(row[0]).toEqual(["cancelled", "draft", ""]);
      const drafts = await pm.ok("GET", `/patients/${first.patientId}/repeat-intakes`);
      expect(drafts).toEqual([]);
      const replay = await pm.post("/leads", body);
      expect(replay.body.id, "replaying the archived key returns the archived lead").toBe(discardedLeadId);
    });

    const second = await startRepeatIntake(pm, first.patientId);
    expect(second.leadId).not.toBe(discardedLeadId);

    await test.step("(a)+(b) second order reuses the contract and is the 2. Einzelauftrag", async () => {
      expect(second.order.contract_id, "repeat draft inherits the signed contract").toBe(
        first.contractId,
      );
      // No explicit contract attach: the inherited contract must be enough to convert.
      const result = await completeRepeatIntake(pm, {
        leadId: second.leadId,
        orderId: second.orderId,
      });
      expect(result.attach.status, describeResult(result.attach)).toBe(200);
      expect(result.lead.readiness.blocking_reasons, "repeat lead readiness").toEqual([]);
      expect(result.convert.status, describeResult(result.convert)).toBe(200);
      expect(result.convert.body.patient_id).toBe(first.patientId);

      const order = await pm.ok("GET", `/orders/${second.orderId}`);
      expect(order.contract_id).toBe(first.contractId);
      expect(order.status).toBe("active");

      const ordinal = await orderSequenceFromSingleOrderPdf(pm, result.documents.single_order);
      expect(ordinal.ordinal, ordinal.head).toBe(2);

      const contractsAfter = listOf(await pm.ok("GET", `/framework-contracts?patient_id=${first.patientId}`));
      expect(contractsAfter.map((contract) => contract.id)).toEqual([first.contractId]);
      const documents = listOf(await pm.ok("GET", `/documents?patient_id=${first.patientId}`));
      const frameworkDocs = documents.filter(
        (document) => document.generated_template_id === "framework_contract",
      );
      expect(frameworkDocs.length, "no new framework contract PDF for a repeat intake").toBe(1);
    });

    await test.step("(e) repeat intake with past and far-future order dates is not date-gated", async () => {
      const third = await startRepeatIntake(pm, first.patientId);
      const past = await pm.post(`/orders/${third.orderId}/commercial-basis`, {
        contract_id: first.contractId,
        date_from: "2021-02-01",
        date_to: "2021-02-10",
      });
      expect(past.status, describeResult(past)).toBe(200);
      const inverted = await pm.post(`/orders/${third.orderId}/commercial-basis`, {
        date_from: "2031-02-10",
        date_to: "2031-02-01",
      });
      expect(inverted.status, describeResult(inverted)).toBe(422);
      const result = await completeRepeatIntake(pm, {
        leadId: third.leadId,
        orderId: third.orderId,
        contractId: first.contractId,
        period: { from: "2035-06-01", to: "2035-12-31" },
      });
      expect(result.attach.status, describeResult(result.attach)).toBe(200);
      expect(result.lead.readiness.blocking_reasons).toEqual([]);
      expect(result.convert.status, describeResult(result.convert)).toBe(200);
      const ordinal = await orderSequenceFromSingleOrderPdf(pm, result.documents.single_order);
      expect(ordinal.ordinal, ordinal.head).toBe(3);

      const pastOnly = await startRepeatIntake(pm, first.patientId);
      const pastResult = await completeRepeatIntake(pm, {
        leadId: pastOnly.leadId,
        orderId: pastOnly.orderId,
        contractId: first.contractId,
        period: { from: "2022-03-01", to: "2022-03-05" },
      });
      expect(pastResult.attach.status, describeResult(pastResult.attach)).toBe(200);
      expect(pastResult.lead.readiness.blocking_reasons).toEqual([]);
      expect(pastResult.convert.status, describeResult(pastResult.convert)).toBe(200);
      const pastOrdinal = await orderSequenceFromSingleOrderPdf(pm, pastResult.documents.single_order);
      expect(pastOrdinal.ordinal, pastOrdinal.head).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------
// Operations / money helpers
// ---------------------------------------------------------------------------

const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";

async function catalogService(actor: Actor, serviceKey: string) {
  const services = listOf(await actor.ok("GET", "/agency-services"));
  return services.find((service) => service.service_key === serviceKey) ?? null;
}

function effectiveCatalogPrice(service: any, onDate: string) {
  const versions = ((service?.price_versions ?? []) as any[])
    .filter((version) => version.valid_from <= onDate && (!version.valid_to || version.valid_to >= onDate))
    .sort((left, right) => String(right.valid_from).localeCompare(String(left.valid_from)));
  const version = versions[0];
  return {
    unit_price: money(version?.unit_price ?? service?.unit_price),
    vat_rate: money(version?.vat_rate ?? service?.vat_rate),
  };
}

async function orderLines(actor: Actor, orderId: string) {
  const order = await actor.ok("GET", `/orders/${orderId}`);
  return order.leistungen as any[];
}

async function releaseInvoice(billing: Actor, invoiceId: string) {
  const released = await billing.post(`/invoices/${invoiceId}/status`, { status: "sent" });
  expect(released.status, describeResult(released)).toBe(200);
  return billing.ok("GET", `/invoices/${invoiceId}`);
}

async function pay(billing: Actor, invoiceId: string, amount: number, note = "business-cycle") {
  return billing.post(`/invoices/${invoiceId}/payments`, {
    request_id: randomUuid(),
    amount_gross: amount.toFixed(2),
    payment_method: "bank_transfer",
    payment_reference: `BC-${note}`,
    received_on: isoDate(0),
    note,
  });
}

async function createAppointment(
  pm: Actor,
  input: { patientId: string; orderId: string; type: "medical" | "non_medical"; title: string; date: string; start: string; end: string },
) {
  const created = await pm.post("/appointments", {
    patient_id: input.patientId,
    order_id: input.orderId,
    appointment_type: input.type,
    title: input.title,
    date: input.date,
    time_start: input.start,
    time_end: input.end,
    ...(input.type === "medical" ? { provider_id: SEEDED_MEDICAL_PROVIDER_ID } : {}),
    location: "Berlin (synthetisch)",
  });
  expect(created.status, describeResult(created)).toBe(201);
  return created.body.id as string;
}

// ---------------------------------------------------------------------------
// 2. Interpreter and medical procedures feed the order service lines
// ---------------------------------------------------------------------------

test.describe("business cycle (live API) - execution", () => {
  test.describe.configure({ timeout: 300_000 });

  test("2 approved interpreter report and completed medical appointment feed the order service lines", async ({
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const interpreter = await actorFor(request, scenario, "interpreter");
    const date = isoDate(3);
    // Reports, their approval and completion open on the appointment date
    // (Europe/Berlin), so the delivered visits take place today; the UTC date
    // is never later than the Berlin one.
    const serviceDate = isoDate(0);
    const interpreterCatalog = await catalogService(pm, "interpreter_hours");
    const medicalCatalog = await catalogService(pm, "treatment_organization");
    expect(interpreterCatalog, "interpreter_hours catalog item").toBeTruthy();
    // The wizard plans interpreter hours from the catalog item; the server prices the
    // line from the catalog version valid on the order date.
    const plannedInterpreterPrice = effectiveCatalogPrice(interpreterCatalog, isoDate(7));
    const onboarded = await onboardNewPatient(pm, "exec", {
      lines: [
        {
          description: "Dolmetscherleistung (Stunden)",
          quantity: 4,
          ...plannedInterpreterPrice,
          agency_service_id: interpreterCatalog.id,
        },
        DEFAULT_LINES[1],
      ],
    });

    const interpreterAppointment = await createAppointment(pm, {
      patientId: onboarded.patientId,
      orderId: onboarded.orderId,
      type: "medical",
      title: `Kardiologie mit Dolmetscher ${onboarded.tag}`,
      date: serviceDate,
      start: "09:00",
      end: "11:30",
    });

    await test.step("a report for a future appointment is rejected before its date", async () => {
      const futureInterpreterAppointment = await createAppointment(pm, {
        patientId: onboarded.patientId,
        orderId: onboarded.orderId,
        type: "medical",
        title: `Nachkontrolle mit Dolmetscher ${onboarded.tag}`,
        date,
        start: "09:00",
        end: "10:00",
      });
      await pm.ok("POST", `/appointments/${futureInterpreterAppointment}/assign-interpreter`, {
        interpreter_id: scenario.credentials.interpreter.user_id,
      });
      await pm.ok("POST", `/appointments/${futureInterpreterAppointment}/status`, {
        status: "confirmed",
      });
      const tooEarly = await interpreter.post(`/appointments/${futureInterpreterAppointment}/report`, {
        hours: 2.5,
        report_text: "vor dem Termin",
      });
      expect(tooEarly.status, `report before the date: ${describeResult(tooEarly)}`).toBe(422);
      expect(tooEarly.body.code).toBe("appointment_report_before_date");
      await pm.ok("POST", `/appointments/${futureInterpreterAppointment}/status`, {
        status: "cancelled",
      });
    });

    await test.step("assign interpreter, confirm, report 2.5h, approve -> approved service line", async () => {
      const assign = await pm.post(`/appointments/${interpreterAppointment}/assign-interpreter`, {
        interpreter_id: scenario.credentials.interpreter.user_id,
      });
      expect(assign.status, describeResult(assign)).toBe(200);
      const accept = await interpreter.post(`/appointments/${interpreterAppointment}/interpreter-response`, {
        response: "accepted",
      });
      expect(accept.status, describeResult(accept)).toBe(200);

      const early = await interpreter.post(`/appointments/${interpreterAppointment}/report`, {
        hours: 2.5,
        report_text: "zu frueh",
      });
      expect(early.status, `report before confirmation: ${describeResult(early)}`).toBe(409);

      await pm.ok("POST", `/appointments/${interpreterAppointment}/status`, { status: "confirmed" });
      const badHours = await interpreter.post(`/appointments/${interpreterAppointment}/report`, {
        hours: 2.4,
        report_text: "invalid granularity",
      });
      expect(badHours.status, describeResult(badHours)).toBe(422);
      const report = await interpreter.post(`/appointments/${interpreterAppointment}/report`, {
        hours: 2.5,
        report_text: "Dolmetschen beim Kardiologen (synthetisch)",
      });
      expect(report.status, describeResult(report)).toBe(201);

      const selfApprove = await interpreter.post(`/appointments/${interpreterAppointment}/report/approve`);
      expect(selfApprove.status, `interpreter approving own report: ${describeResult(selfApprove)}`).toBe(403);

      const approve = await pm.post(`/appointments/${interpreterAppointment}/report/approve`);
      expect(approve.status, describeResult(approve)).toBe(200);

      const reportState = await pm.ok("GET", `/appointments/${interpreterAppointment}/report`);
      expect(reportState.approval_status).toBe("approved");
      expect(reportState.billing_sync_status).toBe("synced");
      expect(reportState.billing_leistung_id).toBeTruthy();

      const lines = await orderLines(pm, onboarded.orderId);
      // The approved report consumes the planned interpreter line instead of adding a
      // second one (otherwise the hours would be billed twice).
      expect(lines.length, JSON.stringify(lines.map((line) => [line.description, line.status]))).toBe(
        onboarded.lineIds.length,
      );
      expect(reportState.billing_leistung_id, "report is linked to the planned line").toBe(
        onboarded.lineIds[0],
      );
      const synced = lines.find((line) => line.id === reportState.billing_leistung_id);
      expect(synced, JSON.stringify(lines.map((line) => [line.description, line.status]))).toBeTruthy();
      expect(synced.status).toBe("approved");
      expect(money(synced.quantity), "planned 4 h become the reported 2.5 h").toBe(2.5);
      expect(money(synced.unit_price)).toBe(plannedInterpreterPrice.unit_price);
      expect(money(synced.vat_rate)).toBe(plannedInterpreterPrice.vat_rate);
      expect(String(synced.notes ?? "")).toContain("Geplante Leistung (4 Std.)");

      const again = await pm.post(`/appointments/${interpreterAppointment}/report/approve`);
      expect(again.status, `second approval: ${describeResult(again)}`).toBe(404);
      const linesAfterReplay = await orderLines(pm, onboarded.orderId);
      expect(linesAfterReplay.length).toBe(lines.length);
    });

    await test.step("complete a medical appointment -> delivered service line (idempotent)", async () => {
      const medicalDate = serviceDate;
      const futureMedicalAppointment = await createAppointment(pm, {
        patientId: onboarded.patientId,
        orderId: onboarded.orderId,
        type: "medical",
        title: `Kontrolle ${onboarded.tag}`,
        date,
        start: "15:00",
        end: "16:00",
      });
      const tooEarly = await pm.post(`/appointments/${futureMedicalAppointment}/status`, {
        status: "completed",
      });
      expect(tooEarly.status, `completion before the date: ${describeResult(tooEarly)}`).toBe(422);
      expect(tooEarly.body.code).toBe("appointment_completion_before_date");
      await pm.ok("POST", `/appointments/${futureMedicalAppointment}/status`, {
        status: "cancelled",
      });

      const medicalAppointment = await createAppointment(pm, {
        patientId: onboarded.patientId,
        orderId: onboarded.orderId,
        type: "medical",
        title: `Untersuchung ${onboarded.tag}`,
        date: medicalDate,
        start: "13:00",
        end: "14:00",
      });
      const before = await orderLines(pm, onboarded.orderId);
      const interpreterCompletes = await interpreter.post(`/appointments/${medicalAppointment}/status`, {
        status: "completed",
      });
      expect(interpreterCompletes.status, describeResult(interpreterCompletes)).toBe(403);
      await pm.ok("POST", `/appointments/${medicalAppointment}/status`, {
        status: "completed",
        recurrence_scope: "single",
      });
      const after = await orderLines(pm, onboarded.orderId);
      const added = after.filter((line) => !before.some((old) => old.id === line.id));
      expect(added.length, JSON.stringify(after.map((line) => [line.description, line.status]))).toBe(1);
      expect(added[0].status).toBe("delivered");
      expect(added[0].source_medical_appointment_id).toBe(medicalAppointment);
      expect(money(added[0].quantity)).toBe(1);
      const expected = effectiveCatalogPrice(medicalCatalog, medicalDate);
      expect.soft(money(added[0].unit_price), "treatment_organization catalog price").toBe(expected.unit_price);

      const reopen = await pm.post(`/appointments/${medicalAppointment}/status`, { status: "completed" });
      expect([200, 409]).toContain(reopen.status);
      expect((await orderLines(pm, onboarded.orderId)).length).toBe(after.length);

      const approve = await pm.post(`/orders/${onboarded.orderId}/leistungen/${added[0].id}/approve`);
      expect(approve.status, describeResult(approve)).toBe(200);
      const deliverAgain = await pm.post(`/orders/${onboarded.orderId}/leistungen/${added[0].id}/deliver`);
      expect(deliverAgain.status, describeResult(deliverAgain)).toBe(404);
    });

    await test.step("manual deliver/approve transitions on planned lines", async () => {
      const coordination = onboarded.lineIds[1];
      const approveTooEarly = await pm.post(`/orders/${onboarded.orderId}/leistungen/${coordination}/approve`);
      expect(approveTooEarly.status, describeResult(approveTooEarly)).toBe(404);
      await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${coordination}/deliver`);
      await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${coordination}/approve`);
      const lines = await orderLines(pm, onboarded.orderId);
      expect(lines.find((line) => line.id === coordination)?.status).toBe("approved");
      const order = await pm.ok("GET", `/orders/${onboarded.orderId}`);
      expect(order.execution_flow.approved_interpreter_reports).toBe(1);
      expect(order.execution_flow.medical_completed).toBeGreaterThanOrEqual(1);
    });

    await test.step("planned vs actual interpreter hours: what a new quote and completion see", async () => {
      const quote = await pm.ok("POST", `/orders/${onboarded.orderId}/quotes`, {});
      const interpreterHours = (quote.line_items as any[])
        .filter((line) => /dolmetsch|interpreter/i.test(line.description))
        .reduce((sum, line) => sum + money(line.quantity), 0);
      test.info().annotations.push({
        type: "observation",
        description: `new quote after report approval: interpreter hours=${interpreterHours}, lines=${JSON.stringify(
          (quote.line_items as any[]).map((line) => [line.description, line.quantity, line.line_gross]),
        )}`,
      });
      expect(interpreterHours, "only the 2.5 approved hours remain billable").toBe(2.5);
      const completion = await pm.post(`/orders/${onboarded.orderId}/status`, { status: "completed" });
      test.info().annotations.push({
        type: "observation",
        description: `completion blockers: ${JSON.stringify(completion.body?.blocking_reasons ?? completion.body)}`,
      });
      expect(completion.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Money: advance, partial payment, interim, prepayment, final, completion
  // -------------------------------------------------------------------------

  test("3 advance, partial payment, interim, prepayment, final invoice, payment and statement agree", async ({
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const billing = await actorFor(request, scenario, "billing");
    const onboarded = await onboardNewPatient(pm, "money", { prepaymentAmount: "238.00" });
    // Quote line order = creation order: 0 interpreter 4x95 (452.20), 1 coordination 1x200 (238.00)

    let advance: any;
    await test.step("advance invoice for the coordination line, released and paid in two steps", async () => {
      const pmPays = await pm.post(`/quotes/${onboarded.quoteId}/invoices`, {
        invoice_type: "advance",
        line_items: [{ line_index: 1, quantity: 1 }],
      });
      // invoices.create includes patient_manager; creation is allowed, payments are not.
      expect([201, 403]).toContain(pmPays.status);
      if (pmPays.status === 201) {
        advance = pmPays.body;
      } else {
        const created = await billing.post(`/quotes/${onboarded.quoteId}/invoices`, {
          invoice_type: "advance",
          line_items: [{ line_index: 1, quantity: 1 }],
        });
        expect(created.status, describeResult(created)).toBe(201);
        advance = created.body;
      }
      expect(advance.invoice_type).toBe("advance");
      expect(advance.status).toBe("draft");
      expect(money(advance.total_net)).toBe(200);
      expect(money(advance.total_vat)).toBe(38);
      expect(money(advance.total_gross)).toBe(238);

      const duplicate = await billing.post(`/quotes/${onboarded.quoteId}/invoices`, { invoice_type: "advance" });
      expect(duplicate.status, `second advance: ${describeResult(duplicate)}`).toBe(409);

      const draftPayment = await pay(billing, advance.id, 10, "draft");
      expect(draftPayment.status, describeResult(draftPayment)).toBe(409);

      const pdf = await billing.call("GET", `/invoices/${advance.id}/pdf`, undefined, { binary: true });
      expect(pdf.status, describeResult(pdf)).toBe(200);
      expect(pdf.bytes?.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      await releaseInvoice(billing, advance.id);
      const pmPayment = await pay(pm, advance.id, 10, "pm");
      expect(pmPayment.status, `PM records payment: ${describeResult(pmPayment)}`).toBe(403);

      const partial = await pay(billing, advance.id, 100, "advance-partial");
      expect(partial.status, describeResult(partial)).toBe(201);
      expect(partial.body.invoice.status).toBe("partially_paid");
      expect(money(partial.body.invoice.balance_due)).toBe(138);

      const over = await pay(billing, advance.id, 138.01, "advance-over");
      expect(over.status, describeResult(over)).toBe(409);

      const rest = await pay(billing, advance.id, 138, "advance-rest");
      expect(rest.status, describeResult(rest)).toBe(201);
      expect(rest.body.invoice.status).toBe("paid");
      expect(money(rest.body.invoice.paid_amount)).toBe(238);
      expect(money(rest.body.invoice.balance_due)).toBe(0);

      const lines = await orderLines(pm, onboarded.orderId);
      expect(lines.map((line) => line.status), "advance never consumes service lines").toEqual([
        "planned",
        "planned",
      ]);
    });

    let interim: any;
    await test.step("interim invoice for the delivered coordination, settled by the advance", async () => {
      await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${onboarded.lineIds[1]}/deliver`);
      await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${onboarded.lineIds[1]}/approve`);
      const created = await billing.post(`/quotes/${onboarded.quoteId}/invoices`, {
        invoice_type: "interim",
        line_items: [{ line_index: 1, quantity: 1 }],
      });
      expect(created.status, describeResult(created)).toBe(201);
      interim = created.body;
      expect(money(interim.total_gross)).toBe(238);
      const available = (interim.available_prepayments as any[]).find(
        (item) => item.invoice_id === advance.id,
      );
      expect(money(available?.available_amount), JSON.stringify(interim.available_prepayments)).toBe(238);

      await releaseInvoice(billing, interim.id);
      const pmApply = await pm.post(`/invoices/${interim.id}/prepayment-allocations`, {
        request_id: randomUuid(),
        advance_invoice_id: advance.id,
        amount_gross: "238.00",
      });
      expect(pmApply.status, describeResult(pmApply)).toBe(403);
      const tooMuch = await billing.post(`/invoices/${interim.id}/prepayment-allocations`, {
        request_id: randomUuid(),
        advance_invoice_id: advance.id,
        amount_gross: "238.01",
      });
      expect(tooMuch.status, describeResult(tooMuch)).toBe(409);
      const applyRequest = randomUuid();
      const applied = await billing.post(`/invoices/${interim.id}/prepayment-allocations`, {
        request_id: applyRequest,
        advance_invoice_id: advance.id,
        amount_gross: "238.00",
      });
      expect(applied.status, describeResult(applied)).toBe(200);
      expect(applied.body.status).toBe("paid");
      expect(money(applied.body.prepayment_applied_amount)).toBe(238);
      expect(money(applied.body.balance_due)).toBe(0);
      const replay = await billing.post(`/invoices/${interim.id}/prepayment-allocations`, {
        request_id: applyRequest,
        advance_invoice_id: advance.id,
        amount_gross: "238.00",
      });
      expect(replay.status).toBe(200);
      expect(replay.body.idempotent_replay).toBe(true);

      const allocationId = (applied.body.prepayment_allocations as any[])[0]?.id;
      const released = await billing.del(`/invoices/${interim.id}/prepayment-allocations/${allocationId}`);
      expect(released.status, describeResult(released)).toBe(200);
      expect(released.body.status).toBe("sent");
      expect(money(released.body.balance_due)).toBe(238);
      const reapplied = await billing.post(`/invoices/${interim.id}/prepayment-allocations`, {
        request_id: randomUuid(),
        advance_invoice_id: advance.id,
        amount_gross: "238.00",
      });
      expect(reapplied.status, describeResult(reapplied)).toBe(200);
      expect(reapplied.body.status).toBe("paid");

      const lines = await orderLines(pm, onboarded.orderId);
      expect(lines.find((line) => line.id === onboarded.lineIds[1])?.status).toBe("invoiced");
    });

    let finalInvoice: any;
    await test.step("final invoice for the remaining interpreter hours, paid in full", async () => {
      const partialFinal = await billing.post(`/quotes/${onboarded.quoteId}/invoices`, {
        invoice_type: "final",
        line_items: [{ line_index: 0, quantity: 1 }],
      });
      expect(partialFinal.status, describeResult(partialFinal)).toBe(422);
      const created = await billing.post(`/quotes/${onboarded.quoteId}/invoices`, { invoice_type: "final" });
      expect(created.status, describeResult(created)).toBe(201);
      finalInvoice = created.body;
      expect(money(finalInvoice.total_net)).toBe(380);
      expect(money(finalInvoice.total_vat)).toBe(72.2);
      expect(money(finalInvoice.total_gross)).toBe(452.2);
      await releaseInvoice(billing, finalInvoice.id);
      const paid = await pay(billing, finalInvoice.id, 452.2, "final");
      expect(paid.status, describeResult(paid)).toBe(201);
      expect(paid.body.invoice.status).toBe("paid");
      const lines = await orderLines(pm, onboarded.orderId);
      expect(lines.map((line) => line.status)).toEqual(["invoiced", "invoiced"]);
      expect(lines.map((line) => line.billing_status)).toEqual(["paid", "paid"]);
    });

    await test.step("patient account statement and financial summary are consistent", async () => {
      const statement = await billing.ok("GET", `/patients/${onboarded.patientId}/account-statement`);
      const summary = statement.summary;
      expect.soft(money(summary.cash_paid), "cash = 238 advance + 452.20 final").toBe(690.2);
      expect.soft(money(summary.prepayment_applied)).toBe(238);
      expect.soft(money(summary.available_prepayment)).toBe(0);
      expect.soft(money(summary.invoice_due)).toBe(0);
      expect.soft(summary.reconciliation_required).toBe(false);
      expect.soft(money(summary.closing_balance ?? summary.calculated_balance)).toBe(0);
      expect.soft(summary.balance_side).toBe("settled");

      const financial = await billing.ok("GET", `/patients/${onboarded.patientId}/financial-summary`);
      expect.soft(money(financial.revenue_gross), "non-advance revenue").toBe(690.2);
      expect.soft(money(financial.open_balance)).toBe(0);
      expect.soft(money(financial.overdue_amount)).toBe(0);
      expect.soft(money(financial.paid_amount) + money(financial.prepayment_applied_amount)).toBe(
        money(financial.settled_amount),
      );
      expect.soft(money(financial.settled_amount)).toBe(690.2);

      const economics = await billing.ok("GET", `/orders/${onboarded.orderId}/economics`);
      test.info().annotations.push({
        type: "observation",
        description: `order economics actual=${JSON.stringify(economics.actual ?? economics).slice(0, 400)}`,
      });
      const invoices = listOf(await billing.ok("GET", `/invoices?patient_id=${onboarded.patientId}`));
      expect(invoices.map((invoice) => [invoice.invoice_type, invoice.status]).sort()).toEqual(
        [
          ["advance", "paid"],
          ["final", "paid"],
          ["interim", "paid"],
        ].sort(),
      );
    });

    await test.step("order completion reports its blockers precisely", async () => {
      const completion = await pm.post(`/orders/${onboarded.orderId}/status`, { status: "completed" });
      test.info().annotations.push({
        type: "observation",
        description: `order completion -> ${completion.status}: ${JSON.stringify(completion.body).slice(0, 800)}`,
      });
      if (completion.status === 422) {
        expect(completion.body.message).toBe("Order cannot move to completed yet");
        const reasons = completion.body.blocking_reasons as string[];
        expect(reasons.length).toBeGreaterThan(0);
        expect(
          reasons.some((reason) => /service item\(s\) are not approved or invoiced/.test(reason)),
          "all service lines are invoiced, so no service blocker is expected",
        ).toBe(false);
      } else {
        expect(completion.status).toBe(200);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Termination during an active order + settlement
// ---------------------------------------------------------------------------

const FLAT_FEE_KEY = "organisation_treatment_bc_live";

/** Shared, tagged catalog flat fee that is due in full on termination (created once). */
async function ensureFlatFeeCatalogItem(ceo: Actor) {
  const existing = await catalogService(ceo, FLAT_FEE_KEY);
  if (existing && existing.is_active && existing.due_in_full_on_termination) return existing;
  const created = await ceo.post("/agency-services", {
    service_key: FLAT_FEE_KEY,
    service_name: "Organisation der Behandlung Pauschale (Live-Test)",
    description: "Synthetic business-cycle flat fee, due in full on termination",
    unit_label: "item",
    unit_price: 450,
    vat_rate: 19,
    currency: "EUR",
    is_active: true,
    valid_from: "2020-01-01",
    due_in_full_on_termination: true,
  });
  expect(created.status, describeResult(created)).toBe(201);
  const service = await catalogService(ceo, FLAT_FEE_KEY);
  expect(service?.due_in_full_on_termination).toBe(true);
  return service;
}

test.describe("business cycle (live API) - termination", () => {
  test.describe.configure({ timeout: 300_000 });

  test("5 terminating the framework contract during an active order settles accrued vs paid", async ({
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const billing = await actorFor(request, scenario, "billing");
    const ceo = await actorFor(request, scenario, "ceo");
    const interpreter = await actorFor(request, scenario, "interpreter");
    const flatFee = await ensureFlatFeeCatalogItem(ceo);
    const flatPrice = effectiveCatalogPrice(flatFee, isoDate(7));
    expect(flatPrice).toEqual({ unit_price: 450, vat_rate: 19 });

    const onboarded = await onboardNewPatient(pm, "terminate", {
      lines: [
        { description: "Dolmetscher Vorgespraech", quantity: 2, unit_price: 60, vat_rate: 19 },
        { description: "Transfer Flughafen", quantity: 1, unit_price: 100, vat_rate: 19 },
        {
          description: "Organisation der Behandlung Pauschale",
          quantity: 1,
          unit_price: 450,
          vat_rate: 19,
          agency_service_id: flatFee.id,
        },
      ],
    });
    const [deliveredLine, cancelledLine, flatLine] = onboarded.lineIds;
    expect(onboarded.estimateGross).toBe(money(142.8 + 119 + 535.5));

    // Accrual after the quote: an extra approved service (billed as a direct line on termination).
    await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${deliveredLine}/deliver`);
    const lateLine = await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen`, {
      description: "Nachbetreuung Telefon",
      quantity: 1,
      unit_price: 60,
      vat_rate: 19,
      client_reference: `bc-late-${onboarded.tag}`,
    });
    await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${lateLine.id}/deliver`);
    await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${lateLine.id}/approve`);

    // Paid advance of 142.80 (line 0) before termination.
    const advance = await billing.ok("POST", `/quotes/${onboarded.quoteId}/invoices`, {
      invoice_type: "advance",
      line_items: [{ line_index: 0, quantity: 2 }],
    });
    expect(money(advance.total_gross)).toBe(142.8);
    await releaseInvoice(billing, advance.id);
    const advancePaid = await pay(billing, advance.id, 142.8, "advance");
    expect(advancePaid.status, describeResult(advancePaid)).toBe(201);

    // A repeat draft that already points at the contract (inherited on creation, not yet confirmed).
    const draft = await startRepeatIntake(pm, onboarded.patientId);
    expect(draft.order.contract_id, "repeat draft inherits the signed contract").toBe(onboarded.contractId);
    const draftStatusBefore = (await pm.ok("GET", `/orders/${draft.orderId}`)).status as string;

    const accruedGross = money(142.8 + 535.5 + 71.4); // delivered + flat fee due in full + approved late line
    const paidGross = 142.8;

    await test.step("preview: RBAC and accrued vs paid", async () => {
      expect((await interpreter.get(`/framework-contracts/${onboarded.contractId}/termination-preview`)).status).toBe(403);
      expect((await billing.get(`/framework-contracts/${onboarded.contractId}/termination-preview`)).status).toBe(403);
      const preview = await pm.ok("GET", `/framework-contracts/${onboarded.contractId}/termination-preview`);
      test.info().annotations.push({
        type: "observation",
        description: `preview open orders: ${JSON.stringify((preview.open_orders as any[]).map((order) => [order.order_number, order.status, order.accrued_gross]))}`,
      });
      const order = (preview.open_orders as any[]).find((item) => item.id === onboarded.orderId);
      expect(order, JSON.stringify(preview).slice(0, 800)).toBeTruthy();
      expect(money(order.accrued_gross)).toBe(accruedGross);
      expect(money(order.accrued_net)).toBe(120 + 450 + 60);
      expect(money(order.paid_gross)).toBe(paidGross);
      expect(money(order.invoiced_gross)).toBe(0);
      expect(money(order.balance_gross)).toBe(money(accruedGross - paidGross));
      expect(money(order.uninvoiced_gross)).toBe(accruedGross);
      const lineIds = (order.lines as any[]).map((line) => line.order_leistung_id).sort();
      expect(lineIds).toEqual([deliveredLine, flatLine, lateLine.id].sort());
      expect((order.lines as any[]).find((line) => line.order_leistung_id === flatLine)?.due_in_full).toBe(true);
      expect((order.cancelled_lines as any[]).map((line) => line.order_leistung_id)).toEqual([cancelledLine]);
      expect(
        (preview.open_orders as any[]).map((item) => item.id),
        "an unconfirmed repeat draft is not an open order to settle",
      ).toEqual([onboarded.orderId]);
    });

    let settlementId = "";
    await test.step("terminate: order cancelled, planned lines cancelled, flat fee due", async () => {
      const shortReason = await pm.post(`/framework-contracts/${onboarded.contractId}/terminate`, { reason: "x" });
      expect(shortReason.status, describeResult(shortReason)).toBe(422);
      expect((await interpreter.post(`/framework-contracts/${onboarded.contractId}/terminate`, { reason: "Patient kuendigt" })).status).toBe(403);
      const terminated = await pm.post(`/framework-contracts/${onboarded.contractId}/terminate`, {
        reason: "Patient kuendigt den Rahmenvertrag (Live-Test)",
      });
      expect(terminated.status, describeResult(terminated)).toBe(200);
      expect(terminated.body.status).toBe("terminated");
      const settlement = (terminated.body.settlements as any[]).find((item) => item.order_id === onboarded.orderId);
      expect(settlement.settlement_status).toBe("open");
      expect(settlement.cancelled_services).toBe(1);
      expect(settlement.flat_fees_due).toBe(1);
      expect(money(settlement.accrued_gross)).toBe(accruedGross);
      expect(money(settlement.paid_gross)).toBe(paidGross);
      expect(money(settlement.balance_gross)).toBe(money(accruedGross - paidGross));
      settlementId = settlement.settlement_id;
      expect(
        (terminated.body.settlements as any[]).map((item) => item.order_id),
        "termination opens no settlement for an unconfirmed repeat draft",
      ).toEqual([onboarded.orderId]);
      expect(
        (terminated.body.detached_draft_orders as any[]).map((item) => [item.order_id, item.source_lead_id]),
        "the repeat draft is detached from the terminated contract",
      ).toEqual([[draft.orderId, draft.leadId]]);

      const order = await pm.ok("GET", `/orders/${onboarded.orderId}`);
      expect(order.status).toBe("cancelled");
      expect(order.cancellation_reason).toBe("contract_terminated");
      const statuses = Object.fromEntries((order.leistungen as any[]).map((line) => [line.id, line.status]));
      expect(statuses[deliveredLine]).toBe("delivered");
      expect(statuses[cancelledLine]).toBe("cancelled");
      expect(statuses[flatLine]).toBe("delivered");
      expect(statuses[lateLine.id]).toBe("approved");

      // The draft is neither stopped nor settled: it only loses the contract link.
      const draftOrder = await pm.ok("GET", `/orders/${draft.orderId}`);
      expect(draftOrder.status).toBe(draftStatusBefore);
      expect(draftOrder.contract_id).toBeNull();
      expect(draftOrder.cancellation_reason ?? null).toBeNull();
      const draftRow = sql(
        `SELECT status, intake_state, COALESCE(contract_id::text, '') FROM orders WHERE id='${draft.orderId}'`,
      );
      if (draftRow) expect(draftRow[0]).toEqual([draftStatusBefore, "draft", ""]);

      const again = await pm.post(`/framework-contracts/${onboarded.contractId}/terminate`, { reason: "nochmal kuendigen" });
      expect(again.status, describeResult(again)).toBe(422);
      const reSign = await pm.post(`/framework-contracts/${onboarded.contractId}/status`, { status: "signed" });
      expect(reSign.status, describeResult(reSign)).toBe(409);
      const preview = await pm.ok("GET", `/framework-contracts/${onboarded.contractId}/termination-preview`);
      expect(preview.open_orders).toEqual([]);
    });

    await test.step("settlement: RBAC, unbalanced settle refused, forced settle needs a note", async () => {
      expect((await interpreter.get(`/orders/${onboarded.orderId}/termination-settlement`)).status).toBe(403);
      const view = await billing.ok("GET", `/orders/${onboarded.orderId}/termination-settlement`);
      expect(view.id).toBe(settlementId);
      expect(view.status).toBe("open");
      expect(view.can_settle).toBe(false);
      expect(view.final_invoice).toBeNull();
      expect(money(view.current.balance_gross)).toBe(money(accruedGross - paidGross));
      expect((await pm.get(`/orders/${onboarded.orderId}/termination-settlement`)).status).toBe(200);

      const unbalanced = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, {});
      expect(unbalanced.status, describeResult(unbalanced)).toBe(409);
      expect(unbalanced.body.error).toBe("termination_settlement_not_balanced");
      const noNote = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, { force: true });
      expect(noNote.status, describeResult(noNote)).toBe(422);
      const pmSettle = await pm.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, { force: true, note: "Abschreibung" });
      expect(pmSettle.status, describeResult(pmSettle)).toBe(403);
      const interpreterSettle = await interpreter.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, { force: true, note: "Abschreibung" });
      expect(interpreterSettle.status).toBe(403);
      expect((await interpreter.post(`/orders/${onboarded.orderId}/termination-settlement/final-invoice`)).status).toBe(403);

      const queue = listOf(await billing.ok("GET", "/invoices/termination-settlements?status=open"));
      expect(queue.some((item) => item.order_id === onboarded.orderId)).toBe(true);
      const perPatient = listOf(await billing.ok("GET", `/patients/${onboarded.patientId}/termination-settlements`));
      test.info().annotations.push({
        type: "observation",
        description: `patient settlements: ${JSON.stringify(perPatient.map((item) => [item.order_number, item.status, item.snapshot?.accrued_gross]))}`,
      });
      expect(perPatient.length, "one settlement per confirmed order").toBe(1);
    });

    await test.step("final invoice (idempotent), advance applied/released/re-applied, paid, settled", async () => {
      const created = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/final-invoice`);
      expect(created.status, describeResult(created)).toBe(201);
      expect(created.body.invoice_type).toBe("final");
      expect(created.body.status).toBe("draft");
      expect(created.body.idempotent_replay).toBe(false);
      expect(money(created.body.total_gross)).toBe(accruedGross);
      const replay = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/final-invoice`);
      expect(replay.status, describeResult(replay)).toBe(200);
      expect(replay.body.id).toBe(created.body.id);
      expect(replay.body.idempotent_replay).toBe(true);
      const finalId = created.body.id as string;

      const lines = await orderLines(billing, onboarded.orderId).catch(async () => orderLines(pm, onboarded.orderId));
      const statuses = Object.fromEntries(lines.map((line) => [line.id, line.status]));
      expect(statuses[deliveredLine]).toBe("invoiced");
      expect(statuses[flatLine]).toBe("invoiced");
      expect(statuses[lateLine.id]).toBe("invoiced");
      expect(statuses[cancelledLine]).toBe("cancelled");

      await releaseInvoice(billing, finalId);
      const applied = await billing.post(`/invoices/${finalId}/prepayment-allocations`, {
        request_id: randomUuid(),
        advance_invoice_id: advance.id,
        amount_gross: "142.80",
      });
      expect(applied.status, describeResult(applied)).toBe(200);
      expect(money(applied.body.balance_due)).toBe(money(accruedGross - paidGross));
      const allocationId = (applied.body.prepayment_allocations as any[])[0].id;
      const released = await billing.del(`/invoices/${finalId}/prepayment-allocations/${allocationId}`);
      expect(released.status, describeResult(released)).toBe(200);
      expect(money(released.body.balance_due)).toBe(accruedGross);
      const midway = await billing.ok("GET", `/orders/${onboarded.orderId}/termination-settlement`);
      expect(money(midway.current.invoiced_gross)).toBe(accruedGross);
      expect(money(midway.current.uninvoiced_gross)).toBe(0);
      expect(midway.can_settle).toBe(false);
      const reapplied = await billing.post(`/invoices/${finalId}/prepayment-allocations`, {
        request_id: randomUuid(),
        advance_invoice_id: advance.id,
        amount_gross: "142.80",
      });
      expect(reapplied.status, describeResult(reapplied)).toBe(200);
      const paid = await pay(billing, finalId, money(accruedGross - paidGross), "termination-final");
      expect(paid.status, describeResult(paid)).toBe(201);
      expect(paid.body.invoice.status).toBe("paid");

      const balanced = await billing.ok("GET", `/orders/${onboarded.orderId}/termination-settlement`);
      expect(money(balanced.current.balance_gross)).toBe(0);
      expect(money(balanced.current.uninvoiced_gross)).toBe(0);
      expect(money(balanced.current.paid_gross)).toBe(accruedGross);
      expect(balanced.can_settle).toBe(true);
      expect(balanced.final_invoice?.id).toBe(finalId);

      const settled = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, {
        note: "Schlussrechnung bezahlt",
      });
      expect(settled.status, describeResult(settled)).toBe(200);
      expect(settled.body.status).toBe("settled");
      expect(settled.body.settlement_forced).toBe(false);
      const twice = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, { note: "again" });
      expect(twice.status).toBe(409);
      const settledQueue = listOf(await billing.ok("GET", "/invoices/termination-settlements?status=settled"));
      expect(settledQueue.some((item) => item.order_id === onboarded.orderId)).toBe(true);

      const statement = await billing.ok("GET", `/patients/${onboarded.patientId}/account-statement`);
      expect.soft(money(statement.summary.invoice_due)).toBe(0);
      expect.soft(money(statement.summary.available_prepayment)).toBe(0);
      expect.soft(money(statement.summary.cash_paid)).toBe(accruedGross);
    });

    await test.step("(c) the detached repeat draft continues and needs a new contract", async () => {
      const openDrafts = await pm.ok("GET", `/patients/${onboarded.patientId}/repeat-intakes`);
      expect(
        (openDrafts as any[]).map((item) => item.id),
        "the detached repeat draft stays open",
      ).toEqual([draft.leadId]);
      // Starting a repeat intake again resumes the open draft.
      const repeat = await startRepeatIntake(pm, onboarded.patientId);
      expect(repeat.leadId).toBe(draft.leadId);
      expect(repeat.orderId).toBe(draft.orderId);
      expect(repeat.order.contract_id ?? null).toBeNull();
      const draftLead = await pm.ok("GET", `/leads/${draft.leadId}`);
      expect(draftLead.readiness.conversion_ready).toBe(false);
      const attachTerminated = await pm.post(`/orders/${repeat.orderId}/commercial-basis`, {
        contract_id: onboarded.contractId,
      });
      expect(attachTerminated.status, describeResult(attachTerminated)).toBe(422);
      expect(attachTerminated.body.message).toBe("Framework contract was terminated; create a new contract");

      const newContract = await pm.ok("POST", "/framework-contracts", {
        lead_id: repeat.leadId,
        status: "sent",
        client_reference: `lead-onboarding:${repeat.leadId}:framework`,
      });
      await pm.ok("POST", `/orders/${repeat.orderId}/commercial-basis`, { contract_id: newContract.id });
      const frameworkDoc = await generateCommercialDocument(pm, {
        templateId: "framework_contract",
        leadId: repeat.leadId,
        orderId: repeat.orderId,
        estimateGross: 0,
        lines: [],
      });
      expect(frameworkDoc.status, describeResult(frameworkDoc)).toBe(200);
      await pm.ok("POST", `/framework-contracts/${newContract.id}/status`, { status: "signed" });
      await pm.ok("POST", `/documents/${frameworkDoc.body.id}/mark-signed`, { compliance_kind: "framework_contract" });

      const result = await completeRepeatIntake(pm, {
        leadId: repeat.leadId,
        orderId: repeat.orderId,
        contractId: newContract.id,
      });
      expect(result.attach.status, describeResult(result.attach)).toBe(200);
      expect(result.lead.readiness.blocking_reasons).toEqual([]);
      expect(result.convert.status, describeResult(result.convert)).toBe(200);
      const ordinal = await orderSequenceFromSingleOrderPdf(pm, result.documents.single_order);
      expect(ordinal.ordinal, `new contract restarts numbering: ${ordinal.head}`).toBe(1);
      const contracts = listOf(await pm.ok("GET", `/framework-contracts?patient_id=${onboarded.patientId}`));
      expect(Object.fromEntries(contracts.map((contract) => [contract.id, contract.status]))).toEqual({
        [onboarded.contractId]: "terminated",
        [newContract.id]: "signed",
      });
    });
  });

  test("5b forced settlement of an unpaid termination requires a note and records the write-off", async ({
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const billing = await actorFor(request, scenario, "billing");
    const onboarded = await onboardNewPatient(pm, "writeoff", {
      lines: [{ description: "Dolmetscher Erstgespraech", quantity: 2, unit_price: 60, vat_rate: 19 }],
    });
    await pm.ok("POST", `/orders/${onboarded.orderId}/leistungen/${onboarded.lineIds[0]}/deliver`);
    const terminated = await pm.ok("POST", `/framework-contracts/${onboarded.contractId}/terminate`, {
      reason: "Patient nicht mehr erreichbar",
    });
    expect(terminated.settlements[0].settlement_status).toBe("open");
    expect(money(terminated.settlements[0].balance_gross)).toBe(142.8);

    const blank = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, {
      force: true,
      note: "  ",
    });
    expect(blank.status, describeResult(blank)).toBe(422);
    const forced = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/settle`, {
      force: true,
      note: "Forderung uneinbringlich, ausgebucht (Live-Test)",
    });
    expect(forced.status, describeResult(forced)).toBe(200);
    expect(forced.body.status).toBe("settled");
    expect(forced.body.settlement_forced).toBe(true);
    expect(money(forced.body.settled_balance_gross)).toBe(142.8);
    const late = await billing.post(`/orders/${onboarded.orderId}/termination-settlement/final-invoice`);
    expect(late.status, `final invoice after settlement: ${describeResult(late)}`).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// 6. Half-cent VAT: wizard estimate (Math.round, half-up) vs server quote
// ---------------------------------------------------------------------------

/** Same arithmetic as calculateServiceLineEstimate() in lead-wizard.tsx. */
function wizardEstimateGross(lines: ServiceLineInput[]) {
  let gross = 0;
  for (const line of lines) {
    const lineNet = Math.round(line.quantity * line.unit_price * 100) / 100;
    const lineVat = Math.round(lineNet * line.vat_rate) / 100;
    gross += Math.round((lineNet + lineVat) * 100) / 100;
  }
  return Math.round(gross * 100) / 100;
}

test.describe("business cycle (live API) - rounding", () => {
  test("6 quarter-hour interpreter pricing: wizard estimate and server quote agree", async ({ request }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const pm = await actorFor(request, scenario, "pm");
    const tag = uniqueTag("round");
    // 2.5 h x 95 EUR = 237.50 net; 19 % VAT = 45.125 -> half-up 45.13, half-even 45.12
    const lines: ServiceLineInput[] = [
      { description: "Dolmetscher 2,5 h", quantity: 2.5, unit_price: 95, vat_rate: 19 },
    ];
    const wizardGross = wizardEstimateGross(lines);
    expect(wizardGross).toBe(282.63);

    const lead = await pm.ok("POST", "/leads", {
      first_name: "Round",
      last_name: tag,
      email: `${tag}@example.com`,
      phone: `+49 30 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    });
    const contract = await pm.ok("POST", "/framework-contracts", { lead_id: lead.id, status: "sent" });
    const order = await pm.ok("POST", "/orders", {
      source_lead_id: lead.id,
      contract_id: contract.id,
      needs_description: tag,
    });
    await pm.ok("POST", `/orders/${order.id}/leistungen`, {
      ...lines[0],
      client_reference: `lead-wizard:${lead.id}:round-0`,
    });
    // The wizard (ensureCommercial) always writes its own estimate as total_estimated.
    await pm.ok("POST", `/orders/${order.id}/commercial-basis`, { total_estimated: wizardGross.toFixed(2) });
    const quote = await pm.ok("POST", `/orders/${order.id}/quotes`, {});
    test.info().annotations.push({
      type: "observation",
      description: `server quote vat=${quote.total_vat} gross=${quote.total_gross}; wizard estimate gross=${wizardGross}`,
    });
    // Commercial rounding (half away from zero) on the server: 45.125 -> 45.13.
    expect(money(quote.total_vat)).toBe(45.13);
    expect(money(quote.total_gross), "server quote and wizard estimate round VAT the same way").toBe(
      wizardGross,
    );

    // Next wizard save re-syncs total_estimated, then the user accepts the quote.
    await pm.ok("POST", `/orders/${order.id}/commercial-basis`, { total_estimated: wizardGross.toFixed(2) });
    const accept = await pm.post(`/quotes/${quote.id}/status`, { status: "accepted" });
    expect(accept.status, `accepting the quote after a wizard save: ${describeResult(accept)}`).toBe(200);
    expect(accept.body.status).toBe("accepted");
  });
});
