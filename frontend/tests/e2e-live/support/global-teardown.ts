import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";

import { STATE_FILE, type ProcessState } from "./process-state";

async function readState(): Promise<ProcessState | null> {
  try {
    const raw = await fsp.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as ProcessState;
  } catch {
    return null;
  }
}

function killProcessTree(pid: number) {
  if (!pid) return;

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    }

    process.kill(-pid, "SIGTERM");
  } catch {
    // Process may already be gone.
  }
}

function stopContainer(containerName: string) {
  try {
    execFileSync("docker", ["stop", containerName], { stdio: "ignore" });
  } catch {
    // Container may already be gone.
  }
}

export default async function globalTeardown() {
  const state = await readState();
  if (!state) {
    return;
  }

  killProcessTree(state.frontendPid);
  killProcessTree(state.backendPid);
  if (state.dbProvisioner === "docker") {
    stopContainer(state.dbContainerName);
  }

  await fsp.rm(STATE_FILE, { force: true });
}
