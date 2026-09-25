import type { Lang, Translations } from "@/lib/i18n";
import { type Actor } from "@/lib/permissions";
import { canViewPatientAssignmentsSurface, canViewPatientCareHistorySurface, canViewPatientClinicalProfile, canViewPatientContractsSurface, canViewPatientDocumentsSurface, canViewPatientFinanceSurface, canViewPatientInvoicesSurface, canViewPatientOperationalSurface } from "./detail-model";

export type PatientNavigationItem = { key: string; label: string; group: string; groupLabel: string };

export function patientWorkspaceNavigation(actor: Actor, lang: Lang, t: Translations): PatientNavigationItem[] {
  const operational = canViewPatientOperationalSurface(actor);
  const care = canViewPatientCareHistorySurface(actor);
  const de = lang === "de";
  const groups: { key: string; label: string; items: [key: string, label: string, visible: boolean][] }[] = [
    { key: "patient", label: de ? "Patient" : "Пациент", items: [
      ["profile", t.patients_profile, true],
      ["relations", t.patients_relations, operational],
      ["documents", t.documents_title, canViewPatientDocumentsSurface(actor)],
    ] },
    { key: "medicine", label: de ? "Medizin" : "Медицина", items: [
      ["clinical", t.uiText.patients_diagnoses_medications ?? (de ? "Medizinisches Profil" : "Медицинская карта"), canViewPatientClinicalProfile(actor)],
      // Temporarily hidden from the patient menu (2026-09-21); the tab itself
      // stays reachable by URL for the CEO until the feature is re-enabled.
      // ["medication-ai", de ? "KI-Medikationsanalyse" : "AI-анализ медикаментов", actorRole(actor) === "ceo"],
      ["appointments", t.appointments_title, care],
    ] },
    { key: "coordination", label: de ? "Betreuung" : "Сопровождение", items: [
      ["orders", t.orders_title, care],
      ["workflow", t.patients_workflow, operational],
      ["curators", t.patients_assign_owner, canViewPatientAssignmentsSurface(actor)],
      ["timeline", t.patients_timeline, care],
    ] },
    { key: "finance", label: de ? "Finanzen" : "Финансы", items: [
      ["finance", de ? "Übersicht nach Zeitraum" : "Обзор по периодам", canViewPatientFinanceSurface(actor)],
      ["billing", de ? "Patientenabrechnung" : "Выставление пациенту", canViewPatientInvoicesSurface(actor)],
      ["invoices", t.invoices_title, canViewPatientInvoicesSurface(actor)],
      ["contracts", t.contracts_title, canViewPatientContractsSurface(actor)],
    ] },
  ];
  return groups.flatMap(group => group.items
    .filter(([, , visible]) => visible)
    .map(([key, label]) => ({ key, label, group: group.key, groupLabel: group.label })));
}
