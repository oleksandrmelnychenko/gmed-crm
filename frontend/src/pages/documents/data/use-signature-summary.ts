import { useCallback, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";
import { isSignaturePending, type SignatureStatus } from "./document-signature-api";

export type SignatureSummary = {
  document_id: string; status: SignatureStatus; test_mode: boolean; result_document_id: string | null;
};
const updatedEvent = "gmed:signature-updated";
export const refreshSignatureSummaries = () => window.dispatchEvent(new Event(updatedEvent));

function createStore() {
  const listeners = new Map<string, Set<() => void>>();
  const values = new Map<string, SignatureSummary>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  function schedule(delay = 100) {
    clearTimeout(timer);
    if (listeners.size) timer = setTimeout(() => { void load(); }, delay);
  }
  async function load() {
    const current = ++generation;
    const ids = [...listeners.keys()];
    if (!ids.length) return;
    try {
      if (!document.hidden) {
        const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, n) => ids.slice(n * 100, (n + 1) * 100));
        const rows = (await Promise.all(batches.map(batch => apiFetch<SignatureSummary[]>(`/document-signatures/statuses?ids=${batch.join(",")}`, { forceFresh: true })))).flat();
        if (generation !== current) return;
        for (const id of ids) {
          if (!listeners.has(id)) continue;
          const next = rows.find(row => row.document_id === id);
          if (JSON.stringify(values.get(id)) === JSON.stringify(next)) continue;
          if (next) values.set(id, next); else values.delete(id);
          listeners.get(id)?.forEach(notify => notify());
        }
      }
    } catch {
      // Retain the last known state; opening the workspace offers a fresh read.
    } finally {
      if (generation === current) schedule([...values.values()].some(row => isSignaturePending(row.status)) ? 15_000 : 60_000);
    }
  }
  const refresh = () => { generation++; schedule(); };
  return {
    get: (id: string) => values.get(id),
    subscribe(id: string, notify: () => void) {
      if (!listeners.size) {
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener(updatedEvent, refresh);
      }
      const subscribers = listeners.get(id) ?? new Set();
      subscribers.add(notify); listeners.set(id, subscribers); refresh();
      return () => {
        subscribers.delete(notify);
        if (!subscribers.size) { listeners.delete(id); values.delete(id); }
        if (!listeners.size) {
          generation++; clearTimeout(timer); values.clear();
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", refresh);
          window.removeEventListener(updatedEvent, refresh);
        }
      };
    },
  };
}
const stores = new Map<string, ReturnType<typeof createStore>>();
export function useSignatureSummary(userId: string | undefined, documentId: string | undefined) {
  if (userId && !stores.has(userId)) stores.set(userId, createStore());
  const store = userId ? stores.get(userId) : undefined;
  const subscribe = useCallback((notify: () => void) => store && documentId ? store.subscribe(documentId, notify) : () => {}, [store, documentId]);
  const snapshot = useCallback(() => documentId ? store?.get(documentId) : undefined, [store, documentId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
