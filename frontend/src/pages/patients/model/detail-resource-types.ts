export type PatientVitalMeasurement = {
  id: string;
  measured_at: string;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  heart_rate?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  bmi?: number | null;
  notes?: string | null;
  recorded_by?: string | null;
  recorded_by_name?: string | null;
  created_at: string;
};

export type PatientCardEntry = {
  id: string;
  entry_date: string;
  category: string;
  source?: string | null;
  content: string;
  author_id: string;
  author_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientMedicalOrder = {
  id: string;
  order_date: string;
  order_type: string;
  title: string;
  instructions: string;
  status: string;
  due_date?: string | null;
  source?: string | null;
  ordered_by: string;
  ordered_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientRiskScore = {
  id: string;
  computed_at: string;
  score_type: string;
  score_value: number;
  scale_max?: number | null;
  interpretation?: string | null;
  source?: string | null;
  inputs?: Record<string, unknown> | null;
  recorded_by: string;
  recorded_by_name?: string | null;
  created_at: string;
};
