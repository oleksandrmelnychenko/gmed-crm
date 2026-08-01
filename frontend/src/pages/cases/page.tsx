import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  LoaderCircle,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import type { CaseRosterItem } from "@/components/cases-roster-section";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import {
  AdminSheetScaffold,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  PageHeader,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClass,
  textareaClass as shellTextareaClass,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { clearApiCache } from "@/lib/api";
import { useSecurePersistedState } from "@/lib/secure-persist";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type Translations,
  useLang,
} from "@/lib/i18n";
import {
  CASE_SNIPPET_CATEGORY_LABEL_KEYS,
  CASE_SNIPPET_CATEGORY_VALUES,
  CASE_STATUS_LABEL_KEYS,
} from "@/lib/i18n/catalogs/cases-clinical";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import {
  daysInStatus,
  daysInStatusLabel,
} from "@/pages/leads/appearance/status-appearance";
import { doctorSpecialtyLabel, type SpecializationLabelLang } from "@/pages/providers/model/specialization-labels";
import {
  CASE_TEXT_SNIPPET_PLACEHOLDERS,
  renderCaseTextSnippet,
} from "../cases.snippets";
import { statusBadgeClass } from "./appearance/status-appearance";
import {
  createCase,
  fetchCaseLookups,
  fetchCaseTextSnippets,
  fetchCases,
  saveCaseTextSnippet,
} from "./data/case-api";
import type {
  CaseTextSnippet,
  DoctorOption,
  PatientOption,
} from "./model/types";

type CaseStatus = "open" | "in_progress" | "closed";

type CaseListItem = CaseRosterItem & {
  closed_reason?: string | null;
  closed_at?: string | null;
  status_changed_at?: string | null;
};

type CaseTextSnippetFormState = {
  id: string;
  label: string;
  category: string;
  body: string;
  is_active: boolean;
};

type CaseFilters = {
  search: string;
  status: string;
  patientId: string;
};

type CaseCreateFormState = {
  patientId: string;
  hauptanfragegrund: string;
  aktuelleAnamnese: string;
  zuweiserDoctorId: string;
  zuweiser: string;
};

type CasePermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canEdit: boolean;
};

type PanelProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

type FieldProps = {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  error?: string;
};

type BannerProps = {
  tone: "error" | "success";
  children: ReactNode;
};

type EmptyPanelProps = {
  title: string;
  text: string;
  action?: ReactNode;
};

const CASE_STATUSES: CaseStatus[] = ["open", "in_progress", "closed"];
const DEFAULT_FILTERS: CaseFilters = { search: "", status: "", patientId: "" };
const DEFAULT_CREATE_FORM: CaseCreateFormState = {
  patientId: "",
  hauptanfragegrund: "",
  aktuelleAnamnese: "",
  zuweiserDoctorId: "",
  zuweiser: "",
};
const DEFAULT_CASE_TEXT_SNIPPET_FORM: CaseTextSnippetFormState = {
  id: "",
  label: "",
  category: "general",
  body: "",
  is_active: true,
};

const inputClassName = shellInputClassName;
const selectClassName = shellSelectClass;
const textareaClassName = shellTextareaClass;
const CASE_REALTIME_EVENTS = [
  "case.created",
  "case.updated",
  "case.medication_expiry_confirmed",
  "case.medication_expiry_flagged",
] as const;

function casePermissions(role?: string): CasePermissions {
  return {
    canViewPage: role === "ceo" || role === "patient_manager",
    canCreate: role === "ceo" || role === "patient_manager",
    canEdit: role === "ceo" || role === "patient_manager",
  };
}

function cardClass(className?: string) {
  return cn(
    "rounded-lg border border-border/70 bg-card",
    className,
  );
}

function caseStatusLabel(
  status: string,
  tr: Translations,
) {
  return formatEnumLabelFromKeys(status, CASE_STATUS_LABEL_KEYS, tr);
}

function buildCasesPath(filters: CaseFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.patientId) params.set("patient_id", filters.patientId);
  const query = params.toString();
  return `/cases${query ? `?${query}` : ""}`;
}

function runtimeTranslations(): Translations {
  return translateCatalog(getLang());
}

function runtimeLocale() {
  switch (getLang()) {
    case "ru":
      return "ru-RU";
    case "de":
      return "de-DE";
    default:
      return "en-GB";
  }
}

function caseText(key: string) {
  return runtimeTranslations().uiText[key] ?? key;
}

function closeReasonLabel(reason: string) {
  return caseText(`case_ws_close_reason_${reason}`);
}

function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || runtimeTranslations().cases_clinical_patient_fallback} (${patient.patient_id})`;
}

function doctorOptionLabel(doctor: DoctorOption, lang: SpecializationLabelLang) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const doctorName = `${titlePrefix}${doctor.name}`.trim();
  const provider = doctor.provider_name.trim();
  const providerLabel = provider
    ? `${lang === "de" ? "Klinik" : "Клиника"}: ${provider}`
    : "";
  return [doctorName, providerLabel].filter(Boolean).join(" · ");
}

function doctorOptionSearchText(doctor: DoctorOption, lang: SpecializationLabelLang) {
  return [doctorOptionLabel(doctor, lang), doctorSpecialtyLabel(doctor, lang)]
    .filter(Boolean)
    .join(" · ");
}

const CASE_DATE_TIME_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
  "en-GB": new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (CASE_DATE_TIME_FORMATTERS[runtimeLocale()] ?? CASE_DATE_TIME_FORMATTERS["en-GB"]).format(date);
}

function snippetCategoryLabel(category: string) {
  return formatEnumLabelFromKeys(
    category,
    CASE_SNIPPET_CATEGORY_LABEL_KEYS,
    runtimeTranslations(),
  );
}

function isKnownSnippetCategory(value: string) {
  return (CASE_SNIPPET_CATEGORY_VALUES as readonly string[]).includes(value);
}

function toOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function bannerText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const CASE_DOCTOR_OPTION_SEPARATOR = "::provider::";

function caseDoctorOptionValue(doctor: DoctorOption) {
  return `${doctor.id}${CASE_DOCTOR_OPTION_SEPARATOR}${doctor.provider_id}`;
}

function splitCaseDoctorSelection(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw || raw === "__none__") return { doctorId: "", providerId: "" };
  const [doctorId, providerId = ""] = raw.split(CASE_DOCTOR_OPTION_SEPARATOR);
  return { doctorId, providerId };
}

function findCaseDoctorBySelection(value: string | null | undefined, doctors: DoctorOption[]) {
  const { doctorId, providerId } = splitCaseDoctorSelection(value);
  if (!doctorId) return null;
  if (providerId) {
    return doctors.find((doctor) => doctor.id === doctorId && doctor.provider_id === providerId) ?? null;
  }
  return doctors.find((doctor) => doctor.id === doctorId) ?? null;
}

function caseDoctorSelectValue(
  value: string | null | undefined,
  providerContext: string | null | undefined,
  doctors: DoctorOption[],
) {
  const { doctorId, providerId } = splitCaseDoctorSelection(value);
  if (!doctorId) return "__none__";
  if (providerId) return `${doctorId}${CASE_DOCTOR_OPTION_SEPARATOR}${providerId}`;

  const matches = doctors.filter((doctor) => doctor.id === doctorId);
  if (matches.length === 0) return doctorId;

  const normalizedProviderContext = providerContext?.trim().toLocaleLowerCase();
  const providerMatch = normalizedProviderContext
    ? matches.find((doctor) => {
        const providerName = doctor.provider_name.trim().toLocaleLowerCase();
        return (
          providerName === normalizedProviderContext ||
          normalizedProviderContext.includes(providerName)
        );
      })
    : null;

  return caseDoctorOptionValue(providerMatch ?? matches[0]);
}

function caseDoctorPayloadId(value: string | null | undefined, doctors: DoctorOption[]) {
  const { doctorId, providerId } = splitCaseDoctorSelection(value);
  if (!doctorId) return null;
  if (providerId) {
    return doctors.some((doctor) => doctor.id === doctorId && doctor.provider_id === providerId)
      ? doctorId
      : null;
  }
  if (doctors.length > 0 && !doctors.some((doctor) => doctor.id === doctorId)) return null;
  return doctorId;
}

type CasesPageState = {
  filters: CaseFilters;
  patients: PatientOption[];
  doctors: DoctorOption[];
  cases: CaseListItem[];
  listBusy: boolean;
  listError: string;
  listVersion: number;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  createForm: CaseCreateFormState;
  snippets: CaseTextSnippet[];
  snippetsBusy: boolean;
  snippetsError: string;
  snippetVersion: number;
  snippetDialogOpen: boolean;
  snippetSaveBusy: boolean;
  snippetSaveError: string;
  snippetForm: CaseTextSnippetFormState;
};

type CasesPagePatch =
  | Partial<CasesPageState>
  | ((current: CasesPageState) => Partial<CasesPageState>);

function casesPageReducer(
  current: CasesPageState,
  patch: CasesPagePatch,
): CasesPageState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveCasesPageStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createCasesPageFieldPatch<K extends keyof CasesPageState>(
  field: K,
  nextValue: SetStateAction<CasesPageState[K]>,
): CasesPagePatch {
  return (current) => ({
    [field]: resolveCasesPageStateAction(nextValue, current[field]),
  } as Partial<CasesPageState>);
}

function useCasesPageContent() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => casePermissions(user?.role), [user?.role]);

  type PersistedCaseFilters = Pick<CaseFilters, "status" | "patientId">;
  const [persistedCaseFilters, setPersistedCaseFilters] = useSecurePersistedState<PersistedCaseFilters>(
    "cases.filters",
    { status: DEFAULT_FILTERS.status, patientId: DEFAULT_FILTERS.patientId },
    {
      schemaVersion: 1,
      validate: (value): value is PersistedCaseFilters =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).status === "string" &&
        typeof (value as Record<string, unknown>).patientId === "string",
    },
  );
  const [casesPageState, dispatchCasesPageState] = useReducer(
    casesPageReducer,
    undefined,
    (): CasesPageState => ({
      filters: {
        ...DEFAULT_FILTERS,
        status: persistedCaseFilters.status,
        patientId: persistedCaseFilters.patientId,
      },
      patients: [],
      doctors: [],
      cases: [],
      listBusy: false,
      listError: "",
      listVersion: 0,
      createOpen: false,
      createBusy: false,
      createError: "",
      createForm: DEFAULT_CREATE_FORM,
      snippets: [],
      snippetsBusy: false,
      snippetsError: "",
      snippetVersion: 0,
      snippetDialogOpen: false,
      snippetSaveBusy: false,
      snippetSaveError: "",
      snippetForm: DEFAULT_CASE_TEXT_SNIPPET_FORM,
    }),
  );
  const {
    cases,
    createBusy,
    createError,
    createForm,
    createOpen,
    doctors,
    filters,
    listBusy,
    listError,
    listVersion,
    patients,
    snippetDialogOpen,
    snippetForm,
    snippetSaveBusy,
    snippetSaveError,
    snippets,
    snippetsBusy,
    snippetsError,
    snippetVersion,
  } = casesPageState;
  const casesPagination = useDataTablePagination(
    cases,
    `${filters.search} ${filters.status} ${filters.patientId}`,
  );
  const setCasesPageField = <K extends keyof CasesPageState>(
    field: K,
    nextValue: SetStateAction<CasesPageState[K]>,
  ) => dispatchCasesPageState(createCasesPageFieldPatch(field, nextValue));
  const setFilters = useCallback(
    (value: SetStateAction<CaseFilters>) => {
      dispatchCasesPageState((current) => {
        const next = resolveCasesPageStateAction(value, current.filters);
        setPersistedCaseFilters({
          status: next.status,
          patientId: next.patientId,
        });
        return { filters: next };
      });
    },
    [setPersistedCaseFilters],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const setPatients = (nextValue: SetStateAction<PatientOption[]>) =>
    setCasesPageField("patients", nextValue);
  const setDoctors = (nextValue: SetStateAction<DoctorOption[]>) =>
    setCasesPageField("doctors", nextValue);
  const setCases = (nextValue: SetStateAction<CaseListItem[]>) =>
    setCasesPageField("cases", nextValue);
  const setListBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("listBusy", nextValue);
  const setListError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("listError", nextValue);
  const setListVersion = (nextValue: SetStateAction<number>) =>
    setCasesPageField("listVersion", nextValue);
  const setCreateOpen = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("createOpen", nextValue);
  const setCreateBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("createBusy", nextValue);
  const setCreateError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("createError", nextValue);
  const setCreateForm = (nextValue: SetStateAction<CaseCreateFormState>) =>
    setCasesPageField("createForm", nextValue);
  const setSnippets = (nextValue: SetStateAction<CaseTextSnippet[]>) =>
    setCasesPageField("snippets", nextValue);
  const setSnippetsBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("snippetsBusy", nextValue);
  const setSnippetsError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("snippetsError", nextValue);
  const setSnippetVersion = (nextValue: SetStateAction<number>) =>
    setCasesPageField("snippetVersion", nextValue);
  const setSnippetDialogOpen = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("snippetDialogOpen", nextValue);
  const setSnippetSaveBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("snippetSaveBusy", nextValue);
  const setSnippetSaveError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("snippetSaveError", nextValue);
  const setSnippetForm = (
    nextValue: SetStateAction<CaseTextSnippetFormState>,
  ) => setCasesPageField("snippetForm", nextValue);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters],
  );
  const casesPath = useMemo(() => buildCasesPath(effectiveFilters), [effectiveFilters]);

  useDebouncedRealtimeSubscription(CASE_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/cases");
    for (const event of events) {
      if (event.entity_type === "case" && event.entity_id) {
        clearApiCache(`/cases/${event.entity_id}`);
        clearApiCache(`/cases/${event.entity_id}/history`);
      }
    }
    startTransition(() => {
      setListVersion((current) => current + 1);
    });
  }, 250);

  const snippetPreviewContext = useMemo(
    () => ({
      patientName: "",
      patientPid: "",
      caseId: "",
      caseUuid: "",
      hauptanfragegrund: "",
      zuweiser: "",
      today: new Date().toISOString().slice(0, 10),
    }),
    [],
  );

  const caseTableColumns = useMemo<ColumnDef<CaseListItem>[]>(
    () => [
      {
        id: "case_id",
        label: t.cases_clinical_case_id,
        accessor: (row) => row.case_id,
        sortable: true,
        required: true,
        width: 170,
        render: (row) => <span className="font-mono text-xs">{row.case_id}</span>,
      },
      {
        id: "patient_name",
        label: t.orders_patient,
        accessor: (row) => row.patient_name,
        sortable: true,
        required: true,
        width: 260,
        render: (row) => <span className="font-mono text-xs">{row.patient_name}</span>,
      },
      {
        id: "reason",
        label: t.cases_reason,
        accessor: (row) => row.hauptanfragegrund ?? "",
        width: 280,
        render: (row) => (
          <span className="block max-w-[280px] truncate text-xs text-foreground">
            {row.hauptanfragegrund?.trim() || t.common_not_set}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.status,
        sortable: true,
        width: 180,
        render: (row) => (
          <span className="inline-flex items-center gap-1.5">
            <Badge variant="outline" className={cn("rounded-full", statusBadgeClass(row.status))}>
              {caseStatusLabel(row.status, t)}
            </Badge>
            {row.status === "closed" && row.closed_reason ? (
              <span className="text-[11px] text-muted-foreground">
                {closeReasonLabel(row.closed_reason)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "days_in_status",
        label: lang === "de" ? "Tage im Status" : "Дней в статусе",
        accessor: (row) => daysInStatus(row.status_changed_at) ?? 0,
        sortable: true,
        width: 130,
        render: (row) => {
          const days = daysInStatus(row.status_changed_at);
          return days != null ? (
            <span className="whitespace-nowrap font-mono text-xs tabular-nums text-foreground">
              {daysInStatusLabel(days, lang)}
            </span>
          ) : (
            <span className="text-xs text-foreground">—</span>
          );
        },
      },
      {
        id: "created",
        label: t.users_created,
        accessor: (row) => row.created_at,
        sortable: true,
        width: 180,
        render: (row) => <span className="text-xs text-foreground">{formatDateTime(row.created_at)}</span>,
      },
    ],
    [lang, t],
  );

  const applyCaseLookups = useCallback(
    (patientItems: PatientOption[], doctorItems: DoctorOption[]) => {
      setPatients(patientItems);
      setDoctors(doctorItems);
    },
    [],
  );

  const hydratePatientFilterFromRoute = useCallback(
    (patientParam: string) => {
      setFilters((current) =>
        current.patientId === patientParam
          ? current
          : { ...current, patientId: patientParam },
      );
    },
    [setFilters],
  );

  const openCreateCaseFromRoute = useCallback(
    (patientParam: string, currentSearchParams: URLSearchParams) => {
      setCreateError("");
      setCreateForm({
        ...DEFAULT_CREATE_FORM,
        patientId: patientParam,
      });
      setCreateOpen(true);
      const params = new URLSearchParams(currentSearchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const startSnippetLoad = useCallback(() => {
    setSnippetsBusy(true);
    setSnippetsError("");
  }, []);

  const finishSnippetLoad = useCallback(() => {
    setSnippetsBusy(false);
  }, []);

  const applySnippets = useCallback((items: CaseTextSnippet[]) => {
    setSnippets(items);
  }, []);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void fetchCaseLookups().then(({ patients: patientItems, doctors: doctorItems }) => {
      if (!cancelled) {
        startTransition(() => {
          applyCaseLookups(patientItems, doctorItems);
        });
      }
    }).catch(() => {
      if (!cancelled) {
        startTransition(() => {
          applyCaseLookups([], []);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyCaseLookups, permissions.canViewPage]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    startSnippetLoad();

    void fetchCaseTextSnippets()
      .then((items) => {
        if (!cancelled) {
          startTransition(() => applySnippets(items));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSnippetsError(
            bannerText(
              error,
              caseText("cases_failed_to_load_text_snippets"),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          finishSnippetLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applySnippets,
    finishSnippetLoad,
    permissions.canViewPage,
    snippetVersion,
    startSnippetLoad,
  ]);

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const caseParam = searchParams.get("case") ?? "";
    const createParam = searchParams.get("create") ?? "";

    hydratePatientFilterFromRoute(patientParam);

    if (caseParam) {
      staffGo(`/cases/${caseParam}`);
      return;
    }

    if (createParam && permissions.canCreate) {
      openCreateCaseFromRoute(patientParam, searchParams);
    }
  }, [
    hydratePatientFilterFromRoute,
    openCreateCaseFromRoute,
    permissions.canCreate,
    searchParams,
    staffGo,
  ]);

  const startCaseListLoad = useCallback(() => {
    setListBusy(true);
    setListError("");
  }, []);

  const applyCases = useCallback((items: CaseListItem[]) => {
    setCases(items);
  }, []);

  const finishCaseListLoad = useCallback(() => {
    setListBusy(false);
  }, []);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    startCaseListLoad();

    void fetchCases(casesPath)
      .then((items) => {
        if (!cancelled) {
          startTransition(() => applyCases(items as CaseListItem[]));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(
            bannerText(
              error,
              caseText("cases_failed_to_load_cases"),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          finishCaseListLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyCases, casesPath, finishCaseListLoad, permissions.canViewPage, listVersion, startCaseListLoad]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function updateQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  function openCase(caseId: string) {
    staffGo(`/cases/${caseId}`);
  }

  async function handleCreateCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    try {
      const created = await createCase({
        patient_id: createForm.patientId,
        hauptanfragegrund: toOptionalText(createForm.hauptanfragegrund),
        aktuelle_anamnese: toOptionalText(createForm.aktuelleAnamnese),
        zuweiser_doctor_id: caseDoctorPayloadId(createForm.zuweiserDoctorId, doctors),
        zuweiser: toOptionalText(createForm.zuweiser),
      });
      setCreateOpen(false);
      setCreateForm(DEFAULT_CREATE_FORM);
      refreshList();
      openCase(created.id);
    } catch (error) {
      setCreateError(
        bannerText(
          error,
          caseText("cases_failed_to_create_case"),
        ),
      );
    } finally {
      setCreateBusy(false);
    }
  }

  function refreshSnippetLibrary() {
    setSnippetVersion((current) => current + 1);
  }

  function openSnippetLibrary() {
    setSnippetSaveError("");
    setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
    setSnippetDialogOpen(true);
  }

  function openNewSnippetDialog() {
    setSnippetSaveError("");
    setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
  }

  function openEditSnippetDialog(snippet: CaseTextSnippet) {
    setSnippetSaveError("");
    setSnippetForm({
      id: snippet.id,
      label: snippet.label,
      category: snippet.category,
      body: snippet.body,
      is_active: snippet.is_active,
    });
  }

  async function handleSaveSnippet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSnippetSaveBusy(true);
    setSnippetSaveError("");

    try {
      await saveCaseTextSnippet(snippetForm.id, {
        label: snippetForm.label,
        category: toOptionalText(snippetForm.category) ?? "general",
        body: snippetForm.body,
        is_active: snippetForm.is_active,
      });
      setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
      refreshSnippetLibrary();
    } catch (error) {
      setSnippetSaveError(
        bannerText(
          error,
          caseText("cases_failed_to_save_text_snippet"),
        ),
      );
    } finally {
      setSnippetSaveBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t.cases_clinical_no_access_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            {t.cases_clinical_no_access_description}
          </p>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.cases_title}
          description={t.cases_subtitle}
          actions={(
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                onClick={refreshList}
              >
                <RefreshCw className="size-3.5" />
                {t.common_refresh}
              </Button>
              {permissions.canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                  onClick={openSnippetLibrary}
                >
                  <NotebookPen className="size-3.5" />
                  {t.cases_snippets_title}
                </Button>
              ) : null}
              {permissions.canCreate ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg gap-1.5 px-3.5"
                  onClick={() => {
                    setCreateError("");
                    setCreateForm(DEFAULT_CREATE_FORM);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  {t.cases_new}
                </Button>
              ) : null}
            </>
          )}
        />

        {listError ? (
          <div className="mb-3">
            <Banner tone="error">{listError}</Banner>
          </div>
        ) : null}
        <DataTableSurface
          rows={casesPagination.pagedRows}
          columns={caseTableColumns}
          rowId={(item) => item.id}
          defaultDensity="comfortable"
          dictionary={t as unknown as Record<string, string>}
          onRowClick={(item) => openCase(item.id)}
          loading={listBusy}
          tableClassName="min-h-[440px]"
          toolbarStart={
            <>
          <ToolbarField label={t.common_search} className="min-w-[220px] flex-1 sm:max-w-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder={t.search_placeholder}
              className="h-8 w-[260px] rounded-md bg-field pl-8 text-xs"
            />
          </div>
          </ToolbarField>

          <ToolbarField label={t.users_status}>
          <NativeComboboxSelect
            value={filters.status || "__all__"}


            onChange={(event) => setFilters((current) => ({
                ...current,
                status: event.target.value && event.target.value !== "__all__" ? event.target.value : "",
              }))} className={cn(selectClassName, "h-8 rounded-md w-[220px] bg-field text-xs")}>
              <option value="__all__">{t.providers_all}</option>
              {CASE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {caseStatusLabel(status, t)}
                </option>
              ))}
            </NativeComboboxSelect>
          </ToolbarField>

          <ToolbarField label={t.orders_patient}>
          <NativeComboboxSelect
            value={filters.patientId || "__all__"}


            onChange={(event) => {
              const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
              setFilters((current) => ({ ...current, patientId }));
              updateQuery({ patient: patientId || null });
            }} className={cn(selectClassName, "h-8 rounded-md w-[260px] bg-field text-xs")}>
              <option value="__all__">{t.providers_all}</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientLabel(patient)}
                </option>
              ))}
            </NativeComboboxSelect>
          </ToolbarField>

          {filters.search.trim() || filters.status || filters.patientId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                updateQuery({ patient: null, case: null });
              }}
            >
              {t.common_reset}
            </Button>
          ) : null}
            </>
          }
          toolbarAfter={(
            <DataTablePager
              pageIndex={casesPagination.pageIndex}
              pageSize={casesPagination.pageSize}
              totalPages={casesPagination.totalPages}
              totalRows={casesPagination.totalRows}
              previousLabel={t.pagination_previous}
              nextLabel={t.pagination_next}
              onPageChange={casesPagination.onPageChange}
            />
          )}
          emptyState={(
                <EmptyPanel
                  title={t.cases_no_match}
                  text={t.cases_no_match}
                  action={
                    permissions.canCreate ? (
                      <Button
                        type="button"
                        className="h-9 rounded-lg px-3.5"
                        onClick={() => {
                          setCreateError("");
                          setCreateForm(DEFAULT_CREATE_FORM);
                          setCreateOpen(true);
                        }}
                      >
                        <Plus className="size-4" />
                        {t.cases_new}
                      </Button>
                    ) : undefined
                  }
                />
          )}
        />
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-border p-0 sm:max-w-[640px]">
          <form onSubmit={handleCreateCase} className="flex min-h-0 flex-1 flex-col">
            <AdminSheetScaffold
              title={t.cases_new}
              description={t.cases_subtitle}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.cases_new}
                  submittingLabel={t.patients_creating}
                  submitting={createBusy}
                  submitDisabled={!createForm.patientId}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
          >
            {createError ? <Banner tone="error">{createError}</Banner> : null}
              <Panel title={t.patients_profile}>
                <Field label={t.cases_patient} required>
                  <NativeComboboxSelect
                    value={createForm.patientId || "__none__"}


                    onChange={(event) => {
                      const patientId = event.target.value && event.target.value !== "__none__" ? event.target.value : "";
                      setCreateForm((current) => ({ ...current, patientId }));
                    }} className={selectClassName}>
                      <option value="__none__">{t.cases_patient}</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patientLabel(patient)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                </Field>
              </Panel>

              <Panel title={t.cases_core_anamnesis}>
                <Field label={t.cases_reason} required>
                  <Input
                    value={createForm.hauptanfragegrund}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        hauptanfragegrund: event.target.value,
                      }))}
                    required
                    className={inputClassName}
                  />
                </Field>

                <Field label={t.cases_anamnesis} required>
                  <textarea
                    value={createForm.aktuelleAnamnese}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        aktuelleAnamnese: event.target.value,
                      }))}
                    required
                    className={textareaClassName}
                    rows={4}
                  />
                </Field>
              </Panel>

              <Panel title={t.common_doctor}>
                <Field label={t.cases_referrer}>
                  <NativeComboboxSelect
                    value={caseDoctorSelectValue(createForm.zuweiserDoctorId, null, doctors)}


                    onChange={(event) => {
                      const selectedDoctor = findCaseDoctorBySelection(event.target.value, doctors);
                      setCreateForm((current) => ({
                        ...current,
                        zuweiserDoctorId: selectedDoctor ? caseDoctorOptionValue(selectedDoctor) : "",
                        zuweiser: selectedDoctor
                          ? doctorOptionLabel(selectedDoctor, lang)
                          : current.zuweiser,
                      }));
                    }} className={selectClassName}>
                      <option value="__none__">{t.common_not_set}</option>
                      {doctors.map((doctor) => {
                        const value = caseDoctorOptionValue(doctor);
                        const label = doctorOptionLabel(doctor, lang);
                        return (
                          <option key={value} value={value} data-search-text={doctorOptionSearchText(doctor, lang)}>
                            {label}
                          </option>
                        );
                      })}
                    </NativeComboboxSelect>
                </Field>

                <Field
                  label={t.cases_clinical_referrer_label}
                >
                  <Input
                    value={createForm.zuweiser}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, zuweiser: event.target.value }))}
                    className={inputClassName}
                  />
                </Field>
              </Panel>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={snippetDialogOpen} onOpenChange={setSnippetDialogOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-border p-0 sm:max-w-[960px]">
          <AdminSheetScaffold
            title={t.cases_snippets_title}
            description={t.cases_snippets_description}
            className="h-full"
          >
            {snippetsError ? <Banner tone="error">{snippetsError}</Banner> : null}
            <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
              <Panel
                title={t.cases_snippets_title}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={openNewSnippetDialog}
                  >
                    {t.cases_snippets_new}
                  </Button>
                }
              >
                {snippetsBusy ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    {t.common_loading}
                  </div>
                ) : snippets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t.cases_snippets_empty}
                  </p>
                ) : (
                  <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                    {snippets.map((snippet) => (
                      <button
                        key={snippet.id}
                        type="button"
                        className={cn(
                          "w-full rounded-xl border p-4 text-left transition",
                          snippetForm.id === snippet.id
                            ? "border-sky-300 bg-sky-50"
                            : "border-border bg-white hover:border-border",
                        )}
                        onClick={() => openEditSnippetDialog(snippet)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {snippet.label}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {snippetCategoryLabel(snippet.category)}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className={snippet.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}
                          >
                            {snippet.is_active ? t.common_active : t.common_inactive}
                          </Badge>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                          {snippet.body}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel title={snippetForm.id ? t.common_edit : t.cases_snippets_new}>
              <form onSubmit={handleSaveSnippet} className="space-y-4">
                {snippetSaveError ? (
                  <Banner tone="error">{snippetSaveError}</Banner>
                ) : null}
                <Field label={t.cases_snippets_label} required>
                  <Input
                    value={snippetForm.label}
                    onChange={(event) =>
                      setSnippetForm((current) => ({
                        ...current,
                        label: event.target.value,
                      }))}
                    className="h-10 rounded-xl bg-field"
                  />
                </Field>
                <Field label={t.cases_snippets_category}>
                  <NativeComboboxSelect
                    value={snippetForm.category || "general"}
                    onChange={(event) =>
                      setSnippetForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))}
                    className={selectClassName}
                  >
                    {CASE_SNIPPET_CATEGORY_VALUES.map((category) => (
                      <option key={category} value={category}>
                        {snippetCategoryLabel(category)}
                      </option>
                    ))}
                    {snippetForm.category &&
                    !isKnownSnippetCategory(snippetForm.category) ? (
                      <option value={snippetForm.category}>
                        {snippetCategoryLabel(snippetForm.category)}
                      </option>
                    ) : null}
                  </NativeComboboxSelect>
                </Field>
                <Field label={t.cases_snippets_body} required>
                  <textarea
                    value={snippetForm.body}
                    onChange={(event) =>
                      setSnippetForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))}
                    className={textareaClassName}
                    rows={8}
                  />
                </Field>
                <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={snippetForm.is_active}
                    onChange={(event) =>
                      setSnippetForm((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))}
                  />
                  {t.cases_snippets_active}
                </label>
                <div className="rounded-xl border border-dashed border-border bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t.cases_snippets_preview}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {renderCaseTextSnippet(snippetForm.body, snippetPreviewContext) || t.cases_snippets_empty}
                  </p>
                </div>
                <code className="block rounded-xl bg-white px-3 py-2 text-[11px] text-muted-foreground">
                  {CASE_TEXT_SNIPPET_PLACEHOLDERS.join(" · ")}
                </code>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => {
                      setSnippetDialogOpen(false);
                      setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
                      setSnippetSaveError("");
                    }}
                  >
                    {t.common_cancel}
                  </Button>
                  <Button
                    type="submit"
                    className="h-9 rounded-lg px-3.5"
                    disabled={snippetSaveBusy}
                  >
                    {snippetSaveBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {t.cases_snippets_save}
                  </Button>
                </div>
              </form>
              </Panel>
            </div>
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function CasesPage() {
  return useCasesPageContent();
}

function Panel({ title, description, action, children, className }: PanelProps) {
  return (
    <section className={cardClass(cn("p-6", className))}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-[var(--brand)]"
            />
            <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
              {title}
            </h3>
          </div>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      <div className="mt-5 border-t border-border pt-5">{children}</div>
    </section>
  );
}

function Field({ label, children, hint, required = false, error = "" }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
        {required ? <span aria-hidden="true" className="ml-1 text-rose-500">*</span> : null}
      </label>
      {children}
      {error ? (
        <span className="text-xs leading-snug text-rose-600">{error}</span>
      ) : hint ? (
        <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function Banner({ tone, children }: BannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {children}
    </div>
  );
}

function EmptyPanel({ title, text, action }: EmptyPanelProps) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-8 text-center">
      <div className="mx-auto max-w-md">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
