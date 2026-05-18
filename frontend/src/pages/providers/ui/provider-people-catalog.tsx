import { useMemo, type ReactNode } from "react";
import {
  ArrowUpRight,
  Building2,
  Mail,
  Phone,
  RotateCcw,
  Search,
  Stethoscope,
  UserRound,
} from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  compactDateTime,
  doctorRoleLabel,
  providerTypeLabel,
} from "../model/list-model";
import {
  DEFAULT_PROVIDER_PEOPLE_FILTERS,
  type ProviderPeopleFilters,
  type ProviderPeoplePatientOption,
  type ProviderPeoplePersonType,
  type ProviderPeopleRow,
} from "../model/people-types";
import { specializationLabelForItem, specializationLabelForValue } from "../model/specialization-labels";
import type {
  ProviderPersonGender,
  ProviderStaffRoleItem,
  ProviderSummary,
  ProviderType,
  SpecializationItem,
} from "../model/types";

type ProviderPeopleCatalogProps = {
  className?: string;
  error?: string | null;
  filters: ProviderPeopleFilters;
  loading?: boolean;
  patients?: readonly ProviderPeoplePatientOption[];
  providers?: readonly ProviderSummary[];
  rows: readonly ProviderPeopleRow[];
  specializations?: readonly SpecializationItem[];
  staffRoles?: readonly ProviderStaffRoleItem[];
  onFiltersChange: (filters: ProviderPeopleFilters) => void;
  onOpenPerson: (personId: string, row: ProviderPeopleRow) => void;
  onOpenProvider: (providerId: string, row: ProviderPeopleRow) => void;
  onResetFilters?: () => void;
  onRetry?: () => void;
};

type ProviderOption = {
  label: string;
  value: string;
};

const DEFAULT_HIDDEN_COLUMNS = ["gender", "contacts", "last_interaction_at"];
const DEFAULT_FROZEN_COLUMNS = ["person"];

const STAFF_ROLE_LABEL_KEYS: Record<string, string> = {
  administration: "providers_staff_role_administration",
  assistant: "providers_staff_role_assistant",
  billing: "providers_staff_role_billing",
  coordinator: "providers_staff_role_coordinator",
  driver: "providers_staff_role_driver",
  nurse: "providers_staff_role_nurse",
  other: "providers_staff_role_other",
  reception: "providers_staff_role_reception",
  secretary: "providers_staff_role_secretary",
  staff: "providers_staff_role_staff",
};

const DOCTOR_ROLE_OPTIONS = [
  "clinical_director",
  "chefarzt",
  "oberarzt",
  "facharzt",
  "assistenzarzt",
  "other",
] as const;

function labelFrom(labels: Record<string, string>, key: string, fallback: string) {
  return labels[key] ?? fallback;
}

function uiLabel(uiText: Record<string, string>, key: string, fallback: string) {
  return uiText[key] ?? fallback;
}

function readableCode(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const words = value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!words) return fallback;
  return words.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function localizedName(
  item: { name_de?: string | null; name_ru?: string | null; name_en?: string | null; code?: string },
  lang: Lang,
) {
  const localized = lang === "de" ? item.name_de : item.name_ru;
  return localized?.trim() || item.name_en?.trim() || readableCode(item.code, "");
}

function staffRoleSelectLabel(
  role: ProviderStaffRoleItem,
  labels: Record<string, string>,
  uiText: Record<string, string>,
  lang: Lang,
) {
  const labelKey = STAFF_ROLE_LABEL_KEYS[role.code];
  if (labelKey) {
    return uiLabel(uiText, labelKey, readableCode(role.code, labels.common_not_set ?? "-"));
  }
  return localizedName(role, lang) || readableCode(role.code, labels.common_not_set ?? "-");
}

function patientOptionLabel(patient: ProviderPeoplePatientOption) {
  return [patient.patient_id, `${patient.first_name} ${patient.last_name}`.trim()]
    .filter(Boolean)
    .join(" - ");
}

function personTypeLabel(
  value: ProviderPeoplePersonType,
  labels: Record<string, string>,
  uiText: Record<string, string>,
) {
  return value === "doctor"
    ? uiLabel(uiText, "providers_doctor", labelFrom(labels, "providers_doctors", "Doctor"))
    : uiLabel(uiText, "providers_staff", "Staff");
}

function genderLabel(value: ProviderPersonGender, labels: Record<string, string>) {
  switch (value) {
    case "male":
      return labelFrom(labels, "gender_male", "Male");
    case "female":
      return labelFrom(labels, "gender_female", "Female");
    default:
      return labelFrom(labels, "common_unknown", "Unknown");
  }
}

function roleLabel(
  row: ProviderPeopleRow,
  labels: Record<string, string>,
  uiText: Record<string, string>,
) {
  if (row.role_label) return row.role_label;
  if (row.person_type === "doctor" && row.role_code) return doctorRoleLabel(row.role_code);
  if (row.role_code) {
    const staffLabelKey = STAFF_ROLE_LABEL_KEYS[row.role_code];
    return staffLabelKey
      ? uiLabel(uiText, staffLabelKey, readableCode(row.role_code, labels.common_not_set ?? "-"))
      : readableCode(row.role_code, labels.common_not_set ?? "-");
  }
  return labels.common_not_set ?? "-";
}

function primaryContactValue(
  row: ProviderPeopleRow,
  kind: "phone" | "email",
) {
  return (
    row.contacts.find((contact) => contact.contact_kind === kind && contact.is_primary)?.value ??
    row.contacts.find((contact) => contact.contact_kind === kind)?.value ??
    ""
  );
}

function contactSummary(row: ProviderPeopleRow, fallback: string) {
  const phone = primaryContactValue(row, "phone");
  const email = primaryContactValue(row, "email");
  return [phone, email].filter(Boolean).join(" / ") || fallback;
}

function specializationSummary(row: ProviderPeopleRow, lang: Lang, fallback: string) {
  const seen = new Set<string>();
  const labels = row.specializations.flatMap((item) => {
    const label = specializationLabelForItem(item, lang).trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });

  if (labels.length > 0) return labels.join(", ");
  return row.fachbereich
    ? specializationLabelForValue(row.fachbereich, row.specializations, lang)
    : fallback;
}

function countLabel(key: string, labels: Record<string, string>, uiText: Record<string, string>) {
  switch (key) {
    case "patient_count":
      return labelFrom(labels, "providers_linked_patients", "Patients");
    case "appointment_count":
      return labelFrom(labels, "providers_appointments", "Appointments");
    case "leistung_count":
    case "service_count":
      return labelFrom(labels, "providers_services", "Services");
    case "concierge_count":
      return labelFrom(labels, "appointments_linked_concierge", "Concierge");
    case "order_count":
      return uiLabel(uiText, "orders_title", "Orders");
    case "interaction_count":
      return uiLabel(uiText, "providers_activity_items", "Activity");
    default:
      return readableCode(key.replace(/_count$/, ""), key);
  }
}

function visibleCounts(row: ProviderPeopleRow) {
  return Object.entries(row.counts).flatMap(([key, value]) => {
    if (value === undefined || !Number.isFinite(value)) return [];
    return [{ key, value }];
  });
}

function PersonTypeBadge({
  row,
  labels,
  uiText,
}: {
  labels: Record<string, string>;
  row: ProviderPeopleRow;
  uiText: Record<string, string>;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        row.person_type === "doctor"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {personTypeLabel(row.person_type, labels, uiText)}
    </Badge>
  );
}

function ProviderTypeBadge({
  providerType,
  labels,
}: {
  labels: Record<string, string>;
  providerType: ProviderType;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        providerType === "medical"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-violet-200 bg-violet-50 text-violet-700",
      )}
    >
      {providerTypeLabel(providerType, labels)}
    </Badge>
  );
}

function PersonIdentityCell({
  labels,
  row,
  uiText,
}: {
  labels: Record<string, string>;
  row: ProviderPeopleRow;
  uiText: Record<string, string>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {row.person_type === "doctor" ? (
          <Stethoscope className="size-3.5" />
        ) : (
          <UserRound className="size-3.5" />
        )}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">
            {row.title ? `${row.title} ${row.name}` : row.name}
          </span>
          <PersonTypeBadge labels={labels} row={row} uiText={uiText} />
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {roleLabel(row, labels, uiText)}
        </div>
      </div>
    </div>
  );
}

function ContactLine({
  icon,
  value,
}: {
  icon: "email" | "phone";
  value: string;
}) {
  const Icon = icon === "email" ? Mail : Phone;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground/70" />
      <span className="truncate">{value}</span>
    </span>
  );
}

function CountsInline({
  labels,
  row,
  uiText,
}: {
  labels: Record<string, string>;
  row: ProviderPeopleRow;
  uiText: Record<string, string>;
}) {
  const counts = visibleCounts(row).slice(0, 3);
  if (counts.length === 0) {
    return <span className="text-xs text-muted-foreground">{labels.common_not_set ?? "-"}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {counts.map((count) => (
        <span
          key={count.key}
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title={`${count.value} ${countLabel(count.key, labels, uiText)}`}
        >
          <span className="font-semibold tabular-nums text-foreground">{count.value}</span>
          <span className="max-w-20 truncate">{countLabel(count.key, labels, uiText)}</span>
        </span>
      ))}
    </div>
  );
}

function buildPeopleColumns(
  labels: Record<string, string>,
  uiText: Record<string, string>,
  lang: Lang,
): ColumnDef<ProviderPeopleRow>[] {
  const notSet = labels.common_not_set ?? "-";

  return [
    {
      id: "person",
      label: uiLabel(uiText, "providers_people_person", "Person"),
      accessor: (row) => row.name,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 300,
      group: "identity",
      render: (row) => <PersonIdentityCell labels={labels} row={row} uiText={uiText} />,
    },
    {
      id: "person_type",
      label: uiLabel(uiText, "providers_people_type", "Person type"),
      accessor: (row) => personTypeLabel(row.person_type, labels, uiText),
      filterType: "enum",
      filterOptions: [
        { value: "doctor", label: personTypeLabel("doctor", labels, uiText) },
        { value: "staff", label: personTypeLabel("staff", labels, uiText) },
      ],
      sortable: true,
      width: 130,
      group: "identity",
      render: (row) => <PersonTypeBadge labels={labels} row={row} uiText={uiText} />,
    },
    {
      id: "provider",
      label: labels.providers_title ?? "Provider",
      accessor: (row) => row.provider_name,
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 260,
      group: "provider",
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{row.provider_name}</div>
          <div className="mt-1">
            <ProviderTypeBadge labels={labels} providerType={row.provider_type} />
          </div>
        </div>
      ),
    },
    {
      id: "role",
      label: uiLabel(uiText, "providers_people_role", "Role"),
      accessor: (row) => roleLabel(row, labels, uiText),
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 180,
      group: "identity",
      render: (row) => (
        <div className="truncate text-xs text-muted-foreground">
          {roleLabel(row, labels, uiText)}
          {row.subrole ? (
            <span className="ml-1 text-[10px] text-muted-foreground/75">
              {readableCode(row.subrole, "")}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "gender",
      label: uiLabel(uiText, "patients_gender", "Gender"),
      accessor: (row) => genderLabel(row.gender, labels),
      filterType: "enum",
      filterOptions: [
        { value: "male", label: genderLabel("male", labels) },
        { value: "female", label: genderLabel("female", labels) },
        { value: "unknown", label: genderLabel("unknown", labels) },
      ],
      sortable: true,
      width: 120,
      group: "identity",
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {genderLabel(row.gender, labels)}
        </span>
      ),
    },
    {
      id: "fachbereich",
      label: labels.providers_fachbereich ?? "Department",
      accessor: (row) => row.fachbereich,
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 180,
      group: "clinical",
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.fachbereich || notSet}
        </span>
      ),
    },
    {
      id: "specializations",
      label: uiLabel(uiText, "providers_doctor_specializations", "Specializations"),
      accessor: (row) => specializationSummary(row, lang, ""),
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 220,
      group: "clinical",
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {specializationSummary(row, lang, notSet)}
        </span>
      ),
    },
    {
      id: "contacts",
      label: uiLabel(uiText, "providers_contacts", "Contacts"),
      accessor: (row) => contactSummary(row, ""),
      filterType: "text",
      searchable: true,
      sortable: false,
      width: 240,
      group: "contact",
      render: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
          {primaryContactValue(row, "phone") ? (
            <ContactLine icon="phone" value={primaryContactValue(row, "phone")} />
          ) : null}
          {primaryContactValue(row, "email") ? (
            <ContactLine icon="email" value={primaryContactValue(row, "email")} />
          ) : null}
          {!primaryContactValue(row, "phone") && !primaryContactValue(row, "email") ? notSet : null}
        </div>
      ),
    },
    {
      id: "counts",
      label: uiLabel(uiText, "providers_people_counts", "Counts"),
      accessor: (row) => visibleCounts(row).map((count) => count.value).join(" "),
      filterType: "number",
      sortable: false,
      width: 210,
      group: "activity",
      render: (row) => <CountsInline labels={labels} row={row} uiText={uiText} />,
    },
    {
      id: "last_interaction_at",
      label: labels.providers_last_activity ?? "Last activity",
      accessor: (row) => row.last_interaction_at,
      filterType: "date",
      sortable: true,
      width: 160,
      group: "activity",
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {compactDateTime(row.last_interaction_at, notSet)}
        </span>
      ),
    },
  ];
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-0.5 flex h-4 min-w-0 items-center truncate text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </span>
  );
}

function SelectField({
  children,
  label,
  value,
  onChange,
}: {
  children: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <NativeComboboxSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
      >
        {children}
      </NativeComboboxSelect>
    </label>
  );
}

function TextFilterField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-md bg-background text-xs"
      />
    </label>
  );
}

function deriveProviderOptions(rows: readonly ProviderPeopleRow[]) {
  const byId = new Map<string, string>();
  for (const row of rows) {
    if (!row.provider_id) continue;
    byId.set(row.provider_id, row.provider_name || row.provider_id);
  }
  return Array.from(byId, ([value, label]) => ({ value, label })).sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
  );
}

function providerOptionsFromProviders(providers: readonly ProviderSummary[]) {
  return providers
    .map((provider) => ({ value: provider.id, label: provider.name || provider.id }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
}

function buildRoleOptions(
  filters: ProviderPeopleFilters,
  labels: Record<string, string>,
  uiText: Record<string, string>,
  staffRoles: readonly ProviderStaffRoleItem[],
  lang: Lang,
) {
  const options: ProviderOption[] = [];
  const includeDoctors = filters.personType !== "staff";
  const includeStaff = filters.personType !== "doctor";

  if (includeDoctors) {
    options.push(
      ...DOCTOR_ROLE_OPTIONS.map((role) => ({
        value: role,
        label: uiLabel(uiText, `providers_doctor_role_${role}`, doctorRoleLabel(role)),
      })),
    );
  }

  if (includeStaff) {
    const seen = new Set(options.map((option) => option.value));
    for (const role of staffRoles) {
      if (!role.is_active || seen.has(role.code)) continue;
      const label = staffRoleSelectLabel(role, labels, uiText, lang);
      options.push({ value: role.code, label });
      seen.add(role.code);
    }
  }

  return options;
}

function FiltersBar({
  filters,
  lang,
  labels,
  patients,
  providerOptions,
  specializations,
  staffRoles,
  uiText,
  onFiltersChange,
  onResetFilters,
}: {
  filters: ProviderPeopleFilters;
  lang: Lang;
  labels: Record<string, string>;
  patients: readonly ProviderPeoplePatientOption[];
  providerOptions: ProviderOption[];
  specializations: readonly SpecializationItem[];
  staffRoles: readonly ProviderStaffRoleItem[];
  uiText: Record<string, string>;
  onFiltersChange: (filters: ProviderPeopleFilters) => void;
  onResetFilters?: () => void;
}) {
  const allLabel = labels.providers_all ?? "All";
  const roleOptions = buildRoleOptions(filters, labels, uiText, staffRoles, lang);
  const setFilter = <K extends keyof ProviderPeopleFilters>(
    key: K,
    value: ProviderPeopleFilters[K],
  ) => onFiltersChange({ ...filters, [key]: value });
  const reset = () => {
    if (onResetFilters) {
      onResetFilters();
      return;
    }
    onFiltersChange(DEFAULT_PROVIDER_PEOPLE_FILTERS);
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5 md:grid-cols-[minmax(190px,1.35fr)_repeat(3,minmax(118px,0.8fr))_auto] md:items-end">
        <label className="min-w-0">
          <FieldLabel>{labels.common_search ?? "Search"}</FieldLabel>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) => setFilter("search", event.target.value)}
              placeholder={labels.common_search_placeholder ?? "Search by name, provider, role"}
              className="h-8 rounded-md bg-background pl-8 text-xs"
            />
          </div>
        </label>

        <SelectField
          label={uiLabel(uiText, "providers_people_type", "Person type")}
          value={filters.personType}
          onChange={(value) =>
            setFilter("personType", value as ProviderPeopleFilters["personType"])
          }
        >
          <option value="">{allLabel}</option>
          <option value="doctor">{personTypeLabel("doctor", labels, uiText)}</option>
          <option value="staff">{personTypeLabel("staff", labels, uiText)}</option>
        </SelectField>

        <SelectField
          label={labels.providers_title ?? "Provider"}
          value={filters.providerId}
          onChange={(value) => setFilter("providerId", value)}
        >
          <option value="">{allLabel}</option>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={labels.providers_type ?? "Provider type"}
          value={filters.providerType}
          onChange={(value) =>
            setFilter("providerType", value as ProviderPeopleFilters["providerType"])
          }
        >
          <option value="">{allLabel}</option>
          <option value="medical">{providerTypeLabel("medical", labels)}</option>
          <option value="non_medical">{providerTypeLabel("non_medical", labels)}</option>
        </SelectField>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 justify-center rounded-md bg-background px-2 text-xs"
          onClick={reset}
        >
          <RotateCcw className="size-3.5" />
          {labels.common_reset ?? "Reset"}
        </Button>
      </div>

      <div className="grid gap-1.5 md:grid-cols-4">
        <TextFilterField
          label={labels.providers_fachbereich ?? "Department"}
          placeholder={labels.providers_fachbereich ?? "Department"}
          value={filters.fachbereich}
          onChange={(value) => setFilter("fachbereich", value)}
        />
        <SelectField
          label={uiLabel(uiText, "providers_doctor_specializations", "Specializations")}
          value={filters.specialization}
          onChange={(value) => setFilter("specialization", value)}
        >
          <option value="">{allLabel}</option>
          {specializations
            .filter((item) => item.is_active)
            .map((item) => (
              <option key={item.id} value={item.code || item.name_en}>
                {specializationLabelForItem(item, lang)}
              </option>
            ))}
        </SelectField>
        <SelectField
          label={uiLabel(uiText, "providers_people_role", "Role")}
          value={filters.role}
          onChange={(value) => setFilter("role", value)}
        >
          <option value="">{allLabel}</option>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={labels.patients_title ?? "Patients"}
          value={filters.patientId}
          onChange={(value) => setFilter("patientId", value)}
        >
          <option value="">{allLabel}</option>
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patientOptionLabel(patient)}
            </option>
          ))}
        </SelectField>
      </div>
    </div>
  );
}

function ErrorBanner({
  error,
  labels,
  onRetry,
}: {
  error: string;
  labels: Record<string, string>;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span>{error}</span>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-rose-200 bg-white/70 text-rose-700 hover:bg-white"
          onClick={onRetry}
        >
          {labels.common_retry ?? "Retry"}
        </Button>
      ) : null}
    </div>
  );
}

function MobilePeopleCards({
  labels,
  lang,
  loading,
  rows,
  uiText,
  onOpenPerson,
  onOpenProvider,
}: {
  labels: Record<string, string>;
  lang: Lang;
  loading: boolean;
  rows: readonly ProviderPeopleRow[];
  uiText: Record<string, string>;
  onOpenPerson: (personId: string, row: ProviderPeopleRow) => void;
  onOpenProvider: (providerId: string, row: ProviderPeopleRow) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`provider-people-skeleton-${index + 1}`}
            className="h-32 animate-pulse rounded-lg border border-border bg-muted/35"
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-5 py-6 text-sm text-muted-foreground md:hidden">
        {labels.common_no_results ?? "No results"}
      </div>
    );
  }

  return (
    <div className="space-y-2 md:hidden">
      {rows.map((row) => (
        <article
          key={`${row.person_type}:${row.person_id}:${row.provider_id}`}
          className="rounded-lg border border-border bg-card p-3 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
              {row.person_type === "doctor" ? (
                <Stethoscope className="size-4" />
              ) : (
                <UserRound className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <h4 className="truncate text-sm font-semibold text-foreground">
                  {row.title ? `${row.title} ${row.name}` : row.name}
                </h4>
                <PersonTypeBadge labels={labels} row={row} uiText={uiText} />
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {roleLabel(row, labels, uiText)}
              </p>
              <p className="mt-2 truncate text-xs text-muted-foreground">
                {row.provider_name}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ProviderTypeBadge labels={labels} providerType={row.provider_type} />
                <Badge
                  variant="outline"
                  className="rounded-full border-border bg-muted/30 text-[10px] text-muted-foreground"
                >
                  {genderLabel(row.gender, labels)}
                </Badge>
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="line-clamp-2">
              <span className="font-medium text-foreground/75">
                {labels.providers_fachbereich ?? "Department"}:{" "}
              </span>
              {specializationSummary(row, lang, labels.common_not_set ?? "-")}
            </p>
            <p className="line-clamp-2">
              <span className="font-medium text-foreground/75">
                {uiLabel(uiText, "providers_contacts", "Contacts")}:{" "}
              </span>
              {contactSummary(row, labels.common_not_set ?? "-")}
            </p>
          </div>

          <div className="mt-3">
            <CountsInline labels={labels} row={row} uiText={uiText} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center rounded-lg bg-muted/20"
              onClick={() => onOpenPerson(row.person_id, row)}
            >
              <UserRound className="size-3.5" />
              {uiLabel(uiText, "providers_people_open_person", "Open person")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center rounded-lg bg-muted/20"
              onClick={() => onOpenProvider(row.provider_id, row)}
            >
              <Building2 className="size-3.5" />
              {uiLabel(uiText, "providers_open_provider", "Open provider")}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ProviderPeopleCatalog({
  className,
  error,
  filters,
  loading = false,
  patients = [],
  providers = [],
  rows,
  specializations = [],
  staffRoles = [],
  onFiltersChange,
  onOpenPerson,
  onOpenProvider,
  onResetFilters,
  onRetry,
}: ProviderPeopleCatalogProps) {
  const { lang, t } = useLang();
  const labels = t as unknown as Record<string, string>;
  const uiText = t.uiText as Record<string, string>;
  const providerOptions = useMemo(() => {
    const options = providerOptionsFromProviders(providers);
    return options.length > 0 ? options : deriveProviderOptions(rows);
  }, [providers, rows]);
  const columns = useMemo(() => buildPeopleColumns(labels, uiText, lang), [labels, lang, uiText]);
  const title = uiLabel(uiText, "providers_people_catalog", "People catalog");
  const countLabelText = uiLabel(uiText, "providers_people_count", "people");

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        </div>
      </div>

      <FiltersBar
        filters={filters}
        lang={lang}
        labels={labels}
        patients={patients}
        providerOptions={providerOptions}
        specializations={specializations}
        staffRoles={staffRoles}
        uiText={uiText}
        onFiltersChange={onFiltersChange}
        onResetFilters={onResetFilters}
      />

      {error && !loading ? <ErrorBanner error={error} labels={labels} onRetry={onRetry} /> : null}

      <div className="hidden md:block">
        <DataTableSurface
          rows={rows}
          columns={columns}
          defaultDensity="compact"
          defaultFrozenColumns={DEFAULT_FROZEN_COLUMNS}
          defaultHiddenColumns={DEFAULT_HIDDEN_COLUMNS}
          dictionary={labels}
          emptyState={labels.common_no_results ?? "No results"}
          footer={({ visibleRows, totalCount }) => (
            <span className="tabular-nums">
              {visibleRows.length === totalCount
                ? `${totalCount} ${countLabelText}`
                : `${visibleRows.length} / ${totalCount} ${countLabelText}`}
            </span>
          )}
          groupLabels={{
            activity: uiLabel(uiText, "providers_activity_items", "Activity"),
            clinical: labels.providers_fachbereich ?? "Clinical",
            contact: uiLabel(uiText, "providers_contacts", "Contacts"),
            identity: uiLabel(uiText, "providers_people_person", "Person"),
            provider: labels.providers_title ?? "Provider",
          }}
          loading={loading}
          maxFrozenColumns={2}
          onRowClick={(row) => onOpenPerson(row.person_id, row)}
          rowActions={(row) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={uiLabel(uiText, "providers_open_provider", "Open provider")}
              aria-label={`${uiLabel(uiText, "providers_open_provider", "Open provider")}: ${row.provider_name}`}
              onClick={() => onOpenProvider(row.provider_id, row)}
            >
              <ArrowUpRight className="size-3.5" />
            </Button>
          )}
          rowActionsLabel={labels.table_actions ?? "Actions"}
          rowActionsWidth={48}
          rowId={(row) => `${row.person_type}:${row.person_id}:${row.provider_id}`}
          storageKey="provider-people-catalog"
          tableClassName="min-h-[360px]"
        />
      </div>

      <MobilePeopleCards
        labels={labels}
        lang={lang}
        loading={loading}
        rows={rows}
        uiText={uiText}
        onOpenPerson={onOpenPerson}
        onOpenProvider={onOpenProvider}
      />
    </section>
  );
}
