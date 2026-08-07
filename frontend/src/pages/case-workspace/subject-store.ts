import { useSyncExternalStore } from "react";

import type { SpecializationItem } from "@/pages/providers/model/types";

/**
 * Case subject kind, published by the workspace provider for consumers that
 * render outside the provider. Unknown means "not loaded yet".
 */
export type CaseSubjectKind = "patient" | "lead" | "unknown";

const subjects = new Map<string, CaseSubjectKind>();
const specializations = new Map<string, readonly SpecializationItem[]>();
const selectedSpecializations = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function publishCaseSubject(caseId: string, kind: CaseSubjectKind) {
  if (subjects.get(caseId) === kind) return;
  subjects.set(caseId, kind);
  for (const listener of listeners) {
    listener();
  }
}

export function publishCaseSpecializations(
  caseId: string,
  items: readonly SpecializationItem[],
) {
  specializations.set(caseId, items);
  const selectedId = selectedSpecializations.get(caseId);
  if (selectedId && !items.some((item) => item.id === selectedId)) {
    selectedSpecializations.set(caseId, null);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function selectCaseSpecialization(
  caseId: string,
  specializationId: string | null,
) {
  if ((selectedSpecializations.get(caseId) ?? null) === specializationId) return;
  selectedSpecializations.set(caseId, specializationId);
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

const EMPTY_SPECIALIZATIONS: readonly SpecializationItem[] = [];

export function useCaseSpecializations(
  caseId: string | undefined,
): readonly SpecializationItem[] {
  return useSyncExternalStore(subscribe, () =>
    caseId ? (specializations.get(caseId) ?? EMPTY_SPECIALIZATIONS) : EMPTY_SPECIALIZATIONS,
  );
}

export function useSelectedCaseSpecialization(
  caseId: string | undefined,
): string | null {
  return useSyncExternalStore(subscribe, () =>
    caseId ? (selectedSpecializations.get(caseId) ?? null) : null,
  );
}
