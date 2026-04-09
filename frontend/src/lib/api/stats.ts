import { get } from "./client";
import type {
  OverviewStats,
  LeadsStats,
  MonthlyEntry,
  UpcomingAppointment,
  StatusCount,
} from "./types";

export function fetchOverviewStats(): Promise<OverviewStats> {
  return get<OverviewStats>("/stats/overview");
}

export function fetchLeadsStats(): Promise<LeadsStats> {
  return get<LeadsStats>("/stats/leads");
}

export function fetchLeadsMonthly(): Promise<MonthlyEntry[]> {
  return get<MonthlyEntry[]>("/stats/leads/monthly");
}

export function fetchLeadsByStatus(): Promise<StatusCount[]> {
  return get<StatusCount[]>("/stats/leads/by-status");
}

export function fetchUpcomingAppointments(): Promise<UpcomingAppointment[]> {
  return get<UpcomingAppointment[]>("/stats/appointments/upcoming");
}
