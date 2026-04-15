import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FRONTEND_ROOT = path.resolve(__dirname, "../../..");
export const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
export const STATE_FILE = path.join(FRONTEND_ROOT, ".playwright-live-state.json");
export const LOG_DIR = path.join(FRONTEND_ROOT, "test-results", "live");

export const DB_CONTAINER_PREFIX = "gmed-e2e-postgres";
export const BACKEND_PORT = 3300;
export const FRONTEND_PORT = 4174;
export const E2E_SUPPORT_SECRET = "gmed-e2e-support-secret";

export type ProcessState = {
  backendPid: number;
  frontendPid: number;
  dbContainerName: string;
  dbProvisioner: "docker" | "external";
  dbUrl: string;
  backendUrl: string;
  frontendUrl: string;
  secret: string;
};
