import { useSyncExternalStore } from "react";

export type PortalPatient = { id: string; name: string; patient_number: string };
type Selection = { userId: string; patientId: string };
const STORAGE_KEY = "gmed-portal-patient";
const listeners = new Set<() => void>();

function readSelection(): Selection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Selection | null;
    return value && typeof value.userId === "string" && typeof value.patientId === "string" ? value : null;
  } catch {
    return null;
  }
}

let selection = readSelection();

export function getPortalPatientId(userId: string | null | undefined): string | null {
  return userId && selection?.userId === userId ? selection.patientId : null;
}

/** Tab-local: another tab can work with a different child at the same time. */
export function selectPortalPatient(userId: string, patientId: string | null) {
  selection = patientId ? { userId, patientId } : null;
  try {
    if (selection) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Keep the selection in memory when storage is unavailable. */ }
  listeners.forEach((listener) => listener());
}

/** Keep a valid explicit choice; only a single linked patient is selected automatically. */
export function reconcilePortalPatientSelection(user: { id: string; role: string; patients?: PortalPatient[] }) {
  const patients = user.role === "patient" ? user.patients ?? [] : [];
  const previous = getPortalPatientId(user.id);
  const next = patients.some((patient) => patient.id === previous)
    ? previous : patients.length === 1 ? patients[0].id : null;
  selectPortalPatient(user.id, next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePortalPatientId(userId: string | null | undefined) {
  return useSyncExternalStore(subscribe, () => getPortalPatientId(userId), () => null);
}
