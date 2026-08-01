import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BriefcaseMedical,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Banner } from "@/components/record-workspace/recipes";
import {
  AdminSheetScaffold,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { PageHeader, checkboxClass, inputClass, textareaClass } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  createSpecialization,
  deleteSpecialization,
  fetchSpecializationsForAdmin,
  updateSpecialization,
} from "@/pages/providers/data/provider-api";
import { providerPermissions } from "@/pages/providers/model/list-model";
import type { SpecializationItem } from "@/pages/providers/model/types";
import {
  createSpecializationWorkType,
  deleteSpecializationWorkType,
  fetchProvidersBySpecializations,
  fetchSpecializationWorkTypes,
  updateSpecializationWorkType,
  type SpecializationLinkedProvider,
  type SpecializationWorkType,
  type WorkTypeDescription,
  type WorkTypeUpsertPayload,
} from "./data/specialization-work-types-api";

type Translate = (ru: string, de: string) => string;

type SpecializationSheetState = {
  item?: SpecializationItem;
};

type WorkTypeSheetState = {
  item?: SpecializationWorkType;
};

type SpecializationDraft = {
  nameDe: string;
  nameRu: string;
  nameEn: string;
  nameEs: string;
  sortOrder: string;
  isActive: boolean;
};

type DescriptionDraft = {
  key: string;
  id?: string;
  languageCode: string;
  body: string;
  sortOrder: number;
  isActive: boolean;
};

type WorkTypeDraft = {
  code: string;
  specializationIds: string[];
  nameDe: string;
  nameRu: string;
  nameEn: string;
  nameEs: string;
  minPriceEur: string;
  maxPriceEur: string;
  durationHours: string;
  sortOrder: string;
  isActive: boolean;
  descriptions: DescriptionDraft[];
};

let descriptionKeySequence = 0;

function nextDescriptionKey() {
  descriptionKeySequence += 1;
  return `description-${descriptionKeySequence}`;
}

function specializationName(item: SpecializationItem, lang: Lang) {
  if (lang === "de") {
    return (
      item.name_de?.trim() ||
      item.name_en?.trim() ||
      item.name_ru?.trim() ||
      item.name_es?.trim() ||
      item.code
    );
  }
  return (
    item.name_ru?.trim() ||
    item.name_de?.trim() ||
    item.name_en?.trim() ||
    item.name_es?.trim() ||
    item.code
  );
}

function workTypeName(item: SpecializationWorkType, lang: Lang) {
  return lang === "de"
    ? item.name_de.trim() ||
        item.name_en.trim() ||
        item.name_ru.trim() ||
        item.name_es.trim() ||
        item.code
    : item.name_ru.trim() ||
        item.name_de.trim() ||
        item.name_en.trim() ||
        item.name_es.trim() ||
        item.code;
}

function workTypeDescription(item: SpecializationWorkType, lang: Lang) {
  const exactLanguage = item.descriptions.find(
    (description) =>
      description.is_active &&
      description.language_code.toLowerCase().split("-")[0] === lang,
  );
  return (
    exactLanguage?.body.trim() ||
    item.descriptions.find((description) => description.is_active)?.body.trim() ||
    item.descriptions[0]?.body.trim() ||
    ""
  );
}

function compareCatalogItems<T extends { sort_order: number; code: string }>(
  left: T,
  right: T,
) {
  return left.sort_order - right.sort_order || left.code.localeCompare(right.code);
}

function formatPriceRange(item: SpecializationWorkType, lang: Lang) {
  const formatter = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatter.format(item.min_price_eur)} - ${formatter.format(item.max_price_eur)} EUR`;
}

function genericError(error: unknown, tx: Translate) {
  return error instanceof Error
    ? error.message
    : tx("Не удалось выполнить действие.", "Aktion konnte nicht ausgeführt werden.");
}

function activeBadge(active: boolean, tx: Translate) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px]",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-zinc-200 bg-zinc-50 text-zinc-600",
      )}
    >
      {active ? tx("Активно", "Aktiv") : tx("Неактивно", "Inaktiv")}
    </Badge>
  );
}

export function SpecializationsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const tx: Translate = (ru, de) => (lang === "ru" ? ru : de);
  const canManage = providerPermissions(user?.role).canManageRegistry;
  const [specializations, setSpecializations] = useState<SpecializationItem[]>([]);
  const [specializationsLoading, setSpecializationsLoading] = useState(true);
  const [specializationsError, setSpecializationsError] = useState("");
  const [selectedSpecializationId, setSelectedSpecializationId] = useState("");
  const [search, setSearch] = useState("");
  const [workTypes, setWorkTypes] = useState<SpecializationWorkType[]>([]);
  const [workTypesLoading, setWorkTypesLoading] = useState(false);
  const [workTypesError, setWorkTypesError] = useState("");
  const [reloadWorkTypesToken, setReloadWorkTypesToken] = useState(0);
  const [busyAction, setBusyAction] = useState("");
  const [specializationSheet, setSpecializationSheet] =
    useState<SpecializationSheetState | null>(null);
  const [workTypeSheet, setWorkTypeSheet] = useState<WorkTypeSheetState | null>(null);

  async function loadSpecializations(preferredId?: string) {
    setSpecializationsLoading(true);
    setSpecializationsError("");
    try {
      const items = (await fetchSpecializationsForAdmin()).toSorted(compareCatalogItems);
      setSpecializations(items);
      setSelectedSpecializationId((current) => {
        const nextPreferred = preferredId || current;
        return items.some((item) => item.id === nextPreferred)
          ? nextPreferred
          : items[0]?.id ?? "";
      });
    } catch (error) {
      setSpecializationsError(genericError(error, tx));
    } finally {
      setSpecializationsLoading(false);
    }
  }

  useEffect(() => {
    void loadSpecializations();
    // The initial catalog request is intentionally tied only to page mount.
  }, []);

  useEffect(() => {
    if (!selectedSpecializationId) {
      setWorkTypes([]);
      setWorkTypesError("");
      return;
    }

    let active = true;
    setWorkTypesLoading(true);
    setWorkTypesError("");
    void fetchSpecializationWorkTypes(selectedSpecializationId, true)
      .then((items) => {
        if (active) {
          setWorkTypes(items.toSorted(compareCatalogItems));
        }
      })
      .catch((error) => {
        if (active) {
          setWorkTypes([]);
          setWorkTypesError(genericError(error, tx));
        }
      })
      .finally(() => {
        if (active) {
          setWorkTypesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [reloadWorkTypesToken, selectedSpecializationId, lang]);

  const filteredSpecializations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) {
      return specializations;
    }
    return specializations.filter((item) =>
      [
        item.code,
        item.name_en,
        item.name_de ?? "",
        item.name_ru ?? "",
        item.name_es ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    );
  }, [search, specializations]);

  const selectedSpecialization =
    specializations.find((item) => item.id === selectedSpecializationId) ?? null;

  async function saveSpecialization(
    item: SpecializationItem | undefined,
    payload: Record<string, unknown>,
  ) {
    const action = item ? `specialization-update-${item.id}` : "specialization-create";
    setBusyAction(action);
    try {
      if (item) {
        await updateSpecialization(item.id, payload);
        await loadSpecializations(item.id);
      } else {
        const created = await createSpecialization(payload);
        await loadSpecializations(created.id);
      }
      setSpecializationSheet(null);
      toast.success(
        item
          ? tx("Специализация обновлена.", "Spezialisierung aktualisiert.")
          : tx("Специализация создана.", "Spezialisierung erstellt."),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function removeSpecialization(item: SpecializationItem) {
    if (
      !window.confirm(
        tx(
          `Удалить специализацию «${specializationName(item, lang)}»?`,
          `Spezialisierung „${specializationName(item, lang)}“ löschen?`,
        ),
      )
    ) {
      return;
    }

    setBusyAction(`specialization-delete-${item.id}`);
    try {
      await deleteSpecialization(item.id);
      await loadSpecializations();
      toast.success(tx("Специализация удалена.", "Spezialisierung gelöscht."));
    } catch (error) {
      toast.error(genericError(error, tx));
    } finally {
      setBusyAction("");
    }
  }

  async function saveWorkType(
    item: SpecializationWorkType | undefined,
    payload: WorkTypeUpsertPayload,
  ) {
    if (!selectedSpecializationId) {
      return;
    }
    const action = item ? `work-type-update-${item.id}` : "work-type-create";
    setBusyAction(action);
    try {
      if (item) {
        await updateSpecializationWorkType(
          selectedSpecializationId,
          item.id,
          payload,
        );
      } else {
        await createSpecializationWorkType(selectedSpecializationId, payload);
      }
      setWorkTypeSheet(null);
      const nextSpecializationIds =
        payload.specialization_ids ?? [selectedSpecializationId];
      const nextSelectedSpecializationId = nextSpecializationIds.includes(
        selectedSpecializationId,
      )
        ? selectedSpecializationId
        : nextSpecializationIds[0] ?? selectedSpecializationId;
      await loadSpecializations(nextSelectedSpecializationId);
      setReloadWorkTypesToken((current) => current + 1);
      toast.success(
        item
          ? tx("Вид работы обновлён.", "Leistungsart aktualisiert.")
          : tx("Вид работы создан.", "Leistungsart erstellt."),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function removeWorkType(item: SpecializationWorkType) {
    if (
      !selectedSpecializationId ||
      !window.confirm(
        tx(
          `Удалить вид работы «${workTypeName(item, lang)}»?`,
          `Leistungsart „${workTypeName(item, lang)}“ löschen?`,
        ),
      )
    ) {
      return;
    }

    setBusyAction(`work-type-delete-${item.id}`);
    try {
      await deleteSpecializationWorkType(selectedSpecializationId, item.id);
      await loadSpecializations(selectedSpecializationId);
      setReloadWorkTypesToken((current) => current + 1);
      toast.success(tx("Вид работы удалён.", "Leistungsart gelöscht."));
    } catch (error) {
      toast.error(genericError(error, tx));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-4 lg:space-y-0">
      <PageHeader
        title={tx("Специализации", "Spezialisierungen")}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadSpecializations(selectedSpecializationId)}
              disabled={specializationsLoading}
            >
              <RefreshCw
                className={cn("size-3.5", specializationsLoading && "animate-spin")}
              />
              {tx("Обновить", "Aktualisieren")}
            </Button>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setSpecializationSheet({})}
              >
                <Plus className="size-3.5" />
                {tx("Специализация", "Spezialisierung")}
              </Button>
            ) : null}
          </>
        }
      />

      {specializationsError ? (
        <Banner tone="error" withIcon>
          {specializationsError}
        </Banner>
      ) : null}

      <div className="grid min-h-[620px] overflow-hidden rounded-lg border border-border/70 bg-card lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-border/70 lg:border-r lg:border-b-0">
          <div className="border-b border-border/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 rounded-lg bg-background pl-9"
                placeholder={tx("Поиск специализации", "Spezialisierung suchen")}
                aria-label={tx("Поиск специализации", "Spezialisierung suchen")}
              />
            </div>
          </div>

          <div className="min-h-0 max-h-[280px] flex-1 overflow-y-auto overscroll-contain p-2 lg:max-h-none">
            {specializationsLoading ? (
              <div className="flex min-h-36 items-center justify-center text-muted-foreground">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : filteredSpecializations.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                {tx("Специализации не найдены.", "Keine Spezialisierungen gefunden.")}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredSpecializations.map((item) => {
                  const selected = item.id === selectedSpecializationId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedSpecializationId(item.id)}
                      className={cn(
                        "relative flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "bg-muted/70 text-foreground before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                          : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
                      )}
                    >
                      <BriefcaseMedical className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {specializationName(item, lang)}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5">
                          <span className="inline-flex max-w-full items-center truncate rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-sky-700">
                            {item.code}
                          </span>
                          <span
                            className="inline-flex shrink-0 items-center rounded-full border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-foreground"
                            title={tx("Количество видов работ", "Anzahl der Leistungsarten")}
                          >
                            {item.work_type_count ?? 0}
                          </span>
                        </span>
                      </span>
                      {!item.is_active ? (
                        <span
                          className="mt-1 size-2 shrink-0 rounded-full bg-zinc-400"
                          title={tx("Неактивно", "Inaktiv")}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
          {!selectedSpecialization ? (
            <div className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {tx(
                "Выберите специализацию.",
                "Wählen Sie eine Spezialisierung aus.",
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {specializationName(selectedSpecialization, lang)}
                    </h2>
                    {activeBadge(selectedSpecialization.is_active, tx)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    DE: {selectedSpecialization.name_de || "-"} · RU:{" "}
                    {selectedSpecialization.name_ru || "-"} · EN:{" "}
                    {selectedSpecialization.name_en || "-"} · ES:{" "}
                    {selectedSpecialization.name_es || "-"} ·{" "}
                    {tx("Порядок отображения", "Anzeigereihenfolge")}:{" "}
                    {selectedSpecialization.sort_order}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title={tx("Редактировать", "Bearbeiten")}
                      aria-label={tx("Редактировать специализацию", "Spezialisierung bearbeiten")}
                      onClick={() =>
                        setSpecializationSheet({ item: selectedSpecialization })
                      }
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      title={tx("Удалить", "Löschen")}
                      aria-label={tx("Удалить специализацию", "Spezialisierung löschen")}
                      disabled={
                        busyAction ===
                        `specialization-delete-${selectedSpecialization.id}`
                      }
                      onClick={() => void removeSpecialization(selectedSpecialization)}
                    >
                      {busyAction ===
                      `specialization-delete-${selectedSpecialization.id}` ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setWorkTypeSheet({})}
                    >
                      <Plus className="size-3.5" />
                      {tx("Вид работы", "Leistungsart")}
                    </Button>
                  </div>
                ) : null}
              </div>

              {workTypesError ? (
                <div className="p-4">
                  <Banner tone="error" withIcon>
                    {workTypesError}
                  </Banner>
                </div>
              ) : null}

              <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
                <div className="hidden min-w-[720px] grid-cols-[minmax(220px,1.5fr)_190px_110px_96px_80px] gap-3 border-b border-border/60 bg-muted/25 px-5 py-2 text-[11px] font-semibold uppercase text-muted-foreground md:grid">
                  <span>{tx("Вид работы", "Leistungsart")}</span>
                  <span>{tx("Диапазон, EUR", "Preisspanne, EUR")}</span>
                  <span className="text-right">{tx("Описания", "Beschreibungen")}</span>
                  <span>{tx("Статус", "Status")}</span>
                  <span className="text-right">{tx("Действия", "Aktionen")}</span>
                </div>

                {workTypesLoading ? (
                  <div className="flex min-h-52 items-center justify-center text-muted-foreground">
                    <LoaderCircle className="size-5 animate-spin" />
                  </div>
                ) : workTypes.length === 0 && !workTypesError ? (
                  <div className="flex min-h-52 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    {tx(
                      "Виды работ ещё не добавлены.",
                      "Noch keine Leistungsarten angelegt.",
                    )}
                  </div>
                ) : (
                  <div className="min-w-[720px] divide-y divide-border/60">
                    {workTypes.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[minmax(220px,1.5fr)_190px_110px_96px_80px] items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/25"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {workTypeName(item, lang)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {lang === "ru" ? item.name_de : item.name_ru}
                          </p>
                          {workTypeDescription(item, lang) ? (
                            <p
                              className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground"
                              title={workTypeDescription(item, lang)}
                            >
                              {workTypeDescription(item, lang)}
                            </p>
                          ) : null}
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {item.code} ·{" "}
                            {tx("порядок отображения", "Anzeigereihenfolge")}{" "}
                            {item.sort_order} · {item.duration_hours}{" "}
                            {tx("ч.", "Std.")}
                          </p>
                        </div>
                        <span className="font-mono text-sm tabular-nums text-foreground">
                          {formatPriceRange(item, lang)}
                        </span>
                        <span className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                          {item.descriptions.length}
                        </span>
                        <span>{activeBadge(item.is_active, tx)}</span>
                        <div className="flex justify-end gap-1">
                          {canManage ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                title={tx("Редактировать", "Bearbeiten")}
                                aria-label={tx("Редактировать вид работы", "Leistungsart bearbeiten")}
                                onClick={() => setWorkTypeSheet({ item })}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                title={tx("Удалить", "Löschen")}
                                aria-label={tx("Удалить вид работы", "Leistungsart löschen")}
                                disabled={busyAction === `work-type-delete-${item.id}`}
                                onClick={() => void removeWorkType(item)}
                              >
                                {busyAction === `work-type-delete-${item.id}` ? (
                                  <LoaderCircle className="animate-spin" />
                                ) : (
                                  <Trash2 />
                                )}
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {specializationSheet ? (
        <SpecializationSheet
          key={specializationSheet.item?.id ?? "new-specialization"}
          item={specializationSheet.item}
          busy={busyAction.startsWith("specialization-")}
          tx={tx}
          onClose={() => setSpecializationSheet(null)}
          onSave={saveSpecialization}
        />
      ) : null}

      {workTypeSheet ? (
        <WorkTypeSheet
          key={workTypeSheet.item?.id ?? "new-work-type"}
          item={workTypeSheet.item}
          specializationId={selectedSpecializationId}
          specializations={specializations}
          lang={lang}
          busy={busyAction.startsWith("work-type-")}
          tx={tx}
          onClose={() => setWorkTypeSheet(null)}
          onSave={saveWorkType}
        />
      ) : null}
    </div>
  );
}

function specializationDraft(item?: SpecializationItem): SpecializationDraft {
  return {
    nameDe: item?.name_de ?? "",
    nameRu: item?.name_ru ?? "",
    nameEn: item?.name_en ?? "",
    nameEs: item?.name_es ?? "",
    sortOrder: String(item?.sort_order ?? 1000),
    isActive: item?.is_active ?? true,
  };
}

function SpecializationSheet({
  item,
  busy,
  tx,
  onClose,
  onSave,
}: {
  item?: SpecializationItem;
  busy: boolean;
  tx: Translate;
  onClose: () => void;
  onSave: (
    item: SpecializationItem | undefined,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const initialDraft = useMemo(() => specializationDraft(item), [item]);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const nameDe = draft.nameDe.trim();
    const nameRu = draft.nameRu.trim();
    const nameEn = draft.nameEn.trim();
    const nameEs = draft.nameEs.trim();
    if (!nameDe || !nameRu || !nameEn || !nameEs) {
      setError(
        tx(
          "Заполните названия DE, RU, EN и ES.",
          "Füllen Sie die Bezeichnungen DE, RU, EN und ES aus.",
        ),
      );
      return;
    }

    try {
      await onSave(item, {
        name_en: nameEn,
        name_de: nameDe,
        name_ru: nameRu,
        name_es: nameEs,
        sort_order: Number.parseInt(draft.sortOrder, 10) || 1000,
        is_active: draft.isActive,
      });
    } catch (nextError) {
      setError(genericError(nextError, tx));
    }
  }

  const title = item
    ? tx("Редактировать специализацию", "Spezialisierung bearbeiten")
    : tx("Новая специализация", "Neue Spezialisierung");

  return (
    <Sheet open dirty={dirty} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full border-l border-border p-0 sm:max-w-[680px]"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={title}
            footer={
              <SheetFormFooter
                cancelLabel={tx("Отмена", "Abbrechen")}
                submitLabel={tx("Сохранить", "Speichern")}
                submittingLabel={tx("Сохранение...", "Wird gespeichert...")}
                submitting={busy}
                onCancel={onClose}
              />
            }
          >
          {error ? (
            <Banner tone="error" withIcon>
              {error}
            </Banner>
          ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={tx("Название DE", "Bezeichnung DE")} required>
                <Input
                  value={draft.nameDe}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nameDe: event.target.value }))
                  }
                  className={inputClass}
                  required
                  autoFocus
                />
              </FormField>
              <FormField label={tx("Название RU", "Bezeichnung RU")} required>
                <Input
                  value={draft.nameRu}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nameRu: event.target.value }))
                  }
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField label={tx("Название EN", "Bezeichnung EN")} required>
                <Input
                  value={draft.nameEn}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nameEn: event.target.value }))
                  }
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField label={tx("Название ES", "Bezeichnung ES")} required>
                <Input
                  value={draft.nameEs}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nameEs: event.target.value }))
                  }
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField
                label={tx("Порядок отображения", "Anzeigereihenfolge")}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sortOrder: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </FormField>
              <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                  className={checkboxClass}
                />
                {tx("Активна", "Aktiv")}
              </label>
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function descriptionDraft(
  description?: WorkTypeDescription,
  index = 0,
): DescriptionDraft {
  return {
    key: nextDescriptionKey(),
    id: description?.id,
    languageCode: description?.language_code || (index % 2 === 0 ? "de" : "ru"),
    body: description?.body ?? "",
    sortOrder: description?.sort_order ?? (index + 1) * 10,
    isActive: description?.is_active ?? true,
  };
}

function workTypeDraft(
  item?: SpecializationWorkType,
  fallbackSpecializationId = "",
): WorkTypeDraft {
  return {
    code: item?.code ?? "",
    specializationIds:
      item?.specialization_ids?.length
        ? item.specialization_ids
        : item?.specialization_id
          ? [item.specialization_id]
          : fallbackSpecializationId
            ? [fallbackSpecializationId]
            : [],
    nameDe: item?.name_de ?? "",
    nameRu: item?.name_ru ?? "",
    nameEn: item?.name_en ?? "",
    nameEs: item?.name_es ?? "",
    minPriceEur: item ? String(item.min_price_eur) : "",
    maxPriceEur: item ? String(item.max_price_eur) : "",
    durationHours: String(item?.duration_hours ?? 1),
    sortOrder: String(item?.sort_order ?? 1000),
    isActive: item?.is_active ?? true,
    descriptions:
      item?.descriptions
        .toSorted((left, right) => left.sort_order - right.sort_order)
        .map(descriptionDraft) ?? [],
  };
}

function WorkTypeSheet({
  item,
  specializationId,
  specializations,
  lang,
  busy,
  tx,
  onClose,
  onSave,
}: {
  item?: SpecializationWorkType;
  specializationId: string;
  specializations: SpecializationItem[];
  lang: Lang;
  busy: boolean;
  tx: Translate;
  onClose: () => void;
  onSave: (
    item: SpecializationWorkType | undefined,
    payload: WorkTypeUpsertPayload,
  ) => Promise<void>;
}) {
  const initialDraft = useMemo(
    () => workTypeDraft(item, specializationId),
    [item, specializationId],
  );
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const [linkedProviders, setLinkedProviders] = useState<
    SpecializationLinkedProvider[]
  >([]);
  const [linkedProvidersLoading, setLinkedProvidersLoading] = useState(false);
  const [linkedProvidersError, setLinkedProvidersError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLinkedProvidersLoading(true);
      setLinkedProvidersError("");
    });
    void fetchProvidersBySpecializations(draft.specializationIds)
      .then((items) => {
        if (active) {
          setLinkedProviders(items);
        }
      })
      .catch(() => {
        if (active) {
          setLinkedProviders([]);
          setLinkedProvidersError(
            tx(
              "Не удалось загрузить связанных провайдеров.",
              "Zugeordnete Provider konnten nicht geladen werden.",
            ),
          );
        }
      })
      .finally(() => {
        if (active) {
          setLinkedProvidersLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [draft.specializationIds, tx]);

  function addDescription() {
    setDraft((current) => ({
      ...current,
      descriptions: [
        ...current.descriptions,
        descriptionDraft(undefined, current.descriptions.length),
      ],
    }));
  }

  function updateDescription(
    key: string,
    patch: Partial<Omit<DescriptionDraft, "key">>,
  ) {
    setDraft((current) => ({
      ...current,
      descriptions: current.descriptions.map((description) =>
        description.key === key ? { ...description, ...patch } : description,
      ),
    }));
  }

  function removeDescription(key: string) {
    setDraft((current) => ({
      ...current,
      descriptions: current.descriptions.filter(
        (description) => description.key !== key,
      ),
    }));
  }

  function moveDescription(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.descriptions.length) {
        return current;
      }
      const descriptions = [...current.descriptions];
      [descriptions[index], descriptions[targetIndex]] = [
        descriptions[targetIndex],
        descriptions[index],
      ];
      return {
        ...current,
        descriptions: descriptions.map((description, descriptionIndex) => ({
          ...description,
          sortOrder: (descriptionIndex + 1) * 10,
        })),
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const minPrice = Number(draft.minPriceEur);
    const maxPrice = Number(draft.maxPriceEur);

    if (
      !draft.nameDe.trim() ||
      !draft.nameRu.trim() ||
      !draft.nameEn.trim() ||
      !draft.nameEs.trim()
    ) {
      setError(
        tx(
          "Заполните названия DE, RU, EN и ES.",
          "Füllen Sie die Bezeichnungen DE, RU, EN und ES aus.",
        ),
      );
      return;
    }
    if (
      item &&
      (draft.specializationIds.length === 0 ||
        draft.specializationIds.some(
          (specializationId) =>
            !specializations.some(
              (specialization) => specialization.id === specializationId,
            ),
        ))
    ) {
      setError(
        tx(
          "Выберите специализацию.",
          "Wählen Sie eine Spezialisierung aus.",
        ),
      );
      return;
    }
    if (
      !Number.isFinite(minPrice) ||
      !Number.isFinite(maxPrice) ||
      minPrice < 0 ||
      maxPrice < minPrice
    ) {
      setError(
        tx(
          "Проверьте диапазон цен: максимум не может быть меньше минимума.",
          "Prüfen Sie die Preisspanne: Der Höchstpreis darf nicht unter dem Mindestpreis liegen.",
        ),
      );
      return;
    }
    if (draft.descriptions.some((description) => !description.body.trim())) {
      setError(
        tx(
          "Заполните или удалите пустые описания.",
          "Füllen oder entfernen Sie leere Beschreibungen.",
        ),
      );
      return;
    }

    const descriptions = draft.descriptions.map((description, index) => ({
      ...(description.id ? { id: description.id } : {}),
      language_code: description.languageCode,
      body: description.body.trim(),
      sort_order: description.sortOrder || (index + 1) * 10,
      is_active: description.isActive,
    }));

    try {
      await onSave(item, {
        ...(item
          ? { specialization_ids: draft.specializationIds }
          : {}),
        name_de: draft.nameDe.trim(),
        name_ru: draft.nameRu.trim(),
        name_en: draft.nameEn.trim(),
        name_es: draft.nameEs.trim(),
        min_price_eur: minPrice,
        max_price_eur: maxPrice,
        duration_hours: Number.parseInt(draft.durationHours, 10),
        sort_order: Number.parseInt(draft.sortOrder, 10) || 1000,
        is_active: draft.isActive,
        descriptions,
      });
    } catch (nextError) {
      setError(genericError(nextError, tx));
    }
  }

  const title = item
    ? tx("Редактировать вид работы", "Leistungsart bearbeiten")
    : tx("Новый вид работы", "Neue Leistungsart");

  return (
    <Sheet open dirty={dirty} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full border-l border-border p-0 sm:max-w-[900px]"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={title}
            footer={
              <SheetFormFooter
                cancelLabel={tx("Отмена", "Abbrechen")}
                submitLabel={tx("Сохранить", "Speichern")}
                submittingLabel={tx("Сохранение...", "Wird gespeichert...")}
                submitting={busy}
                onCancel={onClose}
              />
            }
          >
            <div className="space-y-5">
              {error ? (
                <Banner tone="error" withIcon>
                  {error}
                </Banner>
              ) : null}

              {item ? (
                <div className="space-y-4">
                  <FormField
                    label={tx("Специализации", "Spezialisierungen")}
                    required
                  >
                  <NativeComboboxSelect
                    value=""
                    onChange={(event) => {
                      const specializationId = event.target.value;
                      if (!specializationId) return;
                      setDraft((current) =>
                        current.specializationIds.includes(specializationId)
                          ? current
                          : {
                              ...current,
                              specializationIds: [
                                ...current.specializationIds,
                                specializationId,
                              ],
                            },
                      );
                    }}
                    className="h-9 w-full rounded-lg bg-card"
                  >
                    <option value="">
                      {tx("Добавить специализацию", "Spezialisierung hinzufügen")}
                    </option>
                    {specializations
                      .filter(
                        (specialization) =>
                          !draft.specializationIds.includes(specialization.id),
                      )
                      .map((specialization) => (
                        <option key={specialization.id} value={specialization.id}>
                          {specializationName(specialization, lang)}
                          {!specialization.is_active
                            ? ` (${tx("неактивна", "inaktiv")})`
                            : ""}
                        </option>
                      ))}
                  </NativeComboboxSelect>
                  <div className="flex min-h-9 flex-wrap gap-1.5 pt-2">
                    {draft.specializationIds.map((specializationId) => {
                      const specialization = specializations.find(
                        (candidate) => candidate.id === specializationId,
                      );
                      return (
                        <Badge
                          key={specializationId}
                          variant="secondary"
                          className="h-8 max-w-full gap-1.5 rounded-full px-2.5 text-xs"
                        >
                          <span className="truncate">
                            {specialization
                              ? specializationName(specialization, lang)
                              : specializationId}
                          </span>
                          <button
                            type="button"
                            disabled={draft.specializationIds.length === 1}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                specializationIds:
                                  current.specializationIds.filter(
                                    (id) => id !== specializationId,
                                  ),
                              }))
                            }
                            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            title={tx(
                              "Убрать привязку",
                              "Zuordnung entfernen",
                            )}
                            aria-label={tx(
                              "Убрать специализацию",
                              "Spezialisierung entfernen",
                            )}
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                  </FormField>
                  <FormField label={tx("Технический код", "Technischer Code")}>
                    <Input
                      value={draft.code}
                      className={cn(inputClass, "font-mono")}
                      readOnly
                      disabled
                    />
                  </FormField>
                </div>
              ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label={tx("Название DE", "Bezeichnung DE")} required>
                <Input
                  value={draft.nameDe}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      nameDe: event.target.value,
                    }))
                  }
                  className={inputClass}
                  required
                  autoFocus
                />
              </FormField>
              <FormField label={tx("Название RU", "Bezeichnung RU")} required>
                <Input
                  value={draft.nameRu}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      nameRu: event.target.value,
                    }))
                  }
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField label={tx("Название EN", "Bezeichnung EN")} required>
                <Input
                  value={draft.nameEn}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      nameEn: event.target.value,
                    }))
                  }
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField label={tx("Название ES", "Bezeichnung ES")} required>
                <Input
                  value={draft.nameEs}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      nameEs: event.target.value,
                    }))
                  }
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField label={tx("Минимум, EUR", "Minimum, EUR")} required>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.minPriceEur}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      minPriceEur: event.target.value,
                    }))
                  }
                  className={cn(inputClass, "font-mono tabular-nums")}
                  required
                />
              </FormField>
              <FormField label={tx("Максимум, EUR", "Maximum, EUR")} required>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.maxPriceEur}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      maxPriceEur: event.target.value,
                    }))
                  }
                  className={cn(inputClass, "font-mono tabular-nums")}
                  required
                />
              </FormField>
              <FormField
                label={tx("Длительность, часов", "Dauer, Stunden")}
                required
              >
                <NativeComboboxSelect
                  value={draft.durationHours}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      durationHours: event.target.value,
                    }))
                  }
                  className="h-9 w-full rounded-lg bg-card"
                  required
                >
                  {Array.from({ length: 100 }, (_, index) => index + 1).map(
                    (hours) => (
                      <option key={hours} value={hours}>
                        {hours}
                      </option>
                    ),
                  )}
                </NativeComboboxSelect>
              </FormField>
              <FormField
                label={tx("Порядок отображения", "Anzeigereihenfolge")}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sortOrder: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </FormField>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
                className={checkboxClass}
              />
              {tx("Активен", "Aktiv")}
            </label>

            <section className="border-t border-border/70 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {tx("Описания", "Beschreibungen")}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDescription}
                >
                  <Plus className="size-3.5" />
                  {tx("Описание", "Beschreibung")}
                </Button>
              </div>

              {draft.descriptions.length === 0 ? (
                <div className="mt-3 border-t border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                  {tx("Описания не добавлены.", "Keine Beschreibungen angelegt.")}
                </div>
              ) : (
                <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
                  {draft.descriptions.map((description, index) => (
                    <div
                      key={description.key}
                      className="grid gap-3 py-4 md:grid-cols-[150px_minmax(0,1fr)_auto]"
                    >
                      <div className="space-y-3">
                        <FormField label={tx("Язык", "Sprache")}>
                          <NativeComboboxSelect
                            value={description.languageCode}
                            onChange={(event) =>
                              updateDescription(description.key, {
                                languageCode: event.target.value,
                              })
                            }
                            className="h-9 rounded-lg bg-card"
                            aria-label={tx("Язык описания", "Beschreibungssprache")}
                          >
                            <option value="de">Deutsch</option>
                            <option value="ru">Русский</option>
                            <option value="en">English</option>
                            <option value="es">Español</option>
                          </NativeComboboxSelect>
                        </FormField>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={description.isActive}
                            onChange={(event) =>
                              updateDescription(description.key, {
                                isActive: event.target.checked,
                              })
                            }
                            className={checkboxClass}
                          />
                          {tx("Активно", "Aktiv")}
                        </label>
                      </div>

                      <FormField
                        label={`${tx("Текст", "Text")} ${index + 1}`}
                        required
                      >
                        <textarea
                          value={description.body}
                          onChange={(event) =>
                            updateDescription(description.key, {
                              body: event.target.value,
                            })
                          }
                          className={cn(textareaClass, "min-h-28 resize-y bg-card")}
                          required
                        />
                      </FormField>

                      <div className="flex items-start gap-1 pt-5 md:flex-col">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={tx("Переместить вверх", "Nach oben")}
                          aria-label={tx("Переместить описание вверх", "Beschreibung nach oben")}
                          disabled={index === 0}
                          onClick={() => moveDescription(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={tx("Переместить вниз", "Nach unten")}
                          aria-label={tx("Переместить описание вниз", "Beschreibung nach unten")}
                          disabled={index === draft.descriptions.length - 1}
                          onClick={() => moveDescription(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          title={tx("Удалить", "Löschen")}
                          aria-label={tx("Удалить описание", "Beschreibung löschen")}
                          onClick={() => removeDescription(description.key)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="border-t border-border/70 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {tx("Провайдеры", "Provider")}
                </h3>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {linkedProviders.length}
                </span>
              </div>

              {linkedProvidersLoading ? (
                <div className="mt-3 flex min-h-20 items-center justify-center text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                </div>
              ) : linkedProvidersError ? (
                <div className="mt-3">
                  <Banner tone="error" withIcon>
                    {linkedProvidersError}
                  </Banner>
                </div>
              ) : linkedProviders.length === 0 ? (
                <p className="mt-3 border-y border-dashed border-border/70 py-6 text-center text-sm text-muted-foreground">
                  {tx(
                    "К выбранным специализациям провайдеры не привязаны.",
                    "Den ausgewählten Spezialisierungen sind keine Provider zugeordnet.",
                  )}
                </p>
              ) : (
                <div className="mt-3 max-h-64 divide-y divide-border/60 overflow-y-auto overscroll-contain border-y border-border/70">
                  {linkedProviders.map((provider) => (
                    <div
                      key={provider.id}
                      className="flex min-w-0 items-start justify-between gap-4 px-1 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                            {provider.name}
                          </p>
                          <Badge
                            variant="outline"
                            className="rounded-full border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
                          >
                            {provider.provider_type === "medical"
                              ? tx("Медицинский", "Medizinisch")
                              : tx("Немедицинский", "Nicht medizinisch")}
                          </Badge>
                        </div>
                        {provider.address_city || !provider.is_active ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {provider.address_city ?? ""}
                          {!provider.is_active
                            ? `${provider.address_city ? " · " : ""}${tx("неактивен", "inaktiv")}`
                            : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex max-w-[50%] flex-wrap justify-end gap-1">
                        {provider.specialization_ids.map(
                          (providerSpecializationId) => {
                            const specialization = specializations.find(
                              (candidate) =>
                                candidate.id === providerSpecializationId,
                            );
                            return (
                              <Badge
                                key={providerSpecializationId}
                                variant="outline"
                                className="max-w-full rounded-full px-2 py-0.5 text-[11px]"
                              >
                                <span className="truncate">
                                  {specialization
                                    ? specializationName(specialization, lang)
                                    : providerSpecializationId}
                                </span>
                              </Badge>
                            );
                          },
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function FormField({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
