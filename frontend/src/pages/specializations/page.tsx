import {
  useEffect,
  useId,
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
} from "lucide-react";

import { Banner } from "@/components/record-workspace/recipes";
import { PageHeader, checkboxClass, inputClass, textareaClass } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  fetchSpecializationWorkTypes,
  updateSpecializationWorkType,
  type SpecializationWorkType,
  type WorkTypeDescription,
  type WorkTypeUpsertPayload,
} from "./data/specialization-work-types-api";

type Translate = (ru: string, de: string) => string;

type SpecializationDialogState = {
  item?: SpecializationItem;
};

type WorkTypeDialogState = {
  item?: SpecializationWorkType;
};

type SpecializationDraft = {
  nameDe: string;
  nameRu: string;
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
  nameDe: string;
  nameRu: string;
  minPriceEur: string;
  maxPriceEur: string;
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
    return item.name_de?.trim() || item.name_ru?.trim() || item.name_en || item.code;
  }
  return item.name_ru?.trim() || item.name_de?.trim() || item.name_en || item.code;
}

function workTypeName(item: SpecializationWorkType, lang: Lang) {
  return lang === "de"
    ? item.name_de.trim() || item.name_ru.trim() || item.code
    : item.name_ru.trim() || item.name_de.trim() || item.code;
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
  const [specializationDialog, setSpecializationDialog] =
    useState<SpecializationDialogState | null>(null);
  const [workTypeDialog, setWorkTypeDialog] = useState<WorkTypeDialogState | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setSpecializationDialog(null);
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
      setWorkTypeDialog(null);
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
      setReloadWorkTypesToken((current) => current + 1);
      toast.success(tx("Вид работы удалён.", "Leistungsart gelöscht."));
    } catch (error) {
      toast.error(genericError(error, tx));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="space-y-4">
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
                onClick={() => setSpecializationDialog({})}
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

      <div className="grid min-h-[620px] overflow-hidden rounded-lg border border-border/70 bg-card lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border/70 lg:border-r lg:border-b-0">
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

          <div className="max-h-[280px] flex-1 overflow-y-auto p-2 lg:max-h-none">
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
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                          {item.code}
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

        <main className="min-w-0">
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
                    {selectedSpecialization.name_ru || "-"} ·{" "}
                    {tx("Порядок", "Sortierung")}: {selectedSpecialization.sort_order}
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
                        setSpecializationDialog({ item: selectedSpecialization })
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
                      onClick={() => setWorkTypeDialog({})}
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

              <div className="min-w-0 overflow-x-auto">
                <div className="hidden min-w-[720px] grid-cols-[minmax(220px,1.5fr)_190px_110px_96px_80px] gap-3 border-b border-border/60 bg-muted/25 px-5 py-2 text-[11px] font-semibold uppercase text-muted-foreground md:grid">
                  <span>{tx("Вид работы", "Leistungsart")}</span>
                  <span>{tx("Диапазон, EUR", "Preisspanne, EUR")}</span>
                  <span>{tx("Описания", "Beschreibungen")}</span>
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
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {item.code} · {tx("порядок", "Sortierung")} {item.sort_order}
                          </p>
                        </div>
                        <span className="font-mono text-sm tabular-nums text-foreground">
                          {formatPriceRange(item, lang)}
                        </span>
                        <span className="font-mono text-sm tabular-nums text-muted-foreground">
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
                                onClick={() => setWorkTypeDialog({ item })}
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

      {specializationDialog ? (
        <SpecializationDialog
          key={specializationDialog.item?.id ?? "new-specialization"}
          item={specializationDialog.item}
          busy={busyAction.startsWith("specialization-")}
          tx={tx}
          onClose={() => setSpecializationDialog(null)}
          onSave={saveSpecialization}
        />
      ) : null}

      {workTypeDialog ? (
        <WorkTypeDialog
          key={workTypeDialog.item?.id ?? "new-work-type"}
          item={workTypeDialog.item}
          busy={busyAction.startsWith("work-type-")}
          tx={tx}
          onClose={() => setWorkTypeDialog(null)}
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
    sortOrder: String(item?.sort_order ?? 1000),
    isActive: item?.is_active ?? true,
  };
}

function SpecializationDialog({
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
  const formId = useId();
  const initialDraft = useMemo(() => specializationDraft(item), [item]);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const nameDe = draft.nameDe.trim();
    const nameRu = draft.nameRu.trim();
    if (!nameDe || !nameRu) {
      setError(
        tx(
          "Заполните названия на немецком и русском.",
          "Füllen Sie die deutschen und russischen Bezeichnungen aus.",
        ),
      );
      return;
    }

    try {
      await onSave(item, {
        name_en: nameDe || nameRu,
        name_de: nameDe,
        name_ru: nameRu,
        sort_order: Number.parseInt(draft.sortOrder, 10) || 1000,
        is_active: draft.isActive,
      });
    } catch (nextError) {
      setError(genericError(nextError, tx));
    }
  }

  return (
    <Dialog open dirty={dirty} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(90vh,680px)] max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <DialogTitle>
            {item
              ? tx("Редактировать специализацию", "Spezialisierung bearbeiten")
              : tx("Новая специализация", "Neue Spezialisierung")}
          </DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit} className="overflow-y-auto p-5">
          {error ? (
            <div className="mb-4">
              <Banner tone="error" withIcon>
                {error}
              </Banner>
            </div>
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
            <FormField label={tx("Порядок", "Sortierung")}>
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
        </form>
        <DialogFooter className="m-0 rounded-none px-5 py-3">
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
            {tx("Отмена", "Abbrechen")}
          </DialogClose>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {tx("Сохранить", "Speichern")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function workTypeDraft(item?: SpecializationWorkType): WorkTypeDraft {
  return {
    code: item?.code ?? "",
    nameDe: item?.name_de ?? "",
    nameRu: item?.name_ru ?? "",
    minPriceEur: item ? String(item.min_price_eur) : "",
    maxPriceEur: item ? String(item.max_price_eur) : "",
    sortOrder: String(item?.sort_order ?? 1000),
    isActive: item?.is_active ?? true,
    descriptions:
      item?.descriptions
        .toSorted((left, right) => left.sort_order - right.sort_order)
        .map(descriptionDraft) ?? [],
  };
}

function WorkTypeDialog({
  item,
  busy,
  tx,
  onClose,
  onSave,
}: {
  item?: SpecializationWorkType;
  busy: boolean;
  tx: Translate;
  onClose: () => void;
  onSave: (
    item: SpecializationWorkType | undefined,
    payload: WorkTypeUpsertPayload,
  ) => Promise<void>;
}) {
  const formId = useId();
  const initialDraft = useMemo(() => workTypeDraft(item), [item]);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

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

    if (!draft.code.trim() || !draft.nameDe.trim() || !draft.nameRu.trim()) {
      setError(
        tx(
          "Заполните код и названия DE/RU.",
          "Füllen Sie Code sowie DE/RU-Bezeichnungen aus.",
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
        code: draft.code.trim(),
        name_de: draft.nameDe.trim(),
        name_ru: draft.nameRu.trim(),
        min_price_eur: minPrice,
        max_price_eur: maxPrice,
        sort_order: Number.parseInt(draft.sortOrder, 10) || 1000,
        is_active: draft.isActive,
        descriptions,
      });
    } catch (nextError) {
      setError(genericError(nextError, tx));
    }
  }

  return (
    <Dialog open dirty={dirty} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(94vh,860px)] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <DialogTitle>
            {item
              ? tx("Редактировать вид работы", "Leistungsart bearbeiten")
              : tx("Новый вид работы", "Neue Leistungsart")}
          </DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit} className="overflow-y-auto">
          <div className="space-y-5 p-5">
            {error ? (
              <Banner tone="error" withIcon>
                {error}
              </Banner>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label={tx("Код", "Code")} required>
                <Input
                  value={draft.code}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                  className={inputClass}
                  required
                  autoFocus
                />
              </FormField>
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
              <FormField label={tx("Порядок", "Sortierung")}>
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
          </div>
        </form>
        <DialogFooter className="m-0 rounded-none px-5 py-3">
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
            {tx("Отмена", "Abbrechen")}
          </DialogClose>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {tx("Сохранить", "Speichern")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
