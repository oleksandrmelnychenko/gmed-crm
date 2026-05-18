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
  Download,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  X,
  UsersRound,
  BadgeCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
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
import { formatUiText, useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { exportCsv } from "@/components/data-table/csv-export";
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
  fetchProviderStaffRoles,
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
  blankDoctorForm,
  blankProviderForm,
  blankServiceForm,
  blankStaffForm,
  buildProvidersQuery,
  compactDate,
  compactDateTime,
  doctorToForm,
  doctorRelationshipTypeLabel,
  doctorRoleLabel,
  humanizeCode,
  makeContactFormId,
  patientLabel,
  personGenderLabel,
  providerMeta,
  providerOrganizationLevelLabel,
  providerPermissions,
  providerToForm,
  providerTypeLabel,
  serviceToForm,
  servicePriceLabel,
  staffToForm,
  toDoctorPayload,
  toProviderPayload,
  toServicePayload,
  toStaffPayload,
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
  ProviderContactFormState,
  ProviderDetail,
  ProviderFilters,
  ProviderFormState,
  ProviderPermissions,
  ProviderStaffRoleItem,
  ProviderSummary,
  ServiceFormState,
  ServiceItem,
  StaffFormState,
  ProviderStaff,
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

const selectClassName = shellSelectClassName;
const formSelectClassName = cn(
  shellInputClassName,
  "w-full border border-input px-2.5 py-1 text-sm font-normal text-foreground hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/25"
);
const textareaClassName = shellTextareaClass;
const DEFAULT_PROVIDER_SORT: SortStack = [{ field: "provider", dir: "asc" }];
const LEGACY_PROVIDER_TABLE_QUERY_KEYS = ["filters", "sort", "density", "hide"] as const;
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
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
  onChange,
}: {
  value: string;
  items: SpecializationItem[];
  disabled?: boolean;
  placeholder?: string;
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

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
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
  const labels = row.specializations
    .map((item) => item.code || item.name_en || "")
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : row.fachbereich ?? "";
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

  return contacts.map((contact, _index, all) => {
    const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
    const firstPrimary = sameKind.find((item) => item.isPrimary);
    if (firstPrimary) return { ...contact, isPrimary: contact.id === firstPrimary.id };
    return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
  });
}

function providerPeopleDoctorToForm(row: ProviderPeopleRow): DoctorFormState {
  const roleCode = isDoctorRoleCode(row.role_code) ? row.role_code : row.role_code ? "other" : "";
  const contacts = providerPeopleContactsToForm(row);
  return {
    ...blankDoctorForm(),
    id: row.person_id,
    name: row.display_name ?? row.name,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    title: row.title ?? "",
    roleCode,
    roleLabel: roleCode === "other" ? row.role_label ?? row.role_code ?? "" : row.role_label ?? "",
    subrole: row.subrole ?? "",
    gender: row.gender,
    openingHours: row.opening_hours ?? "",
    fachbereich: row.fachbereich ?? "",
    specializations: providerPeopleSpecializationsToText(row),
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

function providerPeopleStaffToForm(row: ProviderPeopleRow): StaffFormState {
  const contacts = providerPeopleContactsToForm(row);
  return {
    ...blankStaffForm(),
    id: row.person_id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    displayName: row.display_name ?? row.name,
    role: row.role_code ?? "staff",
    department: row.department ?? "",
    gender: row.gender,
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
  specializations: SpecializationItem[];
  specializationDialogOpen: boolean;
  specializationBusy: boolean;
  specializationError: string;
  staffRoles: ProviderStaffRoleItem[];
  parentProviderOptions: ProviderSummary[];
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

function useProvidersPageContent({ detailRouteId = "" }: ProvidersPageProps = {}) {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = { ...t.uiText, ...t } as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;
  const detailPageMode = Boolean(detailRouteId);
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => providerPermissions(user?.role), [user?.role]);
  const relationshipTargetDoctorsRequestRef = useRef(0);
  const [catalogMode, setCatalogModeState] = useState<ProviderCatalogMode>(() =>
    searchParams.get("mode") === "people" ? "people" : "providers",
  );
  const [catalogPersonContext, setCatalogPersonContext] = useState<CatalogPersonContext | null>(null);
  const [peopleFilters, setPeopleFilters] = useState<ProviderPeopleFilters>(() => ({
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
  }));
  const [peopleRows, setPeopleRows] = useState<ProviderPeopleRow[]>([]);
  const [peoplePatientOptions, setPeoplePatientOptions] = useState<ProviderPeoplePatientOption[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleError, setPeopleError] = useState("");
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
    };
  });
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
        specializations: [],
        specializationDialogOpen: false,
        specializationBusy: false,
        specializationError: "",
        staffRoles: [],
        parentProviderOptions: [],
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
    specializations,
    specializationDialogOpen,
    specializationBusy,
    specializationError,
    staffRoles,
    parentProviderOptions,
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
  const setSpecializationDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("specializationDialogOpen", value);
  const setSpecializationBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("specializationBusy", value);
  const setSpecializationError = (value: SetStateAction<string>) =>
    setProvidersPageField("specializationError", value);
  const setStaffRoles = (value: SetStateAction<ProviderStaffRoleItem[]>) =>
    setProvidersPageField("staffRoles", value);
  const setParentProviderOptions = (value: SetStateAction<ProviderSummary[]>) =>
    setProvidersPageField("parentProviderOptions", value);
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

  const relationshipProviderOptions = useMemo(() => {
    if (!detail) return parentProviderOptions;
    if (parentProviderOptions.some((provider) => provider.id === detail.id)) {
      return parentProviderOptions;
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
      parent_provider_id: detail.parent_provider_id,
      parent_provider_name: detail.parent_provider_name,
      organization_level: detail.organization_level,
      specializations: detail.specializations,
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
    return [currentProvider, ...parentProviderOptions];
  }, [detail, parentProviderOptions]);

  const { columns, metrics, sortedAndFilteredProviders } = useProvidersListTableModel({
    deferredSearch,
    providers,
    sortStack,
    tr,
  });

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
      people_gender: nextFilters.gender || null,
      people_fachbereich: nextFilters.fachbereich || null,
      people_specialization: nextFilters.specialization || null,
      people_role: nextFilters.role || null,
      people_patient: nextFilters.patientId || null,
    });
  }

  function handlePeopleFiltersChange(nextFilters: ProviderPeopleFilters) {
    setPeopleFilters(nextFilters);
    syncPeopleFilters(nextFilters);
  }

  function resetPeopleFilters() {
    setPeopleFilters(DEFAULT_PROVIDER_PEOPLE_FILTERS);
    syncPeopleFilters(DEFAULT_PROVIDER_PEOPLE_FILTERS);
  }

  function refreshPeople() {
    setPeopleVersion((current) => current + 1);
  }

  function exportProviders() {
    const stamp = new Date().toISOString().slice(0, 10);
    exportCsv(sortedAndFilteredProviders, columns, `providers-${stamp}.csv`);
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
    setListError(error instanceof Error ? error.message : t.common_failed_load);
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
    setDetailError(error instanceof Error ? error.message : t.common_failed_load);
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
    if (!permissions.canViewPage || detailPageMode || catalogMode !== "people") {
      return;
    }

    let cancelled = false;
    setPeopleBusy(true);
    setPeopleError("");

    void fetchProviderPeople(peopleFilters)
      .then((items) => {
        if (cancelled) return;
        setPeopleRows(items);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPeopleError(error instanceof Error ? error.message : t.common_failed_load);
      })
      .finally(() => {
        if (!cancelled) setPeopleBusy(false);
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
    if (!permissions.canViewPage) return;
    let cancelled = false;
    void Promise.all([
      fetchSpecializationsForAdmin(),
      fetchProviders("/providers?active_only=true"),
      fetchProviderStaffRoles(true),
      fetchProviderPeoplePatients(),
    ])
      .then(([specializationItems, providerItems, roleItems, patientItems]) => {
        if (cancelled) return;
        setSpecializations(specializationItems);
        setParentProviderOptions(providerItems);
        setStaffRoles(roleItems);
        setPeoplePatientOptions(patientItems);
      })
      .catch(() => {
        if (cancelled) return;
        setSpecializations([]);
        setParentProviderOptions([]);
        setStaffRoles([]);
        setPeoplePatientOptions([]);
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
    }
  }, [permissions.forceNonMedical, setFilters]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
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
    setCatalogPersonContext({
      providerId: row.provider_id,
      personId: row.person_id,
      personType: row.person_type,
    });
    if (row.person_type === "doctor") {
      setDoctorError("");
      setDoctorForm(providerPeopleDoctorToForm(row));
      setDoctorDialogOpen(true);
      return;
    }
    setStaffError("");
    setStaffForm(providerPeopleStaffToForm(row));
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
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderBusy(false);
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
        staffGo("/providers");
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

    setDoctorBusy(true);
    setDoctorError("");

    try {
      await saveProviderDoctor(providerId, doctorForm.id, toDoctorPayload(doctorForm));
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
    if (
      !window.confirm(
        formatUiText(t.providers_delete_doctor_confirm, { name: doctorName }),
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
      setRelationshipError(error instanceof Error ? error.message : t.common_failed_update);
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

  async function handleDeleteDoctorRelationship(
    sourceDoctorId: string,
    relationshipId: string,
    doctorName: string,
  ) {
    if (!detail) return;
    if (!window.confirm(formatUiText(l("providers_relationship_delete_confirm"), { name: doctorName }))) {
      return;
    }

    setRelationshipBusy(true);
    setRelationshipError("");

    try {
      await deleteProviderDoctorRelationship(detail.id, sourceDoctorId, relationshipId);
      refreshDetail();
    } catch (error) {
      setRelationshipError(error instanceof Error ? error.message : t.common_failed_update);
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
      const isMedicalProvider = detail.provider_type === "medical";
      await saveProviderService(
        detail.id,
        serviceForm.id,
        toServicePayload(serviceForm, isMedicalProvider),
      );
      setServiceDialogOpen(false);
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
    if (!window.confirm(formatUiText(t.providers_delete_doctor_confirm, { name: staffName }))) {
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
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold text-foreground">
                    {detail.name || t.providers_detail}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">{t.providers_subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => staffGo("/providers")}
                  >
                    {l("providers_back_to_list")}
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
                </div>
              </div>
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

                  {permissions.canManageRegistry || permissions.canViewPage ? (
                    <form
                      id="provider-profile-form"
                      onSubmit={handleUpdateProvider}
                      className="space-y-3"
                    >
                      <ProviderFormFields
                        form={providerForm}
                        specializations={specializations}
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
                    onNew={() => {
                      setDoctorError("");
                      setDoctorForm(blankDoctorForm());
                      setDoctorDialogOpen(true);
                    }}
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
                    onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                    onOpenAppointments={(patientId) =>
                      staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                    }
                  />
                  <InteractionHistorySection
                    detail={detail}
                    onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                    onOpenAppointments={(patientId) =>
                      staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                    }
                    onOpenAppointment={(appointmentId) =>
                      staffGo(`/appointments?appointment=${appointmentId}`)
                    }
                    onOpenOrder={(orderId) => staffGo(`/orders?order=${orderId}`)}
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
            specializations={specializations}
            busy={doctorBusy}
            error={doctorError}
            onSubmit={handleDoctorSubmit}
            onChange={(field, value) =>
              setDoctorForm((current) => ({ ...current, [field]: value }))
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
            forcePriceRange={detail.provider_type === "medical"}
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
              setStaffForm((current) => ({ ...current, [field]: value }))
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
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.providers_title}
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
                    {t.providers_new}
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        {/* KPI inline stats */}
        <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric icon={Building2} label={t.providers_title} value={metrics.total} tone="sky" />
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
            {t.providers_title}
          </Button>
          <Button
            type="button"
            variant={catalogMode === "people" ? "default" : "ghost"}
            size="sm"
            className="h-8 rounded-md px-3"
            onClick={() => setCatalogMode("people")}
          >
            {l("providers_people_catalog")}
          </Button>
        </div>

        {catalogMode === "providers" ? (
          <>
        <div className="relative z-30 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
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

            <NativeComboboxSelect
              value={filters.providerType}
              onChange={(event) => {
                const nextType = event.target.value;
                setFilters((current) => ({
                  ...current,
                  providerType: nextType,
                  specializations: nextType === "non_medical" ? "" : current.specializations,
                }));
                syncQuery({
                  provider_type: nextType || null,
                  specializations: nextType === "non_medical" ? null : filters.specializations || null,
                });
              }}
              disabled={permissions.forceNonMedical}
              className={cn(selectClassName, "h-8 w-[170px] bg-card text-[13px]")}
            >
              <option value="">{t.providers_all}</option>
              <option value="medical">{t.providers_type_medical}</option>
              <option value="non_medical">{t.providers_type_non_medical}</option>
            </NativeComboboxSelect>

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

            <div className="min-w-[220px] max-w-sm flex-1 sm:flex-none">
              <SpecializationMultiSelect
                value={filters.specializations}
                items={specializations}
                placeholder={t.providers_fachbereich}
                disabled={permissions.forceNonMedical || filters.providerType === "non_medical"}
                onChange={(nextValue) => setServerFilter("specializations", nextValue, "specializations")}
              />
            </div>

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="!bg-card hover:!bg-card"
                title={t.common_refresh}
                aria-label={t.common_refresh}
                onClick={() => {
                  refreshList();
                  if (detailOpen && selectedId) {
                    refreshDetail();
                  }
                }}
              >
                <RefreshCw className={cn("size-3.5", listBusy && "animate-spin")} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="!bg-card hover:!bg-card"
                title={t.common_export}
                aria-label={t.common_export}
                onClick={exportProviders}
              >
                <Download className="size-3.5" />
              </Button>
            </div>
          </div>
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
            filters={peopleFilters}
            patients={peoplePatientOptions}
            providers={parentProviderOptions}
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
              title={t.providers_new}
              description={t.providers_create_description}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.providers_new}
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

                  <ProviderChildrenSection
                    children={detail.children}
                    onOpenProvider={openProvider}
                  />

                {permissions.canManageRegistry || permissions.canViewPage ? (
                  <form
                    id="provider-profile-form"
                    onSubmit={handleUpdateProvider}
                    className="space-y-3"
                  >
                    <ProviderFormFields
                      form={providerForm}
                      specializations={specializations}
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
                  onNew={() => {
                    setDoctorError("");
                    setDoctorForm(blankDoctorForm());
                    setDoctorDialogOpen(true);
                  }}
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
                  onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                  onOpenAppointments={(patientId) =>
                    staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                  }
                />
                <InteractionHistorySection
                  detail={detail}
                  onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                  onOpenAppointments={(patientId) =>
                    staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                  }
                  onOpenAppointment={(appointmentId) =>
                    staffGo(`/appointments?appointment=${appointmentId}`)
                  }
                  onOpenOrder={(orderId) => staffGo(`/orders?order=${orderId}`)}
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

      {detail || catalogPersonContext ? (
        <ProviderDoctorFormSheet
          open={doctorDialogOpen}
          onOpenChange={handleDoctorDialogOpenChange}
          form={doctorForm}
          specializations={specializations}
          busy={doctorBusy}
          error={doctorError}
          onSubmit={handleDoctorSubmit}
          onChange={(field, value) =>
            setDoctorForm((current) => ({ ...current, [field]: value }))
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
          forcePriceRange={detail.provider_type === "medical"}
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
          setStaffForm((current) => ({ ...current, [field]: value }))
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
    </>
  );
}

function ProviderDoctorFormSheet({
  open,
  onOpenChange,
  form,
  specializations,
  busy,
  error,
  onSubmit,
  onChange,
  onContactsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DoctorFormState;
  specializations: SpecializationItem[];
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onContactsChange: (contacts: DoctorFormState["contacts"]) => void;
}) {
  const { t } = useLang();
  const submitLabel = form.id ? t.common_save : t.providers_doctor_new;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? t.providers_doctor_detail : t.providers_doctor_new}
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
              <DoctorFormFields
                form={form}
                specializations={specializations}
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

function ProviderDoctorRelationshipFormSheet({
  open,
  onOpenChange,
  form,
  sourceDoctors,
  targetProviders,
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
                  <Field label={l("providers_relationship_source")}>
                    <NativeComboboxSelect
                      value={form.sourceDoctorId}
                      onChange={(event) => onChange({ sourceDoctorId: event.target.value })}
                      className={formSelectClassName}
                      disabled
                      required
                    >
                      {sourceDoctor ? (
                        <option value={sourceDoctor.id}>{sourceDoctor.name}</option>
                      ) : (
                        <option value="">{t.common_not_set}</option>
                      )}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={l("providers_relationship_target_provider")}>
                    <NativeComboboxSelect
                      value={form.targetProviderId}
                      onChange={(event) => onTargetProviderChange(event.target.value)}
                      className={formSelectClassName}
                      required
                    >
                      <option value="">{t.common_select_placeholder}</option>
                      {targetProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {[provider.name, provider.address_city, provider.address_country]
                            .filter(Boolean)
                            .join(" - ")}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={l("providers_relationship_target_doctor")}>
                    <NativeComboboxSelect
                      value={form.targetDoctorId}
                      onChange={(event) => onChange({ targetDoctorId: event.target.value })}
                      className={formSelectClassName}
                      disabled={!form.targetProviderId || targetDoctorsBusy}
                      required
                    >
                      <option value="">
                        {targetDoctorsBusy ? l("providers_loading_provider") : t.common_select_placeholder}
                      </option>
                      {availableTargetDoctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.title ? `${doctor.title} ${doctor.name}` : doctor.name}
                        </option>
                      ))}
                    </NativeComboboxSelect>
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
  forcePriceRange,
  onSubmit,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ServiceFormState;
  busy: boolean;
  error: string;
  forcePriceRange: boolean;
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
                forcePriceRange={forcePriceRange}
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
    <Sheet open={open} onOpenChange={handleOpenChange}>
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
                  <Field label={l("providers_specialization_name_ru")}>
                    <Input
                      value={draft.nameRu}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, nameRu: event.target.value }))
                      }
                      className={shellInputClassName}
                      required={!draft.nameDe.trim()}
                    />
                  </Field>
                  <Field label={l("providers_specialization_name_de")}>
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
                      className="grid gap-3 rounded-lg border border-border bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
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
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {item.code} - {l("providers_specialization_sort_order")}: {item.sort_order}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
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
                          {t.uiText.patients_edit ?? "Edit"}
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
    <Sheet open={open} onOpenChange={handleOpenChange}>
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
                  <Field label={l("providers_staff_role_name_ru")}>
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
                      className="grid gap-3 rounded-lg border border-border bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
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
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {role.code} - {l("providers_staff_role_sort_order")}: {role.sort_order}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
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
                          {t.uiText.patients_edit ?? "Edit"}
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
    <section className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">
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
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-tranzinc-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenPatients}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("providers_patient_links")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l("providers_open_patients_linked_to_this_provider")}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-tranzinc-y-0.5 group-hover:tranzinc-x-0.5" />
            </span>
          </button>
          <button
            type="button"
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-tranzinc-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenAppointments}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("providers_appointments")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l("providers_open_appointments_for_this_provider")}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-tranzinc-y-0.5 group-hover:tranzinc-x-0.5" />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}function HeroInfoLine({
  icon: Icon,
  children,
}: {
  icon: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/65" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function ProviderSheetHero({
  detail,
  providerActionBusy,
  permissions,
  onActivate,
  onDeactivate,
  onDelete,
}: {
  detail: ProviderDetail;
  providerActionBusy: string | null;
  permissions: ProviderPermissions;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;
  const isMedical = detail.provider_type === "medical";
  const metaLine = [
    detail.legal_name && detail.legal_name !== detail.name ? detail.legal_name : null,
    providerMeta(detail),
  ].filter(Boolean).join(" - ");
  const specializationLine = specializationText(detail.specializations, detail.fachbereich, lang);

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card px-7 py-4">
      <span
        className={cn(
          "absolute left-0 top-4 h-12 w-1 rounded-r-full",
          detail.is_active ? "bg-emerald-500" : "bg-zinc-300",
        )}
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-stretch">
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
          <h2 className="truncate text-xl font-semibold leading-tight text-foreground">
            {detail.name}
          </h2>
          <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">
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
            {detail.parent_provider_name ? (
              <Badge
                variant="outline"
                className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {detail.parent_provider_name}
              </Badge>
            ) : null}
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
            <HeroInfoLine icon={MapPin}>
              {providerMeta(detail) || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={Phone}>
              {detail.phone || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={Mail}>
              {detail.email || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={BadgeCheck}>
              {detail.tax_id || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={Stethoscope}>
              {specializationLine || t.common_not_set}
            </HeroInfoLine>
          </div>
        </div>
        <div className="flex flex-col justify-start gap-4 border-t border-dashed border-border/70 pt-3 text-left md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {l("providers_actions")}
          </p>
          {permissions.canManageRegistry ? (
            <div className="flex flex-col gap-2">
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
  const labels = (specializations ?? [])
    .map((item) => specializationOptionLabel(item as SpecializationItem, lang) || "")
    .filter(Boolean);
  if (labels.length) return labels.join(", ");
  return fallback ? specializationLabelForValue(fallback, specializations ?? [], lang) : "";
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
  return staffRoleDisplayName(roles.find((role) => role.code === code), lang) || humanizeCode(code);
}

function DoctorSection({
  detail,
  busy,
  relationshipBusy,
  canManage,
  onNew,
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
  onNew: () => void;
  onEdit: (doctor: DoctorSummary) => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onNewRelationship: (sourceDoctorId: string) => void;
  onEditRelationship: (sourceDoctorId: string, relationship: DoctorRelationship) => void;
  onDeleteRelationship: (sourceDoctorId: string, relationshipId: string, doctorName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {detail.provider_type === "non_medical"
              ? l("providers_contacts")
              : t.providers_doctors}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.doctors.length}
          </span>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center rounded-lg bg-muted/20"
              onClick={onNew}
            >
              <Plus className="size-3.5" />
              {t.providers_doctor_new}
            </Button>
          </div>
        ) : null}
      </div>

      {detail.doctors.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_doctors}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.doctors.map((doctor) => {
            const specializations = specializationText(doctor.specializations, doctor.fachbereich, lang);
            const contacts = contactSummary(doctor.contacts, doctor.phone, doctor.email);
            const roleLabel = doctor.role_label || (doctor.role_code ? doctorRoleLabel(doctor.role_code) : "");
            const subrole = doctor.subrole?.trim() ?? "";
            return (
            <details
              key={doctor.id}
              className="group overflow-hidden rounded-[1.4rem] border border-border bg-card"
            >
              <summary className="grid cursor-pointer list-none gap-4 p-4 transition hover:bg-muted/20 md:grid-cols-[minmax(0,1fr)_160px] [&::-webkit-details-marker]:hidden">
                <div className="flex min-w-0 gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-sm font-medium text-muted-foreground">
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {doctor.title ? `${doctor.title} ` : ""}
                      {doctor.name}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {specializations || t.common_not_set}
                      </Badge>
                      {roleLabel ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
                        >
                          {roleLabel}
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
                          {language}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-snug text-muted-foreground">
                      {contacts || t.common_not_set}
                    </p>
                    {doctor.opening_hours ? (
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">
                        {l("providers_opening_hours")}:{" "}
                        <span className="font-medium text-foreground">{doctor.opening_hours}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-stretch justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                  {canManage ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
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
              </summary>

              <div className="grid border-t border-border bg-muted/10 sm:grid-cols-2 lg:grid-cols-[1.1fr_1fr_1fr_0.5fr_0.5fr]">
                <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
                  <p className="text-xs text-muted-foreground">{l("providers_doctor_specializations")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {specializations || t.common_not_set}
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
                  <p className="mt-1 text-sm font-semibold text-foreground">{doctor.patient_count}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">{l("providers_slots")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{doctor.appointment_count}</p>
                </div>
              </div>

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
                      <div
                        key={relationship.id}
                        className="grid gap-3 rounded-lg border border-border/70 bg-muted/10 p-3 md:grid-cols-[minmax(0,1fr)_160px]"
                      >
                        <div className="min-w-0">
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
                        </div>
                        {canManage ? (
                          <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 w-full justify-center rounded-lg bg-muted/20"
                              disabled={relationshipBusy}
                              onClick={() => onEditRelationship(doctor.id, relationship)}
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
                                  doctor.id,
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
                    ))}
                  </div>
                )}
              </div>
            </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StaffSection({
  detail,
  busy,
  staffRoles,
  canManage,
  onManageRoles,
  onNew,
  onEdit,
  onDelete,
}: {
  detail: ProviderDetail;
  busy: boolean;
  staffRoles: ProviderStaffRoleItem[];
  canManage: boolean;
  onManageRoles: () => void;
  onNew: () => void;
  onEdit: (staff: ProviderStaff) => void;
  onDelete: (staffId: string, staffName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
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
                className="overflow-hidden rounded-[1.4rem] border border-border bg-card"
              >
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
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
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">
                        {l("providers_opening_hours")}:{" "}
                        <span className="font-medium text-foreground">{staff.opening_hours}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {l("providers_staff_notes")}
                    </span>
                    <p className="mt-1 line-clamp-3 text-sm text-foreground">
                      {staff.notes || t.common_not_set}
                    </p>
                  </div>

                  {canManage ? (
                    <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => onEdit(staff)}
                      >
                        {t.uiText.patients_edit ?? "Edit"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                        disabled={busy}
                        onClick={() => onDelete(staff.id, staff.display_name)}
                      >
                        <Trash2 className="size-3.5" />
                        {t.uiText.patients_delete ?? "Delete"}
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
  canManage,
  onNew,
  onEdit,
  onDelete,
}: {
  detail: ProviderDetail;
  busy: boolean;
  canManage: boolean;
  onNew: () => void;
  onEdit: (service: ServiceItem) => void;
  onDelete: (serviceId: string, serviceName: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
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
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-center rounded-lg bg-muted/20"
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
  onOpenPatient,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointments: (patientId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
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
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_270px_160px]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{patientLabel(patient)}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {l("providers_last_interaction")}: {compactDateTime(patient.last_interaction_at, t.common_not_set)}
                  </p>
                </div>

                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70">
                  <div className="border-r border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("providers_appointments")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.appointment_count}</p>
                  </div>
                  <div className="border-r border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("appointments_services")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.leistung_count}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs text-muted-foreground">{t.appointments_linked_concierge}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.concierge_count}</p>
                  </div>
                </div>

                <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-center rounded-lg bg-muted/20"
                    onClick={() => onOpenPatient(patient.id)}
                  >
                    {l("patients_open_patient")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-center rounded-lg bg-muted/20"
                    onClick={() => onOpenAppointments(patient.id)}
                  >
                    {l("providers_appointments")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>      )}
    </section>
  );
}

function InteractionHistorySection({
  detail,
  onOpenPatient,
  onOpenAppointments,
  onOpenAppointment,
  onOpenOrder,
}: {
  detail: ProviderDetail;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointments: (patientId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
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
          {detail.interactions.map((item, index) => (
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
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                        {humanizeCode(item.kind)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                        {humanizeCode(item.status)}
                      </Badge>
                      {item.appointment_type ? (
                        <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                          {humanizeCode(item.appointment_type)}
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

                    {item.notes ? (
                      <div className="rounded-xl border border-border/60 px-3 py-2 text-sm leading-6 text-zinc-700">
                        <span className="mb-1 block text-xs text-muted-foreground">{l("patients_note")}</span>
                        {item.notes}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-center rounded-lg bg-muted/20"
                      onClick={() => onOpenPatient(item.patient_id)}
                    >
                      {l("orders_patient")}
                    </Button>
                    {item.kind === "appointment" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => onOpenAppointment(item.id)}
                      >
                        {l("providers_appointment")}
                      </Button>
                    ) : null}
                    {item.kind !== "appointment" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => onOpenAppointments(item.patient_id)}
                      >
                        {l("providers_appointments")}
                      </Button>
                    ) : null}
                    {item.order_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => onOpenOrder(item.order_id!)}
                      >
                        {l("patients_order")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderFormFields({
  form,
  specializations,
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
  const normalizeProviderContacts = (contacts: ProviderFormState["contacts"]) =>
    contacts.map((contact, _index, all) => {
      const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
      const firstPrimary = sameKind.find((item) => item.isPrimary);
      if (firstPrimary) {
        return { ...contact, isPrimary: contact.id === firstPrimary.id };
      }
      return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
    });
  const updateProviderContact = (
    contactId: string,
    patch: Partial<ProviderContactFormState>,
  ) => {
    if (!onContactsChange) return;
    const changedContacts = form.contacts.map((contact) => {
      if (contact.id !== contactId) return contact;
      return { ...contact, ...patch };
    }).map((contact, _index, all) => {
      if (!patch.isPrimary) return contact;
      const changed = all.find((item) => item.id === contactId);
      if (!changed || contact.contactKind !== changed.contactKind || contact.id === contactId) {
        return contact;
      }
      return { ...contact, isPrimary: false };
    });
    onContactsChange(normalizeProviderContacts(changedContacts));
  };
  const addProviderContact = () => {
    if (!onContactsChange) return;
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = hasPhone ? "email" : "phone";
    onContactsChange(normalizeProviderContacts([
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
    onContactsChange(normalizeProviderContacts(form.contacts.filter((contact) => contact.id !== contactId)));
  };

  const profileFields = (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("patients_display_name")}>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_title}
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

        <Field label={t.providers_type}>
          <NativeComboboxSelect
            value={providerType}
            onChange={(event) => {
              const nextProviderType = event.target.value === "non_medical" ? "non_medical" : "medical";
              onChange("providerType", nextProviderType);
              if (nextProviderType !== "medical") {
                onChange("specializations", "");
                onChange("fachbereich", "");
              }
            }}
            disabled={disabled || forceNonMedical}
            className={formSelectClassName}
          >
            <option value="medical">{t.providers_type_medical}</option>
            <option value="non_medical">{t.providers_type_non_medical}</option>
          </NativeComboboxSelect>
        </Field>
      </div>

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
        </div>
      ) : null}
    </>
  );

  const addressFields = (
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
          <Input
            value={form.addressCountry}
            onChange={(event) => onChange("addressCountry", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
      </div>
    </>
  );

  const contactFields = (
    <>
      <div className="space-y-2">
        {form.contacts.map((contact) => (
          <div
            key={contact.id}
            className="grid gap-2 rounded-lg border border-border/70 bg-card/50 p-2 md:grid-cols-[112px_132px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_92px_36px]"
          >
            <Field label={l("providers_contact_kind")}>
              <NativeComboboxSelect
                value={contact.contactKind}
                onChange={(event) =>
                  updateProviderContact(contact.id, {
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
                  updateProviderContact(contact.id, {
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
            <Field label={l("providers_contact_label")}>
              <Input
                value={contact.label}
                onChange={(event) => updateProviderContact(contact.id, { label: event.target.value })}
                className={shellInputClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={l("providers_staff_department")}>
              <Input
                value={contact.department}
                onChange={(event) => updateProviderContact(contact.id, { department: event.target.value })}
                className={shellInputClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={l("providers_contact_value")}>
              <Input
                type={contact.contactKind === "email" ? "email" : "text"}
                value={contact.value}
                onChange={(event) => updateProviderContact(contact.id, { value: event.target.value })}
                className={shellInputClassName}
                disabled={disabled}
              />
            </Field>
            <label className="flex min-h-[58px] items-end gap-2 pb-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={contact.isPrimary}
                onChange={(event) =>
                  updateProviderContact(contact.id, { isPrimary: event.target.checked })
                }
                className={checkboxClass}
                disabled={disabled}
              />
              {l("providers_contact_primary")}
            </label>
            <div className="flex items-end pb-0.5">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={t.common_remove}
                aria-label={t.common_remove}
                onClick={() => removeProviderContact(contact.id)}
                disabled={disabled}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {!disabled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg bg-muted/20"
            onClick={addProviderContact}
          >
            <Plus className="size-3.5" />
            {l("providers_contact_add")}
          </Button>
        ) : null}
      </div>
    </>
  );

  const contractFields = (
    <>
      <Field label={t.providers_contract}>
        <textarea
          value={form.contractText}
          onChange={(event) => onChange("contractText", event.target.value)}
          className={textareaClassName}
          rows={4}
          placeholder={l("providers_plain_text_becomes_summary_automatically_json_is_accepte")}
          disabled={disabled}
        />
      </Field>

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

function DoctorFormFields({
  form,
  specializations,
  onChange,
  onContactsChange,
}: {
  form: DoctorFormState;
  specializations: SpecializationItem[];
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onContactsChange: (contacts: DoctorFormState["contacts"]) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const doctorTitleOptions = ["Dr. med.", "PD", "Prof."];
  const doctorRoleOptions: Array<{ value: Exclude<DoctorFormState["roleCode"], "">; label: string }> = [
    { value: "clinical_director", label: l("providers_doctor_role_clinical_director") },
    { value: "chefarzt", label: l("providers_doctor_role_chefarzt") },
    { value: "oberarzt", label: l("providers_doctor_role_oberarzt") },
    { value: "facharzt", label: l("providers_doctor_role_facharzt") },
    { value: "assistenzarzt", label: l("providers_doctor_role_assistenzarzt") },
    { value: "other", label: l("providers_doctor_role_other") },
  ];
  const hasCustomTitle = Boolean(form.title) && !doctorTitleOptions.includes(form.title);
  const normalizeContacts = (contacts: DoctorFormState["contacts"]) =>
    contacts.map((contact, _index, all) => {
      const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
      const firstPrimary = sameKind.find((item) => item.isPrimary);
      if (firstPrimary) {
        return { ...contact, isPrimary: contact.id === firstPrimary.id };
      }
      return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
    });
  const updateContact = (
    contactId: string,
    patch: Partial<DoctorFormState["contacts"][number]>,
  ) => {
    const changedContacts = form.contacts.map((contact) => {
        if (contact.id !== contactId) return contact;
        const next = { ...contact, ...patch };
        if (patch.isPrimary) {
          return next;
        }
        return next;
      }).map((contact, _index, all) => {
        if (!patch.isPrimary) return contact;
        const changed = all.find((item) => item.id === contactId);
        if (!changed || contact.contactKind !== changed.contactKind || contact.id === contactId) {
          return contact;
        }
        return { ...contact, isPrimary: false };
      });
    onContactsChange(normalizeContacts(changedContacts));
  };
  const addContact = () => {
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = hasPhone ? "email" : "phone";
    onContactsChange(normalizeContacts([
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
    onContactsChange(normalizeContacts(form.contacts.filter((contact) => contact.id !== contactId)));
  };

  return (
    <div className="space-y-3">
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
          <Field label={t.providers_doctors}>
            <Input
              value={form.name}
              onChange={(event) => onChange("name", event.target.value)}
              className={shellInputClassName}
              placeholder={l("patients_display_name")}
            />
          </Field>
          <Field label={t.providers_doctor_title}>
            <NativeComboboxSelect
              value={form.title}
              onChange={(event) => onChange("title", event.target.value)}
              className={formSelectClassName}
            >
              <option value="">{t.common_not_set}</option>
              {doctorTitleOptions.map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
              {hasCustomTitle ? <option value={form.title}>{form.title}</option> : null}
            </NativeComboboxSelect>
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
              placeholder="Stellvertretender Klinikdirektor"
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
          <Field label={l("providers_languages")}>
            <Input
              value={form.languages}
              onChange={(event) => onChange("languages", event.target.value)}
              className={shellInputClassName}
              placeholder={l("providers_de_en_uk")}
            />
          </Field>
          <Field label={l("providers_opening_hours")}>
            <Input
              value={form.openingHours}
              onChange={(event) => onChange("openingHours", event.target.value)}
              className={shellInputClassName}
              placeholder={l("providers_opening_hours_placeholder")}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("providers_contacts")}>
        <div className="space-y-2">
          {form.contacts.map((contact) => (
            <div
              key={contact.id}
              className="grid gap-2 rounded-lg border border-border/70 bg-card/50 p-2 md:grid-cols-[132px_132px_minmax(0,1fr)_92px_36px]"
            >
              <Field label={l("providers_contact_kind")}>
                <NativeComboboxSelect
                  value={contact.contactKind}
                  onChange={(event) =>
                    updateContact(contact.id, {
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
                    updateContact(contact.id, {
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
              <Field label={l("providers_contact_value")}>
                <Input
                  type={contact.contactKind === "email" ? "email" : "text"}
                  value={contact.value}
                  onChange={(event) => updateContact(contact.id, { value: event.target.value })}
                  className={shellInputClassName}
                />
              </Field>
              <label className="flex min-h-[58px] items-end gap-2 pb-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={contact.isPrimary}
                  onChange={(event) =>
                    updateContact(contact.id, { isPrimary: event.target.checked })
                  }
                  className={checkboxClass}
                />
                {l("providers_contact_primary")}
              </label>
              <div className="flex items-end pb-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title={t.common_remove}
                  aria-label={t.common_remove}
                  onClick={() => removeContact(contact.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg bg-muted/20"
            onClick={addContact}
          >
            <Plus className="size-3.5" />
            {l("providers_contact_add")}
          </Button>
        </div>
      </Section>

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
            <Input
              value={form.licensingCountry}
              onChange={(event) => onChange("licensingCountry", event.target.value)}
              className={shellInputClassName}
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
  const normalizeContacts = (contacts: StaffFormState["contacts"]) =>
    contacts.map((contact, _index, all) => {
      const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
      const firstPrimary = sameKind.find((item) => item.isPrimary);
      if (firstPrimary) {
        return { ...contact, isPrimary: contact.id === firstPrimary.id };
      }
      return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
    });
  const updateContact = (
    contactId: string,
    patch: Partial<StaffFormState["contacts"][number]>,
  ) => {
    const changedContacts = form.contacts.map((contact) => {
        if (contact.id !== contactId) return contact;
        return { ...contact, ...patch };
      }).map((contact, _index, all) => {
        if (!patch.isPrimary) return contact;
        const changed = all.find((item) => item.id === contactId);
        if (!changed || contact.contactKind !== changed.contactKind || contact.id === contactId) {
          return contact;
        }
        return { ...contact, isPrimary: false };
      });
    onContactsChange(normalizeContacts(changedContacts));
  };
  const addContact = () => {
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = hasPhone ? "email" : "phone";
    onContactsChange(normalizeContacts([
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
    onContactsChange(normalizeContacts(form.contacts.filter((contact) => contact.id !== contactId)));
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
              value={form.displayName}
              onChange={(event) => onChange("displayName", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={l("providers_staff_role")}>
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
          <Field label={l("providers_opening_hours")}>
            <Input
              value={form.openingHours}
              onChange={(event) => onChange("openingHours", event.target.value)}
              className={shellInputClassName}
              placeholder={l("providers_opening_hours_placeholder")}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("providers_contacts")}>
        <div className="space-y-2">
          {form.contacts.map((contact) => (
            <div
              key={contact.id}
              className="grid gap-2 rounded-lg border border-border/70 bg-card/50 p-2 md:grid-cols-[132px_132px_minmax(0,1fr)_92px_36px]"
            >
              <Field label={l("providers_contact_kind")}>
                <NativeComboboxSelect
                  value={contact.contactKind}
                  onChange={(event) =>
                    updateContact(contact.id, {
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
                    updateContact(contact.id, {
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
              <Field label={l("providers_contact_value")}>
                <Input
                  type={contact.contactKind === "email" ? "email" : "text"}
                  value={contact.value}
                  onChange={(event) => updateContact(contact.id, { value: event.target.value })}
                  className={shellInputClassName}
                />
              </Field>
              <label className="flex min-h-[58px] items-end gap-2 pb-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={contact.isPrimary}
                  onChange={(event) =>
                    updateContact(contact.id, { isPrimary: event.target.checked })
                  }
                  className={checkboxClass}
                />
                {l("providers_contact_primary")}
              </label>
              <div className="flex items-end pb-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title={t.common_remove}
                  aria-label={t.common_remove}
                  onClick={() => removeContact(contact.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg bg-muted/20"
            onClick={addContact}
          >
            <Plus className="size-3.5" />
            {l("providers_contact_add")}
          </Button>
        </div>
      </Section>

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
  forcePriceRange,
  onChange,
}: {
  form: ServiceFormState;
  forcePriceRange: boolean;
  onChange: (field: keyof ServiceFormState, value: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const priceType = forcePriceRange ? "range" : form.priceType;
  return (
    <div className="space-y-3">
      <Section title={l("providers_service")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.providers_service_name}>
            <Input
              value={form.serviceName}
              onChange={(event) => onChange("serviceName", event.target.value)}
              className={shellInputClassName}
              required
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
      </Section>

      <Section title={l("providers_cost")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={l("providers_price_type")}>
            <NativeComboboxSelect
              value={priceType}
              onChange={(event) => onChange("priceType", event.target.value)}
              className={formSelectClassName}
              disabled={forcePriceRange}
            >
              {forcePriceRange ? null : <option value="fixed">{l("providers_price_fixed")}</option>}
              <option value="range">{l("providers_price_range")}</option>
              {forcePriceRange ? null : <option value="on_request">{l("providers_price_on_request")}</option>}
            </NativeComboboxSelect>
          </Field>
          {priceType === "fixed" ? (
            <Field label={t.providers_service_price}>
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
              <Field label={l("providers_price_from")}>
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
              <Field label={l("providers_price_to")}>
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
