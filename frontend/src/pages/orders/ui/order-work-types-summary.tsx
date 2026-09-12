import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SpecializationWorkType } from "@/pages/specializations/data/specialization-work-types-api";
type Tx = (ru: string, de: string) => string;
const formatMoneyValue = (value: number, lang: Lang) => new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export function workTypeDurationLabel(hours: number, tx: Tx) {
  const duration = Math.max(1, hours);
  const roundedDuration = Math.round(duration);
  const russianUnit = roundedDuration % 10 === 1 && roundedDuration % 100 !== 11
    ? "час"
    : roundedDuration % 10 >= 2
      && roundedDuration % 10 <= 4
      && (roundedDuration % 100 < 12 || roundedDuration % 100 > 14)
      ? "часа"
      : "часов";
  return `${duration} ${tx(russianUnit, duration === 1 ? "Stunde" : "Stunden")}`;
}

const SPECIALIZATION_CHIP_CLASSES = [
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
] as const;

export function specializationChipClass(value: string) {
  const hash = [...value].reduce(
    (result, character) => (result * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return SPECIALIZATION_CHIP_CLASSES[hash % SPECIALIZATION_CHIP_CLASSES.length];
}

type SelectedWorkTypesSummaryProps = {
  workTypes: SpecializationWorkType[];
  specializationLabels: ReadonlyMap<string, string>;
  lang: Lang;
  tx: Tx;
  compact?: boolean;
  selection?: { ids: string[]; onChange: (ids: string[]) => void };
};

export function SelectedWorkTypesSummary({
  workTypes,
  specializationLabels,
  lang,
  tx,
  compact = false,
  selection,
}: SelectedWorkTypesSummaryProps) {
  if (workTypes.length === 0) return null;

  const totalDuration = workTypes.filter(item => !selection || selection.ids.includes(item.id)).reduce(
    (sum, workType) => sum + Math.max(1, workType.duration_hours),
    0,
  );
  const specializationNameList = (workType: SpecializationWorkType) => {
    const specializationIds = workType.specialization_ids.length > 0
      ? workType.specialization_ids
      : [workType.specialization_id];
    return [...new Set(
      specializationIds
        .map((id) => specializationLabels.get(id))
        .filter((value): value is string => Boolean(value)),
    )];
  };
  const specializationNames = (workType: SpecializationWorkType) =>
    specializationNameList(workType).join(", ") || "—";
  const workTypeName = (workType: SpecializationWorkType) => lang === "de"
    ? workType.name_de || workType.name_en || workType.name_ru || workType.name_es || workType.code
    : workType.name_ru || workType.name_de || workType.name_en || workType.name_es || workType.code;
  const columns: ColumnDef<SpecializationWorkType>[] = [
    ...(!compact ? [{
      id: "specialization",
      label: tx("Специализация", "Fachrichtung"),
      accessor: specializationNames,
      sortable: false,
      width: 230,
      render: (workType: SpecializationWorkType) => {
        const names = specializationNameList(workType);
        return names.length > 0 ? (
          <span className="flex min-w-0 flex-wrap gap-1">
            {names.map((name) => (
              <Badge
                key={name}
                variant="outline"
                className={cn(
                  "max-w-full truncate text-[10px] font-medium",
                  specializationChipClass(name),
                )}
                title={name}
              >
                {name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    } satisfies ColumnDef<SpecializationWorkType>] : []),
    {
      id: "work_type",
      label: tx("Вид работы", "Leistungsart"),
      accessor: workTypeName,
      sortable: false,
      minWidth: 280,
      render: (workType) => (
        <span className="break-words font-medium text-foreground">
          {workTypeName(workType)}
        </span>
      ),
    },
    {
      id: "duration",
      label: tx("Длительность", "Dauer"),
      accessor: (workType) => Math.max(1, workType.duration_hours),
      sortable: false,
      align: "right",
      width: 130,
      render: (workType) => (
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 font-mono text-[10px] font-semibold tabular-nums text-amber-700 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-300"
        >
          {workTypeDurationLabel(workType.duration_hours, tx)}
        </Badge>
      ),
    },
    {
      id: "range",
      label: tx("Диапазон цены", "Preisspanne"),
      accessor: (workType) => workType.min_price_eur,
      sortable: false,
      align: "right",
      width: 230,
      render: (workType) => (
        <span className="whitespace-nowrap font-mono font-semibold tabular-nums text-foreground">
          {formatMoneyValue(workType.min_price_eur, lang)} – {formatMoneyValue(workType.max_price_eur, lang)} EUR
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={workTypes}
      columns={columns}
      rowId={(workType) => workType.id}
      selectionEnabled={Boolean(selection)}
      selectedIds={selection?.ids}
      onSelectedIdsChange={selection?.onChange}
      density="compact"
      rowHeightOverrides={{ compact: 44 }}
      mobilePrimaryColumnId="work_type"
      mobileDetailColumnIds={compact ? ["duration", "range"] : ["specialization", "duration", "range"]}
      disableRowHover
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono font-semibold tabular-nums text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            {tx("Длительность", "Dauer")}: {totalDuration ? workTypeDurationLabel(totalDuration, tx) : tx("0 часов", "0 Stunden")}
          </span>
        </div>
      )}
      className="min-h-0 shadow-none"
    />
  );
}
