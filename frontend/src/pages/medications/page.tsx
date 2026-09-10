import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Pencil, Pill, Plus, RefreshCw, Search, SearchX, Trash2, X } from "lucide-react";
import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTable } from "@/components/data-table/data-table";
import { DataTablePager } from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banner, PageHeader, inputClass } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { deleteMedicationCatalogItem, fetchMedicationCatalog, saveMedicationCatalogItem, type MedicationCatalogItem, type MedicationCatalogPage } from "./data";

const EMPTY_PAGE: MedicationCatalogPage = { items: [], total: 0, page: 1, page_size: 50 };
const cleanName = (value: string) => value.trim().replace(/\s+/gu, " ");

export function MedicationsPage() {
  const { lang, t } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ q: "", page: 1 });
  const [reload, setReload] = useState(0);
  const [data, setData] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<MedicationCatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MedicationCatalogItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    void fetchMedicationCatalog(query.q, query.page, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(page.total / page.page_size));
        if (query.page > lastPage) {
          setQuery((current) => ({ ...current, page: lastPage }));
        } else {
          setData(page);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);

  const original = draft ? data.items.find((item) => item.id === draft.id) : undefined;
  const changed = Boolean(draft && (draft.id === "new"
    || cleanName(draft.handelsname) !== original?.handelsname
    || cleanName(draft.wirkstoff) !== original?.wirkstoff));
  const valid = Boolean(draft && cleanName(draft.wirkstoff)
    && [draft.handelsname, draft.wirkstoff].every((value) => [...cleanName(value)].length <= 500));

  function edit(item: MedicationCatalogItem) {
    if (draft || loading) return;
    setSaveError("");
    setDraft({ ...item });
  }

  function cancel() {
    if (pending.current) return;
    setDraft(null);
    setSaveError("");
  }

  async function save() {
    if (!draft || !valid || !changed || pending.current) return;
    pending.current = true;
    setBusy(true);
    setSaveError("");
    try {
      await saveMedicationCatalogItem({ ...draft, handelsname: cleanName(draft.handelsname), wirkstoff: cleanName(draft.wirkstoff) });
      setDraft(null);
      setReload((value) => value + 1);
      toast.success(tx("Медикамент сохранён", "Medikament gespeichert"));
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.body?.code ?? error.code ?? error.message : "";
      setSaveError(code === "medication_pair_exists"
        ? tx("Такая торговая марка и действующее вещество уже есть в справочнике.", "Diese Kombination aus Handelsname und Wirkstoff ist bereits vorhanden.")
        : code === "medication_pair_changed" || code === "medication_pair_not_found"
          ? tx("Запись уже изменена. Отмените редактирование и обновите таблицу.", "Der Eintrag wurde bereits geändert. Brechen Sie die Bearbeitung ab und aktualisieren Sie die Tabelle.")
          : tx("Не удалось сохранить медикамент. Повторите попытку.", "Das Medikament konnte nicht gespeichert werden. Bitte erneut versuchen."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (draft) return;
    setQuery({ q: search.trim(), page: 1 });
  }

  async function remove() {
    if (!deleteTarget || pending.current) return;
    pending.current = true;
    setBusy(true);
    setDeleteError("");
    try {
      await deleteMedicationCatalogItem(deleteTarget);
      setDeleteTarget(null);
      setReload((value) => value + 1);
      toast.success(tx("Медикамент удалён из справочника", "Medikament aus dem Verzeichnis gelöscht"));
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.body?.code ?? error.code ?? error.message : "";
      setDeleteError(code === "medication_pair_changed" || code === "medication_pair_not_found"
        ? tx("Запись уже изменена или удалена. Закройте окно и обновите таблицу.", "Der Eintrag wurde bereits geändert oder gelöscht. Schließen Sie das Fenster und aktualisieren Sie die Tabelle.")
        : tx("Не удалось удалить медикамент. Повторите попытку.", "Das Medikament konnte nicht gelöscht werden. Bitte erneut versuchen."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const rows = draft?.id === "new" ? [draft, ...data.items] : data.items;
  const columns: ColumnDef<MedicationCatalogItem>[] = [
    ...(["handelsname", "wirkstoff"] as const).map((field) => ({
      id: field,
      label: field === "handelsname" ? tx("Торговое название", "Handelsname") : tx("Действующее вещество", "Wirkstoff"),
      accessor: (item: MedicationCatalogItem) => item[field],
      minWidth: 260,
      required: field === "wirkstoff",
      sortable: false,
      cellClassName: "whitespace-normal",
      render: (item: MedicationCatalogItem) => draft?.id === item.id ? (
        <Input
          aria-label={field === "handelsname" ? tx("Торговое название", "Handelsname") : tx("Действующее вещество", "Wirkstoff")}
          value={draft[field]}
          autoFocus={field === "handelsname"}
          required={field === "wirkstoff"}
          maxLength={500}
          disabled={busy}
          aria-invalid={field === "wirkstoff" && !draft.wirkstoff.trim()}
          className={cn(inputClass, "h-8 w-full min-w-0 rounded-md text-xs")}
          onChange={(event) => setDraft((current) => current ? { ...current, [field]: event.target.value } : null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void save(); }
            if (event.key === "Escape") { event.preventDefault(); cancel(); }
          }}
        />
      ) : <span className={cn("line-clamp-2 break-words text-sm leading-5 sm:text-xs sm:leading-4", field === "handelsname" && "font-medium", !item[field] && "text-muted-foreground")} title={item[field]}>{item[field] || "—"}</span>,
    })),
  ];

  return <div className="min-w-0 space-y-4">
    <PageHeader title={t.nav_medications} actions={<Button type="button" size="sm" disabled={loading || loadError || Boolean(draft) || Boolean(deleteTarget)} onClick={() => edit({ id: "new", handelsname: "", wirkstoff: "", version: 0 })}><Plus className="size-4" />{tx("Добавить медикамент", "Medikament hinzufügen")}</Button>} />

    <section aria-label={tx("Справочник медикаментов", "Medikamentenverzeichnis")} className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-end gap-2 border-b border-border/70 p-2.5 sm:px-3 sm:py-2">
        <h2 className="flex h-8 shrink-0 items-center gap-2 text-[13px] font-semibold tracking-tight">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
          {tx("Справочник", "Verzeichnis")}
        </h2>
        <span aria-hidden className="mx-1 mb-2 hidden h-4 w-px shrink-0 bg-border sm:block" />
        <form role="search" onSubmit={submitSearch} className="flex min-w-0 basis-full items-end gap-2 lg:ml-auto lg:basis-auto lg:flex-1 lg:max-w-xl">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="block text-[11px] leading-none text-muted-foreground">{t.common_search}</span>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={tx("Поиск медикаментов", "Medikamente suchen")} placeholder={tx("Торговое название или действующее вещество", "Handelsname oder Wirkstoff")} value={search} maxLength={500} disabled={Boolean(draft)} className={cn(inputClass, "h-8 w-full min-w-0 rounded-md pl-8 text-xs")} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </label>
          <Button type="submit" variant="outline" className="h-8 rounded-md text-xs" disabled={loading || Boolean(draft)}>{tx("Найти", "Suchen")}</Button>
          {search || query.q ? <Button type="button" variant="ghost" size="icon" className="rounded-md" aria-label={tx("Сбросить", "Zurücksetzen")} title={tx("Сбросить", "Zurücksetzen")} disabled={Boolean(draft)} onClick={() => { setSearch(""); setQuery({ q: "", page: 1 }); }}><X className="size-4" /></Button> : null}
        </form>
        <div inert={Boolean(draft)} className={draft ? "opacity-50" : undefined}>
          <ColumnVisibilityMenu columns={columns} hiddenColumns={draft ? [] : hiddenColumns} onChange={setHiddenColumns} />
        </div>
        <Button type="button" variant="outline" size="icon" className="rounded-md" aria-label={t.common_refresh} title={t.common_refresh} disabled={loading || Boolean(draft)} onClick={() => setReload((value) => value + 1)}><RefreshCw className={cn("size-3.5", loading && "animate-spin")} /></Button>
      </div>
      {saveError ? <div className="border-b border-border/70 p-3"><Banner tone="error" withIcon>{saveError}</Banner></div> : null}
      {loadError ? <div className="p-3"><Banner tone="error" withIcon>{tx("Не удалось загрузить медикаменты. Обновите таблицу.", "Medikamente konnten nicht geladen werden. Aktualisieren Sie die Tabelle.")}</Banner></div> : <>
        <div className={draft || loading ? "pointer-events-none opacity-50" : undefined} inert={Boolean(draft) || loading}>
          <DataTablePager pageIndex={data.page - 1} pageSize={data.page_size} totalRows={data.total} totalPages={Math.max(1, Math.ceil(data.total / data.page_size))} previousLabel={tx("Предыдущая страница", "Vorherige Seite")} nextLabel={tx("Следующая страница", "Nächste Seite")} onPageChange={(index) => setQuery((current) => ({ ...current, page: index + 1 }))} />
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          hiddenColumns={draft ? [] : hiddenColumns}
          rowId={(item) => item.id}
          loading={loading}
          storageKey="crm-medications"
          activeRowId={draft?.id}
          className="rounded-none border-0 shadow-none sm:max-h-[min(640px,calc(100dvh-15rem))] [&_dl]:grid-cols-1"
          rowHeightOverrides={{ comfortable: 44 }}
          rowActionsWidth={80}
          mobilePrimaryColumnId="handelsname"
          mobileDetailColumnIds={["wirkstoff"]}
          rowActionsLabel={tx("Действия", "Aktionen")}
          rowActions={(item) => draft?.id === item.id ? <div className="flex items-center gap-1.5">
            <Button type="button" size="icon-sm" aria-label={tx("Сохранить", "Speichern")} title={tx("Сохранить", "Speichern")} disabled={busy || !valid || !changed} onClick={() => void save()}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}</Button>
            <Button type="button" size="icon-sm" variant="outline" aria-label={tx("Отмена", "Abbrechen")} title={tx("Отмена", "Abbrechen")} disabled={busy} onClick={cancel}><X className="size-3.5" /></Button>
          </div> : <div className="flex items-center gap-1.5"><Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" aria-label={tx("Редактировать", "Bearbeiten")} title={tx("Редактировать", "Bearbeiten")} disabled={Boolean(draft) || loading || busy} onClick={() => edit(item)}><Pencil className="size-3.5" /></Button><Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={tx("Удалить", "Löschen")} title={tx("Удалить", "Löschen")} disabled={Boolean(draft) || loading || busy} onClick={() => { setDeleteError(""); setDeleteTarget(item); }}><Trash2 className="size-3.5" /></Button></div>}
          emptyState={<div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            {query.q ? <SearchX aria-hidden className="size-6" /> : <Pill aria-hidden className="size-6" />}
            <p>{query.q ? tx("Медикаменты не найдены", "Keine Medikamente gefunden") : tx("В справочнике пока нет медикаментов", "Noch keine Medikamente im Verzeichnis")}</p>
          </div>}
        />
        <div className="border-t border-border/60 bg-muted/15 px-3 py-1.5 text-xs text-muted-foreground"><span className="font-mono tabular-nums">{data.total}</span></div>
      </>}
    </section>
    <Dialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !busy) { setDeleteTarget(null); setDeleteError(""); } }}><DialogContent className="left-1/2 right-auto top-1/2 bottom-auto flex max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl border-border/70 bg-card p-0 pb-0 sm:max-w-md sm:pb-0">
      <DialogHeader className="gap-2 border-b border-border/70 px-5 py-4 pr-14"><DialogTitle>{tx("Удалить медикамент?", "Medikament löschen?")}</DialogTitle><DialogDescription>{tx("Запись будет удалена из справочника. Назначения пациентов сохранятся.", "Der Eintrag wird aus dem Verzeichnis gelöscht. Patientenverordnungen bleiben erhalten.")}</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto px-5 py-4"><p className="break-words text-sm font-semibold">{deleteTarget?.handelsname || "—"}</p><p className="mt-1 break-words text-sm text-muted-foreground">{deleteTarget?.wirkstoff}</p></div>
      <footer className="space-y-3 border-t border-border/70 bg-muted/20 px-5 py-3">{deleteError ? <Banner tone="error" withIcon>{deleteError}</Banner> : null}<div className="flex justify-end gap-2"><DialogClose render={<Button variant="outline" disabled={busy} />}>{tx("Отмена", "Abbrechen")}</DialogClose><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{tx("Удалить", "Löschen")}</Button></div></footer>
    </DialogContent></Dialog>
  </div>;
}
