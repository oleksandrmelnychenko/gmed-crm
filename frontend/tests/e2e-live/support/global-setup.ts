import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  BACKEND_PORT,
  DB_CONTAINER_PREFIX,
  E2E_SUPPORT_SECRET,
  FRONTEND_PORT,
  FRONTEND_ROOT,
  LOG_DIR,
  REPO_ROOT,
  STATE_FILE,
  type ProcessState,
} from "./process-state";
import {
  backendExecutablePath,
  commandFor,
  spawnLoggedProcess,
  startDbContainer,
  stopProcessTree,
  waitForHttp,
  waitForPostgres,
  waitForTcp,
} from "./runtime";

const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

function resolveExternalDatabaseUrl() {
  const value = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildBackendBinary(logFile: string) {
  execFileSync(
    commandFor("cargo"),
    ["build", "-p", "gmed-server"],
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", fs.openSync(logFile, "w"), fs.openSync(logFile, "a")],
      windowsHide: true,
    },
  );
}

async function writeStateFile(state: ProcessState) {
  await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export default async function globalSetup() {
  await fsp.rm(LOG_DIR, { recursive: true, force: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });

  const externalDbUrl = resolveExternalDatabaseUrl();
  const db = externalDbUrl
    ? null
    : startDbContainer(`${DB_CONTAINER_PREFIX}-${randomUUID().slice(0, 8)}`);
  const dbUrl =
    externalDbUrl ??
    `postgres://gmed:gmed@127.0.0.1:${db!.port}/gmed_e2e?sslmode=disable`;

  if (db) {
    await waitForTcp("127.0.0.1", db.port, 30_000);
    await waitForPostgres(db.containerName, 30_000);
  }

  buildBackendBinary(path.join(LOG_DIR, "backend-build.log"));

  let backend = spawnLoggedProcess(
    backendExecutablePath(),
    [],
    REPO_ROOT,
    {
      ...process.env,
      PORT: String(BACKEND_PORT),
      DATABASE_URL: dbUrl,
      JWT_SECRET: "gmed-e2e-jwt-secret-at-least-32-bytes!!",
      CORS_ORIGIN: FRONTEND_URL,
      AUDIT_IP_SALT: "gmed-e2e-audit-salt-at-least-32-bytes!!",
      MESSAGE_ENCRYPTION_KEYS:
        "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ENABLE_E2E_SUPPORT: "1",
      E2E_SUPPORT_SECRET,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    path.join(LOG_DIR, "backend.log"),
  );

  async function waitForBackend(attempt: number): Promise<void> {
    try {
      await waitForHttp(`${BACKEND_URL}/health`, 90_000);
      return;
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }
      stopProcessTree(backend.pid ?? 0);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      backend = spawnLoggedProcess(
        backendExecutablePath(),
        [],
        REPO_ROOT,
        {
          ...process.env,
          PORT: String(BACKEND_PORT),
          DATABASE_URL: dbUrl,
          JWT_SECRET: "gmed-e2e-jwt-secret-at-least-32-bytes!!",
          CORS_ORIGIN: FRONTEND_URL,
          AUDIT_IP_SALT: "gmed-e2e-audit-salt-at-least-32-bytes!!",
          MESSAGE_ENCRYPTION_KEYS:
            "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          ENABLE_E2E_SUPPORT: "1",
          E2E_SUPPORT_SECRET,
          RUST_LOG: process.env.RUST_LOG ?? "warn",
        },
        path.join(LOG_DIR, "backend.log"),
      );
      return waitForBackend(attempt + 1);
    }
  }

  try {
    await waitForBackend(0);
  } catch (backendStartError) {
    stopProcessTree(backend.pid ?? 0);
    throw backendStartError instanceof Error
      ? backendStartError
      : new Error(`Failed to start backend: ${String(backendStartError)}`);
  }

  const frontend = spawnLoggedProcess(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(FRONTEND_PORT)],
    FRONTEND_ROOT,
    {
      ...process.env,
      VITE_PROXY_TARGET: BACKEND_URL,
    },
    path.join(LOG_DIR, "frontend.log"),
  );

  await waitForHttp(`${FRONTEND_URL}/login`, 120_000);

  await writeStateFile({
    backendPid: backend.pid ?? 0,
    frontendPid: frontend.pid ?? 0,
    dbContainerName: db?.containerName ?? "",
    dbProvisioner: db ? "docker" : "external",
    dbUrl,
    backendUrl: BACKEND_URL,
    frontendUrl: FRONTEND_URL,
    secret: E2E_SUPPORT_SECRET,
  });
}
