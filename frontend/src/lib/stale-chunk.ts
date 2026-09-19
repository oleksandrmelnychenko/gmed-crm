/**
 * After a deploy the hashed chunk files of the previous build disappear, so an
 * open tab that lazily imports a page or a dialog gets a 404 served as HTML.
 * The only sensible recovery is a one-time reload of the same route.
 */
const STALE_CHUNK_RELOAD_KEY = "gmed:stale-chunk-reload";
const STALE_CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to load module script/i,
  /MIME type.*module script/i,
  /ChunkLoadError/i,
  /Loading chunk/i,
  /Unable to preload CSS/i,
  /text\/html/i,
];

export function isStaleChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return STALE_CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function reloadOnceForStaleChunk(error: unknown): boolean {
  if (!isStaleChunkLoadError(error) || typeof window === "undefined") {
    return false;
  }

  const routeKey = `${window.location.pathname}${window.location.search}`;
  try {
    if (window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) === routeKey) {
      return false;
    }
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, routeKey);
  } catch {
    // Session storage can be unavailable in hardened browsers; a reload is still the right recovery.
  }

  window.location.reload();
  return true;
}

/**
 * Catches chunk failures that never reach a route error boundary: lazy dialogs
 * inside an already rendered page, Vite's own preload errors and rejected
 * dynamic imports awaited outside React rendering.
 */
export function installStaleChunkRecovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForStaleChunk((event as Event & { payload?: unknown }).payload)) {
      event.preventDefault();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (reloadOnceForStaleChunk(event.reason)) {
      event.preventDefault();
    }
  });
}
