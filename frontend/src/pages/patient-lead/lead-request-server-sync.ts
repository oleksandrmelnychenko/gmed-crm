import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { mergeSavedDraft } from "./lead-request-autosave";

// Both parents edit one request at once (owner decision 2026-10-23): the
// cabinet re-reads the request when the tab is shown again, the window gets
// the focus or the realtime event `lead.portal_updated` arrives. A form takes
// the newer server values of the fields the user has not touched; a field the
// user is typing in keeps the draft and says, at the field, that it changed.

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What a newer server state of a form means for its draft: the fields that
 * changed on the server since the last known state (`saved`), and of those
 * the ones the user is editing with another value (`conflicts`). A field the
 * user typed to the very value the server now has is no conflict.
 */
export function serverDraftChanges<Draft extends object>(
  saved: Draft,
  incoming: Draft,
  current: Draft,
): { changed: string[]; conflicts: string[] } {
  const changed: string[] = [];
  const conflicts: string[] = [];
  for (const field of Object.keys(incoming) as Array<keyof Draft>) {
    if (same(incoming[field], saved[field])) continue;
    changed.push(String(field));
    if (!same(current[field], saved[field]) && !same(current[field], incoming[field])) conflicts.push(String(field));
  }
  return { changed, conflicts };
}

/** The fields (their element ids) whose server value changed under the user's typing. */
type ConflictRegistry = {
  conflicts: ReadonlySet<string>;
  /** The neutral notice shown at such a field. */
  notice: string;
  add: (ids: readonly string[]) => void;
  remove: (ids: readonly string[]) => void;
};

export const ServerConflictContext = createContext<ConflictRegistry | null>(null);

/** The registry of a request view; provided with {@link ServerConflictContext}. */
export function useServerConflictRegistry(notice: string): ConflictRegistry {
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(() => new Set());
  const add = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setConflicts((current) => (ids.every((id) => current.has(id)) ? current : new Set([...current, ...ids])));
  }, []);
  const remove = useCallback((ids: readonly string[]) => {
    setConflicts((current) => {
      if (!ids.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);
  return useMemo(() => ({ conflicts, notice, add, remove }), [conflicts, notice, add, remove]);
}

/** The notice of the field with this element id, while its server value changed under the typing. */
export function useServerConflictNotice(id: string): string | undefined {
  const registry = useContext(ServerConflictContext);
  return registry?.conflicts.has(id) ? registry.notice : undefined;
}

/** Takes the notice of the field with this element id away: the person looked at the field (focused it). */
export function useServerConflictDismiss(id: string): () => void {
  const registry = useContext(ServerConflictContext);
  const remove = registry?.remove;
  return useCallback(() => remove?.([id]), [remove, id]);
}

/**
 * Keeps an autosaving form in step with newer server data of its section.
 * `incoming` is the draft built from the request as it is now; `savedRef` the
 * last server state the form knows (its autosave baseline). The notice of a
 * conflicting field goes once the user changes that field again.
 */
export function useServerDraftSync<Draft extends object>({
  incoming,
  draft,
  savedRef,
  queuedDraftRef,
  setDraft,
  idOf,
  enabled = true,
}: {
  incoming: Draft;
  draft: Draft;
  savedRef: MutableRefObject<Draft>;
  queuedDraftRef: MutableRefObject<Draft>;
  setDraft: Dispatch<SetStateAction<Draft>>;
  idOf: (field: string) => string;
  enabled?: boolean;
}) {
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const report = useServerConflicts(draft, idOf);
  const key = JSON.stringify(incoming);

  useEffect(() => {
    if (!enabled) return;
    const next = incomingRef.current;
    const saved = savedRef.current;
    const { changed, conflicts } = serverDraftChanges(saved, next, draftRef.current);
    if (changed.length === 0) return;
    savedRef.current = next;
    queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, saved, next, saved, changed);
    setDraft((current) => mergeSavedDraft(current, saved, next, saved, changed));
    report(conflicts);
    // `key` stands for `incoming`; the refs are stable.
  }, [key, enabled, report, savedRef, queuedDraftRef, setDraft]);
}

/**
 * The notices of a form whose own server sync found conflicts (`report`
 * them with the field names): each goes once the user changes the field.
 */
export function useServerConflicts<Draft extends object>(
  draft: Draft,
  idOf: (field: string) => string,
): (fields: readonly string[]) => void {
  const registry = useContext(ServerConflictContext);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const idOfRef = useRef(idOf);
  idOfRef.current = idOf;
  // The draft value each conflicting field had when the notice came up.
  const conflictValues = useRef(new Map<string, unknown>());
  const add = registry?.add;
  const remove = registry?.remove;

  const report = useCallback((fields: readonly string[]) => {
    if (fields.length === 0) return;
    for (const field of fields) conflictValues.current.set(field, draftRef.current[field as keyof Draft]);
    add?.(fields.map((field) => idOfRef.current(field)));
  }, [add]);

  // The form left the screen (another step was opened): its notices go with it, as the
  // first step's do (QA 2026-10-24, B-7); a newer server change reports them afresh.
  useEffect(() => {
    const values = conflictValues.current;
    return () => {
      const ids = Array.from(values.keys(), (field) => idOfRef.current(field));
      values.clear();
      if (ids.length > 0) remove?.(ids);
    };
  }, [remove]);

  useEffect(() => {
    if (conflictValues.current.size === 0) return;
    const edited: string[] = [];
    for (const [field, value] of conflictValues.current) {
      if (!same(draft[field as keyof Draft], value)) edited.push(field);
    }
    if (edited.length === 0) return;
    for (const field of edited) conflictValues.current.delete(field);
    remove?.(edited.map((field) => idOfRef.current(field)));
  }, [draft, remove]);

  return report;
}
