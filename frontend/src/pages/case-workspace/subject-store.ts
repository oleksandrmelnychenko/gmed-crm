import { useSyncExternalStore } from "react";

/**
 * Case subject kind, published by the workspace provider and consumed by the
 * app-shell nav rail (which renders outside the provider). Lead-backed cases
 * hide the Patientenakte group; unknown means "not loaded yet".
 */
export type CaseSubjectKind = "patient" | "lead" | "unknown";

const subjects = new Map<string, CaseSubjectKind>();
const listeners = new Set<() => void>();

export function publishCaseSubject(caseId: string, kind: CaseSubjectKind) {
  if (subjects.get(caseId) === kind) return;
  subjects.set(caseId, kind);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCaseSubjectKind(caseId: string | undefined): CaseSubjectKind {
  return useSyncExternalStore(subscribe, () =>
    caseId ? (subjects.get(caseId) ?? "unknown") : "unknown",
  );
}
