import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  ChevronDown,
  Copy,
  LoaderCircle,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Stethoscope,
  Trash2,
  X,
  UsersRound,
  BadgeCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Input } from "@/components/ui/input";
import { LanguageMultiSelect, languageLabel } from "@/components/ui/language-multi-select";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { formatUiText, uiText, useLang, type TranslationKey, type Translations } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import type { SortStack } from "@/components/data-table/types";
import { readDataTableState, writeDataTableState } from "@/components/data-table/url-state";

import {
  createProviderStaffRole,
  createSpecialization,
  createProvider,
  deleteProvider,
  deleteProviderDoctor,
  deleteProviderDoctorRelationship,
  deleteProviderService,
  deleteProviderStaff,
  deleteSpecialization,
  fetchProviderDetail,
  fetchInsuranceProviders,
  fetchProviderStaffRoles,
  fetchProviderTaxonomy,
  fetchProviders,
  fetchSpecializationsForAdmin,
  saveProviderDoctor,
  saveProviderDoctorRelationship,
  saveProviderService,
  saveProviderStaff,
  setProviderActive,
  setProviderStaffRoleActive,
  setSpecializationActive,
  updateProvider,
  updateProviderStaffRole,
  updateSpecialization,
} from "./data/provider-api";
import { fetchProviderPeople, fetchProviderPeoplePatients } from "./data/provider-people-api";
import {
  DEFAULT_FILTERS,
  DOCTOR_TITLE_OPTIONS,
  blankDoctorForm,
  blankProviderForm,
  blankServiceForm,
  blankStaffForm,
  applyDoctorFieldChange,
  applyStaffFieldChange,
  buildProviderAttributeValueOptionsQuery,
  buildProvidersQuery,
  compactDate,
  compactDateTime,
  composeDoctorDisplayName,
  composeStaffDisplayName,
  formatWeeklyAvailabilityDisplayItems,
  doctorIdentityValue,
  doctorToForm,
  doctorListDisplayName,
  doctorRelationshipTypeLabel,
  doctorRoleLabel,
  formatWeeklyAvailabilityValue,
  humanizeCode,
  joinDoctorTitleValue,
  makeContactFormId,
  normalizeAvailabilityEditorIntervals,
  normalizeWeeklyAvailabilitySchedule,
  normalizeDoctorTitleKey,
  parseWeeklyAvailability,
  patientLabel,
  personGenderLabel,
  providerMeta,
  providerLoadErrorMessage,
  providerOrganizationLevelLabel,
  providerPermissions,
  providerToForm,
  providerTypeLabel,
  existingDoctorLinkOptions,
  serviceToForm,
  servicePriceLabel,
  staffToForm,
  splitDoctorTitleValue,
  taxonomyAttributeValue,
  taxonomyAttributeValueOptions,
  toDoctorPayload,
  toProviderPayload,
  toServicePayload,
  toStaffPayload,
  updateTaxonomyAttributeValue,
  weeklyAvailabilityDayLabel,
} from "./model/list-model";
import {
  normalizeSpecializationLabelKey,
  specializationLabelForItem,
  specializationLabelForValue,
} from "./model/specialization-labels";
import {
  DEFAULT_PROVIDER_PEOPLE_FILTERS,
  type ProviderPeopleFilters,
  type ProviderPeoplePatientOption,
  type ProviderPeoplePersonType,
  type ProviderPeopleRow,
} from "./model/people-types";
import type {
  DoctorFormState,
  DoctorRoleCode,
  DoctorRelationship,
  DoctorSummary,
  InsuranceProviderItem,
  LinkedPatient,
  ProviderContactFormState,
  ProviderDetail,
  ProviderFilters,
  ProviderFormState,
  ProviderPermissions,
  PersonContactFormState,
  ProviderStaffRoleItem,
  ProviderSummary,
  ServiceFormState,
  ServiceItem,
  StaffFormState,
  ProviderStaff,
  ProviderTaxonomyNode,
  ProviderType,
  SpecializationItem,
} from "./model/types";
import { ProviderHierarchyTimeline } from "./ui/provider-hierarchy-timeline";
import { ProviderChildrenSection } from "./ui/provider-children-section";
import { ProviderPeopleCatalog } from "./ui/provider-people-catalog";
import { useProvidersListTableModel } from "./ui/hooks/use-providers-list-table-model";
import {
  PageHeader,
  Section,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useSecurePersistedState } from "@/lib/secure-persist";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { CountrySelect } from "@/pages/patients/ui/shared/patient-form-primitives";
import { ProviderSelectWithTaxonomyFilter } from "./ui/provider-select-with-taxonomy-filter";
import { ProviderTaxonomyCascadeSelect } from "./ui/provider-taxonomy-cascade-select";

const selectClassName = shellSelectClassName;
const formSelectClassName = cn(
  shellInputClassName,
  "w-full border border-input px-2.5 py-1 text-sm font-normal text-foreground hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/25"
);
const availabilityTimeInputClassName = cn(
  shellInputClassName,
  "h-9 min-w-0 px-2 text-sm tabular-nums [color-scheme:light] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70"
);
const providerDetailSectionClassName =
  "border-border/70 bg-card px-5 py-4 sm:px-6 sm:py-5";
const providerDetailPanelClassName = cn(
  "space-y-2.5 rounded-xl border",
  providerDetailSectionClassName,
);
const providerPrimaryActionButtonClassName =
  "h-8 rounded-lg border-[var(--brand)] bg-[var(--brand)] px-3 text-white shadow-sm hover:bg-[var(--brand)]/90 hover:text-white focus-visible:ring-[var(--brand)]/30";
const contactAddButtonClassName =
  providerPrimaryActionButtonClassName;
const textareaClassName = shellTextareaClass;
const DEFAULT_PROVIDER_SORT: SortStack = [{ field: "provider", dir: "asc" }];
const LEGACY_PROVIDER_TABLE_QUERY_KEYS = ["filters", "sort", "density", "hide"] as const;

function countAdvancedProviderFilters(filters: ProviderFilters, forceNonMedical: boolean) {
  let count = 0;
  if (!forceNonMedical && filters.providerType) count += 1;
  if (filters.activeOnly !== DEFAULT_FILTERS.activeOnly) count += 1;
  if (filters.hasContract !== DEFAULT_FILTERS.hasContract) count += 1;
  if (filters.internalRatingGte.trim()) count += 1;
  if (filters.specializations.trim()) count += 1;
  if (filters.insuranceProvider.trim()) count += 1;
  if (filters.taxonomyNodeId.trim()) count += 1;
  if (filters.taxonomyAttributeKey.trim() || filters.taxonomyAttributeValue.trim()) count += 1;
  return count;
}

const PROVIDER_REALTIME_EVENTS = [
  "provider.created",
  "provider.updated",
  "provider.deleted",
  "provider.activated",
  "provider.deactivated",
  "provider.template_created",
  "provider.template_updated",
  "provider.doctor_created",
  "provider.doctor_updated",
  "provider.doctor_deleted",
  "provider.doctor_relationship_created",
  "provider.doctor_relationship_updated",
  "provider.doctor_relationship_deleted",
  "provider.service_created",
  "provider.service_updated",
  "provider.service_deleted",
  "provider.staff_created",
  "provider.staff_updated",
  "provider.staff_deleted",
] as const;

type ContactWithPrimary = {
  id: string;
  contactKind: "phone" | "email";
  isPrimary: boolean;
};

function normalizePrimaryContacts<T extends ContactWithPrimary>(contacts: T[]): T[] {
  const firstByKind = new Map<T["contactKind"], string>();
  const primaryByKind = new Map<T["contactKind"], string>();

  for (const contact of contacts) {
    if (!firstByKind.has(contact.contactKind)) {
      firstByKind.set(contact.contactKind, contact.id);
    }
    if (contact.isPrimary && !primaryByKind.has(contact.contactKind)) {
      primaryByKind.set(contact.contactKind, contact.id);
    }
  }

  return contacts.map((contact) => {
    const primaryId = primaryByKind.get(contact.contactKind) ?? firstByKind.get(contact.contactKind);
    const isPrimary = primaryId === contact.id;
    return contact.isPrimary === isPrimary ? contact : { ...contact, isPrimary };
  });
}

function applyContactPatch<T extends ContactWithPrimary>(
  contacts: T[],
  contactId: string,
  patch: Partial<T>,
): T[] {
  let changedKind: T["contactKind"] | null = null;

  for (const contact of contacts) {
    if (contact.id === contactId) {
      changedKind = patch.contactKind ?? contact.contactKind;
      break;
    }
  }

  return contacts.map((contact) => {
    const next = contact.id === contactId ? { ...contact, ...patch } : contact;
    if (patch.isPrimary && changedKind && next.id !== contactId && next.contactKind === changedKind) {
      return { ...next, isPrimary: false };
    }
    return next;
  });
}

function cardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card",
    extra
  );
}

function stripLegacyProviderTableQuery(params: URLSearchParams) {
  for (const key of LEGACY_PROVIDER_TABLE_QUERY_KEYS) {
    params.delete(key);
  }
  return params;
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function normalizeSpecializationKey(value: string) {
  return normalizeSpecializationLabelKey(value);
}

function splitSpecializationValue(value: string) {
  const seen = new Set<string>();
  return value.split(",").flatMap((part) => {
    const trimmed = part.trim();
    const key = normalizeSpecializationKey(trimmed);
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

function joinSpecializationValue(values: string[]) {
  return values.join(", ");
}

function firstSpecializationValue(value: string) {
  return splitSpecializationValue(value)[0] ?? "";
}

function normalizeInsuranceProviderKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function splitInsuranceProviderValue(value: string) {
  const seen = new Set<string>();
  return value.split(",").flatMap((part) => {
    const trimmed = part.trim();
    const key = normalizeInsuranceProviderKey(trimmed);
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

function joinInsuranceProviderValue(values: string[]) {
  return values.join(", ");
}

function insuranceProviderFieldLabel(lang: "de" | "ru") {
  return lang === "de" ? "Versicherungen" : "Страховые";
}

function insuranceProviderPlaceholder(lang: "de" | "ru") {
  return lang === "de" ? "Versicherung auswählen" : "Выбрать страховую";
}

const INSURANCE_TYPE_OPTION_VALUES = ["private", "public", "self_pay", "foreign"] as const;

function insuranceTypeLabel(value: string, t: Translations) {
  if (value === "private") return t.insurance_private;
  if (value === "public") return t.insurance_public;
  if (value === "self_pay") return t.insurance_self_pay;
  if (value === "foreign") return t.insurance_foreign;
  return value;
}

function specializationRuLabel(item: SpecializationItem) {
  return specializationLabelForItem(item, "ru");
}

function specializationDeLabel(item: SpecializationItem) {
  return specializationLabelForItem(item, "de");
}

function specializationOptionLabel(item: SpecializationItem, lang: "de" | "ru") {
  return specializationLabelForItem(item, lang);
}

function specializationOptionValue(item: SpecializationItem) {
  return item.code || item.name_en;
}

function specializationDisplayValue(value: string, items: SpecializationItem[], lang: "de" | "ru") {
  const key = normalizeSpecializationKey(value);
  const match = items.find((item) =>
    [
      item.code,
      item.name_en,
      item.name_de,
      item.name_ru,
    ].some((candidate) => candidate && normalizeSpecializationKey(candidate) === key),
  );
  return match ? specializationOptionLabel(match, lang) : specializationLabelForValue(value, items, lang);
}

function SpecializationMultiSelect({
  value,
  items,
  disabled,
  placeholder,
  compact = false,
  onChange,
}: {
  value: string;
  items: SpecializationItem[];
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  onChange: (value: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const selected = useMemo(() => splitSpecializationValue(value), [value]);
  const selectedKeys = useMemo(
    () => new Set(selected.map(normalizeSpecializationKey)),
    [selected],
  );
  const options = useMemo(() => {
    const seen = new Set<string>();
    return items.flatMap((item) => {
      const value = specializationOptionValue(item).trim();
      const label = specializationOptionLabel(item, lang).trim();
      const key = normalizeSpecializationKey(value);
      if (!value || !label || seen.has(key)) return [];
      if (!item.is_active && !selectedKeys.has(key)) return [];
      seen.add(key);
      return [{ key: item.id || item.code || key, value, label }];
    });
  }, [items, lang, selectedKeys]);
  const availableOptions = options.filter(
    (option) => !selectedKeys.has(normalizeSpecializationKey(option.value)),
  );
  const selectPlaceholder = placeholder ?? l("providers_specialization_select_placeholder");
  const removeLabel = l("providers_specialization_remove");
  const selectedLabels = useMemo(
    () => selected.map((item) => specializationDisplayValue(item, items, lang)),
    [items, lang, selected],
  );
  const selectedTitle = selectedLabels.join(", ");
  const compactPlaceholder =
    selected.length === 0
      ? selectPlaceholder
      : selected.length === 1
        ? selectedLabels[0] ?? selectPlaceholder
        : `${selectPlaceholder}: ${selected.length}`;
  const compactSelectedOptionValues = useMemo(
    () => {
      const values: string[] = [];
      for (const option of options) {
        if (selectedKeys.has(normalizeSpecializationKey(option.value))) {
          values.push(option.value);
        }
      }
      return values;
    },
    [options, selectedKeys],
  );

  const commit = (next: string[]) => onChange(joinSpecializationValue(next));
  const addSpecialization = (nextValue: string) => {
    const trimmed = nextValue.trim();
    const key = normalizeSpecializationKey(trimmed);
    if (!trimmed || selectedKeys.has(key)) return;
    commit([...selected, trimmed]);
  };
  const removeSpecialization = (target: string) => {
    const targetKey = normalizeSpecializationKey(target);
    commit(selected.filter((item) => normalizeSpecializationKey(item) !== targetKey));
  };
  const toggleSpecialization = (nextValue: string) => {
    const trimmed = nextValue.trim();
    if (!trimmed) return;
    if (selectedKeys.has(normalizeSpecializationKey(trimmed))) {
      removeSpecialization(trimmed);
      return;
    }
    addSpecialization(trimmed);
  };

  if (compact) {
    return (
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        <NativeComboboxSelect
          value=""
          onChange={(event) => toggleSpecialization(event.target.value)}
          className={cn(formSelectClassName, "h-8 min-w-0 flex-1 bg-card text-[13px]")}
          disabled={disabled || options.length === 0}
          selectedValues={compactSelectedOptionValues}
          showValueIndicator={false}
          hidePlaceholderOption
          title={selectedTitle || selectPlaceholder}
        >
          <option value="">{compactPlaceholder}</option>
          {options.map((option) => (
            <option key={option.key} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeComboboxSelect>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn(
            "h-8 w-8 shrink-0 !bg-card hover:!bg-card",
            selected.length === 0 && "invisible",
          )}
          disabled={disabled || selected.length === 0}
          title={t.common_clear}
          aria-label={t.common_clear}
          onClick={() => commit([])}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <NativeComboboxSelect
        value=""
        onChange={(event) => addSpecialization(event.target.value)}
        className={formSelectClassName}
        disabled={disabled || availableOptions.length === 0}
      >
        <option value="">{selectPlaceholder}</option>
        {availableOptions.map((option) => (
          <option key={option.key} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeComboboxSelect>
      {selected.length > 0 ? (
        <div className="flex min-h-8 flex-wrap gap-1.5 rounded-lg border border-border/70 bg-muted/20 p-1.5">
          {selected.map((item) => (
            <Badge
              key={item}
              variant="secondary"
              className="h-7 max-w-full gap-1.5 rounded-full px-2.5 text-[12px] font-medium"
            >
              <span className="min-w-0 truncate">
                {specializationDisplayValue(item, items, lang)}
              </span>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removeSpecialization(item)}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`${removeLabel}: ${item}`}
                  title={`${removeLabel}: ${item}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InsuranceProviderMultiSelect({
  value,
  items,
  disabled,
  compact = false,
  useInsuranceTypes = false,
  onChange,
}: {
  value: string;
  items: InsuranceProviderItem[];
  disabled?: boolean;
  compact?: boolean;
  useInsuranceTypes?: boolean;
  onChange: (value: string) => void;
}) {
  const { t, lang } = useLang();
  const selected = useMemo(() => splitInsuranceProviderValue(value), [value]);
  const selectedKeys = useMemo(
    () => new Set(selected.map(normalizeInsuranceProviderKey)),
    [selected],
  );
  const options = useMemo(() => {
    if (useInsuranceTypes) {
      return INSURANCE_TYPE_OPTION_VALUES.map((option) => ({
        key: option,
        value: option,
        label: insuranceTypeLabel(option, t),
      }));
    }
    const seen = new Set<string>();
    return items.flatMap((item) => {
      const label = item.name.trim();
      const key = normalizeInsuranceProviderKey(label);
      if (!label || seen.has(key)) return [];
      if (item.is_active === false && !selectedKeys.has(key)) return [];
      seen.add(key);
      return [{ key: item.id || key, value: label, label }];
    });
  }, [items, selectedKeys, t, useInsuranceTypes]);
  const availableOptions = options.filter(
    (option) => !selectedKeys.has(normalizeInsuranceProviderKey(option.value)),
  );
  const selectPlaceholder = useInsuranceTypes
    ? t.patients_insurance_type
    : insuranceProviderPlaceholder(lang);
  const selectedCountLabel = useInsuranceTypes
    ? t.patients_insurance_type
    : insuranceProviderFieldLabel(lang);
  const selectedLabels = useMemo(
    () => selected.map((item) => (useInsuranceTypes ? insuranceTypeLabel(item, t) : item)),
    [selected, t, useInsuranceTypes],
  );
  const selectedTitle = selectedLabels.join(", ");
  const compactPlaceholder =
    selected.length === 0
      ? selectPlaceholder
      : selected.length === 1
        ? selectedLabels[0] ?? selectPlaceholder
        : `${selectedCountLabel}: ${selected.length}`;
  const compactSelectedOptionValues = useMemo(
    () =>
      options
        .filter((option) => selectedKeys.has(normalizeInsuranceProviderKey(option.value)))
        .map((option) => option.value),
    [options, selectedKeys],
  );

  const commit = (next: string[]) => onChange(joinInsuranceProviderValue(next));
  const addInsuranceProvider = (nextValue: string) => {
    const trimmed = nextValue.trim();
    const key = normalizeInsuranceProviderKey(trimmed);
    if (!trimmed || selectedKeys.has(key)) return;
    commit([...selected, trimmed]);
  };
  const removeInsuranceProvider = (target: string) => {
    const targetKey = normalizeInsuranceProviderKey(target);
    commit(selected.filter((item) => normalizeInsuranceProviderKey(item) !== targetKey));
  };
  const toggleInsuranceProvider = (nextValue: string) => {
    const trimmed = nextValue.trim();
    if (!trimmed) return;
    if (selectedKeys.has(normalizeInsuranceProviderKey(trimmed))) {
      removeInsuranceProvider(trimmed);
      return;
    }
    addInsuranceProvider(trimmed);
  };

  if (compact) {
    return (
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        <NativeComboboxSelect
          value=""
          onChange={(event) => toggleInsuranceProvider(event.target.value)}
          className={cn(formSelectClassName, "h-8 min-w-0 flex-1 bg-card text-[13px]")}
          disabled={disabled || options.length === 0}
          selectedValues={compactSelectedOptionValues}
          showValueIndicator={false}
          hidePlaceholderOption
          title={selectedTitle || selectPlaceholder}
        >
          <option value="">{compactPlaceholder}</option>
          {options.map((option) => (
            <option key={option.key} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeComboboxSelect>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn(
            "h-8 w-8 shrink-0 !bg-card hover:!bg-card",
            selected.length === 0 && "invisible",
          )}
          disabled={disabled || selected.length === 0}
          title={t.common_clear}
          aria-label={t.common_clear}
          onClick={() => commit([])}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <NativeComboboxSelect
        value=""
        onChange={(event) => addInsuranceProvider(event.target.value)}
        className={formSelectClassName}
        disabled={disabled || availableOptions.length === 0}
      >
        <option value="">{selectPlaceholder}</option>
        {availableOptions.map((option) => (
          <option key={option.key} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeComboboxSelect>
      {selected.length > 0 ? (
        <div className="flex min-h-8 flex-wrap gap-1.5 rounded-lg border border-border/70 bg-muted/20 p-1.5">
          {selected.map((item) => (
            <Badge
              key={item}
              variant="secondary"
              className="h-7 max-w-full gap-1.5 rounded-full px-2.5 text-[12px] font-medium"
            >
              <span className="min-w-0 truncate">
                {useInsuranceTypes ? insuranceTypeLabel(item, t) : item}
              </span>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removeInsuranceProvider(item)}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`${t.common_remove}: ${item}`}
                  title={`${t.common_remove}: ${item}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function taxonomyNodeLabel(node: ProviderTaxonomyNode | null | undefined, lang: "de" | "ru") {
  if (!node) return "";
  if (lang === "ru") {
    return node.name_ru || node.name_de || node.name_en || humanizeCode(node.code);
  }
  return node.name_de || node.name_en || node.name_ru || humanizeCode(node.code);
}

function taxonomyPathLabel(
  node: ProviderTaxonomyNode | null | undefined,
  nodes: ProviderTaxonomyNode[],
  lang: "de" | "ru",
  options: { omitProviderKindRoot?: boolean } = {},
) {
  if (!node) return "";
  const nodesById = new Map(nodes.map((item) => [item.id, item]));
  const path: ProviderTaxonomyNode[] = [];
  let current: ProviderTaxonomyNode | undefined = node;
  while (current) {
    path.unshift(current);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }
  const visiblePath =
    options.omitProviderKindRoot && path.length > 1 && path[0]?.level === "category"
      ? path.slice(1)
      : path;
  return visiblePath.map((item) => taxonomyNodeLabel(item, lang)).join(" / ");
}

function taxonomyLeafLabel(
  taxonomyNode: ProviderTaxonomyNode | null | undefined,
  taxonomyPath: ProviderTaxonomyNode[] | null | undefined,
  lang: "de" | "ru",
) {
  return taxonomyNodeLabel(taxonomyPath?.at(-1) ?? taxonomyNode, lang);
}

const GENERIC_TAXONOMY_FILTER_KEYS = new Set([
  "city",
  "country",
  "fachbereich",
  "specializations",
  "doctor_name",
  "doctor_fachbereich",
  "service_name",
  "has_contract",
  "internal_rating",
  "linked_patient",
]);

const TAXONOMY_ATTRIBUTE_LABELS: Record<string, { de: string; ru: string }> = {
  vehicle_class: { de: "Fahrzeugklasse", ru: "Класс автомобиля" },
  passenger_capacity: { de: "Passagierkapazitaet", ru: "Пассажировместимость" },
  medical_equipment: { de: "Medizinische Ausstattung", ru: "Медицинское оснащение" },
  airport: { de: "Flughafen", ru: "Аэропорт" },
  aircraft_type: { de: "Flugzeugtyp", ru: "Тип воздушного судна" },
  stars: { de: "Kategorie / Sterne", ru: "Категория / звёзды" },
  michelin_stars: { de: "Michelin-Sterne", ru: "Звёзды Michelin" },
  room_type: { de: "Zimmertyp", ru: "Тип номера" },
  cuisine: { de: "Kueche", ru: "Кухня" },
  diet: { de: "Diaet / Ernaehrung", ru: "Диета / питание" },
  language: { de: "Sprache", ru: "Язык" },
  music_direction: { de: "Musikrichtung", ru: "Направление музыки" },
  sport_type: { de: "Sportart", ru: "Вид спорта" },
  government_affiliation: { de: "Staatliche Zugehoerigkeit", ru: "Государственная принадлежность" },
  administrative_specialization: { de: "Verwaltungsspezialisierung", ru: "Административная специализация" },
  legal_area: { de: "Rechtsgebiet", ru: "Область права" },
};

function taxonomyAttributeKeys(node: ProviderTaxonomyNode | null | undefined) {
  return (node?.filter_keys ?? []).filter((key) => !GENERIC_TAXONOMY_FILTER_KEYS.has(key));
}

function taxonomyAttributeLabel(key: string, lang: "de" | "ru") {
  return TAXONOMY_ATTRIBUTE_LABELS[key]?.[lang] ?? humanizeCode(key);
}

function serviceTaxonomyLabel(
  service: ServiceItem,
  nodes: ProviderTaxonomyNode[],
  lang: "de" | "ru",
) {
  const node =
    service.taxonomy_node ??
    nodes.find((item) => item.id === service.taxonomy_node_id) ??
    null;
  return taxonomyPathLabel(node, nodes, lang) || taxonomyNodeLabel(node, lang);
}

function DoctorTitleMultiSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useLang();
  const selected = useMemo(() => splitDoctorTitleValue(value), [value]);
  const selectedKeys = useMemo(
    () => new Set(selected.map(normalizeDoctorTitleKey)),
    [selected],
  );
  const availableOptions = DOCTOR_TITLE_OPTIONS.filter(
    (option) => !selectedKeys.has(normalizeDoctorTitleKey(option.value)),
  );
  const commit = (next: string[]) => onChange(joinDoctorTitleValue(next));
  const addTitle = (nextValue: string) => {
    const trimmed = nextValue.trim();
    if (!trimmed || selectedKeys.has(normalizeDoctorTitleKey(trimmed))) return;
    commit([...selected, trimmed]);
  };
  const removeTitle = (target: string) => {
    const targetKey = normalizeDoctorTitleKey(target);
    commit(selected.filter((item) => normalizeDoctorTitleKey(item) !== targetKey));
  };

  return (
    <div className="space-y-2">
      <NativeComboboxSelect
        value=""
        onChange={(event) => addTitle(event.target.value)}
        className={formSelectClassName}
        disabled={disabled || availableOptions.length === 0}
      >
        <option value="">{t.providers_doctor_title}</option>
        {availableOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value}
          </option>
        ))}
      </NativeComboboxSelect>
      {selected.length > 0 ? (
        <div className="flex min-h-8 flex-wrap gap-1.5 rounded-lg border border-border/70 bg-muted/20 p-1.5">
          {selected.map((title) => (
            <Badge
              key={title}
              variant="secondary"
              className="h-7 max-w-full gap-1.5 rounded-full px-2.5 text-[12px] font-medium"
            >
              <span className="min-w-0 truncate">{title}</span>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removeTitle(title)}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`${t.common_remove}: ${title}`}
                  title={`${t.common_remove}: ${title}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type WeeklyAvailabilitySchedule = ReturnType<typeof parseWeeklyAvailability>;
type WeeklyAvailabilityRow = WeeklyAvailabilitySchedule[number];

function buildAvailabilityEditorSchedule(value: string) {
  return normalizeWeeklyAvailabilitySchedule(parseWeeklyAvailability(value));
}

function weeklyAvailabilityIntervalItems(row: WeeklyAvailabilityRow) {
  // Key by position within the day, never by the editable start/end value.
  // A value-derived key changes on every keystroke, which remounts the focused
  // input mid-edit and can still upset Safari's editing state.
  return row.intervals.map((interval, intervalIndex) => ({
    interval,
    intervalIndex,
    key: `${row.day}-${intervalIndex}`,
  }));
}

function WeeklyAvailabilityEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t, lang } = useLang();
  const [draftSchedule, setDraftSchedule] = useState<WeeklyAvailabilitySchedule>(() =>
    buildAvailabilityEditorSchedule(value),
  );

  useEffect(() => {
    setDraftSchedule(buildAvailabilityEditorSchedule(value));
  }, [value]);
  const closedLabel = lang === "de" ? "Geschlossen" : "Закрыто";
  const addIntervalLabel = lang === "de" ? "Zeit hinzufügen" : "Добавить время";
  const fromLabel = lang === "de" ? "Von" : "С";
  const toLabel = lang === "de" ? "Bis" : "До";
  const commentLabel = lang === "de" ? "Kommentar" : "Комментарий";
  const copyDayLabel = lang === "de" ? "Auf alle Tage kopieren" : "Скопировать на все дни";
  const everyDayLabel = lang === "de" ? "Alle Tage" : "Все дни";
  const weekdayRangeLabel = `${weeklyAvailabilityDayLabel("mon", lang)}-${weeklyAvailabilityDayLabel("fri", lang)}`;
  const quickPresets = [
    { label: `${weekdayRangeLabel} 08-16`, scope: "weekdays", start: "08:00", end: "16:00" },
    { label: `${weekdayRangeLabel} 09-18`, scope: "weekdays", start: "09:00", end: "18:00" },
    { label: `${everyDayLabel} 09-18`, scope: "all", start: "09:00", end: "18:00" },
    { label: "24/7", scope: "all", start: "00:00", end: "00:00" },
  ] as const;
  const defaultInterval = { start: "09:00", end: "17:00" };
  const addOneHour = (time: string) => {
    const [hourText, minuteText] = time.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour >= 23) {
      return "23:59";
    }
    return `${(hour + 1).toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  };
  const nextInterval = (intervals: WeeklyAvailabilityRow["intervals"]) => {
    const previous = intervals.at(-1);
    if (!previous?.end) return defaultInterval;
    const end = addOneHour(previous.end);
    return previous.end < end ? { start: previous.end, end } : defaultInterval;
  };
  const commit = (nextSchedule: WeeklyAvailabilitySchedule) => {
    const normalized = normalizeWeeklyAvailabilitySchedule(nextSchedule);
    const nextValue = formatWeeklyAvailabilityValue(normalized);
    setDraftSchedule(normalized);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };
  const updateDay = (
    day: WeeklyAvailabilityRow["day"],
    update: (current: WeeklyAvailabilityRow) => WeeklyAvailabilityRow,
  ) => {
    commit(draftSchedule.map((row) => (row.day === day ? update(row) : row)));
  };
  const commitCurrentDraft = () => {
    const normalized = normalizeWeeklyAvailabilitySchedule(draftSchedule);
    const nextValue = formatWeeklyAvailabilityValue(normalized);
    setDraftSchedule(normalized);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };
  const toggleDay = (day: WeeklyAvailabilityRow["day"], enabled: boolean) => {
    updateDay(day, (row) => ({
      ...row,
      enabled,
      intervals: enabled
        ? row.intervals.length > 0
          ? row.intervals
          : [defaultInterval]
        : [],
    }));
  };
  const updateInterval = (
    day: WeeklyAvailabilityRow["day"],
    index: number,
    field: "start" | "end" | "comment",
    nextValue: string,
  ) => {
    commit(
      draftSchedule.map((row) =>
        row.day === day
          ? {
              ...row,
              intervals: row.intervals.map((interval, intervalIndex) =>
                intervalIndex === index ? { ...interval, [field]: nextValue } : interval,
              ),
            }
          : row,
      ),
    );
  };
  const addInterval = (day: WeeklyAvailabilityRow["day"]) => {
    updateDay(day, (row) => {
      const intervals = normalizeAvailabilityEditorIntervals([
        ...row.intervals,
        nextInterval(row.intervals),
      ]);
      return {
        ...row,
        enabled: intervals.length > 0,
        intervals,
      };
    });
  };
  const removeInterval = (day: WeeklyAvailabilityRow["day"], index: number) => {
    updateDay(day, (row) => {
      const intervals = row.intervals.filter((_, intervalIndex) => intervalIndex !== index);
      return {
        ...row,
        enabled: intervals.length > 0,
        intervals,
      };
    });
  };
  const applyPreset = (preset: (typeof quickPresets)[number]) => {
    commit(
      draftSchedule.map((row) => {
        const applies =
          preset.scope === "all" ||
          row.day === "mon" ||
          row.day === "tue" ||
          row.day === "wed" ||
          row.day === "thu" ||
          row.day === "fri";
        return applies
          ? {
              ...row,
              enabled: true,
              intervals: [{ start: preset.start, end: preset.end }],
            }
          : {
              ...row,
              enabled: false,
              intervals: [],
            };
      }),
    );
  };
  const copyDayToAll = (sourceRow: WeeklyAvailabilityRow) => {
    const sourceIntervals = sourceRow.intervals.map((interval) => ({ ...interval }));
    commit(
      draftSchedule.map((row) => ({
        ...row,
        enabled: sourceRow.enabled && sourceIntervals.length > 0,
        intervals: sourceRow.enabled
          ? sourceIntervals.map((interval) => ({ ...interval }))
          : [],
      })),
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-2">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-2">
        {quickPresets.map((preset) => (
          <Button
            key={`${preset.scope}-${preset.start}-${preset.end}`}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-lg bg-background px-2 text-xs"
            onClick={() => applyPreset(preset)}
            disabled={disabled}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      {draftSchedule.map((row) => (
        <div
          key={row.day}
          className="grid gap-2 rounded-md border border-border/60 bg-background/70 p-2 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
        >
          <div className="flex h-9 items-center justify-between gap-2">
            <label className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) => toggleDay(row.day, event.target.checked)}
                className={checkboxClass}
                disabled={disabled}
                aria-label={weeklyAvailabilityDayLabel(row.day, lang)}
              />
              <span className="truncate text-sm font-medium text-foreground">
                {weeklyAvailabilityDayLabel(row.day, lang)}
              </span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              onClick={() => copyDayToAll(row)}
              disabled={disabled || !row.enabled || row.intervals.length === 0}
              title={copyDayLabel}
              aria-label={`${copyDayLabel}: ${weeklyAvailabilityDayLabel(row.day, lang)}`}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          {row.enabled ? (
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              {weeklyAvailabilityIntervalItems(row).map(({ interval, intervalIndex, key }) => {
                return (
                  <div key={key} className="grid w-full gap-1.5 sm:w-[18rem]">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-end gap-2">
                      <label className="flex min-w-0 flex-col gap-0.5 text-[10px] font-medium uppercase leading-tight text-muted-foreground">
                        {fromLabel}
                        <Input
                          type="time"
                          value={interval.start}
                          onChange={(event) =>
                            updateInterval(row.day, intervalIndex, "start", event.target.value)
                          }
                          onBlur={commitCurrentDraft}
                          className={availabilityTimeInputClassName}
                          disabled={disabled}
                          aria-label={`${weeklyAvailabilityDayLabel(row.day, lang)} ${fromLabel}`}
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-0.5 text-[10px] font-medium uppercase leading-tight text-muted-foreground">
                        {toLabel}
                        <Input
                          type="time"
                          value={interval.end}
                          onChange={(event) =>
                            updateInterval(row.day, intervalIndex, "end", event.target.value)
                          }
                          onBlur={commitCurrentDraft}
                          className={availabilityTimeInputClassName}
                          disabled={disabled}
                          aria-label={`${weeklyAvailabilityDayLabel(row.day, lang)} ${toLabel}`}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="h-9 w-7 rounded-lg bg-background"
                        onClick={() => removeInterval(row.day, intervalIndex)}
                        disabled={disabled}
                        title={t.common_remove}
                        aria-label={t.common_remove}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Input
                      value={interval.comment ?? ""}
                      onChange={(event) =>
                        updateInterval(row.day, intervalIndex, "comment", event.target.value)
                      }
                      onBlur={commitCurrentDraft}
                      className="h-8 w-full rounded-lg bg-background px-2 text-xs"
                      disabled={disabled}
                      placeholder={commentLabel}
                      aria-label={`${weeklyAvailabilityDayLabel(row.day, lang)} ${commentLabel}`}
                    />
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full justify-center rounded-lg bg-background px-2 text-xs sm:w-auto"
                onClick={() => addInterval(row.day)}
                disabled={disabled}
              >
                <Plus className="size-3.5 shrink-0" />
                {addIntervalLabel}
              </Button>
            </div>
          ) : (
            <div className="flex h-9 min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{closedLabel}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg bg-background px-2 text-xs"
                onClick={() => addInterval(row.day)}
                disabled={disabled}
              >
                <Plus className="size-3.5 shrink-0" />
                {addIntervalLabel}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
      <span className="min-w-0 truncate">{title}</span>
    </span>
  );
}

function Banner({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </div>
  );
}

function EmptyPanel({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-zinc-200 bg-zinc-50/90 px-5 py-6">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{text}</p>
    </div>
  );
}

type ProvidersPageProps = {
  detailRouteId?: string;
};

type ProviderCatalogMode = "providers" | "people";

type CatalogPersonContext = {
  providerId: string;
  personId: string;
  personType: ProviderPeoplePersonType;
  providerType: ProviderType;
};

type DoctorDetailView =
  | {
      source: "provider";
      providerName: string;
      providerType: ProviderType;
      doctor: DoctorSummary;
    }
  | {
      source: "catalog";
      row: ProviderPeopleRow;
    };

type StaffDetailView =
  | {
      source: "provider";
      providerName: string;
      staff: ProviderStaff;
    }
  | {
      source: "catalog";
      row: ProviderPeopleRow;
    };

type DoctorRelationshipFormState = {
  id: string;
  sourceDoctorId: string;
  targetProviderId: string;
  targetDoctorId: string;
  relationshipType: DoctorRelationship["relationship_type"];
  description: string;
  notes: string;
  isActive: boolean;
};

const DOCTOR_ROLE_CODES: readonly DoctorRoleCode[] = [
  "clinical_director",
  "chefarzt",
  "oberarzt",
  "facharzt",
  "assistenzarzt",
  "other",
];

function isDoctorRoleCode(value: string | null | undefined): value is DoctorRoleCode {
  return DOCTOR_ROLE_CODES.includes(value as DoctorRoleCode);
}

function providerPeopleSpecializationsToText(row: ProviderPeopleRow) {
  const labels: string[] = [];
  for (const item of row.specializations) {
    const label = item.code || item.name_en || "";
    if (label) {
      labels.push(label);
    }
  }
  return labels.length > 0 ? labels.join(", ") : row.fachbereich ?? "";
}

function providerPeopleInsuranceProvidersToText(row: ProviderPeopleRow) {
  return row.insurance_providers
    .flatMap((item) => {
      const label = item.name.trim();
      return label ? [label] : [];
    })
    .join(", ");
}

function providerPeopleContactsToForm(row: ProviderPeopleRow): DoctorFormState["contacts"] {
  const contacts = row.contacts.flatMap((contact, index): DoctorFormState["contacts"] => {
    const value = contact.value.trim();
    if (!value) return [];
    return [{
      id: contact.id ?? makeContactFormId(`person-contact-${index}`),
      contactKind: contact.contact_kind === "email" ? "email" : "phone",
      contactType:
        contact.contact_type === "private" || contact.contact_type === "other"
          ? contact.contact_type
          : "work",
      value,
      isPrimary: contact.is_primary,
      notes: contact.notes ?? "",
    }];
  });

  if (contacts.length === 0) {
    if (row.phone) {
      contacts.push({
        id: makeContactFormId("person-phone"),
        contactKind: "phone",
        contactType: "work",
        value: row.phone,
        isPrimary: true,
        notes: "",
      });
    }
    if (row.email) {
      contacts.push({
        id: makeContactFormId("person-email"),
        contactKind: "email",
        contactType: "work",
        value: row.email,
        isPrimary: true,
        notes: "",
      });
    }
  }

  return normalizePrimaryContacts(contacts);
}

function providerPeopleDoctorToForm(row: ProviderPeopleRow): DoctorFormState {
  const roleCode = isDoctorRoleCode(row.role_code) ? row.role_code : row.role_code ? "other" : "";
  const contacts = providerPeopleContactsToForm(row);
  return {
    ...blankDoctorForm(),
    id: row.person_id,
    sharedIdentityId: row.shared_identity_id ?? row.person_id,
    name: row.display_name ?? row.name,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    title: row.title ?? "",
    roleCode,
    roleLabel: roleCode === "other" ? row.role_label ?? row.role_code ?? "" : row.role_label ?? "",
    subrole: row.subrole ?? "",
    website: row.website ?? "",
    schwerpunkt: row.schwerpunkt ?? "",
    gender: row.gender,
    openingHours: row.opening_hours ?? "",
    fachbereich: row.fachbereich ?? "",
    specializations: providerPeopleSpecializationsToText(row),
    insuranceProviders: providerPeopleInsuranceProvidersToText(row),
    languages: row.languages.join(", "),
    phone: row.phone ?? "",
    email: row.email ?? "",
    contacts,
    licenseNumber: row.license_number ?? "",
    licensingCountry: row.licensing_country ?? "",
    licensingValidUntil: row.licensing_valid_until ?? "",
    notes: row.notes ?? "",
  };
}

function providerPeopleDoctorToNewProviderForm(row: ProviderPeopleRow): DoctorFormState {
  return {
    ...providerPeopleDoctorToForm(row),
    id: "",
    sharedIdentityId: doctorIdentityValue(row),
  };
}

function providerPeopleDoctorOptionLabel(row: ProviderPeopleRow) {
  const name =
    doctorListDisplayName({
      name: row.display_name ?? row.name,
      title: row.title,
      gender: row.gender,
    }) || row.name;
  return [name, row.provider_name].filter(Boolean).join(" - ");
}

function providerDoctorFormForPayload(
  form: DoctorFormState,
  providerType: ProviderType,
): DoctorFormState {
  if (providerType === "medical") return form;

  return {
    ...form,
    title: "",
    roleCode: "",
    roleLabel: "",
    fachbereich: "",
    schwerpunkt: "",
    specializations: "",
    insuranceProviders: "",
    licenseNumber: "",
    licensingCountry: "",
    licensingValidUntil: "",
  };
}

function providerPeopleStaffToForm(row: ProviderPeopleRow): StaffFormState {
  const contacts = providerPeopleContactsToForm(row);
  const firstName = row.first_name ?? "";
  const lastName = row.last_name ?? "";
  const gender = row.gender;
  return {
    ...blankStaffForm(),
    id: row.person_id,
    firstName,
    lastName,
    displayName: composeStaffDisplayName(firstName, lastName, gender) || row.display_name || row.name,
    role: row.role_code ?? "staff",
    department: row.department ?? "",
    gender,
    openingHours: row.opening_hours ?? "",
    status: row.status,
    phone: row.phone ?? "",
    email: row.email ?? "",
    contacts,
    notes: row.notes ?? "",
  };
}

type ProvidersPageState = {
  sortStack: SortStack;
  providers: ProviderSummary[];
  listBusy: boolean;
  listError: string;
  listVersion: number;
  taxonomyNodes: ProviderTaxonomyNode[];
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  specializationDialogOpen: boolean;
  specializationBusy: boolean;
  specializationError: string;
  staffRoles: ProviderStaffRoleItem[];
  parentProviderOptions: ProviderSummary[];
  peopleRows: ProviderPeopleRow[];
  peoplePatientOptions: ProviderPeoplePatientOption[];
  peopleBusy: boolean;
  peopleError: string;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  createForm: ProviderFormState;
  detailOpen: boolean;
  selectedId: string;
  detail: ProviderDetail | null;
  detailBusy: boolean;
  detailError: string;
  detailVersion: number;
  providerForm: ProviderFormState;
  providerBusy: boolean;
  providerError: string;
  providerActionBusy: string | null;
  doctorForm: DoctorFormState;
  doctorDialogOpen: boolean;
  doctorBusy: boolean;
  doctorError: string;
  relationshipForm: DoctorRelationshipFormState;
  relationshipDialogOpen: boolean;
  relationshipBusy: boolean;
  relationshipError: string;
  relationshipTargetDoctors: DoctorSummary[];
  relationshipTargetDoctorsBusy: boolean;
  serviceForm: ServiceFormState;
  serviceDialogOpen: boolean;
  serviceBusy: boolean;
  serviceError: string;
  staffForm: StaffFormState;
  staffDialogOpen: boolean;
  staffRoleDialogOpen: boolean;
  staffRoleBusy: boolean;
  staffRoleError: string;
  staffBusy: boolean;
  staffError: string;
};

type RelationshipDeleteTarget = {
  sourceDoctorId: string;
  relationshipId: string;
  doctorName: string;
};

type ProvidersPagePatch =
  | Partial<ProvidersPageState>
  | ((current: ProvidersPageState) => Partial<ProvidersPageState>);

function providersPageReducer(
  state: ProvidersPageState,
  patch: ProvidersPagePatch,
): ProvidersPageState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createProvidersPageFieldPatch<K extends keyof ProvidersPageState>(
  field: K,
  value: SetStateAction<ProvidersPageState[K]>,
): ProvidersPagePatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: ProvidersPageState[K]) => ProvidersPageState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<ProvidersPageState>;
  };
}

function blankDoctorRelationshipForm(
  sourceDoctorId = "",
  targetProviderId = "",
): DoctorRelationshipFormState {
  return {
    id: "",
    sourceDoctorId,
    targetProviderId,
    targetDoctorId: "",
    relationshipType: "professional",
    description: "",
    notes: "",
    isActive: true,
  };
}

function normalizeProviderPeopleFiltersForScope(
  filters: ProviderPeopleFilters,
  forceNonMedical: boolean,
): ProviderPeopleFilters {
  if (!forceNonMedical) return filters;
  return {
    ...filters,
    providerType: "non_medical",
    fachbereich: "",
    specialization: "",
    patientId: "",
    insuranceProvider: "",
  };
}

function useProvidersPageContent({ detailRouteId = "" }: ProvidersPageProps = {}) {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = { ...t.uiText, ...t } as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;
  const detailPageMode = Boolean(detailRouteId);
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const providerDetailReturnTo = searchParams.get("return_to") ?? "";
  const providerDetailBackPath =
    providerDetailReturnTo.startsWith("/") && !providerDetailReturnTo.startsWith("//")
      ? providerDetailReturnTo
      : "/providers";
  const permissions = useMemo(() => providerPermissions(user?.role), [user?.role]);
  const providerPageCopy = useMemo(() => {
    if (!permissions.forceNonMedical) {
      return {
        createDescription: t.providers_create_description,
        newLabel: t.providers_new,
        peopleLabel:
          t.uiText.providers_people_catalog ??
          (lang === "de" ? "Ärzte und Personal" : "Врачи и персонал"),
        subtitle: t.providers_subtitle,
        title: t.providers_title,
      };
    }
    if (lang === "de") {
      return {
        createDescription:
          "Servicepartner mit Kontakten, Vertragsnotizen und operativer Kategorie anlegen.",
        newLabel: "Neuer Servicepartner",
        peopleLabel: "Kontakte und Personal",
        subtitle: "Servicepartner, Kontakte und Leistungskatalog verwalten",
        title: "Servicepartner",
      };
    }
    return {
      createDescription:
        "Добавьте сервисного партнёра с контактами, договорными заметками и операционной категорией.",
      newLabel: "Новый сервисный партнёр",
      peopleLabel: "Контакты и персонал",
      subtitle: "Управление сервисными партнёрами, контактами и каталогом услуг",
      title: "Сервисные партнёры",
    };
  }, [
    lang,
    permissions.forceNonMedical,
    t.providers_create_description,
    t.providers_new,
    t.providers_subtitle,
    t.providers_title,
    t.uiText.providers_people_catalog,
  ]);
  const relationshipTargetDoctorsRequestRef = useRef(0);
  const [catalogMode, setCatalogModeState] = useState<ProviderCatalogMode>(() =>
    searchParams.get("mode") === "people" ? "people" : "providers",
  );
  const [catalogPersonContext, setCatalogPersonContext] = useState<CatalogPersonContext | null>(null);
  const [providerEditOpen, setProviderEditOpen] = useState(false);
  const [doctorDetailView, setDoctorDetailView] = useState<DoctorDetailView | null>(null);
  const [staffDetailView, setStaffDetailView] = useState<StaffDetailView | null>(null);
  const [peopleFilters, setPeopleFilters] = useState<ProviderPeopleFilters>(() =>
    normalizeProviderPeopleFiltersForScope(
      {
        ...DEFAULT_PROVIDER_PEOPLE_FILTERS,
        search: searchParams.get("people_search") ?? "",
        personType:
          searchParams.get("person_type") === "doctor" || searchParams.get("person_type") === "staff"
            ? (searchParams.get("person_type") as ProviderPeopleFilters["personType"])
            : "",
        providerId: searchParams.get("people_provider") ?? "",
        providerType:
          searchParams.get("people_provider_type") === "medical" ||
          searchParams.get("people_provider_type") === "non_medical"
            ? (searchParams.get("people_provider_type") as ProviderPeopleFilters["providerType"])
            : "",
        taxonomyNodeId: searchParams.get("people_taxonomy") ?? "",
        gender:
          searchParams.get("people_gender") === "male" ||
          searchParams.get("people_gender") === "female" ||
          searchParams.get("people_gender") === "unknown"
            ? (searchParams.get("people_gender") as ProviderPeopleFilters["gender"])
            : "",
        fachbereich: searchParams.get("people_fachbereich") ?? "",
        specialization: searchParams.get("people_specialization") ?? "",
        role: searchParams.get("people_role") ?? "",
        patientId: searchParams.get("people_patient") ?? "",
        insuranceProvider: searchParams.get("people_insurance") ?? "",
      },
      permissions.forceNonMedical,
    ),
  );
  const [peopleVersion, setPeopleVersion] = useState(0);
  type PersistedProviderFilters = Pick<
    ProviderFilters,
    "providerType" | "activeOnly" | "hasContract"
  >;
  const persistedDefaults: PersistedProviderFilters = {
    providerType: permissions.forceNonMedical ? "non_medical" : DEFAULT_FILTERS.providerType,
    activeOnly: DEFAULT_FILTERS.activeOnly,
    hasContract: DEFAULT_FILTERS.hasContract,
  };
  const [persistedProviderFilters, setPersistedProviderFilters] =
    useSecurePersistedState<PersistedProviderFilters>(
      "providers.filters",
      persistedDefaults,
      {
        schemaVersion: 1,
        validate: (value): value is PersistedProviderFilters =>
          Boolean(value) &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).providerType === "string" &&
          typeof (value as Record<string, unknown>).activeOnly === "string" &&
          typeof (value as Record<string, unknown>).hasContract === "string",
      },
    );
  const [filters, setFiltersState] = useState<ProviderFilters>(() => {
    const base: ProviderFilters = {
      ...DEFAULT_FILTERS,
      providerType: permissions.forceNonMedical
        ? "non_medical"
        : persistedProviderFilters.providerType,
      activeOnly: persistedProviderFilters.activeOnly,
      hasContract: persistedProviderFilters.hasContract,
    };
    if (typeof window === "undefined") return base;

    const params = new URLSearchParams(window.location.search);
    const tableState = readDataTableState(params);
    const activeOnly = params.get("active");
    const providerType = params.get("provider_type");
    const hasContract = params.get("contract");
    const specializations = params.get("specializations");
    const taxonomyNodeId = params.get("taxonomy");
    const internalRatingGte = params.get("internal_rating");
    const taxonomyAttributeKey = params.get("attr_key");
    const taxonomyAttributeValue = params.get("attr_value");
    const insuranceProvider = params.get("insurance");

    return {
      ...base,
      search: tableState.search ?? "",
      providerType: permissions.forceNonMedical
        ? "non_medical"
        : providerType === "medical" || providerType === "non_medical"
          ? providerType
          : base.providerType,
      activeOnly:
        activeOnly === "" || activeOnly === "true" || activeOnly === "false"
          ? activeOnly
          : base.activeOnly,
      hasContract:
        hasContract === "true" || hasContract === "false" ? hasContract : base.hasContract,
      specializations: specializations ?? base.specializations,
      taxonomyNodeId: taxonomyNodeId ?? base.taxonomyNodeId,
      taxonomyAttributeKey: taxonomyAttributeKey ?? base.taxonomyAttributeKey,
      taxonomyAttributeValue: taxonomyAttributeValue ?? base.taxonomyAttributeValue,
      internalRatingGte: internalRatingGte ?? base.internalRatingGte,
      insuranceProvider: insuranceProvider ?? base.insuranceProvider,
    };
  });
  const [providerFiltersOpen, setProviderFiltersOpen] = useState(
    () => countAdvancedProviderFilters(filters, permissions.forceNonMedical) > 0,
  );
  const setFilters: typeof setFiltersState = useCallback(
    (value) => {
      setFiltersState((prev) => {
        const next = typeof value === "function"
          ? (value as (p: ProviderFilters) => ProviderFilters)(prev)
          : value;
        setPersistedProviderFilters({
          providerType: next.providerType,
          activeOnly: next.activeOnly,
          hasContract: next.hasContract,
        });
        return next;
      });
    },
    [setPersistedProviderFilters],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const [pageState, dispatchPageState] = useReducer(
    providersPageReducer,
    undefined,
    (): ProvidersPageState => {
      return {
        sortStack: DEFAULT_PROVIDER_SORT,
        providers: [],
        listBusy: false,
        listError: "",
        listVersion: 0,
        taxonomyNodes: [],
        specializations: [],
        insuranceProviders: [],
        specializationDialogOpen: false,
        specializationBusy: false,
        specializationError: "",
        staffRoles: [],
        parentProviderOptions: [],
        peopleRows: [],
        peoplePatientOptions: [],
        peopleBusy: false,
        peopleError: "",
        createOpen: false,
        createBusy: false,
        createError: "",
        createForm: blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"),
        detailOpen: false,
        selectedId: "",
        detail: null,
        detailBusy: false,
        detailError: "",
        detailVersion: 0,
        providerForm: blankProviderForm(),
        providerBusy: false,
        providerError: "",
        providerActionBusy: null,
        doctorForm: blankDoctorForm(),
        doctorDialogOpen: false,
        doctorBusy: false,
        doctorError: "",
        relationshipForm: blankDoctorRelationshipForm(),
        relationshipDialogOpen: false,
        relationshipBusy: false,
        relationshipError: "",
        relationshipTargetDoctors: [],
        relationshipTargetDoctorsBusy: false,
        serviceForm: blankServiceForm(),
        serviceDialogOpen: false,
        serviceBusy: false,
        serviceError: "",
        staffForm: blankStaffForm(),
        staffDialogOpen: false,
        staffRoleDialogOpen: false,
        staffRoleBusy: false,
        staffRoleError: "",
        staffBusy: false,
        staffError: "",
      };
    },
  );
  const {
    sortStack,
    providers,
    listBusy,
    listError,
    listVersion,
    taxonomyNodes,
    specializations,
    insuranceProviders,
    specializationDialogOpen,
    specializationBusy,
    specializationError,
    staffRoles,
    parentProviderOptions,
    peopleRows,
    peoplePatientOptions,
    peopleBusy,
    peopleError,
    createOpen,
    createBusy,
    createError,
    createForm,
    detailOpen,
    selectedId,
    detail,
    detailBusy,
    detailError,
    detailVersion,
    providerForm,
    providerBusy,
    providerError,
    providerActionBusy,
    doctorForm,
    doctorDialogOpen,
    doctorBusy,
    doctorError,
    relationshipForm,
    relationshipDialogOpen,
    relationshipBusy,
    relationshipError,
    relationshipTargetDoctors,
    relationshipTargetDoctorsBusy,
    serviceForm,
    serviceDialogOpen,
    serviceBusy,
    serviceError,
    staffForm,
    staffDialogOpen,
    staffRoleDialogOpen,
    staffRoleBusy,
    staffRoleError,
    staffBusy,
    staffError,
  } = pageState;
  const [attributeOptionProviders, setAttributeOptionProviders] = useState<ProviderSummary[]>([]);
  const [existingDoctorOptions, setExistingDoctorOptions] = useState<ProviderPeopleRow[]>([]);
  const [existingDoctorOptionsBusy, setExistingDoctorOptionsBusy] = useState(false);
  const [existingDoctorOptionsError, setExistingDoctorOptionsError] = useState("");
  const [relationshipDeleteTarget, setRelationshipDeleteTarget] =
    useState<RelationshipDeleteTarget | null>(null);
  const setProvidersPageField = <K extends keyof ProvidersPageState>(
    field: K,
    value: SetStateAction<ProvidersPageState[K]>,
  ) => dispatchPageState(createProvidersPageFieldPatch(field, value));
  const setProviders = (value: SetStateAction<ProviderSummary[]>) =>
    setProvidersPageField("providers", value);
  const setListBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("listBusy", value);
  const setListError = (value: SetStateAction<string>) =>
    setProvidersPageField("listError", value);
  const setListVersion = (value: SetStateAction<number>) =>
    setProvidersPageField("listVersion", value);
  const setSpecializations = (value: SetStateAction<SpecializationItem[]>) =>
    setProvidersPageField("specializations", value);
  const setInsuranceProviders = (value: SetStateAction<InsuranceProviderItem[]>) =>
    setProvidersPageField("insuranceProviders", value);
  const setSpecializationDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("specializationDialogOpen", value);
  const setSpecializationBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("specializationBusy", value);
  const setSpecializationError = (value: SetStateAction<string>) =>
    setProvidersPageField("specializationError", value);
  const setStaffRoles = (value: SetStateAction<ProviderStaffRoleItem[]>) =>
    setProvidersPageField("staffRoles", value);
  const setCreateOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("createOpen", value);
  const setCreateBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("createBusy", value);
  const setCreateError = (value: SetStateAction<string>) =>
    setProvidersPageField("createError", value);
  const setCreateForm = (value: SetStateAction<ProviderFormState>) =>
    setProvidersPageField("createForm", value);
  const setDetailOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("detailOpen", value);
  const setSelectedId = (value: SetStateAction<string>) =>
    setProvidersPageField("selectedId", value);
  const setDetail = (value: SetStateAction<ProviderDetail | null>) =>
    setProvidersPageField("detail", value);
  const setDetailBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("detailBusy", value);
  const setDetailError = (value: SetStateAction<string>) =>
    setProvidersPageField("detailError", value);
  const setDetailVersion = (value: SetStateAction<number>) =>
    setProvidersPageField("detailVersion", value);
  const setProviderForm = (value: SetStateAction<ProviderFormState>) =>
    setProvidersPageField("providerForm", value);
  const setProviderBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("providerBusy", value);
  const setProviderError = (value: SetStateAction<string>) =>
    setProvidersPageField("providerError", value);
  const setProviderActionBusy = (value: SetStateAction<string | null>) =>
    setProvidersPageField("providerActionBusy", value);
  const setDoctorForm = (value: SetStateAction<DoctorFormState>) =>
    setProvidersPageField("doctorForm", value);
  const setDoctorDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("doctorDialogOpen", value);
  const setDoctorBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("doctorBusy", value);
  const setDoctorError = (value: SetStateAction<string>) =>
    setProvidersPageField("doctorError", value);
  const setRelationshipForm = (value: SetStateAction<DoctorRelationshipFormState>) =>
    setProvidersPageField("relationshipForm", value);
  const setRelationshipDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("relationshipDialogOpen", value);
  const setRelationshipBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("relationshipBusy", value);
  const setRelationshipError = (value: SetStateAction<string>) =>
    setProvidersPageField("relationshipError", value);
  const setRelationshipTargetDoctors = (value: SetStateAction<DoctorSummary[]>) =>
    setProvidersPageField("relationshipTargetDoctors", value);
  const setRelationshipTargetDoctorsBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("relationshipTargetDoctorsBusy", value);
  const setServiceForm = (value: SetStateAction<ServiceFormState>) =>
    setProvidersPageField("serviceForm", value);
  const setServiceDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("serviceDialogOpen", value);
  const setServiceBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("serviceBusy", value);
  const setServiceError = (value: SetStateAction<string>) =>
    setProvidersPageField("serviceError", value);
  const setStaffForm = (value: SetStateAction<StaffFormState>) =>
    setProvidersPageField("staffForm", value);
  const setStaffDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("staffDialogOpen", value);
  const setStaffRoleDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("staffRoleDialogOpen", value);
  const setStaffRoleBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("staffRoleBusy", value);
  const setStaffRoleError = (value: SetStateAction<string>) =>
    setProvidersPageField("staffRoleError", value);
  const setStaffBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("staffBusy", value);
  const setStaffError = (value: SetStateAction<string>) =>
    setProvidersPageField("staffError", value);

  const effectiveFilters = useMemo<ProviderFilters>(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );

  const providersPath = useMemo(
    () => buildProvidersQuery(effectiveFilters, permissions.forceNonMedical),
    [effectiveFilters, permissions.forceNonMedical]
  );
  const attributeValueOptionsPath = useMemo(
    () =>
      buildProviderAttributeValueOptionsQuery(
        effectiveFilters,
        permissions.forceNonMedical,
      ),
    [effectiveFilters, permissions.forceNonMedical],
  );

  const relationshipProviderOptions = useMemo(() => {
    // A doctor↔doctor relationship needs a target doctor, so only providers that
    // actually have doctors can be a valid target. Hiding doctorless providers
    // keeps the user from picking a dead end where the save button stays disabled.
    const withDoctors = parentProviderOptions.filter(
      (provider) => provider.doctor_count > 0,
    );
    if (!detail) return withDoctors;
    if (withDoctors.some((provider) => provider.id === detail.id)) {
      return withDoctors;
    }
    if (detail.doctors.length === 0) {
      return withDoctors;
    }
    const currentProvider: ProviderSummary = {
      id: detail.id,
      name: detail.name,
      provider_type: detail.provider_type,
      legal_name: detail.legal_name,
      tax_id: detail.tax_id,
      address_city: detail.address_city,
      address_country: detail.address_country,
      fachbereich: detail.fachbereich,
      phone: detail.phone,
      email: detail.email,
      opening_hours: detail.opening_hours,
      parent_provider_id: detail.parent_provider_id,
      parent_provider_name: detail.parent_provider_name,
      organization_level: detail.organization_level,
      taxonomy_node_id: detail.taxonomy_node_id,
      taxonomy_node_ids: detail.taxonomy_node_ids,
      taxonomy_node: detail.taxonomy_node,
      taxonomy_path: detail.taxonomy_path,
      taxonomy_attributes: detail.taxonomy_attributes,
      specializations: detail.specializations,
      insurance_providers: detail.insurance_providers,
      is_active: detail.is_active,
      has_contract: detail.kooperationsvertrag !== null && detail.kooperationsvertrag !== undefined,
      doctor_count: detail.doctors.length,
      patient_count: detail.linked_patients.length,
      appointment_count: 0,
      service_count: detail.services.length,
      concierge_service_count: 0,
      open_concierge_service_count: 0,
      rating_count: 0,
      avg_rating: null,
      last_interaction_at: null,
      created_at: detail.created_at,
    };
    return [currentProvider, ...withDoctors];
  }, [detail, parentProviderOptions]);

  const { metrics, sortedAndFilteredProviders } = useProvidersListTableModel({
    deferredSearch: "",
    lang,
    providers,
    sortStack: deferredSearch.trim() ? [] : sortStack,
    tr,
  });
  const selectedFilterTaxonomyNode = taxonomyNodes.find(
    (node) => node.id === filters.taxonomyNodeId,
  );
  const filterAttributeKeys = taxonomyAttributeKeys(selectedFilterTaxonomyNode);
  const filterAttributeValueOptions = useMemo(
    () =>
      taxonomyAttributeValueOptions(
        attributeOptionProviders,
        filters.taxonomyAttributeKey,
      ),
    [attributeOptionProviders, filters.taxonomyAttributeKey],
  );
  const advancedProviderFilterCount = useMemo(
    () => countAdvancedProviderFilters(filters, permissions.forceNonMedical),
    [filters, permissions.forceNonMedical],
  );

  function setSearch(value: string) {
    setFilters((current) => ({ ...current, search: value }));
    const params = stripLegacyProviderTableQuery(
      writeDataTableState(new URLSearchParams(searchParams), { search: value }),
    );
    setSearchParams(params, { replace: true });
  }

  function setServerFilter(key: keyof ProviderFilters, value: string, queryKey: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    syncQuery({ [queryKey]: value || null });
  }

  function setCatalogMode(nextMode: ProviderCatalogMode) {
    setCatalogModeState(nextMode);
    syncQuery({ mode: nextMode === "people" ? "people" : null });
  }

  function syncPeopleFilters(nextFilters: ProviderPeopleFilters) {
    syncQuery({
      people_search: nextFilters.search || null,
      person_type: nextFilters.personType || null,
      people_provider: nextFilters.providerId || null,
      people_provider_type: nextFilters.providerType || null,
      people_taxonomy: nextFilters.taxonomyNodeId || null,
      people_gender: nextFilters.gender || null,
      people_fachbereich: nextFilters.fachbereich || null,
      people_specialization: nextFilters.specialization || null,
      people_role: nextFilters.role || null,
      people_patient: nextFilters.patientId || null,
      people_insurance: nextFilters.insuranceProvider || null,
    });
  }

  function handlePeopleFiltersChange(nextFilters: ProviderPeopleFilters) {
    const scopedFilters = normalizeProviderPeopleFiltersForScope(
      nextFilters,
      permissions.forceNonMedical,
    );
    setPeopleFilters(scopedFilters);
    syncPeopleFilters(scopedFilters);
  }

  function resetPeopleFilters() {
    const nextFilters = normalizeProviderPeopleFiltersForScope(
      DEFAULT_PROVIDER_PEOPLE_FILTERS,
      permissions.forceNonMedical,
    );
    setPeopleFilters(nextFilters);
    syncPeopleFilters(nextFilters);
  }

  function refreshPeople() {
    setPeopleVersion((current) => current + 1);
  }

  function syncQuery(next: Record<string, string | null>) {
    const params = stripLegacyProviderTableQuery(new URLSearchParams(searchParams));
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (
      !filters.taxonomyAttributeKey ||
      !filters.taxonomyAttributeValue ||
      filterAttributeValueOptions.length === 0 ||
      filterAttributeValueOptions.includes(filters.taxonomyAttributeValue)
    ) {
      return;
    }

    setFilters((current) =>
      current.taxonomyAttributeValue === filters.taxonomyAttributeValue
        ? { ...current, taxonomyAttributeValue: "" }
        : current,
    );
    syncQuery({ attr_value: null });
  }, [
    filterAttributeValueOptions,
    filters.taxonomyAttributeKey,
    filters.taxonomyAttributeValue,
    searchParams,
  ]);

  const applyDetailRouteState = useCallback((providerId: string) => {
    setSelectedId(providerId);
    setDetailOpen(Boolean(providerId));
    setDetail(null);
  }, []);

  const openProviderFromQuery = useCallback((providerId: string) => {
    setSelectedId(providerId);
    setDetailOpen(true);
  }, []);

  const clearProviderList = useCallback(() => {
    setProviders([]);
  }, []);

  const startProviderListLoad = useCallback(() => {
    setListBusy(true);
    setListError("");
  }, []);

  const applyProviderList = useCallback((items: ProviderSummary[]) => {
    setProviders(items);
  }, []);

  const applyProviderListError = useCallback((error: unknown) => {
    setListError(providerLoadErrorMessage(error, t.common_failed_load));
  }, [t.common_failed_load]);

  const finishProviderListLoad = useCallback(() => {
    setListBusy(false);
  }, []);

  const startProviderDetailLoad = useCallback(() => {
    setDetailBusy(true);
    setDetailError("");
    setProviderError("");
    setDoctorError("");
    setServiceError("");
    setStaffError("");
  }, []);

  const applyProviderDetail = useCallback((item: ProviderDetail) => {
    setDetail(item);
    setProviderForm(providerToForm(item));
  }, []);

  const applyProviderDetailError = useCallback((error: unknown) => {
    setDetailError(providerLoadErrorMessage(error, t.common_failed_load));
  }, [t.common_failed_load]);

  const finishProviderDetailLoad = useCallback(() => {
    setDetailBusy(false);
  }, []);

  useEffect(() => {
    if (!detailPageMode) return;
    applyDetailRouteState(detailRouteId);
  }, [applyDetailRouteState, detailPageMode, detailRouteId]);

  useEffect(() => {
    if (detailPageMode) return;
    const providerParam = searchParams.get("provider") ?? "";
    if (providerParam && providerParam !== selectedId) {
      openProviderFromQuery(providerParam);
    }
  }, [detailPageMode, openProviderFromQuery, searchParams, selectedId]);

  useEffect(() => {
    if (!permissions.canViewPage || detailPageMode) {
      startTransition(() => clearProviderList());
      return;
    }

    let cancelled = false;
    startProviderListLoad();

    void fetchProviders(providersPath)
      .then((items) => {
        if (cancelled) return;
        startTransition(() => applyProviderList(items));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        applyProviderListError(error);
      })
      .finally(() => {
        if (!cancelled) {
          finishProviderListLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applyProviderList,
    applyProviderListError,
    clearProviderList,
    detailPageMode,
    finishProviderListLoad,
    permissions.canViewPage,
    providersPath,
    listVersion,
    startProviderListLoad,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage || detailPageMode || !attributeValueOptionsPath) {
      setAttributeOptionProviders([]);
      return;
    }

    let cancelled = false;

    void fetchProviders(attributeValueOptionsPath)
      .then((items) => {
        if (cancelled) return;
        setAttributeOptionProviders(items);
      })
      .catch(() => {
        if (cancelled) return;
        setAttributeOptionProviders([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    attributeValueOptionsPath,
    detailPageMode,
    listVersion,
    permissions.canViewPage,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage || detailPageMode || catalogMode !== "people") {
      return;
    }

    let cancelled = false;
    dispatchPageState({ peopleBusy: true, peopleError: "" });

    void fetchProviderPeople(peopleFilters)
      .then((items) => {
        if (cancelled) return;
        dispatchPageState({ peopleRows: items, peopleBusy: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        dispatchPageState({
          peopleBusy: false,
          peopleError: providerLoadErrorMessage(error, t.common_failed_load),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    catalogMode,
    detailPageMode,
    peopleFilters,
    peopleVersion,
    permissions.canViewPage,
    t.common_failed_load,
  ]);

  useEffect(() => {
    const providerId = catalogPersonContext?.providerId ?? detail?.id ?? "";
    const providerType = catalogPersonContext?.providerType ?? detail?.provider_type ?? "medical";
    const shouldLoad =
      permissions.canViewPage &&
      doctorDialogOpen &&
      !doctorForm.id &&
      providerType === "medical" &&
      Boolean(providerId);

    if (!shouldLoad) {
      setExistingDoctorOptions([]);
      setExistingDoctorOptionsBusy(false);
      setExistingDoctorOptionsError("");
      return;
    }

    let cancelled = false;
    const linkedDoctorIdentityIds =
      providerId === detail?.id
        ? new Set((detail.doctors ?? []).map((doctor) => doctor.shared_identity_id ?? doctor.id))
        : new Set<string>();
    setExistingDoctorOptionsBusy(true);
    setExistingDoctorOptionsError("");

    void fetchProviderPeople({ personType: "doctor", providerType: "medical" })
      .then((rows) => {
        if (cancelled) return;
        setExistingDoctorOptions(
          existingDoctorLinkOptions(rows, providerId, linkedDoctorIdentityIds),
        );
        setExistingDoctorOptionsBusy(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setExistingDoctorOptions([]);
        setExistingDoctorOptionsBusy(false);
        setExistingDoctorOptionsError(
          providerLoadErrorMessage(error, t.common_failed_load),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    catalogPersonContext?.providerId,
    catalogPersonContext?.providerType,
    detail?.doctors,
    detail?.id,
    detail?.provider_type,
    doctorDialogOpen,
    doctorForm.id,
    permissions.canViewPage,
    t.common_failed_load,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    void Promise.all([
      fetchSpecializationsForAdmin(),
      fetchInsuranceProviders(true),
      fetchProviders("/providers?active_only=false"),
      fetchProviderStaffRoles(true),
      fetchProviderPeoplePatients(),
      fetchProviderTaxonomy(),
    ])
      .then(([specializationItems, insuranceProviderItems, providerItems, roleItems, patientItems, taxonomy]) => {
        if (cancelled) return;
        dispatchPageState({
          specializations: specializationItems,
          insuranceProviders: insuranceProviderItems,
          parentProviderOptions: providerItems,
          staffRoles: roleItems,
          peoplePatientOptions: patientItems,
          taxonomyNodes: taxonomy.nodes,
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatchPageState({
          specializations: [],
          insuranceProviders: [],
          parentProviderOptions: [],
          staffRoles: [],
          peoplePatientOptions: [],
          taxonomyNodes: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

  useEffect(() => {
    const shouldLoadDetail = detailOpen || detailPageMode;
    if (!shouldLoadDetail || !selectedId) return;

    let cancelled = false;
    startProviderDetailLoad();

    void fetchProviderDetail(selectedId)
      .then((item) => {
        if (cancelled) return;
        startTransition(() => {
          applyProviderDetail(item);
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        applyProviderDetailError(error);
      })
      .finally(() => {
        if (!cancelled) {
          finishProviderDetailLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applyProviderDetail,
    applyProviderDetailError,
    detailOpen,
    detailPageMode,
    detailVersion,
    finishProviderDetailLoad,
    selectedId,
    startProviderDetailLoad,
  ]);

  useEffect(() => {
    setCreateForm(blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"));
    if (permissions.forceNonMedical) {
      setFilters((current) =>
        current.providerType === "non_medical"
          ? current
          : { ...current, providerType: "non_medical" },
      );
      setPeopleFilters((current) =>
        normalizeProviderPeopleFiltersForScope(current, true),
      );
    }
  }, [permissions.forceNonMedical, setFilters]);

  useEffect(() => {
    if (!peopleFilters.providerId || parentProviderOptions.length === 0) return;
    const selectedProvider = parentProviderOptions.find(
      (provider) => provider.id === peopleFilters.providerId,
    );
    const selectedProviderFitsScope =
      selectedProvider &&
      (!permissions.forceNonMedical || selectedProvider.provider_type === "non_medical");
    if (selectedProviderFitsScope) return;

    setPeopleFilters({ ...peopleFilters, providerId: "" });
  }, [
    parentProviderOptions,
    peopleFilters,
    permissions.forceNonMedical,
  ]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  function refreshInsuranceProviderOptions() {
    void fetchInsuranceProviders(true)
      .then((items) => setInsuranceProviders(items))
      .catch(() => {
        // The saved provider/doctor remains valid even if the option cache refresh fails.
      });
  }

  useDebouncedRealtimeSubscription(PROVIDER_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/providers");
    const selectedWasUpdated = events.some((event) => event.entity_id === selectedId);
    for (const event of events) {
      if (event.entity_type === "provider" && event.entity_id) {
        clearApiCache(`/providers/${event.entity_id}`);
        clearApiCache(`/providers/${event.entity_id}/patients`);
        clearApiCache(`/providers/${event.entity_id}/templates`);
        clearApiCache(`/appointments?provider_id=${event.entity_id}`);
      }
    }
    if (selectedId) {
      clearApiCache(`/providers/${selectedId}`);
      clearApiCache(`/providers/${selectedId}/patients`);
      clearApiCache(`/providers/${selectedId}/templates`);
      clearApiCache(`/appointments?provider_id=${selectedId}`);
    }
    startTransition(() => {
      setListVersion((current) => current + 1);
      if (!selectedId || selectedWasUpdated) {
        setDetailVersion((current) => current + 1);
      }
    });
  }, 250);

  function openProvider(id: string) {
    staffGo(`/providers/${id}`);
  }

  function openProviderPerson(row: ProviderPeopleRow) {
    if (row.person_type === "doctor") {
      setDoctorDetailView({ source: "catalog", row });
      return;
    }
    setStaffDetailView({ source: "catalog", row });
  }

  function handleExistingDoctorSelect(identityId: string) {
    const doctor = existingDoctorOptions.find((row) => doctorIdentityValue(row) === identityId);
    if (!doctor) return;
    setDoctorError("");
    setDoctorForm(providerPeopleDoctorToNewProviderForm(doctor));
  }

  function editDoctorFromDetailView(view: DoctorDetailView) {
    setDoctorDetailView(null);
    setDoctorError("");
    if (view.source === "provider") {
      setDoctorForm(doctorToForm(view.doctor));
      setDoctorDialogOpen(true);
      return;
    }
    setCatalogPersonContext({
      providerId: view.row.provider_id,
      personId: view.row.person_id,
      personType: view.row.person_type,
      providerType: view.row.provider_type,
    });
    setDoctorForm(providerPeopleDoctorToForm(view.row));
    setDoctorDialogOpen(true);
  }

  function editStaffFromDetailView(view: StaffDetailView) {
    setStaffDetailView(null);
    setStaffError("");
    if (view.source === "provider") {
      setStaffForm(staffToForm(view.staff));
      setStaffDialogOpen(true);
      return;
    }
    setCatalogPersonContext({
      providerId: view.row.provider_id,
      personId: view.row.person_id,
      personType: view.row.person_type,
      providerType: view.row.provider_type,
    });
    setStaffForm(providerPeopleStaffToForm(view.row));
    setStaffDialogOpen(true);
  }

  function openCreateSheet() {
    setCreateError("");
    setCreateForm(blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"));
    setCreateOpen(true);
  }

  async function handleCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    try {
      const payload = toProviderPayload(createForm, permissions.forceNonMedical);
      const created = await createProvider(payload);
      refreshInsuranceProviderOptions();
      setCreateOpen(false);
      staffGo(`/providers/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleUpdateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setProviderBusy(true);
    setProviderError("");

    try {
      const payload = toProviderPayload(providerForm, permissions.forceNonMedical);
      await updateProvider(detail.id, payload);
      refreshInsuranceProviderOptions();
      if (providerEditOpen) {
        setProviderEditOpen(false);
      }
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderBusy(false);
    }
  }

  function openProviderEditSheet() {
    if (!detail || !permissions.canManageRegistry) return;
    setProviderError("");
    setProviderForm(providerToForm(detail));
    setProviderEditOpen(true);
  }

  function handleProviderEditOpenChange(open: boolean) {
    setProviderEditOpen(open);
    if (!open) {
      setProviderError("");
      if (detail) {
        setProviderForm(providerToForm(detail));
      }
    }
  }

  async function handleToggleProvider(active: boolean) {
    if (!detail) return;

    setProviderActionBusy(active ? "activate" : "deactivate");
    setProviderError("");

    try {
      await setProviderActive(detail.id, active);
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(
        error instanceof Error
          ? error.message
          : t.common_failed_update
      );
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDeleteProvider() {
    if (!detail) return;
    if (
      !window.confirm(
        formatUiText(t.providers_delete_provider_confirm, { name: detail.name }),
      )
    ) {
      return;
    }

    setProviderActionBusy("delete");
    setProviderError("");

    try {
      await deleteProvider(detail.id);
      setDetailOpen(false);
      setSelectedId("");
      setDetail(null);
      if (detailPageMode) {
        staffGo(providerDetailBackPath);
      } else {
        refreshList();
      }
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDoctorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const providerId = catalogPersonContext?.providerId ?? detail?.id;
    if (!providerId) return;
    const providerType = catalogPersonContext?.providerType ?? detail?.provider_type ?? "medical";

    const payload = toDoctorPayload(providerDoctorFormForPayload(doctorForm, providerType));
    if (!payload.name.trim()) {
      setDoctorError(t.uiText.providers_doctor_name_required ?? t.common_failed_update);
      return;
    }
    if (!doctorForm.id && providerType === "medical" && !payload.title) {
      setDoctorError(t.uiText.providers_doctor_title_required ?? t.common_failed_update);
      return;
    }

    setDoctorBusy(true);
    setDoctorError("");

    try {
      await saveProviderDoctor(providerId, doctorForm.id, payload);
      refreshInsuranceProviderOptions();
      setDoctorDialogOpen(false);
      setDoctorForm(blankDoctorForm());
      setCatalogPersonContext(null);
      refreshList();
      if (detail?.id === providerId) {
        refreshDetail();
      }
      if (catalogMode === "people") {
        refreshPeople();
      }
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  function handleDoctorDialogOpenChange(open: boolean) {
    setDoctorDialogOpen(open);
    if (!open) {
      setDoctorError("");
      setDoctorForm(blankDoctorForm());
      setCatalogPersonContext(null);
    }
  }

  async function handleDeleteDoctor(doctorId: string, doctorName: string) {
    if (!detail) return;
    const confirmMessage =
      detail.provider_type === "non_medical"
        ? t.providers_delete_contact_confirm
        : t.providers_delete_doctor_confirm;
    if (
      !window.confirm(
        formatUiText(confirmMessage, { name: doctorName }),
      )
    ) {
      return;
    }

    setDoctorBusy(true);
    setDoctorError("");

    try {
      await deleteProviderDoctor(detail.id, doctorId);
      if (doctorForm.id === doctorId) {
        setDoctorForm(blankDoctorForm());
      }
      refreshDetail();
      refreshList();
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  async function loadRelationshipTargetDoctors(providerId: string) {
    const requestId = relationshipTargetDoctorsRequestRef.current + 1;
    relationshipTargetDoctorsRequestRef.current = requestId;
    setRelationshipTargetDoctors([]);

    if (!detail || !providerId) {
      setRelationshipTargetDoctorsBusy(false);
      return;
    }
    if (providerId === detail.id) {
      setRelationshipTargetDoctors(detail.doctors);
      setRelationshipTargetDoctorsBusy(false);
      return;
    }

    setRelationshipTargetDoctorsBusy(true);
    try {
      const providerDetail = await fetchProviderDetail(providerId);
      if (relationshipTargetDoctorsRequestRef.current !== requestId) return;
      setRelationshipTargetDoctors(providerDetail.doctors);
    } catch (error) {
      if (relationshipTargetDoctorsRequestRef.current !== requestId) return;
      setRelationshipError(providerLoadErrorMessage(error, t.common_failed_load));
      setRelationshipTargetDoctors([]);
    } finally {
      if (relationshipTargetDoctorsRequestRef.current === requestId) {
        setRelationshipTargetDoctorsBusy(false);
      }
    }
  }

  function openDoctorRelationshipForm(
    sourceDoctorId: string,
    relationship?: DoctorRelationship,
  ) {
    if (!detail) return;
    const targetProviderId = relationship?.target_provider_id ?? detail.id;
    setRelationshipError("");
    setRelationshipForm({
      id: relationship?.id ?? "",
      sourceDoctorId,
      targetProviderId,
      targetDoctorId: relationship?.target_doctor_id ?? "",
      relationshipType: relationship?.relationship_type ?? "professional",
      description: relationship?.description ?? "",
      notes: relationship?.notes ?? "",
      isActive: relationship?.is_active ?? true,
    });
    setRelationshipDialogOpen(true);
    void loadRelationshipTargetDoctors(targetProviderId);
  }

  function handleRelationshipDialogOpenChange(open: boolean) {
    setRelationshipDialogOpen(open);
    if (!open) {
      setRelationshipError("");
      setRelationshipForm(blankDoctorRelationshipForm());
      setRelationshipTargetDoctors([]);
    }
  }

  async function handleRelationshipTargetProviderChange(providerId: string) {
    setRelationshipForm((current) => ({
      ...current,
      targetProviderId: providerId,
      targetDoctorId: "",
    }));
    await loadRelationshipTargetDoctors(providerId);
  }

  async function handleDoctorRelationshipSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !relationshipForm.sourceDoctorId || !relationshipForm.targetDoctorId) return;
    if (relationshipTargetDoctorsBusy) return;
    if (!relationshipTargetDoctors.some((doctor) => doctor.id === relationshipForm.targetDoctorId)) {
      setRelationshipError(l("providers_relationship_target_required"));
      return;
    }

    setRelationshipBusy(true);
    setRelationshipError("");

    try {
      await saveProviderDoctorRelationship(
        detail.id,
        relationshipForm.sourceDoctorId,
        relationshipForm.id,
        {
          target_doctor_id: relationshipForm.targetDoctorId,
          target_provider_id: relationshipForm.targetProviderId,
          relationship_type: relationshipForm.relationshipType,
          description: relationshipForm.description.trim() || null,
          notes: relationshipForm.notes.trim() || null,
          is_active: relationshipForm.isActive,
        },
      );
      setRelationshipDialogOpen(false);
      setRelationshipForm(blankDoctorRelationshipForm());
      setRelationshipTargetDoctors([]);
      refreshDetail();
    } catch (error) {
      setRelationshipError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setRelationshipBusy(false);
    }
  }

  function handleDeleteDoctorRelationship(
    sourceDoctorId: string,
    relationshipId: string,
    doctorName: string,
  ) {
    if (!detail) return;
    setRelationshipError("");
    setRelationshipDeleteTarget({ sourceDoctorId, relationshipId, doctorName });
  }

  function removeDoctorRelationshipLocally(
    sourceDoctorId: string,
    relationshipId: string,
  ) {
    setDetail((current) =>
      current
        ? {
            ...current,
            doctors: current.doctors.map((doctor) =>
              doctor.id === sourceDoctorId
                ? {
                    ...doctor,
                    relationships: doctor.relationships.filter(
                      (relationship) => relationship.id !== relationshipId,
                    ),
                  }
                : doctor,
            ),
          }
        : current,
    );
    setDoctorDetailView((current) =>
      current?.source === "provider" && current.doctor.id === sourceDoctorId
        ? {
            ...current,
            doctor: {
              ...current.doctor,
              relationships: current.doctor.relationships.filter(
                (relationship) => relationship.id !== relationshipId,
              ),
            },
          }
        : current,
    );
  }

  async function confirmDeleteDoctorRelationship() {
    if (!detail || !relationshipDeleteTarget || relationshipBusy) return;
    const target = relationshipDeleteTarget;
    setRelationshipBusy(true);
    setRelationshipError("");
    setRelationshipDeleteTarget(null);
    removeDoctorRelationshipLocally(target.sourceDoctorId, target.relationshipId);

    try {
      await deleteProviderDoctorRelationship(
        detail.id,
        target.sourceDoctorId,
        target.relationshipId,
      );
      refreshDetail();
    } catch (error) {
      setRelationshipError(error instanceof Error ? error.message : t.common_failed_update);
      refreshDetail();
    } finally {
      setRelationshipBusy(false);
    }
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setServiceBusy(true);
    setServiceError("");

    try {
      await saveProviderService(
        detail.id,
        serviceForm.id,
        toServicePayload(serviceForm),
      );
      setServiceDialogOpen(false);
      const isMedicalProvider = detail.provider_type === "medical";
      setServiceForm(blankServiceForm(isMedicalProvider ? "range" : "fixed"));
      refreshList();
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  function handleServiceDialogOpenChange(open: boolean) {
    setServiceDialogOpen(open);
    if (!open) {
      setServiceError("");
      setServiceForm(blankServiceForm(detail?.provider_type === "medical" ? "range" : "fixed"));
    }
  }

  async function handleDeleteService(serviceId: string, serviceName: string) {
    if (!detail) return;
    if (
      !window.confirm(
        formatUiText(t.providers_delete_service_confirm, { name: serviceName }),
      )
    ) {
      return;
    }

    setServiceBusy(true);
    setServiceError("");

    try {
      await deleteProviderService(detail.id, serviceId);
      if (serviceForm.id === serviceId) {
        setServiceForm(blankServiceForm(detail.provider_type === "medical" ? "range" : "fixed"));
      }
      refreshList();
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  async function handleStaffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const providerId = catalogPersonContext?.providerId ?? detail?.id;
    if (!providerId) return;

    setStaffBusy(true);
    setStaffError("");

    try {
      await saveProviderStaff(providerId, staffForm.id, toStaffPayload(staffForm));
      setStaffDialogOpen(false);
      setStaffForm(blankStaffForm());
      setCatalogPersonContext(null);
      refreshList();
      if (detail?.id === providerId) {
        refreshDetail();
      }
      if (catalogMode === "people") {
        refreshPeople();
      }
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setStaffBusy(false);
    }
  }

  async function reloadSpecializations() {
    const items = await fetchSpecializationsForAdmin();
    setSpecializations(items);
  }

  async function handleCreateSpecialization(payload: Record<string, unknown>) {
    setSpecializationBusy(true);
    setSpecializationError("");

    try {
      await createSpecialization(payload);
      await reloadSpecializations();
    } catch (error) {
      setSpecializationError(error instanceof Error ? error.message : t.common_failed_update);
      throw error;
    } finally {
      setSpecializationBusy(false);
    }
  }

  async function handleUpdateSpecialization(
    specializationId: string,
    payload: Record<string, unknown>,
  ) {
    setSpecializationBusy(true);
    setSpecializationError("");

    try {
      await updateSpecialization(specializationId, payload);
      await reloadSpecializations();
      refreshList();
      refreshDetail();
    } catch (error) {
      setSpecializationError(error instanceof Error ? error.message : t.common_failed_update);
      throw error;
    } finally {
      setSpecializationBusy(false);
    }
  }

  async function handleToggleSpecialization(specializationId: string, active: boolean) {
    setSpecializationBusy(true);
    setSpecializationError("");

    try {
      await setSpecializationActive(specializationId, active);
      await reloadSpecializations();
    } catch (error) {
      setSpecializationError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setSpecializationBusy(false);
    }
  }

  async function handleDeleteSpecialization(specializationId: string) {
    setSpecializationBusy(true);
    setSpecializationError("");

    try {
      await deleteSpecialization(specializationId);
      await reloadSpecializations();
      refreshList();
      refreshDetail();
    } catch (error) {
      setSpecializationError(error instanceof Error ? error.message : t.common_failed_update);
      throw error;
    } finally {
      setSpecializationBusy(false);
    }
  }

  function openSpecializationManager() {
    setSpecializationError("");
    setSpecializationDialogOpen(true);
  }

  async function reloadStaffRoles() {
    const roles = await fetchProviderStaffRoles(true);
    setStaffRoles(roles);
  }

  async function handleCreateStaffRole(payload: Record<string, unknown>) {
    setStaffRoleBusy(true);
    setStaffRoleError("");

    try {
      await createProviderStaffRole(payload);
      await reloadStaffRoles();
    } catch (error) {
      setStaffRoleError(error instanceof Error ? error.message : t.common_failed_update);
      throw error;
    } finally {
      setStaffRoleBusy(false);
    }
  }

  async function handleUpdateStaffRole(roleId: string, payload: Record<string, unknown>) {
    setStaffRoleBusy(true);
    setStaffRoleError("");

    try {
      await updateProviderStaffRole(roleId, payload);
      await reloadStaffRoles();
    } catch (error) {
      setStaffRoleError(error instanceof Error ? error.message : t.common_failed_update);
      throw error;
    } finally {
      setStaffRoleBusy(false);
    }
  }

  async function handleToggleStaffRole(roleId: string, active: boolean) {
    setStaffRoleBusy(true);
    setStaffRoleError("");

    try {
      await setProviderStaffRoleActive(roleId, active);
      await reloadStaffRoles();
    } catch (error) {
      setStaffRoleError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setStaffRoleBusy(false);
    }
  }

  function openStaffRoleManager() {
    setStaffRoleError("");
    setStaffRoleDialogOpen(true);
  }

  function handleStaffDialogOpenChange(open: boolean) {
    setStaffDialogOpen(open);
    if (!open) {
      setStaffError("");
      setStaffForm(blankStaffForm());
      setCatalogPersonContext(null);
    }
  }

  async function handleDeleteStaff(staffId: string, staffName: string) {
    if (!detail) return;
    if (!window.confirm(formatUiText(t.providers_delete_staff_confirm, { name: staffName }))) {
      return;
    }

    setStaffBusy(true);
    setStaffError("");

    try {
      await deleteProviderStaff(detail.id, staffId);
      if (staffForm.id === staffId) {
        setStaffForm(blankStaffForm());
      }
      refreshList();
      refreshDetail();
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setStaffBusy(false);
    }
  }

  const relationshipDeleteConfirmDialog = (
    <DirtyDismissConfirmDialog
      open={Boolean(relationshipDeleteTarget)}
      title={lang === "ru" ? "Удалить связь врачей?" : "Arztbeziehung löschen?"}
      message={
        relationshipDeleteTarget
          ? formatUiText(l("providers_relationship_delete_confirm"), {
              name: relationshipDeleteTarget.doctorName,
            })
          : ""
      }
      cancelLabel={t.common_cancel}
      confirmLabel={t.common_delete}
      onCancel={() => setRelationshipDeleteTarget(null)}
      onConfirm={confirmDeleteDoctorRelationship}
    />
  );

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            {t.providers_no_access_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600">
            {t.providers_no_access_body}
          </p>
        </section>
      </div>
    );
  }

  if (detailPageMode) {
    return (
      <>
        <div className="w-full space-y-4">
          {detailBusy ? (
            <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {l("providers_loading_provider")}
            </div>
          ) : detail ? (
            <div className="flex min-h-0 flex-col">
              <div className="space-y-3 rounded-xl p-4">
                  {detailError ? <Banner tone="error">{detailError}</Banner> : null}
                  {providerError ? <Banner tone="error">{providerError}</Banner> : null}

                  <ProviderSheetHero
                    detail={detail}
                    providerActionBusy={providerActionBusy}
                    permissions={permissions}
                    onActivate={() => handleToggleProvider(true)}
                    onDeactivate={() => handleToggleProvider(false)}
                    onDelete={handleDeleteProvider}
                    onEdit={openProviderEditSheet}
                  />

                  <ProviderOverviewSection
                    detail={detail}
                    onOpenPatients={() => window.open(`/patients?provider=${detail.id}`, "_blank", "noopener,noreferrer")}
                    onOpenAppointments={() => window.open(`/appointments?provider=${detail.id}`, "_blank", "noopener,noreferrer")}
                  />

                  <ProviderProfileReadOnlySection detail={detail} />

                  <DoctorSection
                    detail={detail}
                    busy={doctorBusy}
                    relationshipBusy={relationshipBusy}
                    canManage={permissions.canManageRegistry}
                    onOpenProvider={openProvider}
                    onNew={() => {
                      setDoctorError("");
                      setDoctorForm(blankDoctorForm());
                      setDoctorDialogOpen(true);
                    }}
                    onOpen={(doctor) =>
                      setDoctorDetailView({
                        source: "provider",
                        providerName: detail.name,
                        providerType: detail.provider_type,
                        doctor,
                      })
                    }
                    onEdit={(doctor) => {
                      setDoctorError("");
                      setDoctorForm(doctorToForm(doctor));
                      setDoctorDialogOpen(true);
                    }}
                    onDelete={handleDeleteDoctor}
                    onNewRelationship={(sourceDoctorId) => openDoctorRelationshipForm(sourceDoctorId)}
                    onEditRelationship={openDoctorRelationshipForm}
                    onDeleteRelationship={handleDeleteDoctorRelationship}
                  />

                  <StaffSection
                    detail={detail}
                    busy={staffBusy}
                    staffRoles={staffRoles}
                    canManage={permissions.canManageRegistry}
                    onManageRoles={openStaffRoleManager}
                    onNew={() => {
                      setStaffError("");
                      setStaffForm(blankStaffForm());
                      setStaffDialogOpen(true);
                    }}
                    onOpen={(staff) =>
                      setStaffDetailView({
                        source: "provider",
                        providerName: detail.name,
                        staff,
                      })
                    }
                    onEdit={(staff) => {
                      setStaffError("");
                      setStaffForm(staffToForm(staff));
                      setStaffDialogOpen(true);
                    }}
                    onDelete={handleDeleteStaff}
                  />

                  <ServiceSection
                    detail={detail}
                    busy={serviceBusy}
                    taxonomyNodes={taxonomyNodes}
                    canManage={permissions.canManageRegistry}
                    onNew={() => {
                      setServiceError("");
                      setServiceForm(blankServiceForm(detail.provider_type === "medical" ? "range" : "fixed"));
                      setServiceDialogOpen(true);
                    }}
                    onEdit={(service) => {
                      setServiceError("");
                      setServiceForm(serviceToForm(service));
                      setServiceDialogOpen(true);
                    }}
                    onDelete={handleDeleteService}
                  />

                  <LinkedPatientsSection
                    detail={detail}
                  />
                  <InteractionHistorySection
                    detail={detail}
                  />
              </div>
            </div>
          ) : detailError ? (
            <div className="p-4">
              <Banner tone="error">{detailError}</Banner>
            </div>
          ) : (
            <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">
              {t.providers_select_to_open_workspace}
            </div>
          )}
        </div>

        {detail || catalogPersonContext ? (
          <ProviderDoctorFormSheet
            open={doctorDialogOpen}
            onOpenChange={handleDoctorDialogOpenChange}
            form={doctorForm}
            providerType={catalogPersonContext?.providerType ?? detail?.provider_type ?? "medical"}
            specializations={specializations}
            insuranceProviders={insuranceProviders}
            existingDoctorOptions={existingDoctorOptions}
            existingDoctorOptionsBusy={existingDoctorOptionsBusy}
            existingDoctorOptionsError={existingDoctorOptionsError}
            busy={doctorBusy}
            error={doctorError}
            onSubmit={handleDoctorSubmit}
            onSelectExistingDoctor={handleExistingDoctorSelect}
            onChange={(field, value) =>
              setDoctorForm((current) => applyDoctorFieldChange(current, field, value))
            }
            onContactsChange={(contacts) =>
              setDoctorForm((current) => ({ ...current, contacts }))
            }
          />
        ) : null}

        {detail ? (
          <ProviderDoctorRelationshipFormSheet
            open={relationshipDialogOpen}
            onOpenChange={handleRelationshipDialogOpenChange}
            form={relationshipForm}
            sourceDoctors={detail.doctors}
            targetProviders={relationshipProviderOptions}
            taxonomyNodes={taxonomyNodes}
            targetDoctors={relationshipTargetDoctors}
            targetDoctorsBusy={relationshipTargetDoctorsBusy}
            busy={relationshipBusy}
            error={relationshipError}
            onSubmit={handleDoctorRelationshipSubmit}
            onChange={(patch) =>
              setRelationshipForm((current) => ({ ...current, ...patch }))
            }
            onTargetProviderChange={handleRelationshipTargetProviderChange}
          />
        ) : null}

        {detail ? (
          <ProviderServiceFormSheet
            open={serviceDialogOpen}
            onOpenChange={handleServiceDialogOpenChange}
            form={serviceForm}
            busy={serviceBusy}
            error={serviceError}
            providerType={detail.provider_type}
            taxonomyNodes={taxonomyNodes}
            onSubmit={handleServiceSubmit}
            onChange={(field, value) =>
              setServiceForm((current) => ({ ...current, [field]: value }))
            }
          />
        ) : null}

        {detail || catalogPersonContext ? (
          <ProviderStaffFormSheet
            open={staffDialogOpen}
            onOpenChange={handleStaffDialogOpenChange}
            form={staffForm}
            staffRoles={staffRoles}
            busy={staffBusy}
            error={staffError}
            onSubmit={handleStaffSubmit}
            onChange={(field, value) =>
              setStaffForm((current) => applyStaffFieldChange(current, field, value))
            }
            onContactsChange={(contacts) =>
              setStaffForm((current) => ({ ...current, contacts }))
            }
          />
        ) : null}

        {detail ? (
          <ProviderEditFormSheet
            open={providerEditOpen}
            onOpenChange={handleProviderEditOpenChange}
            form={providerForm}
            detail={detail}
            specializations={specializations}
            insuranceProviders={insuranceProviders}
            taxonomyNodes={taxonomyNodes}
            parentProviderOptions={parentProviderOptions}
            permissions={permissions}
            busy={providerBusy}
            error={providerError}
            onSubmit={handleUpdateProvider}
            onChange={(field, value) =>
              setProviderForm((current) => ({ ...current, [field]: value }))
            }
            onContactsChange={(contacts) =>
              setProviderForm((current) => ({ ...current, contacts }))
            }
            onManageSpecializations={permissions.canManageRegistry ? openSpecializationManager : undefined}
          />
        ) : null}

        <ProviderDoctorDetailSheet
          open={Boolean(doctorDetailView)}
          view={doctorDetailView}
          canManage={permissions.canManageRegistry}
          onOpenChange={(open) => {
            if (!open) setDoctorDetailView(null);
          }}
          onEdit={editDoctorFromDetailView}
          onNewRelationship={(doctor) => {
            setDoctorDetailView(null);
            openDoctorRelationshipForm(doctor.id);
          }}
          onDeleteRelationship={handleDeleteDoctorRelationship}
        />

        <ProviderStaffDetailSheet
          open={Boolean(staffDetailView)}
          view={staffDetailView}
          staffRoles={staffRoles}
          canManage={permissions.canManageRegistry}
          onOpenChange={(open) => {
            if (!open) setStaffDetailView(null);
          }}
          onEdit={editStaffFromDetailView}
        />

        {permissions.canManageRegistry ? (
          <SpecializationManagerSheet
            open={specializationDialogOpen}
            items={specializations}
            busy={specializationBusy}
            error={specializationError}
            onOpenChange={setSpecializationDialogOpen}
            onCreate={handleCreateSpecialization}
            onUpdate={handleUpdateSpecialization}
            onToggleActive={handleToggleSpecialization}
            onDelete={handleDeleteSpecialization}
          />
        ) : null}

        {permissions.canManageRegistry ? (
          <StaffRoleManagerSheet
            open={staffRoleDialogOpen}
            roles={staffRoles}
            busy={staffRoleBusy}
            error={staffRoleError}
            onOpenChange={setStaffRoleDialogOpen}
            onCreate={handleCreateStaffRole}
            onUpdate={handleUpdateStaffRole}
            onToggleActive={handleToggleStaffRole}
          />
        ) : null}

        {relationshipDeleteConfirmDialog}
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={providerPageCopy.title}
          description={providerPageCopy.subtitle}
          actions={
            <>
              {permissions.canManageRegistry ? (
                <>
                  <Button
                    type="button"
                    className="h-9 rounded-lg px-3.5"
                    onClick={openCreateSheet}
                  >
                    <Plus className="size-4" />
                    {providerPageCopy.newLabel}
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        {/* KPI inline stats */}
        <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric icon={Building2} label={providerPageCopy.title} value={metrics.total} tone="sky" />
          <AdminInlineMetric
            icon={UsersRound}
            label={permissions.forceNonMedical ? l("appointments_services") : t.providers_doctors}
            value={permissions.forceNonMedical ? metrics.services : metrics.doctors}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={Stethoscope}
            label={t.providers_linked_patients}
            value={metrics.patients}
            tone="amber"
          />
          <AdminInlineMetric
            icon={CalendarClock}
            label={permissions.forceNonMedical ? l("providers_open_requests") : t.providers_appointments}
            value={permissions.forceNonMedical ? metrics.openConciergeRequests : metrics.appointments}
            tone="slate"
          />
        </div>

        <div className="inline-flex w-fit rounded-lg border border-border bg-card p-1">
          <Button
            type="button"
            variant={catalogMode === "providers" ? "default" : "ghost"}
            size="sm"
            className="h-8 rounded-md px-3"
            onClick={() => setCatalogMode("providers")}
          >
            {providerPageCopy.title}
          </Button>
          <Button
            type="button"
            variant={catalogMode === "people" ? "default" : "ghost"}
            size="sm"
            className="h-8 rounded-md px-3"
            onClick={() => setCatalogMode("people")}
          >
            {providerPageCopy.peopleLabel}
          </Button>
        </div>

        {catalogMode === "providers" ? (
          <>
        <div className="relative z-30 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearch("");
                    (event.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={t.common_search}
                className="h-8 w-full rounded-lg bg-card pl-8 text-[13px]"
              />
            </div>

            <Button
              type="button"
              variant={providerFiltersOpen ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2.5"
              aria-expanded={providerFiltersOpen}
              onClick={() => setProviderFiltersOpen((current) => !current)}
            >
              <SlidersHorizontal className="size-3.5" />
              <span>{t.table_filter}</span>
              {advancedProviderFilterCount > 0 ? (
                <span className="rounded-full bg-background/80 px-1.5 text-[11px] tabular-nums text-foreground">
                  {advancedProviderFilterCount}
                </span>
              ) : null}
            </Button>
          </div>

          {providerFiltersOpen ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 p-2">
              <NativeComboboxSelect
                value={filters.providerType}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setFilters((current) => ({
                    ...current,
                    providerType: nextType,
                    specializations: nextType === "non_medical" ? "" : current.specializations,
                    insuranceProvider: nextType === "non_medical" ? "" : current.insuranceProvider,
                    taxonomyNodeId: "",
                    taxonomyAttributeKey: "",
                    taxonomyAttributeValue: "",
                  }));
                  syncQuery({
                    provider_type: nextType || null,
                    specializations: nextType === "non_medical" ? null : filters.specializations || null,
                    insurance: nextType === "non_medical" ? null : filters.insuranceProvider || null,
                    taxonomy: null,
                    attr_key: null,
                    attr_value: null,
                  });
                }}
                disabled={permissions.forceNonMedical}
                className={cn(selectClassName, "h-8 w-[170px] bg-card text-[13px]")}
              >
                <option value="">{t.providers_all}</option>
                <option value="medical">{t.providers_type_medical}</option>
                <option value="non_medical">{t.providers_type_non_medical}</option>
              </NativeComboboxSelect>

              <div className="w-[200px]">
                <ProviderTaxonomyCascadeSelect
                  value={filters.taxonomyNodeId}
                  nodes={taxonomyNodes}
                  providerType={
                    permissions.forceNonMedical
                      ? "non_medical"
                      : filters.providerType === "medical" || filters.providerType === "non_medical"
                        ? filters.providerType
                        : ""
                  }
                  mode="any"
                  placeholder={t.providers_category}
                  allLabel={t.providers_all}
                  containerClassName="w-full"
                  selectClassName={cn(selectClassName, "h-8 w-full bg-card text-[13px]")}
                  onChange={(nextValue) => {
                    setFilters((current) => ({
                      ...current,
                      taxonomyNodeId: nextValue,
                      taxonomyAttributeKey: "",
                      taxonomyAttributeValue: "",
                    }));
                    syncQuery({
                      taxonomy: nextValue || null,
                      attr_key: null,
                      attr_value: null,
                    });
                  }}
                />
              </div>

              {filterAttributeKeys.length > 0 ? (
                <>
                  <NativeComboboxSelect
                    value={filters.taxonomyAttributeKey}
                    onChange={(event) => {
                      const nextKey = event.target.value;
                      setFilters((current) => ({
                        ...current,
                        taxonomyAttributeKey: nextKey,
                        taxonomyAttributeValue: "",
                      }));
                      syncQuery({
                        attr_key: nextKey || null,
                        attr_value: null,
                      });
                    }}
                    className={cn(selectClassName, "h-8 w-[168px] bg-card text-[13px]")}
                  >
                    <option value="">{t.table_filter}</option>
                    {filterAttributeKeys.map((key) => (
                      <option key={key} value={key}>
                        {taxonomyAttributeLabel(key, lang)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  {filterAttributeValueOptions.length > 0 ? (
                    <NativeComboboxSelect
                      value={filters.taxonomyAttributeValue}
                      onChange={(event) =>
                        setServerFilter("taxonomyAttributeValue", event.target.value, "attr_value")
                      }
                      disabled={!filters.taxonomyAttributeKey}
                      className={cn(selectClassName, "h-8 w-[190px] bg-card text-[13px]")}
                    >
                      <option value="">{t.providers_all}</option>
                      {filterAttributeValueOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  ) : (
                    <Input
                      value={filters.taxonomyAttributeValue}
                      onChange={(event) =>
                        setServerFilter("taxonomyAttributeValue", event.target.value, "attr_value")
                      }
                      disabled={!filters.taxonomyAttributeKey}
                      placeholder={t.common_value}
                      className="h-8 w-[160px] rounded-lg bg-card text-[13px]"
                    />
                  )}
                </>
              ) : null}

              <NativeComboboxSelect
                value={filters.activeOnly}
                onChange={(event) => setServerFilter("activeOnly", event.target.value, "active")}
                className={cn(selectClassName, "h-8 w-[140px] bg-card text-[13px]")}
              >
                <option value="">{t.providers_all}</option>
                <option value="true">{t.common_active}</option>
                <option value="false">{t.common_inactive}</option>
              </NativeComboboxSelect>

              <NativeComboboxSelect
                value={filters.hasContract}
                onChange={(event) => setServerFilter("hasContract", event.target.value, "contract")}
                className={cn(selectClassName, "h-8 w-[160px] bg-card text-[13px]")}
              >
                <option value="">{t.providers_contract}</option>
                <option value="true">{t.providers_contract_with}</option>
                <option value="false">{t.providers_contract_without}</option>
              </NativeComboboxSelect>

              <NativeComboboxSelect
                value={filters.internalRatingGte}
                onChange={(event) => setServerFilter("internalRatingGte", event.target.value, "internal_rating")}
                className={cn(selectClassName, "h-8 w-[148px] bg-card text-[13px]")}
              >
                <option value="">{t.providers_internal_rating}</option>
                <option value="5">5+</option>
                <option value="4">4+</option>
                <option value="3">3+</option>
                <option value="2">2+</option>
              </NativeComboboxSelect>

              <div className="w-[180px]">
                <SpecializationMultiSelect
                  value={filters.specializations}
                  items={specializations}
                  placeholder={t.providers_fachbereich}
                  compact
                  disabled={permissions.forceNonMedical || filters.providerType === "non_medical"}
                  onChange={(nextValue) => setServerFilter("specializations", nextValue, "specializations")}
                />
              </div>
              <div className="w-[180px]">
                <InsuranceProviderMultiSelect
                  value={filters.insuranceProvider}
                  items={insuranceProviders}
                  compact
                  useInsuranceTypes
                  disabled={permissions.forceNonMedical || filters.providerType === "non_medical"}
                  onChange={(nextValue) => setServerFilter("insuranceProvider", nextValue, "insurance")}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Error banner */}
        {listError ? <Banner tone="error">{listError}</Banner> : null}

        {listBusy && providers.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-border/70 bg-card text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              {t.common_loading}
            </span>
          </div>
        ) : (
          <>
            {sortedAndFilteredProviders.length > 0 ? (
              <ProviderHierarchyTimeline
                lang={lang}
                providers={sortedAndFilteredProviders}
                selectedProviderId={selectedId}
                tr={tr}
                onProviderClick={openProvider}
              />
            ) : (
              <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border/70 bg-card text-sm text-muted-foreground">
                {t.patients_no_match}
              </div>
            )}
          </>
        )}
          </>
        ) : (
          <ProviderPeopleCatalog
            rows={peopleRows}
            forceNonMedical={permissions.forceNonMedical}
            filters={peopleFilters}
            insuranceProviders={insuranceProviders}
            patients={peoplePatientOptions}
            providers={parentProviderOptions}
            taxonomyNodes={taxonomyNodes}
            specializations={specializations}
            staffRoles={staffRoles}
            loading={peopleBusy}
            error={peopleError}
            onFiltersChange={handlePeopleFiltersChange}
            onResetFilters={resetPeopleFilters}
            onRetry={refreshPeople}
            onOpenPerson={(_, row) => openProviderPerson(row)}
            onOpenProvider={(providerId) => openProvider(providerId)}
          />
        )}
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form onSubmit={handleCreateProvider} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={providerPageCopy.newLabel}
              description={providerPageCopy.createDescription}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={providerPageCopy.newLabel}
                  submittingLabel={t.patients_creating}
                  submitting={createBusy}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              <div className="space-y-3 rounded-xl p-4">
                {createError ? <Banner tone="error">{createError}</Banner> : null}
                <ProviderFormFields
                  form={createForm}
                  specializations={specializations}
                  insuranceProviders={insuranceProviders}
                  taxonomyNodes={taxonomyNodes}
                  parentProviderOptions={parentProviderOptions}
                  onChange={(field, value) =>
                    setCreateForm((current) => ({ ...current, [field]: value }))
                  }
                  onContactsChange={(contacts) =>
                    setCreateForm((current) => ({ ...current, contacts }))
                  }
                  forceNonMedical={permissions.forceNonMedical}
                  onManageSpecializations={permissions.canManageRegistry ? openSpecializationManager : undefined}
                  grouped
                />
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedId("");
            setDetail(null);
            setProviderError("");
            setDoctorError("");
            setRelationshipError("");
            setServiceError("");
            setStaffError("");
            setDoctorForm(blankDoctorForm());
            setRelationshipForm(blankDoctorRelationshipForm());
            setRelationshipDialogOpen(false);
            setRelationshipTargetDoctors([]);
            setServiceForm(blankServiceForm(detail?.provider_type === "medical" ? "range" : "fixed"));
            setStaffForm(blankStaffForm());
            syncQuery({ provider: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[880px]">
          {detailBusy ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {l("providers_loading_provider")}
            </div>
          ) : detail ? (
            <div className="flex flex-1 min-h-0 flex-col">
              <AdminSheetScaffold
                title={detail.name || t.providers_detail}
                description={t.providers_subtitle}
                hideHeader
                footer={(
                  <SheetActionsFooter>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      onClick={() => setDetailOpen(false)}
                    >
                      {t.common_cancel}
                    </Button>
                    {permissions.canManageRegistry ? (
                      <Button
                        type="submit"
                        form="provider-profile-form"
                        className="h-9 rounded-lg gap-1.5"
                        disabled={providerBusy}
                      >
                        {providerBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {providerBusy ? t.patients_saving : t.common_save}
                      </Button>
                    ) : null}
                  </SheetActionsFooter>
                )}
              >
                <div className="space-y-3 rounded-xl p-4">
                  {detailError ? <Banner tone="error">{detailError}</Banner> : null}
                  {providerError ? <Banner tone="error">{providerError}</Banner> : null}

                  <ProviderSheetHero
                    detail={detail}
                    providerActionBusy={providerActionBusy}
                    permissions={permissions}
                    onActivate={() => handleToggleProvider(true)}
                    onDeactivate={() => handleToggleProvider(false)}
                    onDelete={handleDeleteProvider}
                  />

                  <ProviderOverviewSection
                    detail={detail}
                    onOpenPatients={() => window.open(`/patients?provider=${detail.id}`, "_blank", "noopener,noreferrer")}
                    onOpenAppointments={() => window.open(`/appointments?provider=${detail.id}`, "_blank", "noopener,noreferrer")}
                  />

                  <ProviderChildrenSection onOpenProvider={openProvider}>
                    {detail.children}
                  </ProviderChildrenSection>

                {permissions.canManageRegistry || permissions.canViewPage ? (
                  <form
                    id="provider-profile-form"
                    onSubmit={handleUpdateProvider}
                    className="space-y-3"
                  >
                    <ProviderFormFields
                      form={providerForm}
                      specializations={specializations}
                      insuranceProviders={insuranceProviders}
                      taxonomyNodes={taxonomyNodes}
                      parentProviderOptions={parentProviderOptions}
                      currentProviderId={detail.id}
                      onChange={(field, value) =>
                        setProviderForm((current) => ({ ...current, [field]: value }))
                      }
                      onContactsChange={(contacts) =>
                        setProviderForm((current) => ({ ...current, contacts }))
                      }
                      forceNonMedical={permissions.forceNonMedical}
                      disabled={!permissions.canManageRegistry}
                      onManageSpecializations={permissions.canManageRegistry ? openSpecializationManager : undefined}
                      grouped
                    />
                    {!permissions.canManageRegistry ? (
                      <p className="text-[12px] text-muted-foreground italic">
                        {t.providers_edit_restricted_note}
                      </p>
                    ) : null}
                  </form>
                ) : null}

                <DoctorSection
                  detail={detail}
                  busy={doctorBusy}
                  relationshipBusy={relationshipBusy}
                  canManage={permissions.canManageRegistry}
                  onOpenProvider={openProvider}
                  onNew={() => {
                    setDoctorError("");
                    setDoctorForm(blankDoctorForm());
                    setDoctorDialogOpen(true);
                  }}
                  onOpen={(doctor) =>
                    setDoctorDetailView({
                      source: "provider",
                      providerName: detail.name,
                      providerType: detail.provider_type,
                      doctor,
                    })
                  }
                  onEdit={(doctor) => {
                    setDoctorError("");
                    setDoctorForm(doctorToForm(doctor));
                    setDoctorDialogOpen(true);
                  }}
                  onDelete={handleDeleteDoctor}
                  onNewRelationship={(sourceDoctorId) => openDoctorRelationshipForm(sourceDoctorId)}
                  onEditRelationship={openDoctorRelationshipForm}
                  onDeleteRelationship={handleDeleteDoctorRelationship}
                />

                <StaffSection
                  detail={detail}
                  busy={staffBusy}
                  staffRoles={staffRoles}
                  canManage={permissions.canManageRegistry}
                  onManageRoles={openStaffRoleManager}
                  onNew={() => {
                    setStaffError("");
                    setStaffForm(blankStaffForm());
                    setStaffDialogOpen(true);
                  }}
                  onOpen={(staff) =>
                    setStaffDetailView({
                      source: "provider",
                      providerName: detail.name,
                      staff,
                    })
                  }
                  onEdit={(staff) => {
                    setStaffError("");
                    setStaffForm(staffToForm(staff));
                    setStaffDialogOpen(true);
                  }}
                  onDelete={handleDeleteStaff}
                />

                <ServiceSection
                  detail={detail}
                  busy={serviceBusy}
                  taxonomyNodes={taxonomyNodes}
                  canManage={permissions.canManageRegistry}
                  onNew={() => {
                    setServiceError("");
                    setServiceForm(blankServiceForm(detail.provider_type === "medical" ? "range" : "fixed"));
                    setServiceDialogOpen(true);
                  }}
                  onEdit={(service) => {
                    setServiceError("");
                    setServiceForm(serviceToForm(service));
                    setServiceDialogOpen(true);
                  }}
                  onDelete={handleDeleteService}
                />

                <LinkedPatientsSection
                  detail={detail}
                />
                <InteractionHistorySection
                  detail={detail}
                />
                </div>
              </AdminSheetScaffold>
            </div>
          ) : detailError ? (
            <div className="p-4">
              <Banner tone="error">{detailError}</Banner>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t.providers_select_to_open_workspace}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ProviderDoctorDetailSheet
        open={Boolean(doctorDetailView)}
        view={doctorDetailView}
        canManage={permissions.canManageRegistry}
        onOpenChange={(open) => {
          if (!open) setDoctorDetailView(null);
        }}
        onEdit={editDoctorFromDetailView}
        onNewRelationship={(doctor) => {
          setDoctorDetailView(null);
          openDoctorRelationshipForm(doctor.id);
        }}
        onDeleteRelationship={handleDeleteDoctorRelationship}
      />

      <ProviderStaffDetailSheet
        open={Boolean(staffDetailView)}
        view={staffDetailView}
        staffRoles={staffRoles}
        canManage={permissions.canManageRegistry}
        onOpenChange={(open) => {
          if (!open) setStaffDetailView(null);
        }}
        onEdit={editStaffFromDetailView}
      />

      {detail || catalogPersonContext ? (
        <ProviderDoctorFormSheet
          open={doctorDialogOpen}
          onOpenChange={handleDoctorDialogOpenChange}
          form={doctorForm}
          providerType={catalogPersonContext?.providerType ?? detail?.provider_type ?? "medical"}
          specializations={specializations}
          insuranceProviders={insuranceProviders}
          existingDoctorOptions={existingDoctorOptions}
          existingDoctorOptionsBusy={existingDoctorOptionsBusy}
          existingDoctorOptionsError={existingDoctorOptionsError}
          busy={doctorBusy}
          error={doctorError}
          onSubmit={handleDoctorSubmit}
          onSelectExistingDoctor={handleExistingDoctorSelect}
          onChange={(field, value) =>
            setDoctorForm((current) => applyDoctorFieldChange(current, field, value))
          }
          onContactsChange={(contacts) =>
            setDoctorForm((current) => ({ ...current, contacts }))
          }
        />
      ) : null}

      {detail ? (
        <ProviderDoctorRelationshipFormSheet
          open={relationshipDialogOpen}
          onOpenChange={handleRelationshipDialogOpenChange}
          form={relationshipForm}
          sourceDoctors={detail.doctors}
          targetProviders={relationshipProviderOptions}
          taxonomyNodes={taxonomyNodes}
          targetDoctors={relationshipTargetDoctors}
          targetDoctorsBusy={relationshipTargetDoctorsBusy}
          busy={relationshipBusy}
          error={relationshipError}
          onSubmit={handleDoctorRelationshipSubmit}
          onChange={(patch) =>
            setRelationshipForm((current) => ({ ...current, ...patch }))
          }
          onTargetProviderChange={handleRelationshipTargetProviderChange}
        />
      ) : null}

      {detail ? (
        <ProviderServiceFormSheet
          open={serviceDialogOpen}
          onOpenChange={handleServiceDialogOpenChange}
          form={serviceForm}
          busy={serviceBusy}
          error={serviceError}
          providerType={detail.provider_type}
          taxonomyNodes={taxonomyNodes}
          onSubmit={handleServiceSubmit}
          onChange={(field, value) =>
            setServiceForm((current) => ({ ...current, [field]: value }))
          }
        />
      ) : null}

      {detail || catalogPersonContext ? (
        <ProviderStaffFormSheet
          open={staffDialogOpen}
          onOpenChange={handleStaffDialogOpenChange}
          form={staffForm}
          staffRoles={staffRoles}
          busy={staffBusy}
          error={staffError}
          onSubmit={handleStaffSubmit}
          onChange={(field, value) =>
            setStaffForm((current) => applyStaffFieldChange(current, field, value))
          }
          onContactsChange={(contacts) =>
            setStaffForm((current) => ({ ...current, contacts }))
          }
        />
      ) : null}

      {permissions.canManageRegistry ? (
        <SpecializationManagerSheet
          open={specializationDialogOpen}
          items={specializations}
          busy={specializationBusy}
          error={specializationError}
          onOpenChange={setSpecializationDialogOpen}
          onCreate={handleCreateSpecialization}
          onUpdate={handleUpdateSpecialization}
          onToggleActive={handleToggleSpecialization}
          onDelete={handleDeleteSpecialization}
        />
      ) : null}

      {permissions.canManageRegistry ? (
        <StaffRoleManagerSheet
          open={staffRoleDialogOpen}
          roles={staffRoles}
          busy={staffRoleBusy}
          error={staffRoleError}
          onOpenChange={setStaffRoleDialogOpen}
          onCreate={handleCreateStaffRole}
          onUpdate={handleUpdateStaffRole}
          onToggleActive={handleToggleStaffRole}
        />
      ) : null}

      {relationshipDeleteConfirmDialog}
    </>
  );
}

function ReadOnlyLine({
  label,
  value,
  wrap = false,
}: {
  label: ReactNode;
  value: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-6 flex-1 bg-border/70" />
      <span
        className={cn(
          "min-w-0 text-right text-sm font-semibold text-foreground",
          wrap ? "max-w-[70%] break-words" : "max-w-[58%] break-words",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function LabelWithCount({ label, count }: { label: ReactNode; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      {count > 0 ? (
        <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground">
          {count}
        </span>
      ) : null}
    </span>
  );
}

function weeklyAvailabilityBadgeClass(closed: boolean) {
  return closed
    ? "border-orange-200 bg-orange-50 text-orange-800"
    : "border-border/60 bg-muted/30 text-foreground";
}

function WeeklyAvailabilityBadgeList({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const { lang } = useLang();
  const rows = formatWeeklyAvailabilityDisplayItems(value, lang);

  return (
    <div className={cn("flex flex-wrap gap-x-2 gap-y-2.5", className)}>
      {rows.map((row, index) => (
        <span
          key={`${row.day ?? "custom"}-${index}`}
          className={cn(
            "whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-medium",
            weeklyAvailabilityBadgeClass(row.closed),
          )}
        >
          {row.label}
        </span>
      ))}
    </div>
  );
}

function ReadOnlyAvailabilityLine({
  label,
  value,
}: {
  label: ReactNode;
  value: string | null | undefined;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="mt-3 h-px min-w-6 flex-1 bg-border/70" />
      <div className="min-w-0 max-w-[70%] flex-1">
        <WeeklyAvailabilityBadgeList value={value} />
      </div>
    </div>
  );
}

function contactTypeDisplay(
  contactType: string | null | undefined,
  t: ReturnType<typeof useLang>["t"],
) {
  const l = (key: string) => t.uiText[key] ?? key;
  if (contactType === "private") return l("providers_contact_type_private");
  if (contactType === "department") return l("providers_contact_type_department");
  if (contactType === "other") return l("providers_contact_type_other");
  return l("providers_contact_type_work");
}

function contactAddLabel(
  contactKind: "phone" | "email",
  t: ReturnType<typeof useLang>["t"],
  lang: "de" | "ru",
) {
  const addLabel = t.uiText.patients_add ?? "Добавить";
  if (lang === "de") {
    return `${contactKind === "email" ? t.field_email : t.field_phone} ${addLabel}`;
  }
  return contactKind === "email"
    ? `${addLabel} электронную почту`
    : `${addLabel} телефон`;
}

function ReadOnlyContacts({
  contacts,
  fallbackPhone,
  fallbackEmail,
  columns = 1,
}: {
  contacts: { contact_kind: string; contact_type: string; value: string; is_primary?: boolean }[] | undefined;
  fallbackPhone?: string | null;
  fallbackEmail?: string | null;
  columns?: 1 | 2;
}) {
  const { t } = useLang();
  const items = [
    ...(contacts ?? []),
    ...(fallbackPhone && !(contacts ?? []).some((contact) => contact.contact_kind === "phone")
      ? [{ contact_kind: "phone", contact_type: "work", value: fallbackPhone, is_primary: true }]
      : []),
    ...(fallbackEmail && !(contacts ?? []).some((contact) => contact.contact_kind === "email")
      ? [{ contact_kind: "email", contact_type: "work", value: fallbackEmail, is_primary: true }]
      : []),
  ].filter((contact) => contact.value);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.common_not_set}</p>;
  }

  return (
    <div
      className={cn(
        "gap-y-1",
        columns === 2 ? "grid gap-x-8 lg:grid-cols-2" : "space-y-1",
      )}
    >
      {items.map((contact, index) => (
        <ReadOnlyLine
          key={`${contact.contact_kind}-${contact.value}-${index}`}
          label={[
            contact.contact_kind === "email" ? t.field_email : t.field_phone,
            contactTypeDisplay(contact.contact_type, t),
          ].join(" / ")}
          value={contact.value}
        />
      ))}
    </div>
  );
}

function formatProviderRating(value: number | null | undefined, fallback: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.max(0, Math.min(5, value));
  const formatted = Number.isInteger(bounded) ? String(bounded) : bounded.toFixed(1);
  return `${formatted}/5`;
}

function contractReadOnlyValue(value: unknown, fallback: string) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "object") {
    const summary = (value as { summary?: unknown }).summary;
    return typeof summary === "string" && summary.trim() ? summary : fallback;
  }
  return fallback;
}

function taxonomyAttributeReadOnlyRows(detail: ProviderDetail, lang: "de" | "ru") {
  const nodeKeys = taxonomyAttributeKeys(detail.taxonomy_node);
  const keys = new Set([
    ...nodeKeys,
    ...Object.keys(detail.taxonomy_attributes ?? {}),
  ]);

  return Array.from(keys).flatMap((key) => {
    const raw = detail.taxonomy_attributes?.[key];
    const value =
      raw === null || raw === undefined
        ? ""
        : typeof raw === "string"
          ? raw
          : String(raw);
    return value.trim()
      ? [{ label: taxonomyAttributeLabel(key, lang), value }]
      : [];
  });
}

function ProviderProfileReadOnlySection({ detail }: { detail: ProviderDetail }) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const fallback = t.common_not_set;
  const attributeRows = taxonomyAttributeReadOnlyRows(detail, lang);

  return (
    <div className="space-y-3">
      {attributeRows.length > 0 ? (
        <Section
          className={providerDetailSectionClassName}
          title={lang === "ru" ? "Атрибуты категории" : "Kategorieattribute"}
        >
          <div className="grid gap-x-8 gap-y-1 lg:grid-cols-2">
            {attributeRows.map((row) => (
              <ReadOnlyLine key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section className={providerDetailSectionClassName} title={l("patients_contact")}>
        <div className="space-y-3">
          <div className="grid gap-x-8 gap-y-1 lg:grid-cols-2">
            <ReadOnlyLine label={t.providers_website} value={detail.website || fallback} wrap />
          </div>
          <ReadOnlyContacts
            contacts={detail.contacts}
            fallbackPhone={detail.phone}
            fallbackEmail={detail.email}
            columns={2}
          />
        </div>
      </Section>

      <Section className={providerDetailSectionClassName} title={l("providers_contract_and_notes")}>
        <div className="grid gap-x-8 gap-y-1 lg:grid-cols-2">
          <ReadOnlyLine
            label={t.providers_contract}
            value={contractReadOnlyValue(detail.kooperationsvertrag, fallback)}
          />
          <ReadOnlyLine label={t.providers_notes} value={detail.notes || fallback} />
        </div>
      </Section>
    </div>
  );
}

function ProviderDoctorDetailSheet({
  open,
  view,
  canManage,
  onOpenChange,
  onEdit,
  onNewRelationship,
  onDeleteRelationship,
}: {
  open: boolean;
  view: DoctorDetailView | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (view: DoctorDetailView) => void;
  onNewRelationship: (doctor: DoctorSummary) => void;
  onDeleteRelationship: (sourceDoctorId: string, relationshipId: string, doctorName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  if (!view) return null;

  const isProviderDoctor = view.source === "provider";
  const doctor = isProviderDoctor ? view.doctor : null;
  const row = view.source === "catalog" ? view.row : null;
  const providerType = isProviderDoctor ? view.providerType : row?.provider_type ?? "medical";
  const isMedicalProvider = providerType === "medical";
  const displayName = doctor
    ? doctorListDisplayName(doctor)
    : doctorListDisplayName({
        name: row?.name ?? "",
        title: row?.title ?? null,
        gender: row?.gender ?? "unknown",
      });
  const providerName = view.source === "provider" ? view.providerName : row?.provider_name ?? "";
  const role = doctor
    ? doctor.role_label || (doctor.role_code ? doctorRoleLabel(doctor.role_code) : "")
    : row?.role_label || (row?.role_code ? doctorRoleLabel(row.role_code) : "");
  const specializations = doctor
    ? specializationText(doctor.specializations, doctor.fachbereich, lang)
    : specializationText(row?.specializations, row?.fachbereich, lang);
  const insuranceCoverage = insuranceCoverageSummary(
    doctor ? doctor.insurance_providers : row?.insurance_providers,
    t,
  );
  const contacts = doctor?.contacts ?? row?.contacts;
  const phone = doctor?.phone ?? row?.phone;
  const email = doctor?.email ?? row?.email;
  const openingHours = doctor?.opening_hours ?? row?.opening_hours;
  const licenseNumber = doctor?.license_number ?? row?.license_number;
  const licensingCountry = doctor?.licensing_country ?? row?.licensing_country;
  const licensingValidUntil = doctor?.licensing_valid_until ?? row?.licensing_valid_until;
  const notes = doctor?.notes ?? row?.notes;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <AdminSheetScaffold
          title={
            displayName ||
            (isMedicalProvider ? t.providers_doctor_detail : t.providers_contact_person_detail)
          }
          description={providerName}
          footer={
            canManage ? (
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => onOpenChange(false)}
                >
                  {t.common_cancel}
                </Button>
                {doctor && isMedicalProvider ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => onNewRelationship(doctor)}
                  >
                    <Plus className="size-4" />
                    {l("providers_relationship_add")}
                  </Button>
                ) : null}
                <Button type="button" className="h-9 rounded-lg" onClick={() => onEdit(view)}>
                  {l("patients_edit")}
                </Button>
              </SheetActionsFooter>
            ) : null
          }
        >
          <div className="space-y-3 rounded-xl p-4">
            <Section title={isMedicalProvider ? l("providers_doctor_profile") : t.providers_contact_profile}>
              <ReadOnlyLine label={l("patients_display_name")} value={displayName || t.common_not_set} wrap />
              {isMedicalProvider ? (
                <ReadOnlyLine label={l("providers_doctor_role")} value={role || t.common_not_set} />
              ) : null}
              <ReadOnlyLine
                label={isMedicalProvider ? l("providers_doctor_subrole") : t.providers_contact_position}
                value={(doctor?.subrole ?? row?.subrole) || t.common_not_set}
              />
              <ReadOnlyLine label={t.patients_gender} value={personGenderLabel(doctor?.gender ?? row?.gender ?? "unknown")} />
              {isMedicalProvider ? (
                <ReadOnlyLine label={l("providers_doctor_specializations")} value={specializations || t.common_not_set} />
              ) : null}
              {isMedicalProvider ? (
                <ReadOnlyLine
                  label={<LabelWithCount label={t.patients_insurance_type} count={insuranceCoverage.count} />}
                  value={insuranceCoverage.text || t.common_not_set}
                  wrap
                />
              ) : null}
              {isMedicalProvider ? (
                <ReadOnlyLine
                  label={l("providers_doctor_schwerpunkt")}
                  value={(doctor?.schwerpunkt ?? row?.schwerpunkt) || t.common_not_set}
                />
              ) : null}
              {isMedicalProvider ? (
                <ReadOnlyLine
                  label={l("providers_doctor_website")}
                  value={(doctor?.website ?? row?.website) || t.common_not_set}
                  wrap
                />
              ) : null}
              <ReadOnlyAvailabilityLine
                label={l("providers_opening_hours")}
                value={openingHours}
              />
            </Section>
            <Section title={l("providers_contacts")}>
              <ReadOnlyContacts contacts={contacts} fallbackPhone={phone} fallbackEmail={email} />
            </Section>
            {doctor && isMedicalProvider ? (
              <DoctorLinkedPatientsSection patients={doctor.linked_patients ?? []} />
            ) : null}
            {isMedicalProvider ? (
              <Section title={l("providers_license")}>
                <ReadOnlyLine label={l("providers_license_number")} value={licenseNumber || t.common_not_set} />
                <ReadOnlyLine label={l("providers_licensing_country")} value={licensingCountry || t.common_not_set} />
                <ReadOnlyLine label={l("providers_license_valid_until")} value={compactDate(licensingValidUntil, t.common_not_set)} />
              </Section>
            ) : null}
            {doctor && isMedicalProvider ? (
              <Section title={l("providers_doctor_relationships")}>
                {doctor.relationships.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{l("providers_relationships_empty")}</p>
                ) : (
                  <div className="space-y-2">
                    {doctor.relationships.map((relationship) => {
                      const targetName = [
                        relationship.target_doctor_title,
                        relationship.target_doctor_name,
                        relationship.target_provider_name,
                      ].filter(Boolean).join(" - ");
                      return (
                        <div key={relationship.id} className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <ReadOnlyLine
                              label={doctorRelationshipTypeLabel(relationship.relationship_type)}
                              value={targetName}
                            />
                          </div>
                          {canManage ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="mt-1 shrink-0 text-destructive hover:text-destructive"
                              aria-label={t.common_delete}
                              title={t.common_delete}
                              onClick={() => onDeleteRelationship(doctor.id, relationship.id, targetName)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            ) : null}
            <Section title={l("appointments_notes")}>
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {notes || t.common_not_set}
              </p>
            </Section>
          </div>
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}

function patientProfileHref(patientId: string) {
  return `/patients/${encodeURIComponent(patientId)}`;
}

function linkedPatientAddress(patient: Pick<LinkedPatient, "address_street" | "address_city" | "address_zip" | "address_country">) {
  const cityLine = [patient.address_zip, patient.address_city].filter(Boolean).join(" ");
  return [patient.address_street, cityLine, patient.address_country].filter(Boolean).join(", ");
}

function PatientProfileLink({
  patient,
  children,
  className,
}: {
  patient: Pick<LinkedPatient, "id">;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={patientProfileHref(patient.id)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-md text-left font-semibold text-foreground transition hover:text-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-ring/30",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ArrowUpRight className="size-3.5 shrink-0" />
    </a>
  );
}

function DoctorLinkedPatientsSection({ patients }: { patients: LinkedPatient[] }) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <Section title={l("providers_linked_patients")}>
      {patients.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.providers_no_patients}</p>
      ) : (
        <div className="space-y-2">
          {patients.map((patient) => (
            <div key={patient.id} className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <PatientProfileLink patient={patient} className="max-w-full text-sm">
                    {patientLabel(patient)}
                  </PatientProfileLink>
                  {linkedPatientAddress(patient) ? (
                    <p className="mt-1 text-xs leading-5 text-foreground">
                      {linkedPatientAddress(patient)}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {l("providers_last_interaction")}: {compactDateTime(patient.last_interaction_at, t.common_not_set)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ProviderStaffDetailSheet({
  open,
  view,
  staffRoles,
  canManage,
  onOpenChange,
  onEdit,
}: {
  open: boolean;
  view: StaffDetailView | null;
  staffRoles: ProviderStaffRoleItem[];
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (view: StaffDetailView) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  if (!view) return null;

  const staff = view.source === "provider" ? view.staff : null;
  const row = view.source === "catalog" ? view.row : null;
  const displayName = staff?.display_name ?? row?.display_name ?? row?.name ?? t.common_not_set;
  const providerName = view.source === "provider" ? view.providerName : row?.provider_name ?? "";
  const role = staff
    ? staffRoleLabel(staff.role, staffRoles, lang)
    : row?.role_name_de && lang === "de"
      ? row.role_name_de
      : row?.role_name_ru && lang === "ru"
        ? row.role_name_ru
        : row?.role_label || (row?.role_code ? staffRoleLabel(row.role_code, staffRoles, lang) : "");
  const contacts = staff?.contacts ?? row?.contacts;
  const phone = row?.phone;
  const email = row?.email;
  const openingHours = staff?.opening_hours ?? row?.opening_hours;
  const notes = staff?.notes ?? row?.notes;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <AdminSheetScaffold
          title={displayName}
          description={providerName}
          footer={
            canManage ? (
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => onOpenChange(false)}
                >
                  {t.common_cancel}
                </Button>
                <Button type="button" className="h-9 rounded-lg" onClick={() => onEdit(view)}>
                  {l("patients_edit")}
                </Button>
              </SheetActionsFooter>
            ) : null
          }
        >
          <div className="space-y-3 rounded-xl p-4">
            <Section title={l("providers_staff_detail")}>
              <ReadOnlyLine label={l("patients_display_name")} value={displayName} wrap />
              <ReadOnlyLine label={l("providers_people_role")} value={role || t.common_not_set} />
              <ReadOnlyLine label={l("providers_staff_department")} value={(staff?.department ?? row?.department) || t.common_not_set} />
              <ReadOnlyLine label={t.patients_gender} value={personGenderLabel(staff?.gender ?? row?.gender ?? "unknown")} />
              <ReadOnlyLine label={t.users_status} value={humanizeCode(staff?.status ?? row?.status ?? "unknown")} />
              <ReadOnlyAvailabilityLine
                label={l("providers_opening_hours")}
                value={openingHours}
              />
            </Section>
            <Section title={l("providers_contacts")}>
              <ReadOnlyContacts contacts={contacts} fallbackPhone={phone} fallbackEmail={email} />
            </Section>
            <Section title={l("appointments_notes")}>
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {notes || t.common_not_set}
              </p>
            </Section>
          </div>
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}

function ProviderEditFormSheet({
  open,
  onOpenChange,
  form,
  detail,
  specializations,
  insuranceProviders,
  taxonomyNodes,
  parentProviderOptions,
  permissions,
  busy,
  error,
  onSubmit,
  onChange,
  onContactsChange,
  onManageSpecializations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ProviderFormState;
  detail: ProviderDetail;
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  taxonomyNodes: ProviderTaxonomyNode[];
  parentProviderOptions: ProviderSummary[];
  permissions: ProviderPermissions;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (field: keyof ProviderFormState, value: string) => void;
  onContactsChange: (contacts: ProviderFormState["contacts"]) => void;
  onManageSpecializations?: () => void;
}) {
  const { t } = useLang();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={t.patients_edit}
            description={detail.name || t.providers_detail}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={t.common_save}
                submittingLabel={t.patients_saving}
                submitting={busy}
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              <ProviderFormFields
                form={form}
                specializations={specializations}
                insuranceProviders={insuranceProviders}
                taxonomyNodes={taxonomyNodes}
                parentProviderOptions={parentProviderOptions}
                currentProviderId={detail.id}
                onChange={onChange}
                onContactsChange={onContactsChange}
                forceNonMedical={permissions.forceNonMedical}
                disabled={!permissions.canManageRegistry}
                onManageSpecializations={onManageSpecializations}
                grouped
              />
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProviderDoctorFormSheet({
  open,
  onOpenChange,
  form,
  providerType,
  specializations,
  insuranceProviders,
  existingDoctorOptions,
  existingDoctorOptionsBusy,
  existingDoctorOptionsError,
  busy,
  error,
  onSubmit,
  onSelectExistingDoctor,
  onChange,
  onContactsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DoctorFormState;
  providerType: ProviderType;
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  existingDoctorOptions: ProviderPeopleRow[];
  existingDoctorOptionsBusy: boolean;
  existingDoctorOptionsError: string;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelectExistingDoctor: (identityId: string) => void;
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onContactsChange: (contacts: DoctorFormState["contacts"]) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const isMedicalProvider = providerType === "medical";
  const createLabel = isMedicalProvider
    ? t.providers_doctor_new
    : t.providers_contact_person_new;
  const detailLabel = isMedicalProvider
    ? t.providers_doctor_detail
    : t.providers_contact_person_detail;
  const submitLabel = form.id ? t.common_save : createLabel;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? detailLabel : createLabel}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={submitLabel}
                submittingLabel={submitLabel}
                submitting={busy}
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              {isMedicalProvider && !form.id ? (
                <Section title={l("providers_existing_doctor_section")}>
                  <Field label={l("providers_existing_doctor_select")}>
                    <NativeComboboxSelect
                      value={form.sharedIdentityId || ""}
                      onChange={(event) => {
                        const identityId = event.target.value;
                        if (identityId) onSelectExistingDoctor(identityId);
                      }}
                      className={formSelectClassName}
                      disabled={busy || existingDoctorOptionsBusy}
                    >
                      <option value="">
                        {existingDoctorOptionsBusy
                          ? l("providers_existing_doctor_loading")
                          : l("providers_existing_doctor_placeholder")}
                      </option>
                      {existingDoctorOptions.map((doctor) => {
                        const identityId = doctorIdentityValue(doctor);
                        return (
                          <option key={identityId} value={identityId}>
                            {providerPeopleDoctorOptionLabel(doctor)}
                          </option>
                        );
                      })}
                    </NativeComboboxSelect>
                  </Field>
                  {existingDoctorOptionsError ? (
                    <p className="text-xs text-destructive">{existingDoctorOptionsError}</p>
                  ) : existingDoctorOptionsBusy ? null : existingDoctorOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {l("providers_existing_doctor_empty")}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {l("providers_existing_doctor_hint")}
                    </p>
                  )}
                </Section>
              ) : null}
              {isMedicalProvider ? (
                <DoctorFormFields
                  form={form}
                  specializations={specializations}
                  insuranceProviders={insuranceProviders}
                  onChange={onChange}
                  onContactsChange={onContactsChange}
                />
              ) : (
                <ContactPersonFormFields
                  form={form}
                  onChange={onChange}
                  onContactsChange={onContactsChange}
                />
              )}
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProviderDoctorRelationshipFormSheet({
  open,
  onOpenChange,
  form,
  sourceDoctors,
  targetProviders,
  taxonomyNodes,
  targetDoctors,
  targetDoctorsBusy,
  busy,
  error,
  onSubmit,
  onChange,
  onTargetProviderChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DoctorRelationshipFormState;
  sourceDoctors: DoctorSummary[];
  targetProviders: ProviderSummary[];
  taxonomyNodes: ProviderTaxonomyNode[];
  targetDoctors: DoctorSummary[];
  targetDoctorsBusy: boolean;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (patch: Partial<DoctorRelationshipFormState>) => void;
  onTargetProviderChange: (providerId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const sourceDoctor = sourceDoctors.find((doctor) => doctor.id === form.sourceDoctorId);
  const availableTargetDoctors = targetDoctors.filter(
    (doctor) => doctor.id !== form.sourceDoctorId,
  );
  const noAvailableTargetDoctors =
    Boolean(form.targetProviderId) && !targetDoctorsBusy && availableTargetDoctors.length === 0;
  const submitLabel = form.id ? t.common_save : l("providers_relationship_add");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? l("providers_relationship_edit") : l("providers_relationship_add")}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={submitLabel}
                submittingLabel={submitLabel}
                submitting={busy}
                submitDisabled={
                  targetDoctorsBusy ||
                  !form.targetProviderId ||
                  !form.targetDoctorId ||
                  noAvailableTargetDoctors ||
                  !availableTargetDoctors.some((doctor) => doctor.id === form.targetDoctorId)
                }
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              <Section title={l("providers_doctor_relationships")}>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={l("providers_relationship_source")} required>
                    <NativeComboboxSelect
                      value={form.sourceDoctorId}
                      onChange={(event) => onChange({ sourceDoctorId: event.target.value })}
                      className={formSelectClassName}
                      disabled
                      required
                    >
                      {sourceDoctor ? (
                        <option value={sourceDoctor.id}>{doctorListDisplayName(sourceDoctor)}</option>
                      ) : (
                        <option value="">{t.common_not_set}</option>
                      )}
                    </NativeComboboxSelect>
                  </Field>
                  <FieldGroup label={l("providers_relationship_target_provider")}>
                    <ProviderSelectWithTaxonomyFilter
                      value={form.targetProviderId}
                      providers={targetProviders}
                      taxonomyNodes={taxonomyNodes}
                      providerPlaceholder={t.common_select_placeholder}
                      taxonomyPlaceholder={t.providers_category}
                      taxonomyAllLabel={t.providers_all}
                      restrictTaxonomyToAvailable
                      noProvidersLabel={t.providers_none_in_category}
                      containerClassName="grid gap-2"
                      taxonomySelectClassName={formSelectClassName}
                      providerSelectClassName={formSelectClassName}
                      providerLabel={(provider) =>
                        [provider.name, provider.address_city, provider.address_country]
                          .filter(Boolean)
                          .join(" - ")
                      }
                      onChange={onTargetProviderChange}
                    />
                  </FieldGroup>
                  <Field label={l("providers_relationship_target_doctor")} required>
                    <div className="space-y-1.5">
                      <NativeComboboxSelect
                        value={form.targetDoctorId}
                        onChange={(event) => onChange({ targetDoctorId: event.target.value })}
                        className={formSelectClassName}
                        disabled={!form.targetProviderId || targetDoctorsBusy || noAvailableTargetDoctors}
                        required
                      >
                        <option value="">
                          {targetDoctorsBusy ? l("providers_loading_provider") : t.common_select_placeholder}
                        </option>
                        {availableTargetDoctors.map((doctor) => (
                          <option key={doctor.id} value={doctor.id}>
                            {doctorListDisplayName(doctor)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                      {!form.targetProviderId ? (
                        <p className="text-xs text-muted-foreground">
                          {l("providers_relationship_select_target_provider_first")}
                        </p>
                      ) : noAvailableTargetDoctors ? (
                        <p className="text-xs text-muted-foreground">
                          {l("providers_relationship_no_target_doctors")}
                        </p>
                      ) : null}
                    </div>
                  </Field>
                  <Field label={l("providers_relationship_type")}>
                    <NativeComboboxSelect
                      value={form.relationshipType}
                      onChange={(event) =>
                        onChange({
                          relationshipType:
                            event.target.value === "referral" ||
                            event.target.value === "knows" ||
                            event.target.value === "approach_via" ||
                            event.target.value === "other"
                              ? event.target.value
                              : "professional",
                        })
                      }
                      className={formSelectClassName}
                    >
                      <option value="professional">{doctorRelationshipTypeLabel("professional")}</option>
                      <option value="referral">{doctorRelationshipTypeLabel("referral")}</option>
                      <option value="knows">{doctorRelationshipTypeLabel("knows")}</option>
                      <option value="approach_via">{doctorRelationshipTypeLabel("approach_via")}</option>
                      <option value="other">{doctorRelationshipTypeLabel("other")}</option>
                    </NativeComboboxSelect>
                  </Field>
                </div>
                <Field label={l("providers_relationship_description")}>
                  <textarea
                    value={form.description}
                    onChange={(event) => onChange({ description: event.target.value })}
                    className={textareaClassName}
                    rows={3}
                  />
                </Field>
                <Field label={l("appointments_notes")}>
                  <textarea
                    value={form.notes}
                    onChange={(event) => onChange({ notes: event.target.value })}
                    className={textareaClassName}
                    rows={3}
                  />
                </Field>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) => onChange({ isActive: event.target.checked })}
                    className={checkboxClass}
                  />
                  {t.common_active}
                </label>
              </Section>
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProviderServiceFormSheet({
  open,
  onOpenChange,
  form,
  busy,
  error,
  providerType,
  taxonomyNodes,
  onSubmit,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ServiceFormState;
  busy: boolean;
  error: string;
  providerType: ProviderType;
  taxonomyNodes: ProviderTaxonomyNode[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (field: keyof ServiceFormState, value: string) => void;
}) {
  const { t } = useLang();
  const submitLabel = form.id ? t.common_save : t.providers_service_new;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? t.providers_service_detail : t.providers_service_new}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={submitLabel}
                submittingLabel={submitLabel}
                submitting={busy}
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              <ServiceFormFields
                form={form}
                providerType={providerType}
                taxonomyNodes={taxonomyNodes}
                onChange={onChange}
              />
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProviderStaffFormSheet({
  open,
  onOpenChange,
  form,
  staffRoles,
  busy,
  error,
  onSubmit,
  onChange,
  onContactsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: StaffFormState;
  staffRoles: ProviderStaffRoleItem[];
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (field: keyof StaffFormState, value: string) => void;
  onContactsChange: (contacts: StaffFormState["contacts"]) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const submitLabel = form.id ? t.common_save : l("providers_staff_new");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? l("providers_staff_detail") : l("providers_staff_new")}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={submitLabel}
                submittingLabel={submitLabel}
                submitting={busy}
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              <StaffFormFields
                form={form}
                staffRoles={staffRoles}
                onChange={onChange}
                onContactsChange={onContactsChange}
              />
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type SpecializationDraft = {
  nameEn: string;
  nameDe: string;
  nameRu: string;
  sortOrder: string;
  isActive: boolean;
};

function blankSpecializationDraft(): SpecializationDraft {
  return {
    nameEn: "",
    nameDe: "",
    nameRu: "",
    sortOrder: "1000",
    isActive: true,
  };
}

function specializationToDraft(item: SpecializationItem): SpecializationDraft {
  return {
    nameEn: item.name_en,
    nameDe: item.name_de ?? "",
    nameRu: item.name_ru ?? item.name_en ?? "",
    sortOrder: String(item.sort_order),
    isActive: item.is_active,
  };
}

function specializationDraftPayload(draft: SpecializationDraft) {
  const ruName = draft.nameRu.trim();
  const deName = draft.nameDe.trim();
  const fallbackName = ruName || deName;

  return {
    name_en: draft.nameEn.trim() || fallbackName,
    name_de: deName || fallbackName || null,
    name_ru: ruName || fallbackName || null,
    sort_order: Number.parseInt(draft.sortOrder, 10) || 1000,
    is_active: draft.isActive,
  };
}

function hasSpecializationDraftChanges(
  draft: SpecializationDraft,
  editingItem?: SpecializationItem,
) {
  const baseline = editingItem
    ? specializationToDraft(editingItem)
    : blankSpecializationDraft();

  return (
    draft.nameEn !== baseline.nameEn ||
    draft.nameDe !== baseline.nameDe ||
    draft.nameRu !== baseline.nameRu ||
    draft.sortOrder !== baseline.sortOrder ||
    draft.isActive !== baseline.isActive
  );
}

function SpecializationManagerSheet({
  open,
  items,
  busy,
  error,
  onOpenChange,
  onCreate,
  onUpdate,
  onToggleActive,
  onDelete,
}: {
  open: boolean;
  items: SpecializationItem[];
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (specializationId: string, payload: Record<string, unknown>) => Promise<void>;
  onToggleActive: (specializationId: string, active: boolean) => Promise<void>;
  onDelete: (specializationId: string) => Promise<void>;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<SpecializationDraft>(() => blankSpecializationDraft());
  const editingItem = items.find((item) => item.id === editingId);
  const isDirty = hasSpecializationDraftChanges(draft, editingItem);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setEditingId("");
      setDraft(blankSpecializationDraft());
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = specializationDraftPayload(draft);
    if (!payload.name_en) return;

    if (editingId) {
      await onUpdate(editingId, payload);
    } else {
      await onCreate(payload);
    }
    setEditingId("");
    setDraft(blankSpecializationDraft());
  }

  function startEdit(item: SpecializationItem) {
    setEditingId(item.id);
    setDraft(specializationToDraft(item));
  }

  async function handleDelete(item: SpecializationItem) {
    const label = specializationOptionLabel(item, lang);
    if (!window.confirm(formatUiText(l("providers_specialization_delete_confirm"), { name: label }))) {
      return;
    }
    try {
      await onDelete(item.id);
      if (editingId === item.id) {
        setEditingId("");
        setDraft(blankSpecializationDraft());
      }
    } catch {
      // The parent sheet owns the user-visible error banner.
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange} dirty={isDirty}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <AdminSheetScaffold
          title={l("providers_specializations_title")}
          footer={
            <SheetActionsFooter>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                form="provider-specialization-form"
                className="h-9 rounded-lg"
                disabled={busy || !(draft.nameRu.trim() || draft.nameDe.trim())}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {editingId
                  ? l("providers_specialization_update")
                  : l("providers_specialization_create")}
              </Button>
            </SheetActionsFooter>
          }
        >
          <div className="space-y-4 p-4">
            {error ? <Banner tone="error">{error}</Banner> : null}

            <form id="provider-specialization-form" onSubmit={handleSubmit} className="space-y-3">
              <Section
                title={
                  editingItem
                    ? formatUiText(l("common_edit_label"), {
                        label: specializationOptionLabel(editingItem, lang),
                      })
                    : l("providers_specialization_create")
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={l("providers_specialization_name_ru")} required={!draft.nameDe.trim()}>
                    <Input
                      value={draft.nameRu}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, nameRu: event.target.value }))
                      }
                      className={shellInputClassName}
                      required={!draft.nameDe.trim()}
                    />
                  </Field>
                  <Field label={l("providers_specialization_name_de")} required={!draft.nameRu.trim()}>
                    <Input
                      value={draft.nameDe}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, nameDe: event.target.value }))
                      }
                      className={shellInputClassName}
                      required={!draft.nameRu.trim()}
                    />
                  </Field>
                  <Field label={l("providers_specialization_sort_order")}>
                    <Input
                      type="number"
                      min="0"
                      value={draft.sortOrder}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, sortOrder: event.target.value }))
                      }
                      className={shellInputClassName}
                    />
                  </Field>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, isActive: event.target.checked }))
                    }
                    className={checkboxClass}
                  />
                  {l("providers_specialization_active")}
                </label>
              </Section>
            </form>

            <Section title={l("providers_specializations_list")}>
              {items.length === 0 ? (
                <EmptyPanel
                  title={l("providers_specializations_title")}
                  text={l("providers_specializations_empty")}
                />
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2.5 rounded-lg border border-border bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                            {specializationOptionLabel(item, lang)}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              item.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-zinc-200 bg-zinc-50 text-zinc-600",
                            )}
                          >
                            {item.is_active ? t.common_active : t.common_inactive}
                          </Badge>
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {item.code} - {l("providers_specialization_sort_order")}: {item.sort_order}
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          DE: {specializationDeLabel(item) || "-"} / RU: {specializationRuLabel(item) || "-"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg bg-muted/20"
                          disabled={busy}
                          onClick={() => startEdit(item)}
                        >
                          {l("patients_edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg bg-muted/20"
                          disabled={busy}
                          onClick={() => onToggleActive(item.id, !item.is_active)}
                        >
                          {item.is_active
                            ? l("providers_specialization_deactivate")
                            : l("providers_specialization_activate")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                          disabled={busy}
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 className="size-3.5" />
                          {l("providers_specialization_delete")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}

type StaffRoleDraft = {
  nameDe: string;
  nameRu: string;
  sortOrder: string;
  isActive: boolean;
};

function blankStaffRoleDraft(): StaffRoleDraft {
  return {
    nameDe: "",
    nameRu: "",
    sortOrder: "1000",
    isActive: true,
  };
}

function staffRoleToDraft(role: ProviderStaffRoleItem): StaffRoleDraft {
  return {
    nameDe: role.name_de ?? "",
    nameRu: role.name_ru ?? "",
    sortOrder: String(role.sort_order),
    isActive: role.is_active,
  };
}

function staffRoleDraftPayload(draft: StaffRoleDraft) {
  const ruName = draft.nameRu.trim();
  const deName = draft.nameDe.trim();
  const fallbackName = ruName || deName;

  return {
    name_en: fallbackName,
    name_de: deName || fallbackName || null,
    name_ru: ruName || fallbackName || null,
    sort_order: Number.parseInt(draft.sortOrder, 10) || 1000,
    is_active: draft.isActive,
  };
}

function hasStaffRoleDraftChanges(
  draft: StaffRoleDraft,
  editingRole?: ProviderStaffRoleItem,
) {
  const baseline = editingRole
    ? staffRoleToDraft(editingRole)
    : blankStaffRoleDraft();

  return (
    draft.nameDe !== baseline.nameDe ||
    draft.nameRu !== baseline.nameRu ||
    draft.sortOrder !== baseline.sortOrder ||
    draft.isActive !== baseline.isActive
  );
}

function StaffRoleManagerSheet({
  open,
  roles,
  busy,
  error,
  onOpenChange,
  onCreate,
  onUpdate,
  onToggleActive,
}: {
  open: boolean;
  roles: ProviderStaffRoleItem[];
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (roleId: string, payload: Record<string, unknown>) => Promise<void>;
  onToggleActive: (roleId: string, active: boolean) => Promise<void>;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<StaffRoleDraft>(() => blankStaffRoleDraft());
  const editingRole = roles.find((role) => role.id === editingId);
  const isDirty = hasStaffRoleDraftChanges(draft, editingRole);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setEditingId("");
      setDraft(blankStaffRoleDraft());
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = staffRoleDraftPayload(draft);
    if (!payload.name_en) return;

    if (editingId) {
      await onUpdate(editingId, payload);
    } else {
      await onCreate(payload);
    }
    setEditingId("");
    setDraft(blankStaffRoleDraft());
  }

  function startEdit(role: ProviderStaffRoleItem) {
    setEditingId(role.id);
    setDraft(staffRoleToDraft(role));
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange} dirty={isDirty}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <AdminSheetScaffold
          title={l("providers_staff_roles_title")}
          footer={
            <SheetActionsFooter>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                form="provider-staff-role-form"
                className="h-9 rounded-lg"
                disabled={busy || !(draft.nameRu.trim() || draft.nameDe.trim())}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {editingId ? l("providers_staff_role_update") : l("providers_staff_role_create")}
              </Button>
            </SheetActionsFooter>
          }
        >
          <div className="space-y-4 p-4">
            {error ? <Banner tone="error">{error}</Banner> : null}

            <form id="provider-staff-role-form" onSubmit={handleSubmit} className="space-y-3">
              <Section
                title={
                  editingRole
                    ? formatUiText(l("common_edit_label"), {
                        label: staffRoleDisplayName(editingRole, lang),
                      })
                    : l("providers_staff_role_create")
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={l("providers_staff_role_name_ru")} required>
                    <Input
                      value={draft.nameRu}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, nameRu: event.target.value }))
                      }
                      className={shellInputClassName}
                      required
                    />
                  </Field>
                  <Field label={l("providers_staff_role_name_de")}>
                    <Input
                      value={draft.nameDe}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, nameDe: event.target.value }))
                      }
                      className={shellInputClassName}
                    />
                  </Field>
                  <Field label={l("providers_staff_role_sort_order")}>
                    <Input
                      type="number"
                      min="0"
                      value={draft.sortOrder}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, sortOrder: event.target.value }))
                      }
                      className={shellInputClassName}
                    />
                  </Field>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, isActive: event.target.checked }))
                    }
                    className={checkboxClass}
                  />
                  {l("providers_staff_role_active")}
                </label>
              </Section>
            </form>

            <Section title={l("providers_staff_roles_list")}>
              {roles.length === 0 ? (
                <EmptyPanel
                  title={l("providers_staff_roles_title")}
                  text={l("providers_staff_roles_empty")}
                />
              ) : (
                <div className="space-y-2">
                  {roles.map((role) => (
                    <div
                      key={role.id}
                      className="grid gap-2.5 rounded-lg border border-border bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                            {staffRoleDisplayName(role, lang)}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              role.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-zinc-200 bg-zinc-50 text-zinc-600",
                            )}
                          >
                            {role.is_active ? t.common_active : t.common_inactive}
                          </Badge>
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {role.code} - {l("providers_staff_role_sort_order")}: {role.sort_order}
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          DE: {role.name_de || "-"} / RU: {role.name_ru || "-"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg bg-muted/20"
                          disabled={busy}
                          onClick={() => startEdit(role)}
                        >
                          {l("patients_edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg bg-muted/20"
                          disabled={busy}
                          onClick={() => onToggleActive(role.id, !role.is_active)}
                        >
                          {role.is_active
                            ? l("providers_staff_role_deactivate")
                            : l("providers_staff_role_activate")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}

function ProvidersPage(...args: Parameters<typeof useProvidersPageContent>) {
  return useProvidersPageContent(...args);
}

function ProviderOverviewSection({
  detail,
  onOpenPatients,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  onOpenPatients: () => void;
  onOpenAppointments: () => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  const overviewRows = [
    {
      label:
        detail.provider_type === "non_medical"
          ? l("providers_contacts")
          : t.providers_doctors,
      value: detail.doctors.length,
    },
    {
      label: t.providers_services,
      value: detail.services.length,
    },
    {
      label: t.uiText.providers_staff ?? "providers_staff",
      value: detail.staff.length,
    },
    {
      label: t.uiText.providers_children ?? "providers_children",
      value: detail.children.length,
    },
    {
      label: t.providers_linked_patients,
      value: detail.linked_patients.length,
    },
    {
      label: l("providers_activity_items"),
      value: detail.interactions.length,
    },
  ];

  return (
    <section className={cn(providerDetailPanelClassName, "space-y-5 bg-card/40")}>
      <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
        {titleWithDot(l("providers_provider_overview"))}
      </h3>
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-8">
        <div className="space-y-4">
          {overviewRows.map((row) => (
            <div key={row.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="h-px bg-border/70" />
              <span className="text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="grid h-full gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenPatients}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("providers_patient_links")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l("providers_open_patients_linked_to_this_provider")}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </button>
          <button
            type="button"
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenAppointments}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("providers_appointments")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l("providers_open_appointments_for_this_provider")}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function HeroInfoTableRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-5 px-3 py-2.5 sm:grid-cols-[7.25rem_minmax(0,1fr)]">
      <div className="flex min-w-0 items-start gap-2 text-xs font-medium text-foreground">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-foreground/75" />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="min-w-0 break-words text-sm font-semibold leading-5 text-foreground">
        {children}
      </div>
    </div>
  );
}

function HeroAvailabilityTable({
  value,
}: {
  value: string | null | undefined;
}) {
  const { t, lang } = useLang();
  const rows = formatWeeklyAvailabilityDisplayItems(value, lang);
  if (rows.length === 0) return <span>{t.common_not_set}</span>;

  return (
    <div className="grid max-w-md gap-1 text-sm font-medium leading-5 text-foreground">
      {rows.map((row, index) => {
        if (row.freeText || !row.day) {
          return (
            <div key={`${row.label}-${index}`} className="break-words">
              {row.label}
            </div>
          );
        }

        const dayLabel = weeklyAvailabilityDayLabel(row.day, lang);
        const valueLabel = row.label.startsWith(dayLabel)
          ? row.label.slice(dayLabel.length).trim()
          : row.label;

        return (
          <div
            key={`${row.day}-${index}`}
            className="grid min-w-0 grid-cols-[1.65rem_auto] gap-1.5 text-left"
          >
            <span className={cn("font-semibold", row.closed ? "text-orange-800" : "text-foreground")}>
              {dayLabel}
            </span>
            <span
              className={cn(
                "min-w-0 break-words tabular-nums",
                row.closed ? "text-orange-800" : "text-foreground",
              )}
            >
              {valueLabel || t.common_not_set}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function providerFullAddressLine(detail: ProviderDetail) {
  const cityLine = [detail.address_zip, detail.address_city]
    .filter(Boolean)
    .join(" ");
  return [detail.address_street, cityLine, detail.address_country]
    .filter(Boolean)
    .join(", ");
}

function ProviderSheetHero({
  detail,
  providerActionBusy,
  permissions,
  onActivate,
  onDeactivate,
  onDelete,
  onEdit,
}: {
  detail: ProviderDetail;
  providerActionBusy: string | null;
  permissions: ProviderPermissions;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onEdit?: () => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;
  const isMedical = detail.provider_type === "medical";
  const addressLine = providerFullAddressLine(detail);
  const metaLine = [
    detail.legal_name && detail.legal_name !== detail.name ? detail.legal_name : null,
    providerMeta(detail),
  ].filter(Boolean).join(" - ");
  const insuranceTypeLine = insuranceTypeText(detail.insurance_providers, t);
  const specializationLine = specializationText(detail.specializations, detail.fachbereich, lang);
  const taxonomyLine = taxonomyLeafLabel(detail.taxonomy_node, detail.taxonomy_path, lang);
  const internalRatingLabel = formatProviderRating(detail.internal_rating, t.common_not_set);

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card px-7 py-4">
      <span
        className={cn(
          "absolute left-0 top-4 h-12 w-1 rounded-r-full",
          detail.is_active ? "bg-emerald-500" : "bg-zinc-300",
        )}
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px] md:items-stretch">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <span className="h-px w-8 bg-border" />
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]",
                detail.is_active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-zinc-200 bg-zinc-50 text-zinc-600",
              )}
            >
              {detail.is_active ? t.common_active : t.common_inactive}
            </Badge>
          </div>
          <h2 className="break-words text-xl font-semibold leading-tight text-foreground">
            {detail.name}
          </h2>
          <p className="mt-1.5 break-words text-sm text-muted-foreground">
            {metaLine || t.common_not_set}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                isMedical
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-violet-200 bg-violet-50 text-violet-700",
              )}
            >
              {providerTypeLabel(detail.provider_type, tr)}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {providerOrganizationLevelLabel(detail.organization_level)}
            </Badge>
            {taxonomyLine ? (
              <Badge
                variant="outline"
                className="max-w-full rounded-full border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                <span className="truncate">{taxonomyLine}</span>
              </Badge>
            ) : null}
            {detail.parent_provider_name ? (
              <Badge
                variant="outline"
                className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {detail.parent_provider_name}
              </Badge>
            ) : null}
          </div>
          <div className="mt-5 grid overflow-hidden rounded-lg border border-border/70 bg-card md:grid-cols-2">
            <HeroInfoTableRow icon={MapPin} label={l("patients_address")}>
              {addressLine || providerMeta(detail) || t.common_not_set}
            </HeroInfoTableRow>
            <HeroInfoTableRow icon={Phone} label={t.field_phone}>
              {detail.phone || t.common_not_set}
            </HeroInfoTableRow>
            <HeroInfoTableRow icon={Mail} label={t.field_email}>
              {detail.email || t.common_not_set}
            </HeroInfoTableRow>
            <HeroInfoTableRow icon={CalendarClock} label={l("providers_opening_hours")}>
              <HeroAvailabilityTable value={detail.opening_hours} />
            </HeroInfoTableRow>
            <HeroInfoTableRow icon={Star} label={t.providers_internal_rating}>
              <span className="break-words">
                <span className={detail.internal_rating != null ? "text-orange-600" : undefined}>
                  {internalRatingLabel}
                </span>
                {detail.internal_rating_note ? (
                  <span className="font-medium"> · {detail.internal_rating_note}</span>
                ) : null}
              </span>
            </HeroInfoTableRow>
            <HeroInfoTableRow icon={BadgeCheck} label={l("providers_tax_id")}>
              {detail.tax_id || t.common_not_set}
            </HeroInfoTableRow>
            {isMedical ? (
              <HeroInfoTableRow icon={ShieldCheck} label={t.patients_insurance_type}>
                {insuranceTypeLine || t.common_not_set}
              </HeroInfoTableRow>
            ) : null}
            <HeroInfoTableRow icon={Stethoscope} label={t.providers_fachbereich}>
              {specializationLine || t.common_not_set}
            </HeroInfoTableRow>
          </div>
        </div>
        <div className="flex flex-col justify-start gap-4 border-t border-dashed border-border/70 pt-3 text-left md:border-l md:border-t-0 md:pl-5 md:pt-0">
          {permissions.canManageRegistry ? (
            <div className="flex flex-col gap-2">
              {onEdit ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className={cn(providerPrimaryActionButtonClassName, "w-full justify-center gap-1.5")}
                  onClick={onEdit}
                >
                  <Pencil className="size-3.5" />
                  {l("patients_edit")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-center rounded-lg bg-muted/20"
                disabled={providerActionBusy === "activate" || detail.is_active}
                onClick={onActivate}
              >
                {providerActionBusy === "activate" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                {l("providers_activate")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-center rounded-lg bg-muted/20"
                disabled={providerActionBusy === "deactivate" || !detail.is_active}
                onClick={onDeactivate}
              >
                {providerActionBusy === "deactivate" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                {l("providers_deactivate")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                disabled={providerActionBusy === "delete"}
                onClick={onDelete}
              >
                {providerActionBusy === "delete" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {l("patients_delete")}
              </Button>
            </div>
          ) : null}
          <p className="text-right text-sm font-semibold tabular-nums text-foreground">
            {compactDateTime(detail.updated_at, t.common_not_set)}
          </p>
        </div>
      </div>
    </section>
  );
}

function specializationText(
  specializations:
    | { name_en?: string | null; name_de?: string | null; name_ru?: string | null; code?: string }[]
    | undefined,
  fallback?: string | null,
  lang: "de" | "ru" = "de",
) {
  const labels: string[] = [];
  for (const item of specializations ?? []) {
    const label = specializationOptionLabel(item as SpecializationItem, lang);
    if (label) {
      labels.push(label);
    }
  }
  if (labels.length) return labels.join(", ");
  return fallback ? specializationLabelForValue(fallback, specializations ?? [], lang) : "";
}

function insuranceTypeLabels(
  items: { name?: string | null }[] | undefined,
  t: Translations,
) {
  const seen = new Set<string>();
  return (items ?? [])
    .flatMap((item) => {
      const raw = item.name?.trim();
      if (!raw) return [];
      const label = insuranceTypeLabel(raw, t);
      const key = normalizeInsuranceProviderKey(label);
      if (seen.has(key)) return [];
      seen.add(key);
      return [label];
    });
}

function insuranceTypeText(
  items: { name?: string | null }[] | undefined,
  t: Translations,
) {
  return insuranceTypeLabels(items, t).join(", ");
}

function insuranceCoverageSummary(
  items: { name?: string | null }[] | undefined,
  t: Translations,
) {
  const labels = insuranceTypeLabels(items, t);
  return {
    count: labels.length,
    text: labels.join(", "),
  };
}

function contactSummary(
  contacts: { contact_kind: string; contact_type: string; value: string; is_primary?: boolean }[] | undefined,
  fallbackPhone?: string | null,
  fallbackEmail?: string | null,
) {
  const primaryPhone =
    contacts?.find((contact) => contact.contact_kind === "phone" && contact.is_primary)?.value ??
    contacts?.find((contact) => contact.contact_kind === "phone")?.value ??
    fallbackPhone;
  const primaryEmail =
    contacts?.find((contact) => contact.contact_kind === "email" && contact.is_primary)?.value ??
    contacts?.find((contact) => contact.contact_kind === "email")?.value ??
    fallbackEmail;
  return [primaryPhone, primaryEmail].filter(Boolean).join(" - ");
}

function staffRoleDisplayName(role: ProviderStaffRoleItem | undefined, lang: "de" | "ru") {
  if (!role) return "";
  return lang === "de"
    ? role.name_de || role.name_ru || role.code
    : role.name_ru || role.name_de || role.code;
}

function staffRoleLabel(code: string, roles: ProviderStaffRoleItem[], lang: "de" | "ru") {
  const roleLabel = staffRoleDisplayName(roles.find((role) => role.code === code), lang);
  if (roleLabel) return roleLabel;
  const uiTextKey = `providers_staff_role_${code}`;
  const fallbackLabel = uiText(uiTextKey, lang);
  return fallbackLabel === uiTextKey ? humanizeCode(code) : fallbackLabel;
}

function DoctorSection({
  detail,
  busy,
  relationshipBusy,
  canManage,
  onOpenProvider,
  onNew,
  onOpen,
  onEdit,
  onDelete,
  onNewRelationship,
  onEditRelationship,
  onDeleteRelationship,
}: {
  detail: ProviderDetail;
  busy: boolean;
  relationshipBusy: boolean;
  canManage: boolean;
  onOpenProvider: (providerId: string) => void;
  onNew: () => void;
  onOpen: (doctor: DoctorSummary) => void;
  onEdit: (doctor: DoctorSummary) => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onNewRelationship: (sourceDoctorId: string) => void;
  onEditRelationship: (sourceDoctorId: string, relationship: DoctorRelationship) => void;
  onDeleteRelationship: (sourceDoctorId: string, relationshipId: string, doctorName: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const isMedicalProvider = detail.provider_type === "medical";
  const title = isMedicalProvider ? t.providers_doctors : l("providers_contacts");
  const createLabel = isMedicalProvider
    ? t.providers_doctor_new
    : t.providers_contact_person_new;

  return (
    <section className={providerDetailPanelClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.doctors.length}
          </span>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className={cn(providerPrimaryActionButtonClassName, "justify-center gap-1.5")}
              onClick={onNew}
            >
              <Plus className="size-3.5" />
              {createLabel}
            </Button>
          </div>
        ) : null}
      </div>

      {detail.doctors.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={title}
            text={isMedicalProvider ? t.providers_no_patients : t.providers_no_contacts}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.doctors.map((doctor) => (
            isMedicalProvider ? (
              <DoctorCard
                key={doctor.id}
                doctor={doctor}
                busy={busy}
                canManage={canManage}
                relationshipBusy={relationshipBusy}
                onOpen={onOpen}
                onDelete={onDelete}
                onDeleteRelationship={onDeleteRelationship}
                onEdit={onEdit}
                onEditRelationship={onEditRelationship}
                onOpenProvider={onOpenProvider}
                onNewRelationship={onNewRelationship}
              />
            ) : (
              <ContactPersonCard
                key={doctor.id}
                contact={doctor}
                busy={busy}
                canManage={canManage}
                onOpen={onOpen}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            )
          ))}
        </div>
      )}
    </section>
  );
}

function ContactPersonCard({
  contact,
  busy,
  canManage,
  onOpen,
  onDelete,
  onEdit,
}: {
  contact: DoctorSummary;
  busy: boolean;
  canManage: boolean;
  onOpen: (doctor: DoctorSummary) => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onEdit: (doctor: DoctorSummary) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const contacts = contactSummary(contact.contacts, contact.phone, contact.email);
  const position = contact.subrole?.trim() ?? "";

  return (
    <div className="grid gap-3 rounded-[1.4rem] border border-border bg-card p-3.5 md:grid-cols-[minmax(0,1fr)_160px]">
      <button
        type="button"
        className="min-w-0 text-left"
        onClick={() => onOpen(contact)}
      >
        <div className="flex min-w-0 gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-sm font-medium text-muted-foreground">
            <UsersRound className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {doctorListDisplayName(contact)}
            </span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {position ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
                >
                  {position}
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {personGenderLabel(contact.gender)}
              </Badge>
              {contact.languages.map((language) => (
                <Badge
                  key={`${contact.id}-${language}`}
                  variant="outline"
                  className="rounded-full border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                >
                  {languageLabel(language, lang)}
                </Badge>
              ))}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {contacts || t.common_not_set}
            </span>
            {contact.opening_hours ? (
              <span className="mt-2 block">
                <span className="mb-1 block text-[11px] font-medium leading-tight text-muted-foreground">
                  {l("providers_opening_hours")}
                </span>
                <WeeklyAvailabilityBadgeList value={contact.opening_hours} />
              </span>
            ) : null}
          </span>
        </div>
      </button>
      {canManage ? (
        <div className="flex flex-col items-stretch justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
          <Button
            type="button"
            variant="default"
            size="sm"
            className={cn(providerPrimaryActionButtonClassName, "w-full justify-center")}
            onClick={() => onEdit(contact)}
          >
            {l("patients_edit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
            disabled={busy}
            onClick={() => onDelete(contact.id, contact.name)}
          >
            <Trash2 className="size-3.5" />
            {l("patients_delete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DoctorCard({
  doctor,
  busy,
  canManage,
  relationshipBusy,
  onOpen,
  onOpenProvider,
  onDelete,
  onDeleteRelationship,
  onEdit,
  onEditRelationship,
  onNewRelationship,
}: {
  doctor: DoctorSummary;
  busy: boolean;
  canManage: boolean;
  relationshipBusy: boolean;
  onOpen: (doctor: DoctorSummary) => void;
  onOpenProvider: (providerId: string) => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onDeleteRelationship: (sourceDoctorId: string, relationshipId: string, doctorName: string) => void;
  onEdit: (doctor: DoctorSummary) => void;
  onEditRelationship: (sourceDoctorId: string, relationship: DoctorRelationship) => void;
  onNewRelationship: (sourceDoctorId: string) => void;
}) {
  const { t, lang } = useLang();
  const specializations = specializationText(doctor.specializations, doctor.fachbereich, lang);
  const insuranceCoverage = insuranceCoverageSummary(doctor.insurance_providers, t);
  const contacts = contactSummary(doctor.contacts, doctor.phone, doctor.email);
  const roleLabel = doctor.role_label || (doctor.role_code ? doctorRoleLabel(doctor.role_code) : "");
  const subrole = doctor.subrole?.trim() ?? "";

  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-border bg-card">
      <details className="group">
        <DoctorCardSummary
          busy={busy}
          canManage={canManage}
          contacts={contacts}
          doctor={doctor}
          roleLabel={roleLabel}
          specializations={specializations}
          insuranceProviderCount={insuranceCoverage.count}
          insuranceProviders={insuranceCoverage.text}
          subrole={subrole}
          onOpen={onOpen}
          onDelete={onDelete}
          onEdit={onEdit}
          onNewRelationship={onNewRelationship}
        />
        <DoctorMetrics
          doctor={doctor}
          specializations={specializations}
          insuranceProviderCount={insuranceCoverage.count}
          insuranceProviders={insuranceCoverage.text}
        />
        <DoctorRelationships
          canManage={canManage}
          doctor={doctor}
          relationshipBusy={relationshipBusy}
          onDeleteRelationship={onDeleteRelationship}
          onEditRelationship={onEditRelationship}
          onOpenProvider={onOpenProvider}
          onNewRelationship={onNewRelationship}
        />
      </details>
      <DoctorCardLinkedPatients patients={doctor.linked_patients ?? []} />
    </div>
  );
}

function DoctorCardSummary({
  busy,
  canManage,
  contacts,
  doctor,
  insuranceProviderCount,
  roleLabel,
  specializations,
  insuranceProviders,
  subrole,
  onOpen,
  onDelete,
  onEdit,
  onNewRelationship,
}: {
  busy: boolean;
  canManage: boolean;
  contacts: string;
  doctor: DoctorSummary;
  insuranceProviderCount: number;
  roleLabel: string;
  specializations: string;
  insuranceProviders: string;
  subrole: string;
  onOpen: (doctor: DoctorSummary) => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onEdit: (doctor: DoctorSummary) => void;
  onNewRelationship: (sourceDoctorId: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <summary
      className="grid cursor-pointer list-none gap-3 p-3.5 transition hover:bg-muted/20 md:grid-cols-[minmax(0,1fr)_160px] [&::-webkit-details-marker]:hidden"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        onOpen(doctor);
      }}
    >
      <div className="flex min-w-0 gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-sm font-medium text-muted-foreground">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {doctorListDisplayName(doctor)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge
              variant="outline"
              className="max-w-full rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              <span className="truncate">{specializations || t.common_not_set}</span>
            </Badge>
            {roleLabel ? (
              <Badge
                variant="outline"
                className="rounded-full border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
              >
                {roleLabel}
              </Badge>
            ) : null}
            {insuranceProviders ? (
              <Badge
                variant="outline"
                className="max-w-full gap-1.5 rounded-full border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              >
                <span className="truncate">{insuranceProviders}</span>
                <span className="rounded-full bg-white/75 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-800">
                  {insuranceProviderCount}
                </span>
              </Badge>
            ) : null}
            {subrole ? (
              <Badge
                variant="outline"
                className="rounded-full border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700"
              >
                {subrole}
              </Badge>
            ) : null}
            <Badge
              variant="outline"
              className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {personGenderLabel(doctor.gender)}
            </Badge>
            {doctor.languages.map((language) => (
              <Badge
                key={`${doctor.id}-${language}`}
                variant="outline"
                className="rounded-full border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              >
                {languageLabel(language, lang)}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            {contacts || t.common_not_set}
          </p>
          {doctor.opening_hours ? (
            <div className="mt-2">
              <p className="mb-1 text-[11px] font-medium leading-tight text-muted-foreground">
                {l("providers_opening_hours")}
              </p>
              <WeeklyAvailabilityBadgeList value={doctor.opening_hours} />
            </div>
          ) : null}
        </div>
      </div>
      <DoctorSummaryActions
        busy={busy}
        canManage={canManage}
        doctor={doctor}
        onDelete={onDelete}
        onEdit={onEdit}
        onNewRelationship={onNewRelationship}
      />
    </summary>
  );
}

function DoctorSummaryActions({
  busy,
  canManage,
  doctor,
  onDelete,
  onEdit,
  onNewRelationship,
}: {
  busy: boolean;
  canManage: boolean;
  doctor: DoctorSummary;
  onDelete: (doctorId: string, doctorName: string) => void;
  onEdit: (doctor: DoctorSummary) => void;
  onNewRelationship: (sourceDoctorId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <div className="flex flex-col items-stretch justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
      {canManage ? (
        <>
          <Button
            type="button"
            variant="default"
            size="sm"
            className={cn(providerPrimaryActionButtonClassName, "w-full justify-center")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEdit(doctor);
            }}
          >
            {l("patients_edit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center rounded-lg bg-muted/20"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onNewRelationship(doctor.id);
            }}
          >
            <Plus className="size-3.5" />
            {l("providers_relationship_add_short")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(doctor.id, doctor.name);
            }}
          >
            <Trash2 className="size-3.5" />
            {l("patients_delete")}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function DoctorMetrics({
  doctor,
  insuranceProviderCount,
  specializations,
  insuranceProviders,
}: {
  doctor: DoctorSummary;
  insuranceProviderCount: number;
  specializations: string;
  insuranceProviders: string;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const linkedPatientCount = doctor.linked_patients?.length ?? doctor.patient_count;

  return (
    <div className="grid border-t border-border bg-muted/10 sm:grid-cols-2 lg:grid-cols-[1.1fr_1fr_1fr_1fr_0.5fr_0.5fr]">
      <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
        <p className="text-xs text-muted-foreground">{l("providers_doctor_specializations")}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {specializations || t.common_not_set}
        </p>
      </div>
      <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-muted-foreground">{t.patients_insurance_type}</p>
          {insuranceProviderCount > 0 ? (
            <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground">
              {insuranceProviderCount}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {insuranceProviders || t.common_not_set}
        </p>
      </div>
      <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
        <p className="text-xs text-muted-foreground">{l("providers_license")}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {doctor.license_number || t.common_not_set}
          </span>
          <Badge
            variant="outline"
            className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {doctor.licensing_country || t.common_not_set}
          </Badge>
        </div>
      </div>
      <div className="border-b border-border px-4 py-3 lg:border-b-0 lg:border-r">
        <p className="text-xs text-muted-foreground">{l("providers_valid_until")}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {compactDate(doctor.licensing_valid_until, t.common_not_set)}
        </p>
      </div>
      <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
        <p className="text-xs text-muted-foreground">{l("providers_patients")}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{linkedPatientCount}</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{l("providers_slots")}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{doctor.appointment_count}</p>
      </div>
    </div>
  );
}

function DoctorCardLinkedPatients({ patients }: { patients: LinkedPatient[] }) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {l("providers_linked_patients")}
        </p>
        <Badge
          variant="outline"
          className="rounded-full border-border bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {patients.length}
        </Badge>
      </div>
      {patients.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t.providers_no_patients}</p>
      ) : (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {patients.map((patient) => (
            <div key={patient.id} className="rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5">
              <PatientProfileLink patient={patient} className="max-w-full text-sm">
                {patientLabel(patient)}
              </PatientProfileLink>
              {linkedPatientAddress(patient) ? (
                <p className="mt-1 text-xs leading-5 text-foreground">
                  {linkedPatientAddress(patient)}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {l("providers_last_interaction")}: {compactDateTime(patient.last_interaction_at, t.common_not_set)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DoctorRelationships({
  canManage,
  doctor,
  relationshipBusy,
  onDeleteRelationship,
  onEditRelationship,
  onOpenProvider,
  onNewRelationship,
}: {
  canManage: boolean;
  doctor: DoctorSummary;
  relationshipBusy: boolean;
  onDeleteRelationship: (sourceDoctorId: string, relationshipId: string, doctorName: string) => void;
  onEditRelationship: (sourceDoctorId: string, relationship: DoctorRelationship) => void;
  onOpenProvider: (providerId: string) => void;
  onNewRelationship: (sourceDoctorId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {l("providers_doctor_relationships")}
        </p>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg bg-muted/20"
            onClick={() => onNewRelationship(doctor.id)}
          >
            <Plus className="size-3.5" />
            {l("providers_relationship_add")}
          </Button>
        ) : null}
      </div>
      {doctor.relationships.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {l("providers_relationships_empty")}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {doctor.relationships.map((relationship) => (
            <DoctorRelationshipCard
              key={relationship.id}
              doctorId={doctor.id}
              canManage={canManage}
              relationship={relationship}
              relationshipBusy={relationshipBusy}
              onDeleteRelationship={onDeleteRelationship}
              onEditRelationship={onEditRelationship}
              onOpenProvider={onOpenProvider}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DoctorRelationshipCard({
  doctorId,
  canManage,
  relationship,
  relationshipBusy,
  onDeleteRelationship,
  onEditRelationship,
  onOpenProvider,
}: {
  doctorId: string;
  canManage: boolean;
  relationship: DoctorRelationship;
  relationshipBusy: boolean;
  onDeleteRelationship: (sourceDoctorId: string, relationshipId: string, doctorName: string) => void;
  onEditRelationship: (sourceDoctorId: string, relationship: DoctorRelationship) => void;
  onOpenProvider: (providerId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/10 p-3 md:grid-cols-[minmax(0,1fr)_160px]">
      <button
        type="button"
        className="min-w-0 rounded-md text-left transition hover:bg-card/70 focus:outline-none focus:ring-2 focus:ring-ring/30"
        title={`${l("providers_open_provider")}: ${relationship.target_provider_name}`}
        onClick={() => onOpenProvider(relationship.target_provider_id)}
      >
        <p className="text-sm font-semibold text-foreground">
          {relationship.target_doctor_title ? `${relationship.target_doctor_title} ` : ""}
          {relationship.target_doctor_name}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className="rounded-full border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {relationship.target_provider_name}
          </Badge>
          <Badge
            variant="outline"
            className="rounded-full border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {doctorRelationshipTypeLabel(relationship.relationship_type)}
          </Badge>
          {!relationship.is_active ? (
            <Badge
              variant="outline"
              className="rounded-full border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {t.common_inactive}
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          {relationship.description || relationship.notes || t.common_not_set}
        </p>
      </button>
      {canManage ? (
        <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
          <Button
            type="button"
            variant="default"
            size="sm"
            className={cn(providerPrimaryActionButtonClassName, "w-full justify-center")}
            disabled={relationshipBusy}
            onClick={() => onEditRelationship(doctorId, relationship)}
          >
            {l("patients_edit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
            disabled={relationshipBusy}
            onClick={() =>
              onDeleteRelationship(
                doctorId,
                relationship.id,
                relationship.target_doctor_name,
              )
            }
          >
            <Trash2 className="size-3.5" />
            {l("patients_delete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StaffSection({
  detail,
  busy,
  staffRoles,
  canManage,
  onManageRoles,
  onNew,
  onOpen,
  onEdit,
  onDelete,
}: {
  detail: ProviderDetail;
  busy: boolean;
  staffRoles: ProviderStaffRoleItem[];
  canManage: boolean;
  onManageRoles: () => void;
  onNew: () => void;
  onOpen: (staff: ProviderStaff) => void;
  onEdit: (staff: ProviderStaff) => void;
  onDelete: (staffId: string, staffName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <section className={providerDetailPanelClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {l("providers_staff")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.staff.length}
          </span>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center rounded-lg bg-muted/20"
              onClick={onManageRoles}
            >
              <BadgeCheck className="size-3.5" />
              {l("providers_staff_roles_manage")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center rounded-lg bg-muted/20"
              onClick={onNew}
            >
              <Plus className="size-3.5" />
              {l("providers_staff_new")}
            </Button>
          </div>
        ) : null}
      </div>

      {detail.staff.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={l("providers_staff")}
            text={l("providers_no_staff")}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.staff.map((staff) => {
            const contacts = contactSummary(staff.contacts);
            return (
              <div
                key={staff.id}
                role="button"
                tabIndex={0}
                className="overflow-hidden rounded-[1.4rem] border border-border bg-card text-left transition hover:bg-muted/20"
                onClick={() => onOpen(staff)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(staff);
                  }
                }}
              >
                <div className="grid gap-3 p-3.5 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{staff.display_name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {staffRoleLabel(staff.role, staffRoles, lang)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {humanizeCode(staff.status)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {personGenderLabel(staff.gender)}
                      </Badge>
                      {staff.department ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {staff.department}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs leading-snug text-muted-foreground">
                      {contacts || t.common_not_set}
                    </p>
                    {staff.opening_hours ? (
                      <div className="mt-2">
                        <p className="mb-1 text-[11px] font-medium leading-tight text-muted-foreground">
                          {l("providers_opening_hours")}
                        </p>
                        <WeeklyAvailabilityBadgeList value={staff.opening_hours} />
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {l("providers_staff_notes")}
                    </span>
                    <p className="mt-1 break-words text-sm text-foreground">
                      {staff.notes || t.common_not_set}
                    </p>
                  </div>

                  {canManage ? (
                    <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className={cn(providerPrimaryActionButtonClassName, "w-full justify-center")}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(staff);
                        }}
                      >
                        {l("patients_edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(staff.id, staff.display_name);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {l("patients_delete")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ServiceSection({
  detail,
  busy,
  taxonomyNodes,
  canManage,
  onNew,
  onEdit,
  onDelete,
}: {
  detail: ProviderDetail;
  busy: boolean;
  taxonomyNodes: ProviderTaxonomyNode[];
  canManage: boolean;
  onNew: () => void;
  onEdit: (service: ServiceItem) => void;
  onDelete: (serviceId: string, serviceName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className={providerDetailPanelClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {l("providers_service_catalog")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.services.length}
          </span>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-center rounded-lg bg-muted/20"
            onClick={onNew}
          >
            <Plus className="size-3.5" />
            {t.providers_service_new}
          </Button>
        ) : null}
      </div>

      {detail.services.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_services}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.services.map((service) => (
            <div
              key={service.id}
              className="overflow-hidden rounded-[1.4rem] border border-border bg-card"
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{service.service_name}</p>
                  {serviceTaxonomyLabel(service, taxonomyNodes, lang) ? (
                    <p className="mt-1 break-words text-xs font-medium text-muted-foreground">
                      {serviceTaxonomyLabel(service, taxonomyNodes, lang)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {service.description || t.common_not_set}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t.providers_service_valid_from}:{" "}
                      <span className="font-medium text-foreground">
                        {compactDate(service.valid_from, t.common_not_set)}
                      </span>
                    </span>
                    <span>
                      {t.providers_service_valid_to}:{" "}
                      <span className="font-medium text-foreground">
                        {compactDate(service.valid_to, t.common_not_set)}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/70 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{l("providers_price")}</span>
                  <span className="text-lg font-semibold leading-none text-foreground">
                    {servicePriceLabel(service)}
                  </span>
                </div>

                {canManage ? (
                  <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className={cn(providerPrimaryActionButtonClassName, "w-full justify-center")}
                      onClick={() => onEdit(service)}
                    >
                      {l("patients_edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                      disabled={busy}
                      onClick={() => onDelete(service.id, service.service_name)}
                    >
                      <Trash2 className="size-3.5" />
                      {l("patients_delete")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>      )}
    </section>
  );
}
function LinkedPatientsSection({
  detail,
}: {
  detail: ProviderDetail;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className={providerDetailPanelClassName}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {l("providers_linked_patients")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.linked_patients.length}
          </span>
        </div>

      </div>

      {detail.linked_patients.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_no_patients}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.linked_patients.map((patient) => (
            <div
              key={patient.id}
              className="overflow-hidden rounded-[1.4rem] border border-border bg-card"
            >
              <div className="p-3.5">
                <div className="min-w-0">
                  <PatientProfileLink patient={patient} className="max-w-full text-sm">
                    {patientLabel(patient)}
                  </PatientProfileLink>
                  {linkedPatientAddress(patient) ? (
                    <p className="mt-1 text-xs leading-5 text-foreground">
                      {linkedPatientAddress(patient)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {l("providers_last_interaction")}: {compactDateTime(patient.last_interaction_at, t.common_not_set)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>      )}
    </section>
  );
}

const INTERACTION_KIND_LABEL_KEYS = {
  appointment: "interaction_appointment",
  concierge_service: "activity_entity_concierge_service",
  service: "interaction_service",
  activity: "interaction_activity",
} satisfies Partial<Record<string, TranslationKey>>;

const INTERACTION_STATUS_LABEL_KEYS = {
  planned: "operations_status_planned",
  scheduled: "operations_status_planned",
  requested: "documents_requested",
  booked: "operations_status_booked",
  confirmed: "operations_status_confirmed",
  in_progress: "operations_status_in_progress",
  in_service: "operations_status_in_service",
  completed: "common_completed",
  cancelled: "invoices_workspace_status_cancelled",
  draft: "invoices_workspace_status_draft",
  delivered: "operations_status_delivered",
  approved: "operations_status_approved",
} satisfies Partial<Record<string, TranslationKey>>;

const INTERACTION_TYPE_LABEL_KEYS = {
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
  internal: "operations_status_internal",
  hotel: "services_type_hotel",
  transfer: "services_type_transfer",
  vip_terminal: "services_type_vip_terminal",
  flight: "services_type_flight",
  chauffeur: "services_type_chauffeur",
  translation_support: "services_type_translation_support",
  other: "services_type_other",
} satisfies Partial<Record<string, TranslationKey>>;

const AUTO_CREATED_NON_MEDICAL_NOTE = "auto-created from non-medical appointment";

function normalizeInteractionCode(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function interactionLabel(
  value: string | null | undefined,
  labelKeys: Partial<Record<string, TranslationKey>>,
  translations: Translations,
) {
  const normalized = normalizeInteractionCode(value);
  if (!normalized) return translations.common_not_set;
  const labelKey = labelKeys[normalized];
  return labelKey ? translations[labelKey] : humanizeCode(normalized);
}

function interactionKindLabel(value: string | null | undefined, translations: Translations) {
  return interactionLabel(value, INTERACTION_KIND_LABEL_KEYS, translations);
}

function interactionStatusLabel(value: string | null | undefined, translations: Translations) {
  return interactionLabel(value, INTERACTION_STATUS_LABEL_KEYS, translations);
}

function interactionTypeLabel(value: string | null | undefined, translations: Translations) {
  return interactionLabel(value, INTERACTION_TYPE_LABEL_KEYS, translations);
}

function interactionNoteLabel(value: string | null | undefined, lang: "de" | "ru") {
  const note = value?.trim();
  if (!note) return null;
  if (note.toLowerCase() === AUTO_CREATED_NON_MEDICAL_NOTE) {
    return lang === "de"
      ? "Automatisch aus einem nicht-medizinischen Termin erstellt."
      : "Автоматически создано из немедицинского приёма.";
  }
  return note;
}

function InteractionHistorySection({
  detail,
}: {
  detail: ProviderDetail;
}) {
  const { lang, t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className={providerDetailPanelClassName}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {l("providers_interaction_history")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.interactions.length}
          </span>
        </div>

      </div>

      {detail.interactions.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_no_activity}
            text={t.providers_no_activity}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3 pl-6">
          {detail.interactions.map((item, index) => {
            const notes = interactionNoteLabel(item.notes, lang);
            return (
              <div
                key={item.id}
                className={cn(
                  "relative",
                  index < detail.interactions.length - 1 &&
                    "before:absolute before:-bottom-5 before:-left-4 before:top-3 before:w-px before:bg-border",
                )}
              >
                <span className="absolute -left-[1.125rem] top-1.5 z-10 size-2 rounded-full bg-muted-foreground ring-4 ring-background" />
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {item.title}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {compactDateTime(item.occurred_at, t.common_not_set)}
                  </span>
                </div>
                <div className="rounded-[1.4rem] border border-zinc-200 p-4">
                  <div className="grid gap-4">
                    <div className="min-w-0 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                          {interactionKindLabel(item.kind, t)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                          {interactionStatusLabel(item.status, t)}
                        </Badge>
                        {item.appointment_type ? (
                          <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                            {interactionTypeLabel(item.appointment_type, t)}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          <span className="text-xs text-muted-foreground">{l("orders_patient")}</span>
                          <span className="font-medium text-foreground">{item.patient_name}</span>
                          <span className="text-xs text-muted-foreground">ID</span>
                          <span className="font-medium text-foreground">{item.patient_id}</span>
                        </div>
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          <span className="text-xs text-muted-foreground">{l("providers_doctor")}</span>
                          <span className="font-medium text-foreground">{item.doctor_name || t.common_not_set}</span>
                          <span className="text-xs text-muted-foreground">{l("providers_location")}</span>
                          <span className="font-medium text-foreground">{item.location || t.common_not_set}</span>
                        </div>
                      </div>

                      {notes ? (
                        <div className="rounded-xl border border-border/60 px-3 py-2 text-sm leading-6 text-zinc-700">
                          <span className="mb-1 block text-xs text-muted-foreground">{l("patients_note")}</span>
                          {notes}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProviderFormFields({
  form,
  specializations,
  insuranceProviders,
  taxonomyNodes,
  parentProviderOptions,
  currentProviderId,
  onChange,
  onContactsChange,
  forceNonMedical,
  disabled = false,
  onManageSpecializations,
  grouped = false,
}: {
  form: ProviderFormState;
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  taxonomyNodes: ProviderTaxonomyNode[];
  parentProviderOptions: ProviderSummary[];
  currentProviderId?: string;
  onChange: (field: keyof ProviderFormState, value: string) => void;
  onContactsChange?: (contacts: ProviderFormState["contacts"]) => void;
  forceNonMedical: boolean;
  disabled?: boolean;
  onManageSpecializations?: () => void;
  grouped?: boolean;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const parentOptions = parentProviderOptions.filter(
    (provider) => provider.id !== currentProviderId,
  );
  const providerType = forceNonMedical ? "non_medical" : form.providerType;
  const isMedicalProvider = providerType === "medical";
  const canManageSpecializations = Boolean(onManageSpecializations) && !disabled && isMedicalProvider;

  const updateProviderContact = (
    contactId: string,
    patch: Partial<ProviderContactFormState>,
  ) => {
    if (!onContactsChange) return;
    onContactsChange(normalizePrimaryContacts(applyContactPatch(form.contacts, contactId, patch)));
  };
  const addProviderContact = (preferredKind?: ProviderContactFormState["contactKind"]) => {
    if (!onContactsChange) return;
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = preferredKind ?? (hasPhone ? "email" : "phone");
    onContactsChange(normalizePrimaryContacts([
      ...form.contacts,
      {
        id: makeContactFormId("provider-contact"),
        contactKind,
        contactType: "work",
        label: "",
        department: "",
        value: "",
        isPrimary: !form.contacts.some((contact) => contact.contactKind === contactKind),
        notes: "",
      },
    ]));
  };
  const removeProviderContact = (contactId: string) => {
    if (!onContactsChange) return;
    onContactsChange(normalizePrimaryContacts(form.contacts.filter((contact) => contact.id !== contactId)));
  };

  const profileFields = (
    <ProviderProfileFields
      canManageSpecializations={canManageSpecializations}
      disabled={disabled}
      forceNonMedical={forceNonMedical}
      form={form}
      isMedicalProvider={isMedicalProvider}
      parentOptions={parentOptions}
      providerType={providerType}
      specializations={specializations}
      insuranceProviders={insuranceProviders}
      taxonomyNodes={taxonomyNodes}
      onChange={onChange}
      onManageSpecializations={onManageSpecializations}
    />
  );
  const addressFields = (
    <ProviderAddressFields form={form} disabled={disabled} onChange={onChange} />
  );
  const contactFields = (
    <ProviderContactFields
      contacts={form.contacts}
      disabled={disabled}
      onAdd={addProviderContact}
      onRemove={removeProviderContact}
      onUpdate={updateProviderContact}
    />
  );
  const contractFields = (
    <ProviderContractFields form={form} disabled={disabled} onChange={onChange} />
  );

  if (grouped) {
    return (
      <div className="space-y-3">
        <Section title={l("providers_provider_profile")}>
          {profileFields}
        </Section>
        <Section title={l("patients_address")}>
          {addressFields}
        </Section>
        <Section title={l("patients_contact")}>
          {contactFields}
        </Section>
        <Section title={l("providers_contract_and_notes")}>
          {contractFields}
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {profileFields}
      {addressFields}
      {contactFields}
      {contractFields}
    </div>
  );
}

function ProviderProfileFields({
  canManageSpecializations,
  disabled,
  forceNonMedical,
  form,
  isMedicalProvider,
  parentOptions,
  providerType,
  specializations,
  insuranceProviders,
  taxonomyNodes,
  onChange,
  onManageSpecializations,
}: {
  canManageSpecializations: boolean;
  disabled: boolean;
  forceNonMedical: boolean;
  form: ProviderFormState;
  isMedicalProvider: boolean;
  parentOptions: ProviderSummary[];
  providerType: ProviderFormState["providerType"];
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  taxonomyNodes: ProviderTaxonomyNode[];
  onChange: (field: keyof ProviderFormState, value: string) => void;
  onManageSpecializations?: () => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const selectedTaxonomyNode = taxonomyNodes.find((node) => node.id === form.taxonomyNodeId);
  const formAttributeKeys = taxonomyAttributeKeys(selectedTaxonomyNode);
  const namePlaceholder = forceNonMedical
    ? lang === "de"
      ? "Servicepartner"
      : "Сервисный партнёр"
    : t.providers_name_placeholder;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={l("patients_display_name")} required>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className={shellInputClassName}
            placeholder={namePlaceholder}
            required
            disabled={disabled}
          />
        </Field>

        <Field label={l("providers_legal_name")}>
          <Input
            value={form.legalName}
            onChange={(event) => onChange("legalName", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_legal_entity_contract_name")}
            disabled={disabled}
          />
        </Field>

      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.providers_type}>
          <NativeComboboxSelect
            value={providerType}
            onChange={(event) => {
              const nextProviderType = event.target.value === "non_medical" ? "non_medical" : "medical";
              onChange("providerType", nextProviderType);
              onChange("taxonomyNodeId", "");
              onChange("taxonomyAttributes", "{}");
              if (nextProviderType !== "medical") {
                onChange("specializations", "");
                onChange("fachbereich", "");
                onChange("insuranceProviders", "");
              }
            }}
            disabled={disabled || forceNonMedical}
            className={formSelectClassName}
          >
            <option value="medical">{t.providers_type_medical}</option>
            <option value="non_medical">{t.providers_type_non_medical}</option>
          </NativeComboboxSelect>
        </Field>

        <Field label={t.providers_category}>
          <ProviderTaxonomyCascadeSelect
            value={form.taxonomyNodeId}
            nodes={taxonomyNodes}
            providerType={providerType}
            mode="leaf"
            disabled={disabled}
            placeholder={t.providers_choose_category}
            containerClassName="w-full"
            selectClassName={formSelectClassName}
            onChange={(nextValue) => {
              onChange("taxonomyNodeId", nextValue);
              onChange("taxonomyAttributes", "{}");
            }}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={lang === "ru" ? "Внутренний рейтинг" : "Interne Bewertung"}>
          <Input
            type="number"
            min="0"
            max="5"
            step="0.5"
            value={form.internalRating}
            onChange={(event) => onChange("internalRating", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={lang === "ru" ? "Заметка к рейтингу" : "Bewertungsnotiz"}>
          <Input
            value={form.internalRatingNote}
            onChange={(event) => onChange("internalRatingNote", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
      </div>

      {formAttributeKeys.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {formAttributeKeys.map((key) => (
            <Field key={key} label={taxonomyAttributeLabel(key, lang)}>
              <Input
                value={taxonomyAttributeValue(form.taxonomyAttributes, key)}
                onChange={(event) =>
                  onChange(
                    "taxonomyAttributes",
                    updateTaxonomyAttributeValue(
                      form.taxonomyAttributes,
                      key,
                      event.target.value,
                    ),
                  )
                }
                className={shellInputClassName}
                disabled={disabled}
              />
            </Field>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={l("providers_tax_id")}>
          <Input
            value={form.taxId}
            onChange={(event) => onChange("taxId", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_vat_tax_id")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_website}>
          <Input
            value={form.website}
            onChange={(event) => onChange("website", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_https")}
            disabled={disabled}
          />
        </Field>
      </div>

      <FieldGroup label={l("providers_opening_hours")}>
        <WeeklyAvailabilityEditor
          value={form.openingHours}
          onChange={(nextValue) => onChange("openingHours", nextValue)}
          disabled={disabled}
        />
      </FieldGroup>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={l("providers_organization_level")}>
          <NativeComboboxSelect
            value={form.organizationLevel}
            onChange={(event) => onChange("organizationLevel", event.target.value)}
            disabled={disabled}
            className={formSelectClassName}
          >
            <option value="organization">{l("providers_level_organization")}</option>
            <option value="clinic">{l("providers_level_clinic")}</option>
            <option value="department">{l("providers_level_department")}</option>
            <option value="unit">{l("providers_level_unit")}</option>
          </NativeComboboxSelect>
        </Field>
        <Field label={l("providers_parent_provider")}>
          <NativeComboboxSelect
            value={form.parentProviderId}
            onChange={(event) => onChange("parentProviderId", event.target.value)}
            className={formSelectClassName}
            disabled={disabled}
          >
            <option value="">{l("providers_no_parent")}</option>
            {parentOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {[provider.name, provider.address_city, provider.address_country]
                  .filter(Boolean)
                  .join(" - ")}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
      </div>

      {isMedicalProvider ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.providers_fachbereich}>
            <SpecializationMultiSelect
              value={form.specializations}
              items={specializations}
              disabled={disabled}
              onChange={(nextValue) => {
                onChange("specializations", nextValue);
                onChange("fachbereich", firstSpecializationValue(nextValue));
              }}
            />
          </Field>
          {canManageSpecializations ? (
            <div className="flex justify-start pt-[20px]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 justify-center rounded-lg bg-muted/20"
                onClick={onManageSpecializations}
              >
                <BadgeCheck className="size-3.5" />
                {l("providers_specializations_manage")}
              </Button>
            </div>
          ) : null}
          <Field label={t.patients_insurance_type}>
            <InsuranceProviderMultiSelect
              value={form.insuranceProviders}
              items={insuranceProviders}
              disabled={disabled}
              useInsuranceTypes
              onChange={(nextValue) => onChange("insuranceProviders", nextValue)}
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}

function ProviderAddressFields({
  form,
  disabled,
  onChange,
}: {
  form: ProviderFormState;
  disabled: boolean;
  onChange: (field: keyof ProviderFormState, value: string) => void;
}) {
  const { t } = useLang();

  return (
    <>
      <Field label={t.providers_street}>
        <Input
          value={form.addressStreet}
          onChange={(event) => onChange("addressStreet", event.target.value)}
          className={shellInputClassName}
          disabled={disabled}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_city}>
          <Input
            value={form.addressCity}
            onChange={(event) => onChange("addressCity", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_zip}>
          <Input
            value={form.addressZip}
            onChange={(event) => onChange("addressZip", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_country}>
          <CountrySelect
            value={form.addressCountry}
            onChange={(value) => onChange("addressCountry", value)}
            placeholder={t.common_select_placeholder}
            disabled={disabled}
          />
        </Field>
      </div>
    </>
  );
}

function ProviderContactFields({
  contacts,
  disabled,
  onAdd,
  onRemove,
  onUpdate,
}: {
  contacts: ProviderFormState["contacts"];
  disabled: boolean;
  onAdd: (contactKind?: ProviderContactFormState["contactKind"]) => void;
  onRemove: (contactId: string) => void;
  onUpdate: (contactId: string, patch: Partial<ProviderContactFormState>) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const contactTypeLabel = (value: ProviderContactFormState["contactType"]) => {
    if (value === "department") return l("providers_contact_type_department");
    if (value === "other") return l("providers_contact_type_other");
    return l("providers_contact_type_work");
  };
  const contactValueLabel = (contactKind: ProviderContactFormState["contactKind"]) =>
    contactKind === "email" ? t.field_email : t.field_phone;

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="rounded-xl border border-border/70 bg-card/50 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/25 text-muted-foreground">
                  {contact.contactKind === "email" ? (
                    <Mail className="size-4" />
                  ) : (
                    <Phone className="size-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                    {contactValueLabel(contact.contactKind)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {contactTypeLabel(contact.contactType)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={contact.isPrimary}
                    onChange={(event) =>
                      onUpdate(contact.id, { isPrimary: event.target.checked })
                    }
                    className={checkboxClass}
                    disabled={disabled}
                  />
                  {l("providers_contact_primary")}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title={t.common_remove}
                  aria-label={t.common_remove}
                  onClick={() => onRemove(contact.id)}
                  disabled={disabled}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[150px_150px_minmax(220px,1fr)_minmax(180px,0.8fr)]">
              <Field label={l("providers_contact_kind")}>
                <NativeComboboxSelect
                  value={contact.contactKind}
                  onChange={(event) =>
                    onUpdate(contact.id, {
                      contactKind: event.target.value === "email" ? "email" : "phone",
                    })
                  }
                  className={formSelectClassName}
                  disabled={disabled}
                >
                  <option value="phone">{t.field_phone}</option>
                  <option value="email">{t.field_email}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={l("providers_contact_type")}>
                <NativeComboboxSelect
                  value={contact.contactType}
                  onChange={(event) =>
                    onUpdate(contact.id, {
                      contactType:
                        event.target.value === "department" || event.target.value === "other"
                          ? event.target.value
                          : "work",
                    })
                  }
                  className={formSelectClassName}
                  disabled={disabled}
                >
                  <option value="work">{l("providers_contact_type_work")}</option>
                  <option value="department">{l("providers_contact_type_department")}</option>
                  <option value="other">{l("providers_contact_type_other")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={contactValueLabel(contact.contactKind)}>
                <Input
                  type={contact.contactKind === "email" ? "email" : "tel"}
                  value={contact.value}
                  onChange={(event) => onUpdate(contact.id, { value: event.target.value })}
                  className={shellInputClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={l("providers_contact_label")}>
                <Input
                  value={contact.label}
                  onChange={(event) => onUpdate(contact.id, { label: event.target.value })}
                  className={shellInputClassName}
                  disabled={disabled}
                />
              </Field>
              {contact.contactType === "department" ? (
                <div className="md:col-span-2 xl:col-span-1">
                  <Field label={l("providers_staff_department")}>
                  <Input
                    value={contact.department}
                    onChange={(event) => onUpdate(contact.id, { department: event.target.value })}
                    className={shellInputClassName}
                    disabled={disabled}
                  />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {!disabled ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={contactAddButtonClassName}
              onClick={() => onAdd("phone")}
            >
              <Phone className="size-3.5" />
              {contactAddLabel("phone", t, lang)}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={contactAddButtonClassName}
              onClick={() => onAdd("email")}
            >
              <Mail className="size-3.5" />
              {contactAddLabel("email", t, lang)}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProviderContractFields({
  form,
  disabled,
  onChange,
}: {
  form: ProviderFormState;
  disabled: boolean;
  onChange: (field: keyof ProviderFormState, value: string) => void;
}) {
  const { t } = useLang();

  return (
    <>
      <Field label={t.providers_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
          placeholder={t.providers_notes}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

function DoctorFormFields({
  form,
  specializations,
  insuranceProviders,
  onChange,
  onContactsChange,
}: {
  form: DoctorFormState;
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onContactsChange: (contacts: DoctorFormState["contacts"]) => void;
}) {
  const updateContact = (
    contactId: string,
    patch: Partial<DoctorFormState["contacts"][number]>,
  ) => {
    onContactsChange(normalizePrimaryContacts(applyContactPatch(form.contacts, contactId, patch)));
  };
  const addContact = (preferredKind?: PersonContactFormState["contactKind"]) => {
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = preferredKind ?? (hasPhone ? "email" : "phone");
    onContactsChange(normalizePrimaryContacts([
      ...form.contacts,
      {
        id: makeContactFormId("contact"),
        contactKind,
        contactType: "work",
        value: "",
        isPrimary: !form.contacts.some((contact) => contact.contactKind === contactKind),
        notes: "",
      },
    ]));
  };
  const removeContact = (contactId: string) => {
    onContactsChange(normalizePrimaryContacts(form.contacts.filter((contact) => contact.id !== contactId)));
  };

  return (
    <div className="space-y-3">
      <DoctorProfileFields
        form={form}
        specializations={specializations}
        insuranceProviders={insuranceProviders}
        onChange={onChange}
      />
      <DoctorContactFields
        contacts={form.contacts}
        onAdd={addContact}
        onRemove={removeContact}
        onUpdate={updateContact}
      />
      <DoctorLicenseFields form={form} onChange={onChange} />
      <DoctorNotesFields notes={form.notes} onChange={(value) => onChange("notes", value)} />
    </div>
  );
}

function ContactPersonFormFields({
  form,
  onChange,
  onContactsChange,
}: {
  form: DoctorFormState;
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onContactsChange: (contacts: DoctorFormState["contacts"]) => void;
}) {
  const updateContact = (
    contactId: string,
    patch: Partial<DoctorFormState["contacts"][number]>,
  ) => {
    onContactsChange(normalizePrimaryContacts(applyContactPatch(form.contacts, contactId, patch)));
  };
  const addContact = (preferredKind?: PersonContactFormState["contactKind"]) => {
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = preferredKind ?? (hasPhone ? "email" : "phone");
    onContactsChange(normalizePrimaryContacts([
      ...form.contacts,
      {
        id: makeContactFormId("contact"),
        contactKind,
        contactType: "work",
        value: "",
        isPrimary: !form.contacts.some((contact) => contact.contactKind === contactKind),
        notes: "",
      },
    ]));
  };
  const removeContact = (contactId: string) => {
    onContactsChange(normalizePrimaryContacts(form.contacts.filter((contact) => contact.id !== contactId)));
  };

  return (
    <div className="space-y-3">
      <ContactPersonProfileFields form={form} onChange={onChange} />
      <DoctorContactFields
        contacts={form.contacts}
        onAdd={addContact}
        onRemove={removeContact}
        onUpdate={updateContact}
      />
      <DoctorNotesFields notes={form.notes} onChange={(value) => onChange("notes", value)} />
    </div>
  );
}

function ContactPersonProfileFields({
  form,
  onChange,
}: {
  form: DoctorFormState;
  onChange: (field: keyof DoctorFormState, value: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <Section title={t.providers_contact_profile}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.patients_first_name}>
          <Input
            value={form.firstName}
            onChange={(event) => onChange("firstName", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.patients_last_name}>
          <Input
            value={form.lastName}
            onChange={(event) => onChange("lastName", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("patients_display_name")}>
          <Input
            value={composeDoctorDisplayName(form.firstName, form.lastName, form.gender) || form.name}
            readOnly
            tabIndex={-1}
            aria-readonly
            className={cn(shellInputClassName, "bg-muted/40 text-muted-foreground")}
            placeholder={l("patients_display_name")}
          />
        </Field>
        <Field label={t.providers_contact_position}>
          <Input
            value={form.subrole}
            onChange={(event) => onChange("subrole", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.patients_gender}>
          <NativeComboboxSelect
            value={form.gender}
            onChange={(event) =>
              onChange(
                "gender",
                event.target.value === "male" || event.target.value === "female"
                  ? event.target.value
                  : "unknown",
              )
            }
            className={formSelectClassName}
          >
            <option value="unknown">{t.common_unknown}</option>
            <option value="male">{t.gender_male}</option>
            <option value="female">{t.gender_female}</option>
          </NativeComboboxSelect>
        </Field>
        <Field label={l("providers_languages")}>
          <LanguageMultiSelect
            value={form.languages}
            onChange={(nextValue) => onChange("languages", nextValue)}
            className={formSelectClassName}
            placeholder={l("patients_languages_select_placeholder")}
          />
        </Field>
        <div className="md:col-span-2">
          <FieldGroup label={l("providers_opening_hours")}>
            <WeeklyAvailabilityEditor
              value={form.openingHours}
              onChange={(nextValue) => onChange("openingHours", nextValue)}
            />
          </FieldGroup>
        </div>
      </div>
    </Section>
  );
}

function DoctorProfileFields({
  form,
  specializations,
  insuranceProviders,
  onChange,
}: {
  form: DoctorFormState;
  specializations: SpecializationItem[];
  insuranceProviders: InsuranceProviderItem[];
  onChange: (field: keyof DoctorFormState, value: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const doctorRoleOptions: Array<{ value: Exclude<DoctorFormState["roleCode"], "">; label: string }> = [
    { value: "clinical_director", label: l("providers_doctor_role_clinical_director") },
    { value: "chefarzt", label: l("providers_doctor_role_chefarzt") },
    { value: "oberarzt", label: l("providers_doctor_role_oberarzt") },
    { value: "facharzt", label: l("providers_doctor_role_facharzt") },
    { value: "assistenzarzt", label: l("providers_doctor_role_assistenzarzt") },
    { value: "other", label: l("providers_doctor_role_other") },
  ];

  return (
    <Section title={l("providers_doctor_profile")}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.patients_first_name}>
          <Input
            value={form.firstName}
            onChange={(event) => onChange("firstName", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.patients_last_name}>
          <Input
            value={form.lastName}
            onChange={(event) => onChange("lastName", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("patients_display_name")}>
          <Input
            value={composeDoctorDisplayName(form.firstName, form.lastName, form.gender) || form.name}
            readOnly
            tabIndex={-1}
            aria-readonly
            className={cn(shellInputClassName, "bg-muted/40 text-muted-foreground")}
            placeholder={l("patients_display_name")}
          />
        </Field>
        <Field label={t.providers_doctor_title} required={!form.id}>
          <DoctorTitleMultiSelect
            value={form.title}
            onChange={(nextValue) => onChange("title", nextValue)}
          />
        </Field>
        <Field label={l("providers_doctor_role")}>
          <NativeComboboxSelect
            value={form.roleCode}
            onChange={(event) => onChange("roleCode", event.target.value)}
            className={formSelectClassName}
          >
            <option value="">{t.common_not_set}</option>
            {doctorRoleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
        {form.roleCode === "other" ? (
          <Field label={l("providers_doctor_role_custom")}>
            <Input
              value={form.roleLabel}
              onChange={(event) => onChange("roleLabel", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
        ) : null}
        <Field label={l("providers_doctor_subrole")}>
          <Input
            value={form.subrole}
            onChange={(event) => onChange("subrole", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_doctor_subrole_placeholder")}
          />
        </Field>
        <Field label={t.patients_gender}>
          <NativeComboboxSelect
            value={form.gender}
            onChange={(event) =>
              onChange(
                "gender",
                event.target.value === "male" || event.target.value === "female"
                  ? event.target.value
                  : "unknown",
              )
            }
            className={formSelectClassName}
          >
            <option value="unknown">{t.common_unknown}</option>
            <option value="male">{t.gender_male}</option>
            <option value="female">{t.gender_female}</option>
          </NativeComboboxSelect>
        </Field>
        <Field label={l("providers_doctor_specializations")}>
          <SpecializationMultiSelect
            value={form.specializations}
            items={specializations}
            onChange={(nextValue) => {
              onChange("specializations", nextValue);
              onChange("fachbereich", firstSpecializationValue(nextValue));
            }}
          />
        </Field>
        <Field label={l("providers_doctor_schwerpunkt")}>
          <Input
            value={form.schwerpunkt}
            onChange={(event) => onChange("schwerpunkt", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_doctor_schwerpunkt_placeholder")}
          />
        </Field>
        <Field label={t.patients_insurance_type}>
          <InsuranceProviderMultiSelect
            value={form.insuranceProviders}
            items={insuranceProviders}
            useInsuranceTypes
            onChange={(nextValue) => onChange("insuranceProviders", nextValue)}
          />
        </Field>
        <Field label={l("providers_doctor_website")}>
          <Input
            type="url"
            inputMode="url"
            value={form.website}
            onChange={(event) => onChange("website", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_doctor_website_placeholder")}
          />
        </Field>
        <Field label={l("providers_languages")}>
          <LanguageMultiSelect
            value={form.languages}
            onChange={(nextValue) => onChange("languages", nextValue)}
            className={formSelectClassName}
            placeholder={l("patients_languages_select_placeholder")}
          />
        </Field>
        <div className="md:col-span-2">
          <FieldGroup label={l("providers_opening_hours")}>
            <WeeklyAvailabilityEditor
              value={form.openingHours}
              onChange={(nextValue) => onChange("openingHours", nextValue)}
            />
          </FieldGroup>
        </div>
      </div>
    </Section>
  );
}

function PersonContactFields({
  contacts,
  onAdd,
  onRemove,
  onUpdate,
}: {
  contacts: PersonContactFormState[];
  onAdd: (contactKind?: PersonContactFormState["contactKind"]) => void;
  onRemove: (contactId: string) => void;
  onUpdate: (contactId: string, patch: Partial<PersonContactFormState>) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const contactTypeLabel = (value: PersonContactFormState["contactType"]) => {
    if (value === "private") return l("providers_contact_type_private");
    if (value === "other") return l("providers_contact_type_other");
    return l("providers_contact_type_work");
  };
  const contactValueLabel = (contactKind: PersonContactFormState["contactKind"]) =>
    contactKind === "email" ? t.field_email : t.field_phone;

  return (
    <Section title={l("providers_contacts")}>
      <div className="space-y-3">
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="rounded-xl border border-border/70 bg-card/50 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/25 text-muted-foreground">
                  {contact.contactKind === "email" ? (
                    <Mail className="size-4" />
                  ) : (
                    <Phone className="size-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                    {contactValueLabel(contact.contactKind)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {contactTypeLabel(contact.contactType)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={contact.isPrimary}
                    onChange={(event) =>
                      onUpdate(contact.id, { isPrimary: event.target.checked })
                    }
                    className={checkboxClass}
                  />
                  {l("providers_contact_primary")}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title={t.common_remove}
                  aria-label={t.common_remove}
                  onClick={() => onRemove(contact.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[150px_150px_minmax(220px,1fr)]">
              <Field label={l("providers_contact_kind")}>
                <NativeComboboxSelect
                  value={contact.contactKind}
                  onChange={(event) =>
                    onUpdate(contact.id, {
                      contactKind: event.target.value === "email" ? "email" : "phone",
                    })
                  }
                  className={formSelectClassName}
                >
                  <option value="phone">{t.field_phone}</option>
                  <option value="email">{t.field_email}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={l("providers_contact_type")}>
                <NativeComboboxSelect
                  value={contact.contactType}
                  onChange={(event) =>
                    onUpdate(contact.id, {
                      contactType:
                        event.target.value === "private" || event.target.value === "other"
                          ? event.target.value
                          : "work",
                    })
                  }
                  className={formSelectClassName}
                >
                  <option value="work">{l("providers_contact_type_work")}</option>
                  <option value="private">{l("providers_contact_type_private")}</option>
                  <option value="other">{l("providers_contact_type_other")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={contactValueLabel(contact.contactKind)}>
                <Input
                  type={contact.contactKind === "email" ? "email" : "tel"}
                  value={contact.value}
                  onChange={(event) => onUpdate(contact.id, { value: event.target.value })}
                  className={shellInputClassName}
                />
              </Field>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={contactAddButtonClassName}
            onClick={() => onAdd("phone")}
          >
            <Phone className="size-3.5" />
            {contactAddLabel("phone", t, lang)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={contactAddButtonClassName}
            onClick={() => onAdd("email")}
          >
            <Mail className="size-3.5" />
            {contactAddLabel("email", t, lang)}
          </Button>
        </div>
      </div>
    </Section>
  );
}

function DoctorContactFields({
  contacts,
  onAdd,
  onRemove,
  onUpdate,
}: {
  contacts: DoctorFormState["contacts"];
  onAdd: (contactKind?: PersonContactFormState["contactKind"]) => void;
  onRemove: (contactId: string) => void;
  onUpdate: (contactId: string, patch: Partial<DoctorFormState["contacts"][number]>) => void;
}) {
  return (
    <PersonContactFields
      contacts={contacts}
      onAdd={onAdd}
      onRemove={onRemove}
      onUpdate={onUpdate}
    />
  );
}

function DoctorLicenseFields({
  form,
  onChange,
}: {
  form: DoctorFormState;
  onChange: (field: keyof DoctorFormState, value: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <Section title={l("providers_license")}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("providers_license_number")}>
          <Input
            value={form.licenseNumber}
            onChange={(event) => onChange("licenseNumber", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("providers_licensing_country")}>
          <CountrySelect
            value={form.licensingCountry}
            onChange={(value) => onChange("licensingCountry", value)}
            placeholder={t.common_select_placeholder}
          />
        </Field>
        <Field label={l("providers_license_valid_until")}>
          <Input
            type="date"
            value={form.licensingValidUntil}
            onChange={(event) => onChange("licensingValidUntil", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>
    </Section>
  );
}

function DoctorNotesFields({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <Section title={l("appointments_notes")}>
      <Field label={t.providers_notes}>
        <textarea
          value={notes}
          onChange={(event) => onChange(event.target.value)}
          className={textareaClassName}
          rows={3}
        />
      </Field>
    </Section>
  );
}

function StaffFormFields({
  form,
  staffRoles,
  onChange,
  onContactsChange,
}: {
  form: StaffFormState;
  staffRoles: ProviderStaffRoleItem[];
  onChange: (field: keyof StaffFormState, value: string) => void;
  onContactsChange: (contacts: StaffFormState["contacts"]) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const selectableRoles = staffRoles.filter((role) => role.is_active || role.code === form.role);
  const hasCustomRole =
    Boolean(form.role) && !selectableRoles.some((role) => role.code === form.role);
  const updateContact = (
    contactId: string,
    patch: Partial<StaffFormState["contacts"][number]>,
  ) => {
    onContactsChange(normalizePrimaryContacts(applyContactPatch(form.contacts, contactId, patch)));
  };
  const addContact = (preferredKind?: PersonContactFormState["contactKind"]) => {
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = preferredKind ?? (hasPhone ? "email" : "phone");
    onContactsChange(normalizePrimaryContacts([
      ...form.contacts,
      {
        id: makeContactFormId("contact"),
        contactKind,
        contactType: "work",
        value: "",
        isPrimary: !form.contacts.some((contact) => contact.contactKind === contactKind),
        notes: "",
      },
    ]));
  };
  const removeContact = (contactId: string) => {
    onContactsChange(normalizePrimaryContacts(form.contacts.filter((contact) => contact.id !== contactId)));
  };

  return (
    <div className="space-y-3">
      <Section title={l("providers_staff_profile")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_first_name}>
            <Input
              value={form.firstName}
              onChange={(event) => onChange("firstName", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={t.patients_last_name}>
            <Input
              value={form.lastName}
              onChange={(event) => onChange("lastName", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={l("patients_display_name")}>
            <Input
              value={composeStaffDisplayName(form.firstName, form.lastName, form.gender) || form.displayName}
              readOnly
              tabIndex={-1}
              aria-readonly
              className={cn(shellInputClassName, "bg-muted/40 text-muted-foreground")}
              placeholder={l("patients_display_name")}
            />
          </Field>
          <Field label={l("providers_staff_role")} required>
            <NativeComboboxSelect
              value={form.role}
              onChange={(event) => onChange("role", event.target.value)}
              className={formSelectClassName}
              required
            >
              {selectableRoles.map((role) => (
                <option key={role.id} value={role.code}>
                  {staffRoleLabel(role.code, staffRoles, lang)}
                </option>
              ))}
              {hasCustomRole ? (
                <option value={form.role}>{humanizeCode(form.role)}</option>
              ) : null}
            </NativeComboboxSelect>
          </Field>
          <Field label={l("providers_staff_department")}>
            <Input
              value={form.department}
              onChange={(event) => onChange("department", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={t.patients_gender}>
            <NativeComboboxSelect
              value={form.gender}
              onChange={(event) =>
                onChange(
                  "gender",
                  event.target.value === "male" || event.target.value === "female"
                    ? event.target.value
                    : "unknown",
                )
              }
              className={formSelectClassName}
            >
              <option value="unknown">{t.common_unknown}</option>
              <option value="male">{t.gender_male}</option>
              <option value="female">{t.gender_female}</option>
            </NativeComboboxSelect>
          </Field>
          <Field label={l("providers_staff_status")}>
            <NativeComboboxSelect
              value={form.status}
              onChange={(event) => onChange("status", event.target.value)}
              className={formSelectClassName}
            >
              <option value="active">{t.common_active}</option>
              <option value="inactive">{t.common_inactive}</option>
              <option value="external">{l("providers_staff_external")}</option>
              <option value="unknown">{l("providers_staff_unknown")}</option>
            </NativeComboboxSelect>
          </Field>
          <div className="md:col-span-2">
            <FieldGroup label={l("providers_opening_hours")}>
              <WeeklyAvailabilityEditor
                value={form.openingHours}
                onChange={(nextValue) => onChange("openingHours", nextValue)}
              />
            </FieldGroup>
          </div>
        </div>
      </Section>

      <PersonContactFields
        contacts={form.contacts}
        onAdd={addContact}
        onRemove={removeContact}
        onUpdate={updateContact}
      />

      <Section title={l("appointments_notes")}>
        <Field label={t.providers_notes}>
          <textarea
            value={form.notes}
            onChange={(event) => onChange("notes", event.target.value)}
            className={textareaClassName}
            rows={3}
          />
        </Field>
      </Section>
    </div>
  );
}

function ServiceFormFields({
  form,
  providerType,
  taxonomyNodes,
  onChange,
}: {
  form: ServiceFormState;
  providerType: ProviderType;
  taxonomyNodes: ProviderTaxonomyNode[];
  onChange: (field: keyof ServiceFormState, value: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const priceType = form.priceType || "fixed";
  const selectedTaxonomyNode = taxonomyNodes.find((node) => node.id === form.taxonomyNodeId);
  const formAttributeKeys = taxonomyAttributeKeys(selectedTaxonomyNode);
  return (
    <div className="space-y-3">
      <Section title={l("providers_service")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.providers_service_name} required>
            <Input
              value={form.serviceName}
              onChange={(event) => onChange("serviceName", event.target.value)}
              className={shellInputClassName}
              required
            />
          </Field>
          <Field label={t.services_category}>
            <ProviderTaxonomyCascadeSelect
              value={form.taxonomyNodeId}
              nodes={taxonomyNodes}
              providerType={providerType}
              mode="leaf"
              placeholder={t.documents_choose_category}
              containerClassName="grid gap-2 sm:grid-cols-2"
              selectClassName={formSelectClassName}
              onChange={(nextValue) => {
                onChange("taxonomyNodeId", nextValue);
                onChange("taxonomyAttributes", "{}");
              }}
            />
          </Field>
          <Field label={t.providers_service_desc}>
            <textarea
              value={form.description}
              onChange={(event) => onChange("description", event.target.value)}
              className={textareaClassName}
              rows={3}
            />
          </Field>
        </div>
        {formAttributeKeys.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {formAttributeKeys.map((key) => (
              <Field key={key} label={taxonomyAttributeLabel(key, lang)}>
                <Input
                  value={taxonomyAttributeValue(form.taxonomyAttributes, key)}
                  onChange={(event) =>
                    onChange(
                      "taxonomyAttributes",
                      updateTaxonomyAttributeValue(
                        form.taxonomyAttributes,
                        key,
                        event.target.value,
                      ),
                    )
                  }
                  className={shellInputClassName}
                />
              </Field>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title={l("providers_cost")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={l("providers_price_type")}>
            <NativeComboboxSelect
              value={priceType}
              onChange={(event) => onChange("priceType", event.target.value)}
              className={formSelectClassName}
            >
              <option value="fixed">{l("providers_price_fixed")}</option>
              <option value="range">{l("providers_price_range")}</option>
              <option value="on_request">{l("providers_price_on_request")}</option>
            </NativeComboboxSelect>
          </Field>
          {priceType === "fixed" ? (
            <Field label={t.providers_service_price} required>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => {
                  onChange("price", event.target.value);
                  onChange("priceFrom", event.target.value);
                  onChange("priceTo", event.target.value);
                }}
                className={shellInputClassName}
                required
              />
            </Field>
          ) : null}
          {priceType === "range" ? (
            <>
              <Field label={l("providers_price_from")} required>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.priceFrom}
                  onChange={(event) => onChange("priceFrom", event.target.value)}
                  className={shellInputClassName}
                  required
                />
              </Field>
              <Field label={l("providers_price_to")} required>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.priceTo}
                  onChange={(event) => onChange("priceTo", event.target.value)}
                  className={shellInputClassName}
                  required
                />
              </Field>
            </>
          ) : null}
          {priceType === "on_request" ? (
            <Field label={l("providers_price_note")}>
              <Input
                value={form.priceNote}
                onChange={(event) => onChange("priceNote", event.target.value)}
                className={shellInputClassName}
                placeholder={l("providers_price_on_request")}
              />
            </Field>
          ) : null}
          <Field label={t.providers_service_currency}>
            <Input
              value={form.currency}
              onChange={(event) => onChange("currency", event.target.value.toUpperCase())}
              className={shellInputClassName}
            />
          </Field>
          {priceType !== "on_request" ? (
            <Field label={l("providers_price_note")}>
              <Input
                value={form.priceNote}
                onChange={(event) => onChange("priceNote", event.target.value)}
                className={shellInputClassName}
              />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title={l("providers_validity")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.providers_service_valid_from}>
            <Input
              type="date"
              value={form.validFrom}
              onChange={(event) => onChange("validFrom", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={t.providers_service_valid_to}>
            <Input
              type="date"
              value={form.validTo}
              onChange={(event) => onChange("validTo", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}
function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ProvidersPage detailRouteId={id ?? ""} />;
}

export { ProviderDetailPage, ProvidersPage };
