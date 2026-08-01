import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Building2,
  ChevronDown,
  CornerDownRight,
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
import { ProviderTaxonomyCascadeSelect } from "./provider-taxonomy-cascade-select";

import {
  compactDateTime,
  doctorListDisplayName,
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
  InsuranceProviderItem,
  LinkedPatient,
  ProviderPersonGender,
  ProviderStaffRoleItem,
  ProviderSummary,
  ProviderTaxonomyNode,
  ProviderType,
  SpecializationItem,
} from "../model/types";

type ProviderPeopleCatalogProps = {
  className?: string;
  error?: string | null;
  forceNonMedical?: boolean;
  filters: ProviderPeopleFilters;
  loading?: boolean;
  insuranceProviders?: readonly InsuranceProviderItem[];
  patients?: readonly ProviderPeoplePatientOption[];
  providers?: readonly ProviderSummary[];
  taxonomyNodes?: readonly ProviderTaxonomyNode[];
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

type ProviderPeopleCatalogRow = ProviderPeopleRow & {
  providerRows: ProviderPeopleRow[];
  /** Synthetic per-clinic row rendered under an expanded doctor. */
  isProviderChild?: boolean;
};

function catalogRowIdentity(row: ProviderPeopleRow) {
  return row.shared_identity_id?.trim() || row.person_id;
}

const DEFAULT_HIDDEN_COLUMNS = ["gender", "contacts", "last_interaction_at"];
const DEFAULT_FROZEN_COLUMNS = ["person"];
const EMPTY_PATIENT_OPTIONS: readonly ProviderPeoplePatientOption[] = [];
const EMPTY_PROVIDER_OPTIONS: readonly ProviderSummary[] = [];
const EMPTY_SPECIALIZATION_OPTIONS: readonly SpecializationItem[] = [];
const EMPTY_INSURANCE_PROVIDER_OPTIONS: readonly InsuranceProviderItem[] = [];
const EMPTY_STAFF_ROLE_OPTIONS: readonly ProviderStaffRoleItem[] = [];

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

function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestTimestamp(values: readonly (string | null | undefined)[]) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function mergeLinkedPatients(rows: readonly ProviderPeopleRow[]): LinkedPatient[] {
  const patients = new Map<string, LinkedPatient>();

  for (const patient of rows.flatMap((row) => row.linked_patients)) {
    const key = patient.patient_id || patient.id;
    const current = patients.get(key);
    if (!current) {
      patients.set(key, patient);
      continue;
    }

    patients.set(key, {
      ...current,
      appointment_count: current.appointment_count + patient.appointment_count,
      leistung_count: current.leistung_count + patient.leistung_count,
      concierge_count: current.concierge_count + patient.concierge_count,
      last_interaction_at:
        latestTimestamp([current.last_interaction_at, patient.last_interaction_at]) ?? "",
    });
  }

  return [...patients.values()].sort((left, right) =>
    (right.last_interaction_at || "").localeCompare(left.last_interaction_at || ""),
  );
}

function mergePeopleCounts(
  rows: readonly ProviderPeopleRow[],
  linkedPatients: readonly LinkedPatient[],
) {
  const countKeys = new Set(rows.flatMap((row) => Object.keys(row.counts)));
  const counts = Object.fromEntries(
    [...countKeys].map((countKey) => [
      countKey,
      rows.reduce((sum, row) => sum + (row.counts[countKey] ?? 0), 0),
    ]),
  );

  if (countKeys.has("patient_count")) {
    counts.patient_count = linkedPatients.length;
  }

  return counts;
}

export function groupProviderPeopleRows(
  rows: readonly ProviderPeopleRow[],
  groupDoctors = true,
): ProviderPeopleCatalogRow[] {
  const grouped = new Map<string, ProviderPeopleCatalogRow>();

  for (const row of rows) {
    const identity = row.shared_identity_id?.trim() || row.person_id;
    const key = groupDoctors && row.person_type === "doctor"
      ? `doctor:${identity}`
      : `staff:${row.person_id}:${row.provider_id}`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, { ...row, providerRows: [row] });
      continue;
    }

    const providerRows = uniqueBy([...current.providerRows, row], (item) => item.provider_id);
    const linkedPatients = mergeLinkedPatients(providerRows);

    grouped.set(key, {
      ...current,
      providerRows: [...providerRows].sort((left, right) =>
        left.provider_name.localeCompare(right.provider_name, undefined, { sensitivity: "base" }),
      ),
      specializations: uniqueBy(
        providerRows.flatMap((providerRow) => providerRow.specializations),
        (item) => item.id || item.code || item.name_en || "",
      ),
      insurance_providers: uniqueBy(
        providerRows.flatMap((providerRow) => providerRow.insurance_providers),
        (item) => item.id || item.name,
      ),
      contacts: uniqueBy(
        providerRows.flatMap((providerRow) => providerRow.contacts),
        (item) => `${item.contact_kind}:${item.value.trim().toLocaleLowerCase()}`,
      ),
      languages: uniqueBy(
        providerRows.flatMap((providerRow) => providerRow.languages),
        (item) => item.trim().toLocaleLowerCase(),
      ),
      linked_patients: linkedPatients,
      counts: mergePeopleCounts(providerRows, linkedPatients),
      last_interaction_at: latestTimestamp(
        providerRows.flatMap((providerRow) => [
          providerRow.last_interaction_at,
          ...providerRow.linked_patients.map((patient) => patient.last_interaction_at),
        ]),
      ),
    });
  }

  return [...grouped.values()];
}

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

function localizedFallback(lang: Lang, de: string, ru: string) {
  return lang === "de" ? de : ru;
}

function providerCatalogLabel(
  labels: Record<string, string>,
  lang: Lang,
  forceNonMedical: boolean,
) {
  return forceNonMedical
    ? localizedFallback(lang, "Servicepartner", "Сервисные партнёры")
    : labels.providers_title ?? localizedFallback(lang, "Provider", "Провайдер");
}

function peopleCatalogTitle(lang: Lang, forceNonMedical: boolean) {
  return forceNonMedical
    ? localizedFallback(lang, "Kontakte und Personal", "Контакты и персонал")
    : localizedFallback(lang, "Ärzte und Personal", "Врачи и персонал");
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

function contactPersonLabel(lang: Lang) {
  return localizedFallback(lang, "Kontakt", "Контакт");
}

function isContactPersonType(
  value: ProviderPeoplePersonType,
  providerType: ProviderType | "" | null | undefined,
  forceNonMedical = false,
) {
  return value === "doctor" && (forceNonMedical || providerType === "non_medical");
}

function personDisplayName(row: ProviderPeopleRow, forceNonMedical: boolean) {
  return row.person_type === "doctor" && !isContactPersonType(row.person_type, row.provider_type, forceNonMedical)
    ? doctorListDisplayName(row)
    : row.name;
}

function personTypeLabel(
  value: ProviderPeoplePersonType,
  labels: Record<string, string>,
  uiText: Record<string, string>,
  lang: Lang,
  providerType?: ProviderType | "" | null,
  forceNonMedical = false,
) {
  if (isContactPersonType(value, providerType, forceNonMedical)) {
    return contactPersonLabel(lang);
  }
  return value === "doctor"
    ? uiLabel(uiText, "providers_doctor", labelFrom(labels, "common_doctor", labels.common_not_set ?? "-"))
    : uiLabel(uiText, "providers_staff", labels.common_not_set ?? "-");
}

function genderLabel(value: ProviderPersonGender, labels: Record<string, string>) {
  switch (value) {
    case "male":
      return labelFrom(labels, "gender_male", labels.common_unknown ?? "-");
    case "female":
      return labelFrom(labels, "gender_female", labels.common_unknown ?? "-");
    default:
      return labelFrom(labels, "common_unknown", "-");
  }
}

const ROLE_CHIP_TONES: Record<string, string> = {
  // Doctor roles
  clinical_director: "border-purple-200 bg-purple-50 text-purple-700",
  chefarzt: "border-purple-200 bg-purple-50 text-purple-700",
  oberarzt: "border-sky-200 bg-sky-50 text-sky-700",
  facharzt: "border-emerald-200 bg-emerald-50 text-emerald-700",
  assistenzarzt: "border-teal-200 bg-teal-50 text-teal-700",
  // Staff roles
  administration: "border-amber-200 bg-amber-50 text-amber-700",
  coordinator: "border-amber-200 bg-amber-50 text-amber-700",
  billing: "border-orange-200 bg-orange-50 text-orange-700",
  nurse: "border-rose-200 bg-rose-50 text-rose-700",
  assistant: "border-teal-200 bg-teal-50 text-teal-700",
  reception: "border-sky-200 bg-sky-50 text-sky-700",
  secretary: "border-sky-200 bg-sky-50 text-sky-700",
  driver: "border-lime-200 bg-lime-50 text-lime-700",
};

function roleChipTone(roleCode: string | null | undefined) {
  return (
    (roleCode && ROLE_CHIP_TONES[roleCode]) ||
    "border-border/60 bg-muted/40 text-foreground"
  );
}

function roleLabel(
  row: ProviderPeopleRow,
  labels: Record<string, string>,
  uiText: Record<string, string>,
  lang: Lang,
) {
  if (row.person_type === "staff") {
    const localized = lang === "de" ? row.role_name_de : row.role_name_ru;
    if (localized?.trim()) return localized.trim();
  } else if (row.role_label?.trim()) {
    return row.role_label.trim();
  }
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
      return labelFrom(labels, "providers_linked_patients", labels.common_not_set ?? "-");
    case "appointment_count":
      return labelFrom(labels, "providers_appointments", labels.common_not_set ?? "-");
    case "leistung_count":
    case "service_count":
      return labelFrom(labels, "providers_services", labels.common_not_set ?? "-");
    case "concierge_count":
      return labelFrom(labels, "appointments_linked_concierge", labels.common_not_set ?? "-");
    case "order_count":
      return uiLabel(uiText, "orders_title", labels.common_not_set ?? "-");
    case "interaction_count":
      return uiLabel(uiText, "providers_activity_items", labels.common_not_set ?? "-");
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
  forceNonMedical,
  lang,
  row,
  labels,
  uiText,
}: {
  forceNonMedical: boolean;
  lang: Lang;
  labels: Record<string, string>;
  row: ProviderPeopleRow;
  uiText: Record<string, string>;
}) {
  const isContactPerson = isContactPersonType(row.person_type, row.provider_type, forceNonMedical);
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        row.person_type === "doctor" && !isContactPerson
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {personTypeLabel(row.person_type, labels, uiText, lang, row.provider_type, forceNonMedical)}
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
  forceNonMedical,
  row,
}: {
  forceNonMedical: boolean;
  row: ProviderPeopleRow;
}) {
  const isContactPerson = isContactPersonType(row.person_type, row.provider_type, forceNonMedical);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {row.person_type === "doctor" && !isContactPerson ? (
        <Stethoscope className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate font-mono text-xs font-medium text-foreground">
        {personDisplayName(row, forceNonMedical)}
      </span>
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
  forceNonMedical: boolean,
  onOpenProvider: (providerId: string, row: ProviderPeopleRow) => void,
  expandedDoctors: ReadonlySet<string>,
  onToggleExpanded: (row: ProviderPeopleCatalogRow) => void,
): ColumnDef<ProviderPeopleCatalogRow>[] {
  const notSet = labels.common_not_set ?? "-";
  const providerLabel = providerCatalogLabel(labels, lang, forceNonMedical);

  const columns: ColumnDef<ProviderPeopleCatalogRow>[] = [
    {
      id: "person",
      label: uiLabel(uiText, "providers_people_person", localizedFallback(lang, "Person", "Человек")),
      accessor: (row) => row.name,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 300,
      group: "identity",
      render: (row) => {
        if (row.isProviderChild) {
          return (
            <button
              type="button"
              className="group/provider flex w-full min-w-0 items-center gap-1.5 pl-7 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={(event) => {
                event.stopPropagation();
                onOpenProvider(row.provider_id, row);
              }}
            >
              <CornerDownRight className="size-3 shrink-0 text-muted-foreground/60" />
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs text-muted-foreground group-hover/provider:text-[var(--brand)]">
                {row.provider_name}
              </span>
            </button>
          );
        }
        return <PersonIdentityCell forceNonMedical={forceNonMedical} row={row} />;
      },
    },
    {
      id: "role",
      label: uiLabel(uiText, "providers_people_role", localizedFallback(lang, "Funktion", "Должность")),
      accessor: (row) => roleLabel(row, labels, uiText, lang),
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 240,
      group: "identity",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium",
              roleChipTone(row.role_code),
            )}
          >
            {roleLabel(row, labels, uiText, lang)}
          </span>
          {row.subrole ? (
            <span className="truncate font-mono text-[10px] text-foreground">
              {readableCode(row.subrole, "")}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "person_type",
      label: uiLabel(uiText, "providers_people_type", localizedFallback(lang, "Personentyp", "Тип человека")),
      accessor: (row) =>
        personTypeLabel(row.person_type, labels, uiText, lang, row.provider_type, forceNonMedical),
      filterType: "enum",
      filterOptions: [
        { value: "doctor", label: personTypeLabel("doctor", labels, uiText, lang, "", forceNonMedical) },
        { value: "staff", label: personTypeLabel("staff", labels, uiText, lang) },
      ],
      sortable: true,
      width: 130,
      group: "identity",
      render: (row) => (
        <PersonTypeBadge
          forceNonMedical={forceNonMedical}
          labels={labels}
          lang={lang}
          row={row}
          uiText={uiText}
        />
      ),
    },
    {
      id: "provider",
      label: providerLabel,
      accessor: (row) => row.provider_name,
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 260,
      group: "provider",
      render: (row) => {
        if (row.isProviderChild) {
          return (
            <span className="px-1.5">
              <ProviderTypeBadge labels={labels} providerType={row.provider_type} />
            </span>
          );
        }

        if (row.providerRows.length > 1) {
          const expanded = expandedDoctors.has(catalogRowIdentity(row));
          return (
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-foreground transition hover:bg-muted/40 hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-expanded={expanded}
              title={row.providerRows.map((providerRow) => providerRow.provider_name).join("\n")}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded(row);
              }}
            >
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {row.providerRows.length} {localizedFallback(lang, "Provider", "провайдера")}
              </span>
              <ChevronDown
                className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
              />
            </button>
          );
        }

        const primary = row.providerRows[0] ?? row;
        return (
          <button
            type="button"
            className="group/provider flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProvider(primary.provider_id, primary);
            }}
          >
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs font-medium text-foreground group-hover/provider:text-[var(--brand)]">
              {primary.provider_name}
            </span>
            <ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition group-hover/provider:-translate-y-0.5 group-hover/provider:translate-x-0.5 group-hover/provider:text-[var(--brand)]" />
            <span className="shrink-0">
              <ProviderTypeBadge labels={labels} providerType={primary.provider_type} />
            </span>
          </button>
        );
      },
    },
    {
      id: "gender",
      label: uiLabel(uiText, "patients_gender", labels.patients_gender ?? localizedFallback(lang, "Geschlecht", "Пол")),
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
      label: labels.providers_fachbereich ?? localizedFallback(lang, "Fachbereich", "Специализация"),
      accessor: (row) => specializationSummary(row, lang, ""),
      filterType: "text",
      searchable: true,
      sortable: true,
      width: 180,
      group: "clinical",
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {specializationSummary(row, lang, notSet)}
        </span>
      ),
    },
    {
      id: "specializations",
      label: uiLabel(uiText, "providers_doctor_specializations", localizedFallback(lang, "Spezialisierungen", "Специализации")),
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
      label: uiLabel(uiText, "providers_contacts", localizedFallback(lang, "Kontakte", "Контакты")),
      accessor: (row) => contactSummary(row, ""),
      filterType: "text",
      searchable: true,
      sortable: false,
      width: 240,
      group: "contact",
      render: (row) => {
        const phone = primaryContactValue(row, "phone");
        const email = primaryContactValue(row, "email");
        if (!phone && !email) {
          return <span className="text-xs text-muted-foreground">{notSet}</span>;
        }
        return (
          <div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
            {phone ? <ContactLine icon="phone" value={phone} /> : null}
            {email ? <ContactLine icon="email" value={email} /> : null}
          </div>
        );
      },
    },
    {
      id: "counts",
      label: uiLabel(uiText, "providers_people_counts", localizedFallback(lang, "Kennzahlen", "Показатели")),
      accessor: (row) => visibleCounts(row).map((count) => count.value).join(" "),
      filterType: "number",
      sortable: false,
      width: 210,
      group: "activity",
      render: (row) => <CountsInline labels={labels} row={row} uiText={uiText} />,
    },
    {
      id: "last_interaction_at",
      label: labels.providers_last_activity ?? localizedFallback(lang, "Letzte Aktivität", "Последняя активность"),
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

  return forceNonMedical ? columns.filter((column) => column.group !== "clinical") : columns;
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
  disabled,
  label,
  value,
  onChange,
}: {
  children: ReactNode;
  disabled?: boolean;
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
        disabled={disabled}
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

function providerMatchesTaxonomy(
  provider: ProviderSummary,
  taxonomyNodeId: string,
) {
  const selected = taxonomyNodeId.trim();
  if (!selected) return true;

  return new Set([
    provider.taxonomy_node_id ?? "",
    provider.taxonomy_node?.id ?? "",
    ...(provider.taxonomy_filter_ids ?? []),
    ...(provider.taxonomy_node_ids ?? []),
    ...(provider.taxonomy_path ?? []).map((node) => node.id),
  ].filter(Boolean)).has(selected);
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
  forceNonMedical = false,
  filters,
  lang,
  labels,
  patients,
  providerOptions,
  providers,
  insuranceProviders,
  taxonomyNodes,
  specializations,
  staffRoles,
  uiText,
  onFiltersChange,
  onResetFilters,
}: {
  forceNonMedical?: boolean;
  filters: ProviderPeopleFilters;
  lang: Lang;
  labels: Record<string, string>;
  patients: readonly ProviderPeoplePatientOption[];
  providerOptions: ProviderOption[];
  providers: readonly ProviderSummary[];
  insuranceProviders: readonly InsuranceProviderItem[];
  taxonomyNodes: readonly ProviderTaxonomyNode[];
  specializations: readonly SpecializationItem[];
  staffRoles: readonly ProviderStaffRoleItem[];
  uiText: Record<string, string>;
  onFiltersChange: (filters: ProviderPeopleFilters) => void;
  onResetFilters?: () => void;
}) {
  const allLabel = labels.providers_all ?? localizedFallback(lang, "Alle", "Все");
  const effectiveProviderType: ProviderPeopleFilters["providerType"] = forceNonMedical
    ? "non_medical"
    : filters.providerType;
  const providerLabel = providerCatalogLabel(labels, lang, forceNonMedical);
  const roleOptions = buildRoleOptions(filters, labels, uiText, staffRoles, lang);
  const selectedTaxonomyNode = taxonomyNodes.find((node) => node.id === filters.taxonomyNodeId);
  const showClinicalFilters =
    !forceNonMedical && effectiveProviderType !== "non_medical" && filters.personType !== "staff";
  const showPatientFilter = showClinicalFilters;
  const filteredProviderOptions = useMemo(() => {
    if ((!filters.taxonomyNodeId && !effectiveProviderType) || providers.length === 0) {
      return providerOptions;
    }
    const matchingProviderIds = new Set(
      providers
        .filter((provider) =>
          (!effectiveProviderType || provider.provider_type === effectiveProviderType) &&
          providerMatchesTaxonomy(provider, filters.taxonomyNodeId),
        )
        .map((provider) => provider.id),
    );
    return providerOptions.filter((option) => matchingProviderIds.has(option.value));
  }, [effectiveProviderType, filters.taxonomyNodeId, providerOptions, providers]);
  const activeSpecializationOptions = specializations.flatMap((item) => {
    if (!item.is_active) return [];
    return [{
      id: item.id,
      label: specializationLabelForItem(item, lang),
      value: item.code || item.name_en,
    }];
  });
  const activeInsuranceProviderOptions = insuranceProviders.flatMap((item) => {
    const label = item.name.trim();
    if (!label || item.is_active === false) return [];
    return [{ id: item.id || label, label, value: label }];
  });
  const setFilter = <K extends keyof ProviderPeopleFilters>(
    key: K,
    value: ProviderPeopleFilters[K],
  ) => onFiltersChange({ ...filters, [key]: value });
  const selectedProviderMatches = (
    providerId: string,
    providerType: ProviderPeopleFilters["providerType"],
    taxonomyNodeId: string,
  ) => {
    if (!providerId || providers.length === 0) return true;
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return false;
    return (
      (!providerType || provider.provider_type === providerType) &&
      providerMatchesTaxonomy(provider, taxonomyNodeId)
    );
  };
  const setPersonType = (value: ProviderPeopleFilters["personType"]) => {
    const patch: Partial<ProviderPeopleFilters> = { personType: value, role: "" };
    if (value === "staff" || forceNonMedical) {
      patch.fachbereich = "";
      patch.specialization = "";
      patch.patientId = "";
      patch.insuranceProvider = "";
    }
    if (forceNonMedical) patch.providerType = "non_medical";
    onFiltersChange({ ...filters, ...patch });
  };
  const setProviderType = (value: ProviderPeopleFilters["providerType"]) => {
    if (forceNonMedical) {
      onFiltersChange({
        ...filters,
        providerType: "non_medical",
        fachbereich: "",
        specialization: "",
        patientId: "",
        insuranceProvider: "",
      });
      return;
    }
    const taxonomyMatchesType =
      !filters.taxonomyNodeId ||
      !value ||
      !selectedTaxonomyNode ||
      selectedTaxonomyNode.provider_kind === value;
    const nextTaxonomyNodeId = taxonomyMatchesType ? filters.taxonomyNodeId : "";
    const patch: Partial<ProviderPeopleFilters> = {
      providerType: value,
      taxonomyNodeId: nextTaxonomyNodeId,
    };

    if (!selectedProviderMatches(filters.providerId, value, nextTaxonomyNodeId)) {
      patch.providerId = "";
    }
    if (value === "non_medical") {
      patch.fachbereich = "";
      patch.specialization = "";
      patch.patientId = "";
      patch.insuranceProvider = "";
    }
    onFiltersChange({ ...filters, ...patch });
  };
  const setTaxonomyNode = (value: string) => {
    const selectedNode = taxonomyNodes.find((node) => node.id === value);
    const nextProviderType: ProviderPeopleFilters["providerType"] =
      forceNonMedical
        ? "non_medical"
        : selectedNode?.provider_kind === "medical" || selectedNode?.provider_kind === "non_medical"
          ? selectedNode.provider_kind
          : filters.providerType;
    const patch: Partial<ProviderPeopleFilters> = {
      providerType: nextProviderType,
      taxonomyNodeId: value,
    };
    if (!selectedProviderMatches(filters.providerId, nextProviderType, value)) {
      patch.providerId = "";
    }
    if (nextProviderType === "non_medical") {
      patch.fachbereich = "";
      patch.specialization = "";
      patch.patientId = "";
      patch.insuranceProvider = "";
    }
    onFiltersChange({ ...filters, ...patch });
  };
  const reset = () => {
    if (onResetFilters) {
      onResetFilters();
      return;
    }
    onFiltersChange({
      ...DEFAULT_PROVIDER_PEOPLE_FILTERS,
      providerType: forceNonMedical ? "non_medical" : "",
    });
  };

  return (
    <div>
      <div className="grid gap-x-2 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        <label className="min-w-0">
          <FieldLabel>{labels.common_search ?? localizedFallback(lang, "Suchen", "Поиск")}</FieldLabel>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) => setFilter("search", event.target.value)}
              placeholder={
                labels.common_search_placeholder ??
                localizedFallback(lang, "Nach Name, Provider oder Funktion suchen", "Поиск по имени, провайдеру или должности")
              }
              className="h-8 rounded-md bg-background pl-8 text-xs"
            />
          </div>
        </label>

        <SelectField
          label={uiLabel(uiText, "providers_people_type", localizedFallback(lang, "Personentyp", "Тип человека"))}
          value={filters.personType}
          onChange={(value) => setPersonType(value as ProviderPeopleFilters["personType"])}
        >
          <option value="">{allLabel}</option>
          <option value="doctor">
            {effectiveProviderType === "non_medical"
              ? contactPersonLabel(lang)
              : personTypeLabel("doctor", labels, uiText, lang)}
          </option>
          <option value="staff">{personTypeLabel("staff", labels, uiText, lang)}</option>
        </SelectField>

        <label className="min-w-0">
          <FieldLabel>{labels.providers_category ?? allLabel}</FieldLabel>
          <ProviderTaxonomyCascadeSelect
            value={filters.taxonomyNodeId}
            nodes={[...taxonomyNodes]}
            providerType={effectiveProviderType}
            mode="any"
            placeholder={labels.providers_category ?? allLabel}
            allLabel={allLabel}
            selectClassName="h-8 rounded-md bg-background text-xs"
            onChange={setTaxonomyNode}
          />
        </label>

        <SelectField
          label={providerLabel}
          value={filters.providerId}
          onChange={(value) => setFilter("providerId", value)}
        >
          <option value="">{allLabel}</option>
          {filteredProviderOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={labels.providers_type ?? localizedFallback(lang, "Providertyp", "Тип провайдера")}
          value={effectiveProviderType}
          disabled={forceNonMedical}
          onChange={(value) => setProviderType(value as ProviderPeopleFilters["providerType"])}
        >
          <option value="">{allLabel}</option>
          <option value="medical">{providerTypeLabel("medical", labels)}</option>
          <option value="non_medical">{providerTypeLabel("non_medical", labels)}</option>
        </SelectField>

        <SelectField
          label={localizedFallback(lang, "Status", "Статус")}
          value={filters.activeOnly ? "true" : "false"}
          onChange={(value) => setFilter("activeOnly", value === "true")}
        >
          <option value="true">
            {localizedFallback(lang, "Nur aktive", "Только активные")}
          </option>
          <option value="false">
            {localizedFallback(lang, "Alle, einschließlich inaktive", "Все, включая неактивные")}
          </option>
        </SelectField>

        {showClinicalFilters ? (
          <>
            <TextFilterField
              label={labels.providers_fachbereich ?? localizedFallback(lang, "Fachbereich", "Специализация")}
              placeholder={labels.providers_fachbereich ?? localizedFallback(lang, "Fachbereich", "Специализация")}
              value={filters.fachbereich}
              onChange={(value) => setFilter("fachbereich", value)}
            />
            <SelectField
              label={uiLabel(uiText, "providers_doctor_specializations", localizedFallback(lang, "Spezialisierungen", "Специализации"))}
              value={filters.specialization}
              onChange={(value) => setFilter("specialization", value)}
            >
              <option value="">{allLabel}</option>
              {activeSpecializationOptions.map((option) => (
                <option key={option.id} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={localizedFallback(lang, "Versicherungen", "Страховые")}
              value={filters.insuranceProvider}
              onChange={(value) => setFilter("insuranceProvider", value)}
            >
              <option value="">{allLabel}</option>
              {activeInsuranceProviderOptions.map((option) => (
                <option key={option.id} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </>
        ) : null}
        <SelectField
          label={uiLabel(uiText, "providers_people_role", localizedFallback(lang, "Funktion", "Должность"))}
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
        {showPatientFilter ? (
          <SelectField
            label={labels.patients_title ?? localizedFallback(lang, "Patienten", "Пациенты")}
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
        ) : null}
        <div className="min-w-0 self-end">
          <FieldLabel>
            <span aria-hidden="true">&nbsp;</span>
          </FieldLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center rounded-md bg-background px-2 text-xs"
            onClick={reset}
          >
            <RotateCcw className="size-3.5" />
            {labels.common_reset ?? localizedFallback(lang, "Zurücksetzen", "Сбросить")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({
  error,
  lang,
  labels,
  onRetry,
}: {
  error: string;
  lang: Lang;
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
          {labels.common_retry ?? localizedFallback(lang, "Erneut versuchen", "Повторить")}
        </Button>
      ) : null}
    </div>
  );
}

function MobilePeopleCards({
  forceNonMedical,
  labels,
  lang,
  loading,
  rows,
  uiText,
  onOpenPerson,
  onOpenProvider,
}: {
  forceNonMedical: boolean;
  labels: Record<string, string>;
  lang: Lang;
  loading: boolean;
  rows: readonly ProviderPeopleCatalogRow[];
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
        {labels.common_no_results ?? localizedFallback(lang, "Keine Ergebnisse", "Нет результатов")}
      </div>
    );
  }

  return (
    <div className="space-y-2 md:hidden">
      {rows.map((row) => (
        <article
          key={`${row.person_type}:${row.shared_identity_id ?? row.person_id}`}
          className="rounded-lg border border-border bg-card p-3 shadow-sm"
        >
          <div className="flex items-start gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
              {row.person_type === "doctor" &&
              !isContactPersonType(row.person_type, row.provider_type, forceNonMedical) ? (
                <Stethoscope className="size-4" />
              ) : (
                <UserRound className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <h4 className="min-w-0 max-w-full break-words text-sm font-semibold text-foreground">
                  {personDisplayName(row, forceNonMedical)}
                </h4>
                <PersonTypeBadge
                  forceNonMedical={forceNonMedical}
                  labels={labels}
                  lang={lang}
                  row={row}
                  uiText={uiText}
                />
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {roleLabel(row, labels, uiText, lang)}
              </p>
              {row.providerRows.length === 1 ? (
                <p className="mt-1.5 break-words text-xs text-muted-foreground">
                  {row.provider_name}
                </p>
              ) : (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none font-medium text-foreground/75">
                    {row.providerRows.length} {localizedFallback(lang, "Provider", "провайдера")}
                  </summary>
                  <div className="mt-1 space-y-1 border-l border-border pl-2">
                    {row.providerRows.map((providerRow) => (
                      <button
                        key={providerRow.provider_id}
                        type="button"
                        className="block max-w-full truncate text-left hover:text-[var(--brand)]"
                        onClick={() => onOpenProvider(providerRow.provider_id, providerRow)}
                      >
                        {providerRow.provider_name}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
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

          <div className="mt-2.5 space-y-1.5 text-xs text-muted-foreground">
            {!forceNonMedical ? (
              <p className="break-words">
                <span className="font-medium text-foreground/75">
                  {labels.providers_fachbereich ?? localizedFallback(lang, "Fachbereich", "Специализация")}:{" "}
                </span>
                {specializationSummary(row, lang, labels.common_not_set ?? "-")}
              </p>
            ) : null}
            <p className="break-words">
              <span className="font-medium text-foreground/75">
                {uiLabel(uiText, "providers_contacts", localizedFallback(lang, "Kontakte", "Контакты"))}:{" "}
              </span>
              {contactSummary(row, labels.common_not_set ?? "-")}
            </p>
          </div>

          <div className="mt-2.5">
            <CountsInline labels={labels} row={row} uiText={uiText} />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center rounded-lg bg-muted/20"
              onClick={() => {
                const providerRow = row.providerRows[0] ?? row;
                onOpenPerson(providerRow.person_id, providerRow);
              }}
            >
              <UserRound className="size-3.5" />
              {uiLabel(uiText, "providers_people_open_person", localizedFallback(lang, "Person öffnen", "Открыть человека"))}
            </Button>
            {row.providerRows.length === 1 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 justify-center rounded-lg bg-muted/20"
                onClick={() => onOpenProvider(row.provider_id, row)}
              >
                <Building2 className="size-3.5" />
                {uiLabel(uiText, "providers_open_provider", localizedFallback(lang, "Provider öffnen", "Открыть провайдера"))}
              </Button>
            ) : (
              <span />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function ProviderPeopleCatalog({
  className,
  error,
  forceNonMedical = false,
  filters,
  insuranceProviders = EMPTY_INSURANCE_PROVIDER_OPTIONS,
  loading = false,
  patients = EMPTY_PATIENT_OPTIONS,
  providers = EMPTY_PROVIDER_OPTIONS,
  taxonomyNodes = [],
  rows,
  specializations = EMPTY_SPECIALIZATION_OPTIONS,
  staffRoles = EMPTY_STAFF_ROLE_OPTIONS,
  onFiltersChange,
  onOpenPerson,
  onOpenProvider,
  onResetFilters,
  onRetry,
}: ProviderPeopleCatalogProps) {
  const { lang, t } = useLang();
  const labels = t as unknown as Record<string, string>;
  const uiText = t.uiText as Record<string, string>;
  const groupedRows = useMemo(
    () => groupProviderPeopleRows(rows, !filters.providerId),
    [filters.providerId, rows],
  );
  const providerOptions = useMemo(() => {
    const options = providerOptionsFromProviders(providers);
    return options.length > 0 ? options : deriveProviderOptions(rows);
  }, [providers, rows]);
  const [expandedDoctors, setExpandedDoctors] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpandedDoctor = useCallback((row: ProviderPeopleCatalogRow) => {
    const identity = catalogRowIdentity(row);
    setExpandedDoctors((current) => {
      const next = new Set(current);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  }, []);
  const expandRow = useCallback(
    (row: ProviderPeopleCatalogRow) => {
      if (
        row.isProviderChild ||
        row.providerRows.length <= 1 ||
        !expandedDoctors.has(catalogRowIdentity(row))
      ) {
        return null;
      }
      return row.providerRows.map((providerRow) => ({
        ...providerRow,
        providerRows: [providerRow],
        isProviderChild: true,
      }));
    },
    [expandedDoctors],
  );
  const columns = useMemo(
    () => buildPeopleColumns(
      labels,
      uiText,
      lang,
      forceNonMedical,
      onOpenProvider,
      expandedDoctors,
      toggleExpandedDoctor,
    ),
    [expandedDoctors, forceNonMedical, labels, lang, onOpenProvider, toggleExpandedDoctor, uiText],
  );
  const title = forceNonMedical
    ? peopleCatalogTitle(lang, true)
    : uiLabel(uiText, "providers_people_catalog", peopleCatalogTitle(lang, false));
  const countLabelText = uiLabel(uiText, "providers_people_count", localizedFallback(lang, "Personen", "людей"));

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {groupedRows.length}
          </span>
        </div>
      </div>

      <FiltersBar
        forceNonMedical={forceNonMedical}
        filters={filters}
        insuranceProviders={insuranceProviders}
        lang={lang}
        labels={labels}
        patients={patients}
        providerOptions={providerOptions}
        providers={providers}
        taxonomyNodes={taxonomyNodes}
        specializations={specializations}
        staffRoles={staffRoles}
        uiText={uiText}
        onFiltersChange={onFiltersChange}
        onResetFilters={onResetFilters}
      />

      {error && !loading ? <ErrorBanner error={error} lang={lang} labels={labels} onRetry={onRetry} /> : null}

      <div className="hidden md:block">
        <DataTableSurface
          rows={groupedRows}
          columns={columns}
          defaultDensity="comfortable"
          defaultFrozenColumns={DEFAULT_FROZEN_COLUMNS}
          defaultHiddenColumns={DEFAULT_HIDDEN_COLUMNS}
          dictionary={labels}
          emptyState={labels.common_no_results ?? localizedFallback(lang, "Keine Ergebnisse", "Нет результатов")}
          footer={({ visibleRows, totalCount }) => (
            <span className="tabular-nums">
              {visibleRows.length === totalCount
                ? `${totalCount} ${countLabelText}`
                : `${visibleRows.length} / ${totalCount} ${countLabelText}`}
            </span>
          )}
          groupLabels={{
            activity: uiLabel(uiText, "providers_activity_items", localizedFallback(lang, "Aktivität", "Активность")),
            clinical: labels.providers_fachbereich ?? localizedFallback(lang, "Fachbereich", "Специализация"),
            contact: uiLabel(uiText, "providers_contacts", localizedFallback(lang, "Kontakte", "Контакты")),
            identity: uiLabel(uiText, "providers_people_person", localizedFallback(lang, "Person", "Человек")),
            provider: providerCatalogLabel(labels, lang, forceNonMedical),
          }}
          loading={loading}
          maxFrozenColumns={2}
          expandRow={expandRow}
          onRowClick={(row) => {
            if (row.isProviderChild) {
              onOpenProvider(row.provider_id, row);
              return;
            }
            const providerRow = row.providerRows[0] ?? row;
            onOpenPerson(providerRow.person_id, providerRow);
          }}
          rowId={(row) =>
            row.isProviderChild
              ? `child:${row.person_type}:${row.person_id}:${row.provider_id}`
              : `${row.person_type}:${row.shared_identity_id ?? row.person_id}`
          }
          storageKey="provider-people-catalog"
          tableClassName="min-h-[360px]"
        />
      </div>

      <MobilePeopleCards
        forceNonMedical={forceNonMedical}
        labels={labels}
        lang={lang}
        loading={loading}
        rows={groupedRows}
        uiText={uiText}
        onOpenPerson={onOpenPerson}
        onOpenProvider={onOpenProvider}
      />
    </section>
  );
}
