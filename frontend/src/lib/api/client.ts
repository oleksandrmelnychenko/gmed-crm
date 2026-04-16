/**
 * Low-level fetch wrapper shared by all API modules.
 * Re-exports the existing apiFetch from @/lib/api and adds convenience helpers.
 */

import { apiFetch, buildApiUrl, getAccessToken } from "@/lib/api";

export { apiFetch };

/** GET shorthand */
export function get<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

/** POST with JSON body */
export function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** POST without body (fire-and-forget style actions) */
export function postNoBody(path: string): Promise<void> {
  return apiFetch<void>(path, { method: "POST" });
}

/** POST multipart/form-data (file upload) */
export async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Do NOT set Content-Type — browser sets it with boundary

  const res = await fetch(buildApiUrl(path), {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    let body: { message?: string; error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new Error(body?.message ?? body?.error ?? `${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
