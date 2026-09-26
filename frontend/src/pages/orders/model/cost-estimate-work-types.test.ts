import { describe, expect, it } from "vitest";

import { costEstimateWorkTypeHint, costEstimateWorkTypeStatus } from "./cost-estimate-work-types";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;
const step = { ru: "Оформление заказа", de: "Auftragserfassung" };

describe("preliminary cost calculation work types", () => {
  it("is ready only when medical work types are selected", () => {
    expect(costEstimateWorkTypeStatus({ specializationCount: 1, availableWorkTypeCount: 3, selectedWorkTypeCount: 2 })).toBe("ready");
    expect(costEstimateWorkTypeStatus({ specializationCount: 1, availableWorkTypeCount: 3, selectedWorkTypeCount: 0 })).toBe("not_selected");
    expect(costEstimateWorkTypeHint("ready", ru, step)).toBeNull();
  });

  it("asks for a specialization before anything else", () => {
    expect(costEstimateWorkTypeStatus({ specializationCount: 0, availableWorkTypeCount: 0, selectedWorkTypeCount: 0, loading: true })).toBe("no_specialization");
    expect(costEstimateWorkTypeHint("no_specialization", ru, step)).toContain("«Оформление заказа»");
  });

  it("does not report an empty catalog while work types load or after a failed load", () => {
    expect(costEstimateWorkTypeStatus({ specializationCount: 1, availableWorkTypeCount: 0, selectedWorkTypeCount: 0, loading: true })).toBe("loading");
    expect(costEstimateWorkTypeStatus({ specializationCount: 1, availableWorkTypeCount: 0, selectedWorkTypeCount: 0, failed: true })).toBe("load_failed");
  });

  it("says the calculation is not required while the catalog has no work types for the specializations", () => {
    const status = costEstimateWorkTypeStatus({ specializationCount: 2, availableWorkTypeCount: 0, selectedWorkTypeCount: 0 });
    expect(status).toBe("no_catalog_work_types");
    expect(costEstimateWorkTypeHint(status, ru, step)).toContain("предварительный расчёт не требуется");
    expect(costEstimateWorkTypeHint(status, de, step)).toContain("keine vorläufige Kostenkalkulation erforderlich");
  });

  it("states that agency services are not part of the calculation", () => {
    expect(costEstimateWorkTypeHint("not_selected", ru, step)).toContain("Услуги агентства");
    expect(costEstimateWorkTypeHint("not_selected", de, step)).toBe(
      "Wählen Sie im Schritt „Auftragserfassung“ die medizinischen Leistungsarten aus. Agenturleistungen gehören nicht in die vorläufige Kostenkalkulation.",
    );
  });
});
