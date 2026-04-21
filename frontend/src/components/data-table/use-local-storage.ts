import { useCallback, useEffect, useRef, useState } from "react";

type Serializer<T> = {
  parse: (raw: string) => T;
  stringify: (value: T) => string;
};

const defaultSerializer = <T>(): Serializer<T> => ({
  parse: (raw: string) => JSON.parse(raw) as T,
  stringify: (value: T) => JSON.stringify(value),
});

function readFromStorage<T>(key: string, fallback: T, serializer: Serializer<T>): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return serializer.parse(raw);
  } catch {
    return fallback;
  }
}

export function useLocalStorage<T>(
  key: string,
  initial: T,
  serializer?: Serializer<T>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const serializerRef = useRef(serializer ?? defaultSerializer<T>());
  const [state, setState] = useState<T>(() =>
    readFromStorage(key, initial, serializerRef.current),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serializerRef.current.stringify(state));
    } catch {
      /* quota exceeded or access denied; silent */
    }
  }, [key, state]);

  const update = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => (typeof value === "function" ? (value as (p: T) => T)(prev) : value));
  }, []);

  return [state, update];
}

export function useVersionedLocalStorage<T>(
  key: string,
  initial: T,
  schemaVersion: number,
): [T, (value: T | ((prev: T) => T)) => void] {
  type Wrapper = { v: number; d: T };
  const serializer: Serializer<T> = {
    parse: (raw) => {
      const parsed = JSON.parse(raw) as Wrapper;
      if (!parsed || typeof parsed !== "object" || parsed.v !== schemaVersion) {
        return initial;
      }
      return parsed.d;
    },
    stringify: (value) => JSON.stringify({ v: schemaVersion, d: value } satisfies Wrapper),
  };
  return useLocalStorage(key, initial, serializer);
}
