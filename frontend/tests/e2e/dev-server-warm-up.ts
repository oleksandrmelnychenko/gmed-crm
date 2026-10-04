import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "@playwright/test";

/**
 * The Vite dev server compiles a module on its first request. At the start of
 * a run many workers ask for the same large lazy chunks at once (staff shell,
 * patient workspace, clinical tab), and on a busy machine the first render
 * took up to a minute, longer than the 10 s expect and even the 60 s test
 * timeout. The global setup loads every lazily imported app module once,
 * before any worker starts, so tests measure the app and not the compiler.
 */
const WARM_UP_TIMEOUT = 300_000;

const FRONTEND_DIR = fileURLToPath(new URL("../../", import.meta.url));
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const DYNAMIC_IMPORT = /import\(\s*["']([^"']+)["']\s*\)/g;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name) ? [full] : [];
  });
}

function resolveSource(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC_DIR, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // Packages are pre-bundled by Vite at start-up.
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/** Dev-server URLs of every module the app loads lazily (route pages, tabs, sheets). */
export function lazyAppModuleUrls(): string[] {
  const urls = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    for (const match of readFileSync(file, "utf8").matchAll(DYNAMIC_IMPORT)) {
      const resolved = resolveSource(file, match[1]);
      if (resolved && !TEST_FILE.test(resolved)) {
        urls.add(`/${path.relative(FRONTEND_DIR, resolved).split(path.sep).join("/")}`);
      }
    }
  }
  return [...urls].sort();
}

/**
 * Loads the app shell and every lazily imported app module once. Best effort:
 * it logs what it could not load and never throws.
 */
export async function warmUpDevServer(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.route("**/api/v1/**", (route) => route.fulfill({ status: 503, json: { error: "warm-up" } }));
    await page.routeWebSocket("**/api/**", (socket) => socket.close());
    // The login page loads the app shell's static module graph.
    await page.goto("/login", { timeout: WARM_UP_TIMEOUT });
    const failed = await page.evaluate(async ({ urls, budget }) => {
      const settled = Promise.allSettled(urls.map((url) => import(/* @vite-ignore */ url)));
      const results = await Promise.race([
        settled,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), budget)),
      ]);
      if (!results) return ["(warm-up budget exceeded)"];
      return urls.filter((_, index) => results[index].status === "rejected");
    }, { urls: lazyAppModuleUrls(), budget: WARM_UP_TIMEOUT - 30_000 });
    if (failed.length > 0) console.warn(`[warm-up] not loaded: ${failed.join(", ")}`);
  } catch (error) {
    console.warn(`[warm-up] skipped: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}
