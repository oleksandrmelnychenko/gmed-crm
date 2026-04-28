import { useCallback, useEffect, useMemo, useState } from "react";

import { getAccessToken } from "@/lib/api";

const ACCESS_TOKEN_KEY = "gmed_access_token";
const STORAGE_PREFIX = "gmed:secure";

type Wrapper<T> = {
  v: number;
  d: T;
};

function decodeJwtSub(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function currentUserScope(): string {
  return decodeJwtSub(getAccessToken()) ?? "anon";
}

function buildKey(scope: string, userId: string, schemaVersion: number) {
  return `${STORAGE_PREFIX}:${userId}:v${schemaVersion}:${scope}`;
}

function readSnapshot<T>(
  storageKey: string,
  schemaVersion: number,
  validate?: (value: unknown) => value is T,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wrapper<unknown>;
    if (!parsed || typeof parsed !== "object" || parsed.v !== schemaVersion) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    if (validate && !validate(parsed.d)) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.d as T;
  } catch {
    return null;
  }
}

function writeSnapshot<T>(storageKey: string, schemaVersion: number, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ v: schemaVersion, d: value } satisfies Wrapper<T>),
    );
  } catch {
    // quota exceeded or storage disabled — silent
  }
}

export type SecurePersistedOptions<T> = {
  /** Bump when the shape changes; old data is dropped. */
  schemaVersion: number;
  /**
   * Hook to redact sensitive fields before persisting.
   * Return the stripped value (e.g. drop free-text search/email).
   */
  redact?: (value: T) => T;
  /** Type-guard to validate shape of stored data on read. */
  validate?: (value: unknown) => value is T;
};

/**
 * Per-user, schema-versioned localStorage state.
 *
 * - Key is namespaced with the current authenticated user id (decoded from
 *   the access token), so switching accounts on the same machine never
 *   surfaces another user's filters.
 * - Schema-versioned wrapper drops mismatched payloads on read.
 * - Optional `redact` strips sensitive fields before write (e.g. free-text
 *   search that may contain PII).
 * - Stored data is best-effort cache — never trust it as authoritative.
 */
export function useSecurePersistedState<T>(
  scopeKey: string,
  initial: T,
  options: SecurePersistedOptions<T>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const { schemaVersion, redact, validate } = options;
  const [userScope, setUserScope] = useState(() => currentUserScope());
  const storageKey = useMemo(
    () => buildKey(scopeKey, userScope, schemaVersion),
    [scopeKey, schemaVersion, userScope],
  );

  const [state, setState] = useState<T>(() => {
    const stored = readSnapshot<T>(storageKey, schemaVersion, validate);
    return stored ?? initial;
  });

  useEffect(() => {
    const valueToPersist = redact ? redact(state) : state;
    writeSnapshot(storageKey, schemaVersion, valueToPersist);
  }, [state, storageKey, schemaVersion, redact]);

  // Re-hydrate when the user changes (e.g. logout + login on same tab).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: StorageEvent) => {
      if (event.key !== ACCESS_TOKEN_KEY) return;
      const nextScope = currentUserScope();
      if (nextScope === userScope) return;
      setUserScope(nextScope);
      const nextKey = buildKey(scopeKey, nextScope, schemaVersion);
      const stored = readSnapshot<T>(nextKey, schemaVersion, validate);
      setState(stored ?? initial);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [initial, scopeKey, schemaVersion, userScope, validate]);

  const update = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => (typeof value === "function" ? (value as (p: T) => T)(prev) : value));
  }, []);

  return [state, update];
}

/** Wipe every securely persisted entry — call on explicit logout. */
export function clearSecurePersistedState() {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(`${STORAGE_PREFIX}:`)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}
