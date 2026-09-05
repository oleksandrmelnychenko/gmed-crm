import type { OrderOption, PatientOption } from "../model/types";
import { matchInvoicePatient } from "../model/patient-match";

// These fixtures are deliberately isolated from GMed's patient/invoice API.
// No credential, endpoint or browser flag can turn this adapter into a live connector.
export type DatevDemoInvoice = {
  id: string;
  source: "demo";
  number: string;
  supplier: string;
  recipient: string;
  date: string;
  dueDate: string;
  netCents: number;
  vatCents: number;
  grossCents: number;
  currency: "EUR";
  text: string;
  lines: { description: string; quantity: number; unitCents: number }[];
};

export type DatevDemoBinding = { patientId: string; orderId: string };
export type DatevBindingFilter = "all" | "linked" | "unlinked";

export const DATEV_DEMO_PATIENTS: PatientOption[] = [
  { id: "demo-patient-1", patient_id: "DEMO-PT-1001", first_name: "Alex", last_name: "Muster" },
  { id: "demo-patient-2", patient_id: "DEMO-PT-1002", first_name: "Mia", last_name: "Beispiel" },
];

export const DATEV_DEMO_ORDERS: OrderOption[] = [
  { id: "demo-order-1", order_number: "DEMO-O-1001", patient_id: "demo-patient-1", patient_pid: "DEMO-PT-1001", patient_name: "Alex Muster" },
  { id: "demo-order-2", order_number: "DEMO-O-1002", patient_id: "demo-patient-1", patient_pid: "DEMO-PT-1001", patient_name: "Alex Muster" },
  { id: "demo-order-3", order_number: "DEMO-O-1003", patient_id: "demo-patient-2", patient_pid: "DEMO-PT-1002", patient_name: "Mia Beispiel" },
];

export const DATEV_DEMO_INVOICES: DatevDemoInvoice[] = [
  {
    id: "demo-datev-001", source: "demo", number: "DEMO-2026-001",
    supplier: "Musterzentrum Nord", recipient: "Alex Muster",
    date: "2026-09-01", dueDate: "2026-09-15", currency: "EUR",
    netCents: 24000, vatCents: 4560, grossCents: 28560,
    text: "DEMO - keine echte Rechnung\nRechnungsempfänger: Alex Muster\nPatient-ID: DEMO-PT-1001\nRechnung DEMO-2026-001",
    lines: [{ description: "Beispielleistung A", quantity: 1, unitCents: 18000 }, { description: "Beispielleistung B", quantity: 2, unitCents: 3000 }],
  },
  {
    id: "demo-datev-002", source: "demo", number: "DEMO-2026-002",
    supplier: "Demo Labor West", recipient: "Mia Beispiel",
    date: "2026-09-02", dueDate: "2026-09-16", currency: "EUR",
    netCents: 8500, vatCents: 1615, grossCents: 10115,
    text: "DEMO - keine echte Rechnung\nRechnungsempfänger: Mia Beispiel\nRechnung DEMO-2026-002",
    lines: [{ description: "Beispielleistung C", quantity: 1, unitCents: 8500 }],
  },
  {
    id: "demo-datev-003", source: "demo", number: "DEMO-2026-003",
    supplier: "Musterpraxis Sued", recipient: "Sam Unbekannt",
    date: "2026-09-03", dueDate: "2026-09-17", currency: "EUR",
    netCents: 15000, vatCents: 2850, grossCents: 17850,
    text: "DEMO - keine echte Rechnung\nRechnungsempfänger: Sam Unbekannt\nRechnung DEMO-2026-003",
    lines: [{ description: "Beispielleistung D", quantity: 1, unitCents: 15000 }],
  },
];

export function suggestDemoPatient(invoice: DatevDemoInvoice): string {
  const match = matchInvoicePatient(invoice.text, DATEV_DEMO_PATIENTS);
  return match.status === "matched" ? match.patientId : "";
}

export function isValidDemoBinding(invoiceId: string, binding: DatevDemoBinding): boolean {
  return DATEV_DEMO_INVOICES.some((invoice) => invoice.id === invoiceId)
    && DATEV_DEMO_PATIENTS.some((patient) => patient.id === binding.patientId)
    && DATEV_DEMO_ORDERS.some((order) => order.id === binding.orderId && order.patient_id === binding.patientId);
}

export function filterDemoInvoices(search: string, filter: DatevBindingFilter, bindings: Record<string, DatevDemoBinding>): DatevDemoInvoice[] {
  const needle = search.trim().toLocaleLowerCase();
  return DATEV_DEMO_INVOICES.filter((invoice) => {
    const binding = bindings[invoice.id];
    const linked = binding !== undefined && isValidDemoBinding(invoice.id, binding);
    const patient = linked ? DATEV_DEMO_PATIENTS.find((candidate) => candidate.id === binding.patientId) : undefined;
    const haystack = [invoice.number, invoice.supplier, invoice.recipient, patient?.first_name, patient?.last_name, patient?.patient_id].join(" ").toLocaleLowerCase();
    return haystack.includes(needle) && (filter === "all" || (filter === "linked" ? linked : !linked));
  });
}

export function datevMoney(cents: number, lang: string): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function datevDate(date: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function demoDocumentUrl(invoice: DatevDemoInvoice, format: "pdf" | "png"): string {
  return `${import.meta.env.BASE_URL}demo/datev/${invoice.id}.${format}`;
}
