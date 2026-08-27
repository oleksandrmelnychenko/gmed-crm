/**
 * Low-level fetch wrapper shared by all API modules.
 * Re-exports the existing apiFetch from @/lib/api and adds convenience helpers.
 */

import { apiFetch } from "@/lib/api";

type GetOptions = {
  signal?: AbortSignal;
};

/** GET shorthand */
export function get<T>(path: string, options: GetOptions = {}): Promise<T> {
  return apiFetch<T>(path, options);
}

/** POST with JSON body */
export function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
