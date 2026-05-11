import { Mail } from "lucide-react";
import type { ReactNode } from "react";

import {
  functionalLabelChipClass,
  humanizeFunctionalLabel,
  normalizeFunctionalLabel,
} from "./shared/patient-form-primitives";
import type { ColumnDef, FilterOption } from "@/components/data-table/types";
import { cn } from "@/lib/utils";

import { computeAge, patientDisplayName, type PatientSummary } from "../model/list-model";

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatShortDate(value?: string | null): string {
  if (!value) return "";
  try {
    return SHORT_DATE_FORMATTER.format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function formatRelativeDate(value?: string | null, now: Date = new Date()): string {
  if (!value) return "";
  const then = new Date(value);
  if (!Number.isFinite(then.getTime())) return value;
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 0) return formatShortDate(value);
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function genderText(value: string | null | undefined, tr: Record<string, string>): string {
  switch (value) {
    case "male":
      return tr.gender_male ?? "Male";
    case "female":
      return tr.gender_female ?? "Female";
    case "diverse":
      return tr.gender_diverse ?? "Diverse";
    default:
      return tr.common_not_set ?? "—";
  }
}

function insuranceText(value: string | null | undefined, tr: Record<string, string>): string {
  switch (value) {
    case "private":
      return tr.insurance_private ?? "Private";
    case "public":
      return tr.insurance_public ?? "Public";
    case "self_pay":
      return tr.insurance_self_pay ?? "Self-pay";
    case "foreign":
      return tr.insurance_foreign ?? "Foreign";
    default:
      return tr.common_not_set ?? "—";
  }
}

type DynamicOptions = {
  insuranceProviders: FilterOption[];
  nationalities: FilterOption[];
  languages: FilterOption[];
  labels: FilterOption[];
};

function deriveDynamicOptions(rows: readonly PatientSummary[]): DynamicOptions {
  const providers = new Set<string>();
  const nationalities = new Set<string>();
  const languages = new Set<string>();
  const labels = new Set<string>();
  for (const row of rows) {
    if (row.insurance_provider) providers.add(row.insurance_provider);
    if (row.nationality) nationalities.add(row.nationality);
    if (row.residence_country) nationalities.add(row.residence_country);
    for (const lang of row.languages ?? []) languages.add(lang);
    for (const label of row.functional_labels ?? []) labels.add(label);
  }
  const toOpts = (values: Iterable<string>) =>
    Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  return {
    insuranceProviders: toOpts(providers),
    nationalities: toOpts(nationalities),
    languages: toOpts(languages),
    labels: Array.from(labels)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: humanizeFunctionalLabel(value) })),
  };
}

export const DEFAULT_PATIENT_HIDDEN_COLUMNS: string[] = [
  "birth_date",
  "email",
  "phone_secondary",
  "gender",
  "nationality",
  "residence_country",
  "languages",
  "functional_labels",
  "assigned_provider",
  "address_city",
];

export const DEFAULT_PATIENT_FROZEN_COLUMNS: string[] = ["no", "patient"];
export const MAX_PATIENT_FROZEN_COLUMNS = 4;

export const PATIENT_COLUMN_GROUPS: Record<string, string> = {
  identity: "Identity",
  contact: "Contact",
  insurance: "Insurance",
  metadata: "Metadata",
  relations: "Relations",
  audit: "Audit",
};

export function buildPatientColumns(
  tr: Record<string, string>,
  rows: readonly PatientSummary[] = [],
): ColumnDef<PatientSummary>[] {
  const dyn = deriveDynamicOptions(rows);

  const cols: ColumnDef<PatientSummary>[] = [
    {
      id: "no",
      label: tr.patients_col_no ?? "No.",
      accessor: (p: PatientSummary) => p.patient_id,
      filterType: "text",
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 96,
      group: "identity",
      render: (p: PatientSummary) => (
        <span className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
          {p.patient_id}
        </span>
      ),
    },
    {
      id: "status",
      label: tr.patients_col_status ?? "Status",
      accessor: (p: PatientSummary) => (p.is_active ? "active" : "inactive"),
      filterType: "enum",
      filterOptions: [
        { value: "active", label: tr.common_active ?? "Active" },
        { value: "inactive", label: tr.common_inactive ?? "Inactive" },
      ],
      sortable: true,
      defaultVisible: true,
      width: 112,
      group: "identity",
      render: (p: PatientSummary) => <StatusPill active={p.is_active} tr={tr} />,
    },
    {
      id: "patient",
      label: tr.patients_col_patient ?? "Patient",
      accessor: (p: PatientSummary) => patientDisplayName(p),
      filterType: "text",
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 240,
      group: "identity",
      render: (p: PatientSummary) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{patientDisplayName(p)}</div>
          {p.functional_labels?.length ? (
            <FunctionalLabelSummary labels={p.functional_labels} />
          ) : null}
        </div>
      ),
    },
    {
      id: "age",
      label: tr.patients_col_age ?? "Age",
      accessor: (p: PatientSummary) => computeAge(p.birth_date),
      filterType: "number",
      sortable: true,
      defaultVisible: true,
      width: 64,
      group: "identity",
      render: (p: PatientSummary) => {
        const age = computeAge(p.birth_date);
        return (
          <span className="tabular-nums text-xs text-muted-foreground">
            {age != null ? age : "—"}
          </span>
        );
      },
    },
    {
      id: "insurance",
      label: tr.patients_insurance_type ?? "Insurance",
      accessor: (p: PatientSummary) => p.insurance_type,
      filterType: "enum",
      filterOptions: [
        { value: "private", label: tr.insurance_private ?? "Private" },
        { value: "public", label: tr.insurance_public ?? "Public" },
        { value: "self_pay", label: tr.insurance_self_pay ?? "Self-pay" },
        { value: "foreign", label: tr.insurance_foreign ?? "Foreign" },
      ],
      sortable: true,
      searchable: true,
      defaultVisible: true,
      width: 220,
      group: "insurance",
      render: (p: PatientSummary) => (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs text-foreground">
            {insuranceText(p.insurance_type, tr)}
          </span>
          {p.insurance_provider ? (
            <span className="truncate text-[10px] text-muted-foreground">
              {p.insurance_provider}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "insurance_provider",
      label: tr.patients_insurance_provider ?? "Insurance provider",
      accessor: (p: PatientSummary) => p.insurance_provider,
      filterType: "enum",
      filterOptions: dyn.insuranceProviders,
      sortable: true,
      searchable: true,
      width: 180,
      group: "insurance",
      render: (p: PatientSummary) => (
        <TextCell
          renderId="insurance_provider"
          value={p.insurance_provider}
          emptyLabel={tr.common_not_set}
        />
      ),
    },
    {
      id: "phone_primary",
      label: tr.patients_phone_primary ?? "Phone",
      accessor: (p: PatientSummary) => p.phone_primary,
      filterType: "text",
      sortable: true,
      searchable: true,
      defaultVisible: true,
      width: 144,
      group: "contact",
      render: (p: PatientSummary) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {p.phone_primary ?? "—"}
        </span>
      ),
    },
    {
      id: "email",
      label: tr.patients_email ?? "Email",
      accessor: (p: PatientSummary) => p.email,
      filterType: "text",
      sortable: true,
      searchable: true,
      width: 220,
      group: "contact",
      render: (p: PatientSummary) => (
        <TextCell
          renderId="email"
          value={p.email}
          icon={<Mail className="size-3" />}
          mono
          emptyLabel={tr.common_not_set}
        />
      ),
    },
    {
      id: "birth_date",
      label: tr.patients_birth_date ?? "Birth date",
      accessor: (p: PatientSummary) => p.birth_date,
      filterType: "date",
      sortable: true,
      width: 128,
      group: "audit",
      render: (p: PatientSummary) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatShortDate(p.birth_date)}
        </span>
      ),
    },
    {
      id: "gender",
      label: tr.patients_gender ?? "Gender",
      accessor: (p: PatientSummary) => p.gender,
      filterType: "enum",
      filterOptions: [
        { value: "male", label: tr.gender_male ?? "Male" },
        { value: "female", label: tr.gender_female ?? "Female" },
        { value: "diverse", label: tr.gender_diverse ?? "Diverse" },
      ],
      sortable: true,
      width: 100,
      group: "identity",
      render: (p: PatientSummary) => (
        <TextCell
          renderId="gender"
          value={genderText(p.gender, tr)}
          emptyLabel={tr.common_not_set}
        />
      ),
    },
    {
      id: "nationality",
      label: tr.patients_nationality ?? "Nationality",
      accessor: (p: PatientSummary) => p.nationality,
      filterType: "multi_enum",
      filterOptions: dyn.nationalities,
      sortable: true,
      searchable: true,
      width: 128,
      group: "metadata",
      render: (p: PatientSummary) => (
        <PillCell
          renderId="nationality"
          value={p.nationality}
          emptyLabel={tr.common_not_set}
        />
      ),
    },
    {
      id: "residence_country",
      label: tr.patients_residence_country ?? "Residence",
      accessor: (p: PatientSummary) => p.residence_country,
      filterType: "multi_enum",
      filterOptions: dyn.nationalities,
      sortable: true,
      searchable: true,
      width: 128,
      group: "metadata",
      render: (p: PatientSummary) => (
        <PillCell
          renderId="residence_country"
          value={p.residence_country}
          emptyLabel={tr.common_not_set}
        />
      ),
    },
    {
      id: "languages",
      label: tr.patients_languages ?? "Languages",
      accessor: (p: PatientSummary) => p.languages,
      filterType: "tag_array",
      filterOptions: dyn.languages,
      searchable: true,
      width: 160,
      group: "metadata",
      render: (p: PatientSummary) => (
        <TagListCell
          renderId="languages"
          values={p.languages ?? []}
          emptyLabel={tr.common_not_set}
        />
      ),
    },
    {
      id: "functional_labels",
      label: tr.patients_functional_labels ?? "Labels",
      accessor: (p: PatientSummary) => p.functional_labels,
      filterType: "tag_array",
      filterOptions: dyn.labels,
      searchable: true,
      width: 200,
      group: "metadata",
      render: (p: PatientSummary) => (
        <TagListCell
          renderId="functional_labels"
          values={p.functional_labels ?? []}
          format={humanizeFunctionalLabel}
          classNameForValue={functionalLabelChipClass}
          dataValueAttribute={normalizeFunctionalLabel}
          emptyLabel={tr.common_not_set}
          maxVisible={2}
        />
      ),
    },
    {
      id: "created_at",
      label: tr.patients_created_at ?? "Created",
      accessor: (p: PatientSummary) => p.created_at,
      filterType: "date",
      sortable: true,
      defaultVisible: true,
      width: 96,
      group: "audit",
      render: (p: PatientSummary) => (
        <span className="tabular-nums text-[11px] text-muted-foreground">
          {formatRelativeDate(p.created_at)}
        </span>
      ),
    },
  ];
  return cols;
}

type TextCellProps = {
  emptyLabel?: string;
  icon?: ReactNode;
  mono?: boolean;
  renderId: string;
  value?: ReactNode;
};

function TextCell({ emptyLabel = "—", icon, mono = false, renderId, value }: TextCellProps) {
  const isEmpty =
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  return (
    <div data-patient-cell-render={renderId} className="flex min-w-0 items-center gap-1.5">
      {icon ? (
        <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          mono && "font-mono text-[11px] tabular-nums",
          isEmpty ? "text-muted-foreground/60" : "text-muted-foreground",
        )}
      >
        {isEmpty ? emptyLabel || "—" : value}
      </span>
    </div>
  );
}

type PillCellProps = {
  emptyLabel?: string;
  renderId: string;
  value?: string | null;
};

function PillCell({ emptyLabel = "—", renderId, value }: PillCellProps) {
  if (!value) {
    return <TextCell renderId={renderId} value={null} emptyLabel={emptyLabel} />;
  }
  return (
    <div data-patient-cell-render={renderId} className="flex min-w-0 items-center">
      <span className="min-w-0 truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

type TagListCellProps = {
  classNameForValue?: (value: string) => string;
  dataValueAttribute?: (value: string) => string;
  emptyLabel?: string;
  format?: (value: string) => string;
  maxVisible?: number;
  renderId: string;
  values: readonly string[];
};

function TagListCell({
  classNameForValue,
  dataValueAttribute,
  emptyLabel = "—",
  format = (value) => value,
  maxVisible = 3,
  renderId,
  values,
}: TagListCellProps) {
  const normalized = values.filter(Boolean);
  if (normalized.length === 0) {
    return <TextCell renderId={renderId} value={null} emptyLabel={emptyLabel} />;
  }

  const visible = normalized.slice(0, maxVisible);
  const hiddenCount = normalized.length - visible.length;

  return (
    <div data-patient-cell-render={renderId} className="flex min-w-0 items-center gap-1 overflow-hidden">
      {visible.map((value) => (
        <span
          key={value}
          data-patient-functional-label={dataValueAttribute?.(value)}
          className={cn(
            "max-w-[6.5rem] shrink truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
            classNameForValue ? classNameForValue(value) : "border-transparent bg-muted text-muted-foreground",
          )}
        >
          {format(value)}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function FunctionalLabelSummary({
  labels,
  maxVisible = 2,
}: {
  labels: readonly string[];
  maxVisible?: number;
}) {
  const normalized = labels.filter(Boolean);
  const visible = normalized.slice(0, maxVisible);
  const hiddenCount = normalized.length - visible.length;

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
      {visible.map((label) => (
        <span
          key={label}
          data-patient-functional-label={normalizeFunctionalLabel(label)}
          className={cn(
            "max-w-[6.75rem] shrink truncate rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-3",
            functionalLabelChipClass(label),
          )}
        >
          {humanizeFunctionalLabel(label)}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="shrink-0 rounded-full border border-border bg-muted/70 px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-muted-foreground">
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

type StatusPillProps = { active: boolean; tr: Record<string, string> };

function StatusPill({ active, tr }: StatusPillProps) {
  const status = active ? "active" : "inactive";
  return (
    <span
      data-patient-cell-render="status"
      data-patient-status-pill={status}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4",
        active
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-rose-500",
        )}
      />
      {active ? tr.common_active ?? "Active" : tr.common_inactive ?? "Inactive"}
    </span>
  );
}
