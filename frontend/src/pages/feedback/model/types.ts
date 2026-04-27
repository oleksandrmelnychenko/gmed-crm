export type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

export type PatientAppointmentOption = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  provider_name?: string | null;
  doctor_name?: string | null;
  status: string;
};

export type FeedbackFormState = {
  appointmentId: string;
  overallScore: string;
  patientManagerScore: string;
  interpreterScore: string;
  conciergeScore: string;
  treatmentScore: string;
  doctorScore: string;
  organizationScore: string;
  serviceScore: string;
  infrastructureScore: string;
  priceValueScore: string;
  treatmentSuccess: string;
  complicationReported: boolean;
  npsScore: string;
  comments: string;
  improvementNotes: string;
  internalNote: string;
};
