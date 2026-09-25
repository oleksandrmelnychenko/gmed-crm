// The preliminary cost calculation (VKS, template `cost_estimate`) lists the
// selected medical work types only. The agency's own services belong to the
// Kostenvoranschlag, so without medical work types there is nothing to create.

export type CostEstimateWorkTypeStatus =
  | "ready"
  | "loading"
  | "load_failed"
  | "no_specialization"
  | "no_catalog_work_types"
  | "not_selected";

export function costEstimateWorkTypeStatus(input: {
  specializationCount: number;
  availableWorkTypeCount: number;
  selectedWorkTypeCount: number;
  loading?: boolean;
  failed?: boolean;
}): CostEstimateWorkTypeStatus {
  if (input.selectedWorkTypeCount > 0) return "ready";
  if (input.specializationCount === 0) return "no_specialization";
  if (input.loading) return "loading";
  if (input.failed) return "load_failed";
  if (input.availableWorkTypeCount === 0) return "no_catalog_work_types";
  return "not_selected";
}

type Tx = (ru: string, de: string) => string;

/** Why the VKS cannot be created yet; `step` names the wizard step with the work types. */
export function costEstimateWorkTypeHint(
  status: CostEstimateWorkTypeStatus,
  tx: Tx,
  step: { ru: string; de: string },
): string | null {
  switch (status) {
    case "ready":
      return null;
    case "loading":
      return tx("Загружаются виды работ…", "Leistungsarten werden geladen…");
    case "load_failed":
      return tx(
        `Не удалось загрузить виды работ. Повторите загрузку на этапе «${step.ru}».`,
        `Die Leistungsarten konnten nicht geladen werden. Laden Sie sie im Schritt „${step.de}“ erneut.`,
      );
    case "no_specialization":
      return tx(
        `Выберите специализацию и медицинские виды работ на этапе «${step.ru}». Предварительный расчёт включает только медицинские услуги.`,
        `Wählen Sie im Schritt „${step.de}“ eine Fachrichtung und die medizinischen Leistungsarten. Die vorläufige Kostenkalkulation enthält nur medizinische Leistungen.`,
      );
    case "no_catalog_work_types":
      return tx(
        "Для выбранных специализаций в каталоге нет видов работ. Выберите другую специализацию или попросите CEO добавить виды работ в разделе «Специализации».",
        "Für die gewählten Fachrichtungen sind im Katalog keine Leistungsarten hinterlegt. Wählen Sie eine andere Fachrichtung oder lassen Sie die Leistungsarten im Bereich „Spezialisierungen“ vom CEO ergänzen.",
      );
    case "not_selected":
      return tx(
        `Выберите медицинские виды работ на этапе «${step.ru}». Услуги агентства в предварительный расчёт не входят.`,
        `Wählen Sie im Schritt „${step.de}“ die medizinischen Leistungsarten aus. Agenturleistungen gehören nicht in die vorläufige Kostenkalkulation.`,
      );
  }
}
