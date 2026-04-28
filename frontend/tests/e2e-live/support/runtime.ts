import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { REPO_ROOT } from "./process-state";

export function commandFor(command: string) {
  if (process.platform === "win32") {
    if (command === "cargo") return "cargo.exe";
    if (command === "npm") return "npm.cmd";
    if (command === "npx") return "npx.cmd";
  }
  return command;
}

export async function waitForHttp(url: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

export async function waitForTcp(host: string, port: number, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    const socket = new net.Socket();
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.connect(port, host, () => resolve());
      });
      socket.destroy();
      return;
    } catch (error) {
      lastError = error;
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error(
    `Timed out waiting for TCP ${host}:${port}: ${String(lastError)}`,
  );
}

export async function waitForPostgres(containerName: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      execFileSync(
        "docker",
        ["exec", containerName, "pg_isready", "-U", "gmed", "-d", "gmed_e2e"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error(
    `Timed out waiting for postgres in ${containerName}: ${String(lastError)}`,
  );
}

export function dockerStdout(args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

export function parseDockerPort(output: string) {
  const port = output.trim().split(":").at(-1);
  if (!port) {
    throw new Error(`Unexpected docker port output: ${output}`);
  }
  const parsed = Number.parseInt(port, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse docker port: ${output}`);
  }
  return parsed;
}

function cargoTargetDir() {
  const configured = process.env.CARGO_TARGET_DIR;
  if (!configured) return path.join(REPO_ROOT, "target");
  return path.isAbsolute(configured)
    ? configured
    : path.join(REPO_ROOT, configured);
}

export function backendExecutablePath() {
  return path.join(
    cargoTargetDir(),
    "debug",
    process.platform === "win32" ? "gmed-server.exe" : "gmed-server",
  );
}

export function stopProcessTree(pid: number) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

export function stopContainer(containerName: string) {
  if (!containerName) return;
  try {
    execFileSync("docker", ["rm", "-f", containerName], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // Container may already be gone.
  }
}

export function startDbContainer(containerName: string) {
  stopContainer(containerName);
  const containerId = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      "POSTGRES_USER=gmed",
      "-e",
      "POSTGRES_PASSWORD=gmed",
      "-e",
      "POSTGRES_DB=gmed_e2e",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const portOutput = dockerStdout(["port", containerId, "5432/tcp"]);
  return {
    containerName,
    port: parseDockerPort(portOutput),
  };
}

export function spawnLoggedProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
) {
  const executable = commandFor(command);
  const isWindowsCmd =
    process.platform === "win32" && executable.toLowerCase().endsWith(".cmd");
  const child = spawn(
    isWindowsCmd ? "cmd.exe" : executable,
    isWindowsCmd ? ["/d", "/s", "/c", executable, ...args] : args,
    {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.createWriteStream(logFile, { flags: "w" });
  const err = fs.createWriteStream(logFile, { flags: "a" });
  child.stdout?.pipe(out);
  child.stderr?.pipe(err);
  return child;
}
