import type { APIRequestContext, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  BACKEND_PORT,
  DB_CONTAINER_PREFIX,
  LOG_DIR,
  REPO_ROOT,
  STATE_FILE,
  type ProcessState,
} from "./process-state";
import {
  backendExecutablePath,
  dockerStdout,
  spawnLoggedProcess,
  startDbContainer,
  stopProcessTree,
  waitForHttp,
  waitForPostgres,
  waitForTcp,
} from "./runtime";

export type BootstrapScenario = {
  scenario: string;
  tag: string;
  credentials: {
    password: string;
    pm: {
      email: string;
      name: string;
      user_id: string;
    };
    ceo: {
      email: string;
      name: string;
      user_id: string;
    };
    assistant: {
      email: string;
      name: string;
      user_id: string;
    };
    billing: {
      email: string;
      name: string;
      user_id: string;
    };
    teamlead_interpreter: {
      email: string;
      name: string;
      user_id: string;
    };
    interpreter: {
      email: string;
      name: string;
      user_id: string;
    };
    patient: {
      email: string;
      name: string;
      user_id: string;
    };
    mfa_staff: {
      email: string;
      name: string;
      user_id: string;
    };
  };
  patient: {
    id: string;
    patient_id: string;
    name: string;
  };
  contract: {
    id: string;
    contract_number: string;
  };
  quote: {
    id: string;
    quote_number: string;
  };
  order: {
    id: string;
  };
  invoice: {
    id: string;
    invoice_number: string;
  };
  appointment: {
    id: string;
    title: string;
    date: string;
  };
  recurring_appointment: {
    id: string;
    title: string;
    series_id: string;
  };
  documents: {
    internal: {
      id: string;
      title: string;
    };
    released: {
      id: string;
      title: string;
      share_id: string;
    };
    provider_ready: {
      id: string;
      title: string;
    };
  };
  leads: {
    blocked: {
      id: string;
      name: string;
    };
    ready: {
      id: string;
      name: string;
    };
  };
  feedback: {
    id: string;
    comments: string;
  };
};

let cachedProcessState: ProcessState | null = null;

async function readProcessState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, "utf8");
    const state = JSON.parse(raw) as ProcessState;
    cachedProcessState = state;
    return state;
  } catch {
    if (cachedProcessState) {
      return cachedProcessState;
    }
    throw new Error(
      `Missing live Playwright process state at ${STATE_FILE}. Run the suite through playwright.live.config.ts.`,
    );
  }
}

async function writeProcessState(state: ProcessState) {
  await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  cachedProcessState = state;
}

function isContainerRunning(containerName: string) {
  if (!containerName) return false;
  try {
    return (
      dockerStdout(["inspect", "-f", "{{.State.Running}}", containerName]) === "true"
    );
  } catch {
    return false;
  }
}

async function ensureDatabaseHealthy(state: ProcessState) {
  if (state.dbProvisioner === "external") {
    return state;
  }

  if (isContainerRunning(state.dbContainerName)) {
    return state;
  }

  const db = startDbContainer(`${DB_CONTAINER_PREFIX}-${randomUUID().slice(0, 8)}`);
  await waitForTcp("127.0.0.1", db.port, 30_000);
  await waitForPostgres(db.containerName, 30_000);

  return {
    ...state,
    dbContainerName: db.containerName,
    dbProvisioner: "docker",
    dbUrl: `postgres://gmed:gmed@127.0.0.1:${db.port}/gmed_e2e?sslmode=disable`,
  };
}

async function ensureBackendHealthy(forceRestart = false) {
  let state = await readProcessState();

  if (!forceRestart) {
    try {
      const response = await fetch(`${state.backendUrl}/health`);
      if (response.ok) {
        return state;
      }
    } catch {
      // Fall through to restart.
    }
  }

  stopProcessTree(state.backendPid);
  state = await ensureDatabaseHealthy(state);
  const backend = spawnLoggedProcess(
    backendExecutablePath(),
    [],
    REPO_ROOT,
    {
      ...process.env,
      PORT: String(BACKEND_PORT),
      DATABASE_URL: state.dbUrl,
      JWT_SECRET: "gmed-e2e-jwt-secret-at-least-32-bytes!!",
      CORS_ORIGIN: state.frontendUrl,
      AUDIT_IP_SALT: "gmed-e2e-audit-salt-at-least-32-bytes!!",
      MESSAGE_ENCRYPTION_KEYS:
        "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ENABLE_E2E_SUPPORT: "1",
      E2E_SUPPORT_SECRET: state.secret,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    path.join(LOG_DIR, "backend.log"),
  );

  await waitForHttp(`${state.backendUrl}/health`, 90_000);
  state = {
    ...state,
    backendPid: backend.pid ?? 0,
  };
  await writeProcessState(state);
  return state;
}

export async function ensureLiveBackendHealthy(forceRestart = false) {
  return ensureBackendHealthy(forceRestart);
}

export type LiveApiClient = {
  backendUrl: string;
  headers: Record<string, string>;
};

export async function authenticateApiClient(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<LiveApiClient> {
  const state = await ensureBackendHealthy();
  const response = await request.post(
    `${state.backendUrl}/api/v1/auth/login`,
    { data: { email, password } },
  );
  if (!response.ok()) {
    throw new Error(
      `API login failed with ${response.status()} ${response.statusText()}: ${await response.text()}`,
    );
  }
  const body = (await response.json()) as
    | { access_token: string; refresh_token: string }
    | { status: string; message?: string };
  if ("status" in body) {
    throw new Error(body.message ?? `Unexpected login status: ${body.status}`);
  }
  return {
    backendUrl: state.backendUrl,
    headers: { Authorization: `Bearer ${body.access_token}` },
  };
}

export async function bootstrapFullSmokeScenario(
  request: APIRequestContext,
): Promise<BootstrapScenario> {
  let state = await ensureBackendHealthy();
  let response;
  try {
    response = await request.post(`${state.backendUrl}/api/v1/e2e/bootstrap/full-smoke`, {
      headers: {
        "x-e2e-secret": state.secret,
      },
    });
  } catch {
    state = await ensureBackendHealthy();
    response = await request.post(`${state.backendUrl}/api/v1/e2e/bootstrap/full-smoke`, {
      headers: {
        "x-e2e-secret": state.secret,
      },
    });
  }

  if (!response.ok()) {
    throw new Error(
      `E2E bootstrap failed with ${response.status()} ${response.statusText()}: ${await response.text()}`,
    );
  }
  await ensureBackendHealthy();
  return (await response.json()) as BootstrapScenario;
}

export async function loginViaUi(page: Page, email: string, password: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ensureBackendHealthy();
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    try {
      await page.waitForURL(/\/$/, { timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function loginViaApi(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const state = await ensureBackendHealthy();
      const response = await request.post(`${state.backendUrl}/api/v1/auth/login`, {
        data: { email, password },
      });

      if (!response.ok()) {
        throw new Error(
          `API login failed with ${response.status()} ${response.statusText()}: ${await response.text()}`,
        );
      }

      const result = (await response.json()) as
        | {
            access_token: string;
            refresh_token: string;
          }
        | {
            status: string;
            message?: string;
          };

      if ("status" in result) {
        throw new Error(result.message ?? `Unexpected login status: ${result.status}`);
      }

      await page.goto("/login");
      await page.evaluate(
        ({ accessToken, refreshToken }) => {
          window.localStorage.setItem("gmed_access_token", accessToken);
          window.localStorage.setItem("gmed_refresh_token", refreshToken);
        },
        {
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
        },
      );
      await page.goto("/");
      await page.waitForURL(/\/$/, { timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await page.waitForTimeout(1_000);
    }
  }

  throw lastError ?? new Error("API login failed.");
}

export async function bootstrapAndLogin(
  page: Page,
  request: APIRequestContext,
  role: "pm" | "assistant" | "billing" | "interpreter" | "patient",
) {
  const scenario = await bootstrapFullSmokeScenario(request);
  const credentials =
    role === "pm"
      ? scenario.credentials.pm
      : role === "assistant"
        ? scenario.credentials.assistant
        : role === "billing"
          ? scenario.credentials.billing
        : role === "interpreter"
          ? scenario.credentials.interpreter
          : scenario.credentials.patient;

  await loginViaApi(page, request, credentials.email, scenario.credentials.password);
  return scenario;
}

export async function setGermanLanguage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("gmed_lang", "de");
  });
}
