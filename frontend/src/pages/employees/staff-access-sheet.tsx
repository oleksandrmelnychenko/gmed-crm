import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  type LucideIcon,
  UserRound,
} from "lucide-react";

import {
  AdminSectionTitle,
  AdminSheetScaffold,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { applyFilters } from "@/components/data-table/filter-logic";
import { DataTablePager } from "@/components/data-table/data-table-pager";
import type { ColumnDef, FilterPredicate } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Banner, TabLoader } from "@/components/ui-shell";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  cloneStaffAccessProfile,
  createStaffAccessProfile,
  getStaffUserAccess,
  listDocumentAccessResources,
  listPatientAccessResources,
  listProviderAccessResources,
  listStaffAccessProfiles,
  updateStaffUserAccess,
} from "./staff-access-api";
import {
  accessDraftSignature,
  canRoleUseMedicalDocuments,
  effectiveProfileAllRule,
  effectiveProfileRule,
  profileRulesFromDirectRules,
  setDirectAllRuleEnabled,
  setDirectRuleEnabled,
  STAFF_ACCESS_CAPABILITIES,
} from "./staff-access-model";
import type {
  StaffAccessCapability,
  StaffAccessProfile,
  StaffAccessResource,
  StaffAccessResourceType,
  StaffAccessUser,
  StaffDirectAccessRuleInput,
  StaffUserAccessResponse,
  UpdateStaffUserAccessBody,
} from "./staff-access-types";

type ResourceLoadState = {
  items: StaffAccessResource[];
  loading: boolean;
  error: string;
};

type ResourceStateMap = Record<StaffAccessResourceType, ResourceLoadState>;
type ResourceFilterStateMap = Record<StaffAccessResourceType, FilterPredicate[]>;

const EMPTY_RESOURCE_STATE: ResourceStateMap = {
  provider: { items: [], loading: false, error: "" },
  patient: { items: [], loading: false, error: "" },
  document: { items: [], loading: false, error: "" },
};

const EMPTY_RESOURCE_FILTERS: ResourceFilterStateMap = {
  provider: [],
  patient: [],
  document: [],
};

const RESOURCE_PAGE_SIZE = 50;

const RESOURCE_ICONS = {
  provider: Stethoscope,
  patient: UserRound,
  document: FileText,
} satisfies Record<StaffAccessResourceType, LucideIcon>;

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ruleLabel(
  rule: StaffDirectAccessRuleInput,
  resourceLabel: (type: StaffAccessResourceType, id: string | null) => string,
  capabilityLabel: (capability: StaffAccessCapability) => string,
  allLabel: string,
) {
  const scope = rule.scope_type === "all"
    ? allLabel
    : resourceLabel(rule.resource_type, rule.resource_id);
  return `${scope}: ${capabilityLabel(rule.capability)}`;
}

function directRuleFor(
  rules: StaffDirectAccessRuleInput[],
  resourceType: StaffAccessResourceType,
  resourceId: string,
  capability: StaffAccessCapability,
) {
  return rules.find(
    (rule) =>
      rule.resource_type === resourceType &&
      rule.scope_type === "record" &&
      rule.resource_id === resourceId &&
      rule.capability === capability,
  );
}

function directAllRuleFor(
  rules: StaffDirectAccessRuleInput[],
  resourceType: StaffAccessResourceType,
  capability: StaffAccessCapability,
) {
  return rules.find(
    (rule) =>
      rule.resource_type === resourceType &&
      rule.scope_type === "all" &&
      rule.capability === capability,
  );
}

export function StaffAccessSheet({
  open,
  employee,
  onClose,
}: {
  open: boolean;
  employee: Pick<StaffAccessUser, "id" | "name" | "email" | "role"> | null;
  onClose: () => void;
}) {
  const { t } = useLang();
  const copy = t.staffAccess;

  const capabilityLabel = useCallback(
    (capability: StaffAccessCapability) => {
      return copy.capabilities[capability];
    },
    [copy.capabilities],
  );

  const resourceStatusLabel = useCallback(
    (status: string) => {
      const labels = copy.statuses as Record<string, string>;
      return labels[status] ?? copy.statuses.unknown;
    },
    [copy.statuses],
  );

  const [access, setAccess] = useState<StaffUserAccessResponse | null>(null);
  const [profiles, setProfiles] = useState<StaffAccessProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [resources, setResources] = useState<ResourceStateMap>(EMPTY_RESOURCE_STATE);
  const [activeTab, setActiveTab] = useState<StaffAccessResourceType>("provider");
  const [searches, setSearches] = useState<Record<StaffAccessResourceType, string>>({
    provider: "",
    patient: "",
    document: "",
  });
  const [resourceFilters, setResourceFilters] =
    useState<ResourceFilterStateMap>(EMPTY_RESOURCE_FILTERS);
  const [resourcePages, setResourcePages] = useState<Record<StaffAccessResourceType, number>>({
    provider: 0,
    patient: 0,
    document: 0,
  });
  const [draftProfileId, setDraftProfileId] = useState("");
  const [draftProfileValidUntil, setDraftProfileValidUntil] = useState("");
  const [draftRules, setDraftRules] = useState<StaffDirectAccessRuleInput[]>([]);
  const [initialSignature, setInitialSignature] = useState("");
  const [profileFormMode, setProfileFormMode] = useState<"create" | "clone" | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const activeEmployeeIdRef = useRef<string | null>(null);

  const buildDraftBody = useCallback(
    (): Omit<UpdateStaffUserAccessBody, "expected_access_revision"> => ({
      profile_id: draftProfileId || null,
      profile_valid_until: draftProfileId ? toIsoDateTime(draftProfileValidUntil) : null,
      direct_rules: draftRules,
    }),
    [draftProfileId, draftProfileValidUntil, draftRules],
  );

  const dirty = Boolean(access) && accessDraftSignature(buildDraftBody()) !== initialSignature;

  const applyAccessResponse = useCallback((next: StaffUserAccessResponse) => {
    const profileId = next.profile?.id ?? "";
    const profileValidUntil = toLocalDateTime(next.profile_valid_until);
    const directRules = next.direct_rules.map<StaffDirectAccessRuleInput>((rule) => ({ ...rule }));
    const signature = accessDraftSignature({
      profile_id: profileId || null,
      profile_valid_until: profileId ? toIsoDateTime(profileValidUntil) : null,
      direct_rules: directRules,
    });
    setAccess(next);
    setDraftProfileId(profileId);
    setDraftProfileValidUntil(profileValidUntil);
    setDraftRules(directRules);
    setInitialSignature(signature);
  }, []);

  const loadMainData = useCallback(async () => {
    if (!employee || employee.role === "ceo") return;
    const requestedEmployeeId = employee.id;
    setLoading(true);
    setLoadError("");
    setSaveError("");
    setConflict(false);
    try {
      const [nextAccess, nextProfiles] = await Promise.all([
        getStaffUserAccess(requestedEmployeeId),
        listStaffAccessProfiles(),
      ]);
      if (activeEmployeeIdRef.current !== requestedEmployeeId) return;
      applyAccessResponse(nextAccess);
      setProfiles(nextProfiles);
    } catch (reason) {
      if (activeEmployeeIdRef.current !== requestedEmployeeId) return;
      setLoadError(reason instanceof Error ? reason.message : copy.loadError);
    } finally {
      if (activeEmployeeIdRef.current === requestedEmployeeId) setLoading(false);
    }
  }, [applyAccessResponse, copy.loadError, employee]);

  const loadResourceCatalog = useCallback(
    async (resourceType: StaffAccessResourceType) => {
      setResources((current) => ({
        ...current,
        [resourceType]: { ...current[resourceType], loading: true, error: "" },
      }));
      try {
        const items = await (
          resourceType === "provider"
            ? listProviderAccessResources()
            : resourceType === "patient"
              ? listPatientAccessResources()
              : listDocumentAccessResources()
        );
        setResources((current) => ({
          ...current,
          [resourceType]: { items, loading: false, error: "" },
        }));
      } catch (reason) {
        setResources((current) => ({
          ...current,
          [resourceType]: {
            ...current[resourceType],
            loading: false,
            error: reason instanceof Error ? reason.message : copy.resourceLoadError,
          },
        }));
      }
    },
    [copy.resourceLoadError],
  );

  useEffect(() => {
    activeEmployeeIdRef.current = open && employee?.role !== "ceo" ? employee?.id ?? null : null;
    if (!open || !employee || employee.role === "ceo") return;
    const activeEmployeeId = employee.id;
    setAccess(null);
    setProfiles([]);
    setResources(EMPTY_RESOURCE_STATE);
    setSaving(false);
    setProfileBusy(false);
    setActiveTab("provider");
    setSearches({ provider: "", patient: "", document: "" });
    setResourceFilters({ provider: [], patient: [], document: [] });
    setResourcePages({ provider: 0, patient: 0, document: 0 });
    setDraftProfileId("");
    setDraftProfileValidUntil("");
    setDraftRules([]);
    setInitialSignature("");
    setProfileFormMode(null);
    setProfileName("");
    setProfileDescription("");
    setProfileError("");
    void loadMainData();
    void loadResourceCatalog("provider");
    void loadResourceCatalog("patient");
    void loadResourceCatalog("document");
    return () => {
      if (activeEmployeeIdRef.current === activeEmployeeId) {
        activeEmployeeIdRef.current = null;
      }
    };
  }, [employee, loadMainData, loadResourceCatalog, open]);

  const compatibleProfiles = useMemo(() => {
    if (!employee) return [];
    return profiles.filter(
      (profile) =>
        profile.roles.includes(employee.role) &&
        (profile.is_active || profile.id === access?.profile?.id),
    );
  }, [access?.profile?.id, employee, profiles]);

  const selectedProfile = profiles.find((profile) => profile.id === draftProfileId) ?? null;

  const resourceLabel = useCallback(
    (resourceType: StaffAccessResourceType, resourceId: string | null) => {
      if (!resourceId) return copy.all;
      return resources[resourceType].items.find((item) => item.id === resourceId)?.label ?? resourceId;
    },
    [copy.all, resources],
  );

  const resourcesForType = (resourceType: StaffAccessResourceType) => {
    const state = resources[resourceType];
    const byId = new Map(state.items.map((item) => [item.id, item]));
    for (const rule of draftRules) {
      if (
        rule.resource_type === resourceType &&
        rule.scope_type === "record" &&
        rule.resource_id &&
        !byId.has(rule.resource_id)
      ) {
        byId.set(rule.resource_id, {
          id: rule.resource_id,
          label: rule.resource_id,
          description: copy.unavailable,
          status: "unknown",
        });
      }
    }
    const needle = searches[resourceType].trim().toLocaleLowerCase();
    return Array.from(byId.values()).filter((item) =>
      !needle || `${item.label} ${item.description}`.toLocaleLowerCase().includes(needle),
    );
  };

  const globalDirectRules = draftRules.filter((rule) => rule.scope_type === "all");
  const targetRole = access?.user.role ?? employee?.role ?? "";
  const targetCanUseMedicalDocuments =
    Boolean(access?.ceo_full_access) || canRoleUseMedicalDocuments(targetRole);

  const save = async () => {
    if (!employee || !access || !dirty || saving) return;
    const requestedEmployeeId = employee.id;
    setSaving(true);
    setSaveError("");
    setConflict(false);
    try {
      const next = await updateStaffUserAccess(requestedEmployeeId, {
        expected_access_revision: access.access_revision,
        ...buildDraftBody(),
      });
      if (activeEmployeeIdRef.current !== requestedEmployeeId) return;
      applyAccessResponse(next);
      onClose();
    } catch (reason) {
      if (activeEmployeeIdRef.current !== requestedEmployeeId) return;
      if (reason instanceof ApiRequestError && reason.status === 409) {
        setConflict(true);
        setSaveError(copy.conflict);
      } else {
        setSaveError(reason instanceof Error ? reason.message : copy.saveError);
      }
    } finally {
      if (activeEmployeeIdRef.current === requestedEmployeeId) setSaving(false);
    }
  };

  const openProfileForm = (mode: "create" | "clone") => {
    setProfileFormMode(mode);
    setProfileName(mode === "clone" && selectedProfile ? `${selectedProfile.name} — copy` : "");
    setProfileDescription(mode === "clone" ? selectedProfile?.description ?? "" : "");
    setProfileError("");
  };

  const submitProfileForm = async () => {
    if (!employee || !profileName.trim() || profileBusy) return;
    const requestedEmployeeId = employee.id;
    const requestedEmployeeRole = employee.role;
    setProfileBusy(true);
    setProfileError("");
    try {
      const sourceProfile = profileFormMode === "clone" ? selectedProfile : null;
      const creatingFromDirectRules = !sourceProfile;
      const created =
        sourceProfile
          ? await cloneStaffAccessProfile(sourceProfile.id, {
              name: profileName.trim(),
              description: profileDescription.trim() || null,
            })
          : await createStaffAccessProfile({
              name: profileName.trim(),
              description: profileDescription.trim() || null,
              roles: [requestedEmployeeRole],
              rules: profileRulesFromDirectRules(draftRules),
            });
      if (activeEmployeeIdRef.current !== requestedEmployeeId) return;
      setProfiles((current) => [created, ...current.filter((profile) => profile.id !== created.id)]);
      setDraftProfileId(created.id);
      setDraftProfileValidUntil("");
      if (creatingFromDirectRules) setDraftRules([]);
      setProfileFormMode(null);
      setProfileName("");
      setProfileDescription("");
    } catch (reason) {
      if (activeEmployeeIdRef.current !== requestedEmployeeId) return;
      setProfileError(reason instanceof Error ? reason.message : copy.profileCreateError);
    } finally {
      if (activeEmployeeIdRef.current === requestedEmployeeId) setProfileBusy(false);
    }
  };

  const removeGlobalRule = (rule: StaffDirectAccessRuleInput) => {
    setDraftRules((current) => current.filter((candidate) => candidate !== rule));
  };

  const renderResourceTab = (resourceType: StaffAccessResourceType) => {
    const state = resources[resourceType];
    const Icon = RESOURCE_ICONS[resourceType];
    const capabilities = STAFF_ACCESS_CAPABILITIES[resourceType];
    const resourceTitle =
      resourceType === "provider"
        ? copy.providers
        : resourceType === "patient"
          ? copy.patients
          : copy.documents;
    const catalogResources = resourcesForType(resourceType);
    const filterColumns: ColumnDef<StaffAccessResource>[] = [
      {
        id: "resource",
        label: resourceTitle,
        accessor: (item) => `${item.label} ${item.description}`.trim(),
        filterType: "text",
      },
      ...(resourceType === "provider" || resourceType === "document"
        ? [{
            id: "resource_type",
            label: copy.resourceType,
            accessor: (item: StaffAccessResource) => item.medicalKind ?? "",
            filterType: "enum" as const,
            filterOptions: [
              { value: "medical", label: t.providers_type_medical },
              { value: "non_medical", label: t.providers_type_non_medical },
            ],
          }]
        : []),
      {
        id: "resource_status",
        label: copy.resourceStatus,
        accessor: (item) => item.status,
        filterType: "enum",
        filterOptions: Array.from(new Set(catalogResources.map((item) => item.status)))
          .sort()
          .map((status) => ({ value: status, label: resourceStatusLabel(status) })),
      },
    ];
    const filterAccessors = Object.fromEntries(
      filterColumns.map((column) => [column.id, column.accessor]),
    );
    const displayedResources = applyFilters(
      catalogResources,
      resourceFilters[resourceType],
      { accessors: filterAccessors },
    );
    const totalPages = Math.max(1, Math.ceil(displayedResources.length / RESOURCE_PAGE_SIZE));
    const pageIndex = Math.min(resourcePages[resourceType], totalPages - 1);
    const pagedResources = displayedResources.slice(
      pageIndex * RESOURCE_PAGE_SIZE,
      (pageIndex + 1) * RESOURCE_PAGE_SIZE,
    );

    return (
      <TabsContent value={resourceType} className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searches[resourceType]}
              onChange={(event) => {
                setSearches((current) => ({ ...current, [resourceType]: event.target.value }));
                setResourcePages((current) => ({ ...current, [resourceType]: 0 }));
              }}
              placeholder={copy.search}
              className="h-9 bg-field pl-9"
            />
          </div>
          <FilterBuilder
            columns={filterColumns}
            rows={catalogResources}
            filters={resourceFilters[resourceType]}
            onChange={(filters) => {
              setResourceFilters((current) => ({ ...current, [resourceType]: filters }));
              setResourcePages((current) => ({ ...current, [resourceType]: 0 }));
            }}
            className="shrink-0"
          />
        </div>

        {state.error ? (
          <Banner tone="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{state.error}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadResourceCatalog(resourceType)}
              >
                <RefreshCw className="size-3.5" />
                {copy.retry}
              </Button>
            </div>
          </Banner>
        ) : null}
        {state.loading ? <TabLoader /> : null}

        {!state.loading && !state.error ? (
          <div className="space-y-2">
            <div className="max-h-[46vh] overflow-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="min-w-[280px] px-3 py-2.5 text-xs font-semibold text-foreground">
                    {resourceTitle}
                  </th>
                  {capabilities.map((capability) => (
                    <th
                      key={capability}
                      className="min-w-[110px] px-2 py-2.5 text-center text-xs font-semibold text-foreground"
                    >
                      {capabilityLabel(capability)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-primary/[0.035]">
                  <td className="px-3 py-3 align-middle">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{copy.all}</p>
                        <p className="text-xs text-muted-foreground">{copy.allScopeHint}</p>
                      </div>
                    </div>
                  </td>
                  {capabilities.map((capability) => {
                    const direct = directAllRuleFor(draftRules, resourceType, capability);
                    const inherited = effectiveProfileAllRule(
                      selectedProfile?.rules ?? [],
                      resourceType,
                      capability,
                    );
                    const checked = (direct?.effect ?? inherited?.effect) === "allow";
                    const medicalAllLocked =
                      resourceType === "document" && !targetCanUseMedicalDocuments;
                    return (
                      <td key={capability} className="px-2 py-3 text-center align-middle">
                        <div className="flex flex-col items-center gap-1">
                          <label
                            className={cn(
                              "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-background",
                              checked && "border-primary/40 bg-primary/5",
                              medicalAllLocked && "cursor-not-allowed bg-muted/60",
                            )}
                            title={
                              medicalAllLocked
                                ? copy.medicalLocked
                                : `${copy.all}: ${capabilityLabel(capability)}`
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={saving || medicalAllLocked}
                              onChange={(event) =>
                                setDraftRules((current) =>
                                  setDirectAllRuleEnabled(
                                    current,
                                    resourceType,
                                    capability,
                                    event.target.checked,
                                    inherited?.effect,
                                  ),
                                )
                              }
                              className="size-3.5 accent-[var(--primary)]"
                            />
                          </label>
                          {inherited && !direct ? (
                            <span className="rounded bg-sky-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-700">
                              {copy.inheritedRule}
                            </span>
                          ) : null}
                          {direct?.effect === "deny" ? (
                            <span className="rounded bg-rose-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-700">
                              {copy.directDeny}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {displayedResources.length === 0 ? (
                  <tr>
                    <td
                      colSpan={capabilities.length + 1}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      {copy.empty}
                    </td>
                  </tr>
                ) : null}

                {pagedResources.map((item) => {
                  const medicalLocked =
                    resourceType === "document" &&
                    item.isMedical &&
                    !targetCanUseMedicalDocuments;
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "transition-colors hover:bg-muted/25",
                        medicalLocked && "bg-muted/35 text-muted-foreground",
                      )}
                    >
                      <td className="px-3 py-3 align-middle">
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
                            {medicalLocked ? (
                              <LockKeyhole className="size-3.5" />
                            ) : (
                              <Icon className="size-3.5" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-medium text-foreground">
                                {item.label}
                              </p>
                              {item.medicalKind ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "shrink-0 rounded-full text-[10px]",
                                    item.medicalKind === "medical"
                                      ? "border-sky-200 bg-sky-50 text-sky-700"
                                      : "border-violet-200 bg-violet-50 text-violet-700",
                                  )}
                                >
                                  {item.medicalKind === "medical"
                                    ? t.providers_type_medical
                                    : t.providers_type_non_medical}
                                </Badge>
                              ) : null}
                              <Badge
                                variant="outline"
                                className={cn(
                                  "shrink-0 rounded-full text-[10px]",
                                  item.status === "active" &&
                                    "border-emerald-200 bg-emerald-50 text-emerald-700",
                                  (item.status === "inactive" || item.status === "deleted") &&
                                    "border-rose-200 bg-rose-50 text-rose-700",
                                  (item.status === "draft" || item.status === "prospective") &&
                                    "border-amber-200 bg-amber-50 text-amber-700",
                                )}
                              >
                                {resourceStatusLabel(item.status)}
                              </Badge>
                            </div>
                            {item.description ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                            {medicalLocked ? (
                              <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                                <AlertTriangle className="size-3 shrink-0" />
                                {copy.medicalLocked}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      {capabilities.map((capability) => {
                        const direct = directRuleFor(
                          draftRules,
                          resourceType,
                          item.id,
                          capability,
                        );
                        const directAll = directAllRuleFor(
                          draftRules,
                          resourceType,
                          capability,
                        );
                        const inherited = effectiveProfileRule(
                          selectedProfile?.rules ?? [],
                          resourceType,
                          item.id,
                          capability,
                        );
                        const inheritedEffect = directAll?.effect ?? inherited?.effect;
                        const checked =
                          !medicalLocked && (direct?.effect ?? inheritedEffect) === "allow";
                        return (
                          <td key={capability} className="px-2 py-3 text-center align-middle">
                            <div className="flex flex-col items-center gap-1">
                              <label
                                className={cn(
                                  "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-background",
                                  checked && "border-primary/40 bg-primary/5",
                                  medicalLocked && "cursor-not-allowed bg-muted/60",
                                )}
                                title={`${item.label}: ${capabilityLabel(capability)}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={medicalLocked || saving}
                                  onChange={(event) =>
                                    setDraftRules((current) =>
                                      setDirectRuleEnabled(
                                        current,
                                        resourceType,
                                        item.id,
                                        capability,
                                        event.target.checked,
                                        inheritedEffect,
                                      ),
                                    )
                                  }
                                  className="size-3.5 accent-[var(--primary)]"
                                />
                              </label>
                              {inherited && !direct && !directAll ? (
                                <span className="rounded bg-sky-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-700">
                                  {copy.inheritedRule}
                                </span>
                              ) : null}
                              {direct?.effect === "deny" ? (
                                <span className="rounded bg-rose-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-700">
                                  {copy.directDeny}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-xs tabular-nums text-muted-foreground">
                {copy.resourceCount
                  .replace("{shown}", String(displayedResources.length))
                  .replace("{total}", String(catalogResources.length))}
              </p>
              {totalPages > 1 ? (
                <DataTablePager
                  pageIndex={pageIndex}
                  pageSize={RESOURCE_PAGE_SIZE}
                  totalPages={totalPages}
                  totalRows={displayedResources.length}
                  previousLabel={t.pagination_previous}
                  nextLabel={t.pagination_next}
                  onPageChange={(nextPage) =>
                    setResourcePages((current) => ({
                      ...current,
                      [resourceType]: nextPage,
                    }))
                  }
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </TabsContent>
    );
  };

  return (
    <Sheet open={open} dirty={dirty} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="right"
        className="!inset-[10px] !h-[calc(100dvh-20px)] !w-[calc(100vw-20px)] !max-w-none !rounded-xl !border !border-border !p-0 !shadow-xl"
      >
        <AdminSheetScaffold
          title={`${copy.title} — ${employee?.name ?? ""}`}
          footer={(
            <SheetFormFooter
              cancelLabel={t.common_cancel}
              submitLabel={copy.save}
              submittingLabel={copy.saving}
              submitting={saving}
              submitDisabled={!dirty || loading || Boolean(loadError) || conflict}
              onCancel={onClose}
              onSubmit={() => void save()}
              error={saveError || undefined}
            />
          )}
        >
          {loading ? <TabLoader /> : null}
          {loadError ? (
            <Banner tone="error">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{loadError}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void loadMainData()}>
                  <RefreshCw className="size-3.5" />
                  {copy.retry}
                </Button>
              </div>
            </Banner>
          ) : null}
          {conflict ? (
            <Banner tone="warning">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{copy.conflict}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void loadMainData()}>
                  <RefreshCw className="size-3.5" />
                  {copy.retry}
                </Button>
              </div>
            </Banner>
          ) : null}

          {!loading && access ? (
            <>
              {access.ceo_full_access ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="size-4" />
                    {copy.fullAccess}
                  </span>
                </div>
              ) : null}

              <section className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <AdminSectionTitle>{copy.profile}</AdminSectionTitle>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openProfileForm("create")}>
                      <Plus className="size-3.5" />
                      {copy.create}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!selectedProfile}
                      onClick={() => openProfileForm("clone")}
                    >
                      <Copy className="size-3.5" />
                      {copy.clone}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{copy.profile}</Label>
                    <SelectField
                      value={draftProfileId || "__none__"}
                      onValueChange={(value) => {
                        setDraftProfileId(value === "__none__" ? "" : value);
                        if (value === "__none__") setDraftProfileValidUntil("");
                      }}
                      options={[
                        { value: "__none__", label: copy.noProfile },
                        ...compatibleProfiles.map((profile) => ({
                          value: profile.id,
                          label: `${profile.name}${profile.is_active ? "" : ` (${copy.inactive})`} · ${profile.assigned_user_count} ${copy.assigned}`,
                        })),
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="staff-profile-valid-until">{copy.validUntil}</Label>
                    <Input
                      id="staff-profile-valid-until"
                      type="datetime-local"
                      value={draftProfileValidUntil}
                      disabled={!draftProfileId}
                      onChange={(event) => setDraftProfileValidUntil(event.target.value)}
                      className="h-9 bg-field"
                    />
                  </div>
                </div>

                {profileFormMode ? (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/25 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="staff-access-profile-name">{copy.newProfileName}</Label>
                        <Input
                          id="staff-access-profile-name"
                          value={profileName}
                          onChange={(event) => setProfileName(event.target.value)}
                          className="h-9 bg-field"
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="staff-access-profile-description">{copy.description}</Label>
                        <Input
                          id="staff-access-profile-description"
                          value={profileDescription}
                          onChange={(event) => setProfileDescription(event.target.value)}
                          className="h-9 bg-field"
                        />
                      </div>
                    </div>
                    {profileError ? <Banner tone="error">{profileError}</Banner> : null}
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setProfileFormMode(null)}>
                        {t.common_cancel}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!profileName.trim() || profileBusy}
                        onClick={() => void submitProfileForm()}
                      >
                        {profileBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                        {profileFormMode === "clone" ? copy.clone : copy.createFromDirect}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
                <AdminSectionTitle>{copy.inherited}</AdminSectionTitle>
                {selectedProfile?.rules.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProfile.rules.map((rule, index) => (
                      <Badge
                        key={`${rule.resource_type}:${rule.resource_id}:${rule.capability}:${index}`}
                        variant={rule.effect === "deny" ? "destructive" : "outline"}
                        className="max-w-full"
                      >
                        <span className="truncate">
                          {ruleLabel(rule, resourceLabel, capabilityLabel, copy.all)}
                        </span>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{copy.noInherited}</p>
                )}
              </section>

              {globalDirectRules.length ? (
                <section className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
                  <AdminSectionTitle>{copy.globalRules}</AdminSectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {globalDirectRules.map((rule, index) => (
                      <span
                        key={`${rule.resource_type}:${rule.capability}:${index}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 text-xs"
                      >
                        {ruleLabel(rule, resourceLabel, capabilityLabel, copy.all)}
                        <button
                          type="button"
                          className="rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => removeGlobalRule(rule)}
                          aria-label={copy.remove}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
                <AdminSectionTitle>{copy.personal}</AdminSectionTitle>
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => setActiveTab(value as StaffAccessResourceType)}
                >
                  <TabsList className="w-full justify-start overflow-x-auto" variant="line">
                    <TabsTrigger value="provider">{copy.providers}</TabsTrigger>
                    <TabsTrigger value="patient">{copy.patients}</TabsTrigger>
                    <TabsTrigger value="document">{copy.documents}</TabsTrigger>
                  </TabsList>
                  {activeTab === "provider" ? renderResourceTab("provider") : null}
                  {activeTab === "patient" ? renderResourceTab("patient") : null}
                  {activeTab === "document" ? renderResourceTab("document") : null}
                </Tabs>
              </section>
            </>
          ) : null}
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}
