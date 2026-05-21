export type OverviewStats = {
  patients: number;
  leads: number;
  orders: number;
  appointments: number;
  cases: number;
  users: number;
};

export type MonthlyEntry = { month: string; count: number };

export type UpcomingAppointment = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  type?: string | null;
  status: string;
  location?: string | null;
  patient_name: string;
};

export type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  patient_id?: string | null;
  order_id?: string | null;
  appointment_id?: string | null;
  due_date?: string | null;
  priority: string;
  status: string;
};

export type PatientSummary = {
  id: string;
  is_active: boolean;
  insurance_type?: string | null;
  created_at: string;
};

export type DemographicsPayload = {
  period: string;
  total: number;
  by_country: Array<{ country: string; count: number }>;
  by_age_group: Array<{ group: string; count: number }>;
  by_gender: Record<string, number>;
  by_insurance: Record<string, number>;
  top_languages: Array<{ language: string; count: number }>;
};

export type ClinicalPayload = {
  period: string;
  top_case_reasons: Array<{ reason: string; count: number }>;
  cases_by_status: Record<string, number>;
  service_mix: Array<{ service_type: string; item_count: number; gross_total: string }>;
  avg_case_duration_days: number;
};

export type OperationsPayload = {
  period: string;
  appointments_by_status: Record<string, number>;
  appointments_heatmap: Array<{ dow: number; hour: number; count: number }>;
  orders_by_phase_valued: Array<{ phase: string; count: number; value_eur: string }>;
  top_providers: Array<{
    id: string;
    name: string;
    provider_type?: string | null;
    taxonomy_node_id?: string | null;
    taxonomy_node_code?: string | null;
    taxonomy_node_name_de?: string | null;
    taxonomy_node_name_ru?: string | null;
    patient_count: number;
    appointment_count: number;
  }>;
};

export type Period = "7d" | "30d" | "90d" | "12m" | "all";

export const PERIOD_OPTIONS: Period[] = ["7d", "30d", "90d", "12m", "all"];
