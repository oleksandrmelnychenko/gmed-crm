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

const EMPTY_RESOURCE_STATE: ResourceStateMap = {
  provider: { items: [], loading: false, error: "" },
  patient: { items: [], loading: false, error: "" },
  document: { items: [], loading: false, error: "" },
};

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
  const { lang, t } = useLang();
  const isGerman = lang === "de";
  const copy = useMemo(
    () =>
      isGerman
        ? {
            title: "Zugriffe",
            fullAccess: "Vollständiger Systemzugriff",
            loadError: "Zugriffe konnten nicht geladen werden.",
            resourceLoadError: "Katalog konnte nicht geladen werden.",
            retry: "Erneut versuchen",
            profile: "Wiederverwendbares Profil",
            noProfile: "Ohne Profil",
            profileHint: "Das Profil wird vererbt; persönliche Regeln bleiben separat.",
            validUntil: "Profil gültig bis",
            inherited: "Vom Profil geerbt",
            noInherited: "Das gewählte Profil enthält keine Regeln.",
            personal: "Persönliche Regeln",
            providers: "Anbieter",
            patients: "Patienten",
            documents: "Dokumente",
            search: "Ressource suchen",
            empty: "Keine Ressourcen gefunden.",
            medicalLocked: "Medizinisches Dokument: für diese Rolle systemweit gesperrt.",
            directDeny: "Direkt verboten",
            inheritedRule: "Profil",
            globalRules: "Globale persönliche Regeln",
            allScopeHint: "Persönliche Regel für alle verfügbaren Einträge; medizinische Systemgrenzen bleiben aktiv.",
            remove: "Entfernen",
            create: "Profil erstellen",
            clone: "Profil duplizieren",
            newProfileName: "Profilname",
            description: "Beschreibung (optional)",
            createFromDirect: "Aus persönlichen Regeln erstellen",
            creating: "Wird erstellt…",
            profileCreateError: "Profil konnte nicht erstellt werden.",
            conflict: "Die Zugriffe wurden in einer anderen Sitzung geändert. Laden Sie die aktuellen Daten neu und wiederholen Sie die Änderungen.",
            saveError: "Zugriffe konnten nicht gespeichert werden.",
            save: "Zugriffe speichern",
            saving: "Wird gespeichert…",
            all: "Alle Einträge",
            inactive: "Inaktiv",
            assigned: "zugewiesen",
            unavailable: "Nicht im aktuellen Katalog verfügbar",
          }
        : {
            title: "Доступи",
            fullAccess: "Повний системний доступ",
            loadError: "Не вдалося завантажити доступи.",
            resourceLoadError: "Не вдалося завантажити каталог.",
            retry: "Спробувати ще",
            profile: "Багаторазовий профіль",
            noProfile: "Без профілю",
            profileHint: "Правила профілю успадковуються, а персональні правила зберігаються окремо.",
            validUntil: "Профіль діє до",
            inherited: "Успадковано з профілю",
            noInherited: "У вибраному профілі ще немає правил.",
            personal: "Персональні правила",
            providers: "Провайдери",
            patients: "Пацієнти",
            documents: "Документи",
            search: "Знайти ресурс",
            empty: "Ресурсів не знайдено.",
            medicalLocked: "Медичний документ: для цієї ролі доступ заблокований системно.",
            directDeny: "Пряма заборона",
            inheritedRule: "Профіль",
            globalRules: "Глобальні персональні правила",
            allScopeHint: "Персональне правило для всіх доступних записів; системні медичні обмеження залишаються чинними.",
            remove: "Видалити",
            create: "Створити профіль",
            clone: "Дублювати профіль",
            newProfileName: "Назва профілю",
            description: "Опис (необов'язково)",
            createFromDirect: "Створити з персональних правил",
            creating: "Створення…",
            profileCreateError: "Не вдалося створити профіль.",
            conflict: "Доступи змінили в іншій сесії. Завантажте актуальні дані та повторіть зміни.",
            saveError: "Не вдалося зберегти доступи.",
            save: "Зберегти доступи",
            saving: "Збереження…",
            all: "Усі записи",
            inactive: "Неактивний",
            assigned: "призначено",
            unavailable: "Недоступний у поточному каталозі",
          },
    [isGerman],
  );

  const capabilityLabel = useCallback(
    (capability: StaffAccessCapability) => {
      const labels = isGerman
        ? { view: "Ansehen", use: "Verwenden", edit: "Bearbeiten", download: "Download", upload: "Upload" }
        : { view: "Перегляд", use: "Використання", edit: "Редагування", download: "Завантаження", upload: "Вивантаження" };
      return labels[capability];
    },
    [isGerman],
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
        });
      }
    }
    const needle = searches[resourceType].trim().toLocaleLowerCase();
    return Array.from(byId.values()).filter((item) =>
      !needle || `${item.label} ${item.description}`.toLocaleLowerCase().includes(needle),
    );
  };

  const globalDirectRules = draftRules.filter((rule) => rule.scope_type === "all");
  const targetCanUseMedicalDocuments = employee
    ? canRoleUseMedicalDocuments(employee.role)
    : false;

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
    const displayedResources = resourcesForType(resourceType);

    return (
      <TabsContent value={resourceType} className="space-y-3 pt-2">
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">{copy.all}</p>
            <p className="text-xs text-muted-foreground">{copy.allScopeHint}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {capabilities.map((capability) => {
              const direct = directAllRuleFor(draftRules, resourceType, capability);
              const inherited = effectiveProfileAllRule(
                selectedProfile?.rules ?? [],
                resourceType,
                capability,
              );
              const checked = (direct?.effect ?? inherited?.effect) === "allow";
              return (
                <label
                  key={capability}
                  className={cn(
                    "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs",
                    checked && "border-primary/40 bg-primary/5 text-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving}
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
                  <span>{capabilityLabel(capability)}</span>
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
                </label>
              );
            })}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searches[resourceType]}
            onChange={(event) =>
              setSearches((current) => ({ ...current, [resourceType]: event.target.value }))
            }
            placeholder={copy.search}
            className="h-9 bg-field pl-9"
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
          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {displayedResources.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {copy.empty}
              </div>
            ) : null}
            {displayedResources.map((item) => {
              const medicalLocked =
                resourceType === "document" &&
                item.isMedical &&
                !targetCanUseMedicalDocuments;
              return (
                <article
                  key={item.id}
                  className={cn(
                    "rounded-xl border border-border bg-card/70 p-3",
                    medicalLocked && "bg-muted/40 opacity-75",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
                        {medicalLocked ? <LockKeyhole className="size-3.5" /> : <Icon className="size-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                        {item.description ? (
                          <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                        ) : null}
                      </div>
                    </div>
                    {item.isMedical ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Medical
                      </Badge>
                    ) : null}
                  </div>

                  {medicalLocked ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {copy.medicalLocked}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {capabilities.map((capability) => {
                      const direct = directRuleFor(draftRules, resourceType, item.id, capability);
                      const directAll = directAllRuleFor(draftRules, resourceType, capability);
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
                        <label
                          key={capability}
                          className={cn(
                            "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs",
                            checked && "border-primary/40 bg-primary/5 text-foreground",
                            medicalLocked && "cursor-not-allowed",
                          )}
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
                          <span>{capabilityLabel(capability)}</span>
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
                        </label>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </TabsContent>
    );
  };

  return (
    <Sheet open={open} dirty={dirty} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="right"
        className="w-full border-l border-border p-0 sm:max-w-[min(920px,78vw)]"
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
                    <p className="text-xs text-muted-foreground">{copy.profileHint}</p>
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
