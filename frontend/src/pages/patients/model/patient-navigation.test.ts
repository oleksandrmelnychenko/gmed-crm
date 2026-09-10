import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { patientWorkspaceNavigation } from "./patient-navigation";
import { canViewPatientFinanceSurface, normalizePatientDetailTab } from "./detail-model";

describe("patient navigation", () => {
  it.each(["ru", "de"] as const)("groups all sections once and keeps the period overview first in finance (%s)", lang => {
    const items = patientWorkspaceNavigation("ceo", lang, t(lang));
    expect([...new Set(items.map(item => item.group))]).toEqual(["patient", "medicine", "coordination", "finance"]);
    expect(new Set(items.map(item => item.key)).size).toBe(items.length);
    expect(items.filter(item => item.group === "finance").map(item => item.key)).toEqual(["finance", "invoices", "contracts"]);
    expect(items.every(item => item.label && item.groupLabel)).toBe(true);
  });
  it.each(["ceo", "ceo_assistant", "patient_manager", "billing", "it_admin", "doctor", "lab", "partner", undefined])("matches financial API access for %s, including direct links", role => {
    const allowed = ["ceo", "ceo_assistant", "patient_manager", "billing"].includes(role ?? "");
    expect(canViewPatientFinanceSurface(role)).toBe(allowed);
    expect(patientWorkspaceNavigation(role, "ru", t("ru")).some(item => item.key === "finance")).toBe(allowed);
    expect(normalizePatientDetailTab("finance", { canViewFinance: allowed, canViewInvoices: true, canViewDocuments: true, canViewContracts: true, canViewOperationalSurface: true })).toBe(allowed ? "finance" : "profile");
  });
});
