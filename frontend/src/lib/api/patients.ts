import { get, post } from "./client";
import type {
  Patient,
  CreatePatientBody,
  UpdatePatientBody,
  PatientAssignment,
} from "./types";

export function fetchPatients(search?: string): Promise<Patient[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return get<Patient[]>(`/patients${qs}`);
}

export function createPatient(body: CreatePatientBody): Promise<unknown> {
  return post("/patients", body);
}

export function updatePatient(id: string, body: UpdatePatientBody): Promise<unknown> {
  return post(`/patients/${id}/update`, body);
}

export function fetchPatientAssignments(patientId: string): Promise<PatientAssignment[]> {
  return get<PatientAssignment[]>(`/patients/${patientId}/assignments`);
}

export function assignPatient(patientId: string, userId: string): Promise<unknown> {
  return post(`/patients/${patientId}/assign`, { user_id: userId });
}
