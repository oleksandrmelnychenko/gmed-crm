import { useCallback, useEffect, useMemo, useReducer, type FormEvent, type SetStateAction } from "react";
import { Plus, RefreshCcw } from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSectionTitle,
  AdminSheetScaffold,
  SheetFormFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  TabLoader,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { formatEnumLabelFromKeys, useLang, type TranslationKey } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  createAdminAnnouncement,
  deleteAdminAnnouncement,
  fetchAdminAnnouncements,
} from "@/pages/admin/data/admin-api";

interface Announcement {
  id: string;
  title: string;
  message: string;
  variant: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  creator: string;
}

type AdminAnnouncementsTranslations = ReturnType<typeof useLang>["t"];

const VARIANT_COLORS: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
  success: "bg-green-500/15 text-green-700 dark:text-green-400",
};

const ANNOUNCEMENT_VARIANT_LABEL_KEYS = {
  info: "ann_info",
  warning: "ann_warning",
  error: "common_error",
  success: "ann_success",
} as const satisfies Partial<Record<string, TranslationKey>>;

const ADMIN_ANNOUNCEMENT_REALTIME_EVENTS = [
  "announcement.created",
  "announcement.updated",
  "announcement.deleted",
] as const;

function compactDt(dt: string | null | undefined): string {
  if (!dt) return "-";
  return dt.split("T")[0] ?? dt;
}

function toDateTimeLocalInput(value: Date): string {
  const tzOffsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

type AdminAnnouncementsState = {
  items: Announcement[];
  loading: boolean;
  error: string;
  showCreate: boolean;
  creating: boolean;
  createError: string;
  fTitle: string;
  fMsg: string;
  fVariant: string;
  fEnds: string;
  minAnnouncementEndsAt: string;
};

type AdminAnnouncementsPatch =
  | Partial<AdminAnnouncementsState>
  | ((current: AdminAnnouncementsState) => Partial<AdminAnnouncementsState>);

function adminAnnouncementsReducer(
  state: AdminAnnouncementsState,
  patch: AdminAnnouncementsPatch,
): AdminAnnouncementsState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createAdminAnnouncementsFieldPatch<K extends keyof AdminAnnouncementsState>(
  field: K,
  value: SetStateAction<AdminAnnouncementsState[K]>,
): AdminAnnouncementsPatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: AdminAnnouncementsState[K]) => AdminAnnouncementsState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<AdminAnnouncementsState>;
  };
}

type AdminAnnouncementCreateSheetProps = {
  createError: string;
  creating: boolean;
  fEnds: string;
  fMsg: string;
  fTitle: string;
  fVariant: string;
  minAnnouncementEndsAt: string;
  showCreate: boolean;
  t: AdminAnnouncementsTranslations;
  onCreate: (event: FormEvent) => void;
  onEndsChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onTitleChange: (value: string) => void;
  onVariantChange: (value: string) => void;
};

function AdminAnnouncementCreateSheet({
  createError,
  creating,
  fEnds,
  fMsg,
  fTitle,
  fVariant,
  minAnnouncementEndsAt,
  showCreate,
  t,
  onCreate,
  onEndsChange,
  onMessageChange,
  onOpenChange,
  onTitleChange,
  onVariantChange,
}: AdminAnnouncementCreateSheetProps) {
  return (
    <Sheet open={showCreate} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
        <form onSubmit={onCreate} className="flex flex-1 min-h-0 flex-col">
          <AdminSheetScaffold
            title={t.ann_new}
            description={t.ann_subtitle}
            footer={(
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={t.common_save}
                submitting={creating}
                onCancel={() => onOpenChange(false)}
              />
            )}
          >
            {createError ? <Banner tone="error">{createError}</Banner> : null}

            <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
              <AdminSectionTitle>{t.ann_new}</AdminSectionTitle>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={`${t.field_name} *`} htmlFor="announcement-title">
                  <Input
                    id="announcement-title"
                    required
                    value={fTitle}
                    onChange={(event) => onTitleChange(event.target.value)}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
                <Field label={t.ann_variant} htmlFor="announcement-variant">
                  <NativeComboboxSelect value={fVariant}
                    onChange={(event) => onVariantChange(event.target.value ?? "info")} id="announcement-variant" className="!h-9 w-full rounded-lg bg-card">
                      <option value="info">{t.ann_info}</option>
                      <option value="warning">{t.ann_warning}</option>
                      <option value="error">{t.common_error}</option>
                      <option value="success">{t.ann_success}</option>
                    </NativeComboboxSelect>
                </Field>
              </div>
              <Field label={`${t.ann_message} *`} htmlFor="announcement-message">
                <Input
                  id="announcement-message"
                  required
                  value={fMsg}
                  onChange={(event) => onMessageChange(event.target.value)}
                  className="h-9 rounded-lg bg-card"
                />
              </Field>
              <Field label={t.ann_ends} htmlFor="announcement-ends">
                <Input
                  id="announcement-ends"
                  type="datetime-local"
                  value={fEnds}
                  onChange={(event) => onEndsChange(event.target.value)}
                  min={minAnnouncementEndsAt}
                  className="h-9 rounded-lg bg-card"
                />
              </Field>
            </section>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type AdminAnnouncementsHeaderActionsProps = {
  t: AdminAnnouncementsTranslations;
  onCreate: () => void;
  onRefresh: () => void;
};

function AdminAnnouncementsHeaderActions({
  t,
  onCreate,
  onRefresh,
}: AdminAnnouncementsHeaderActionsProps) {
  return (
    <>
      <AdminGuideButton title={t.ann_title} description={t.ann_subtitle} />
      <Button
        type="button"
        variant="outline"
        className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
        onClick={onRefresh}
      >
        <RefreshCcw className="size-3.5" />
        {t.common_refresh}
      </Button>
      <Button
        type="button"
        className="h-9 rounded-lg gap-1.5 px-3.5"
        onClick={onCreate}
      >
        <Plus className="size-3.5" />
        {t.ann_new}
      </Button>
    </>
  );
}

type AdminAnnouncementsTableProps = {
  columns: ColumnDef<Announcement>[];
  items: Announcement[];
  t: AdminAnnouncementsTranslations;
};

function AdminAnnouncementsTable({
  columns,
  items,
  t,
}: AdminAnnouncementsTableProps) {
  return (
    <AdminTableCard
      title={t.ann_title}
      description={t.ann_subtitle}
      count={items.length}
    >
      <DataTableSurface
        rows={items}
        columns={columns}
        defaultDensity="comfortable"
        dictionary={t as unknown as Record<string, string>}
        rowId={(announcement) => announcement.id}
        emptyState={<EmptyCell>{t.ann_no_announcements}</EmptyCell>}
        tableClassName="min-h-[320px]"
      />
    </AdminTableCard>
  );
}

function useAdminAnnouncementsController(t: AdminAnnouncementsTranslations) {
  const [announcementState, dispatchAnnouncementState] = useReducer(
    adminAnnouncementsReducer,
    undefined,
    (): AdminAnnouncementsState => ({
      items: [],
      loading: true,
      error: "",
      showCreate: false,
      creating: false,
      createError: "",
      fTitle: "",
      fMsg: "",
      fVariant: "info",
      fEnds: "",
      minAnnouncementEndsAt: toDateTimeLocalInput(new Date()),
    }),
  );
  const {
    items,
    loading,
    error,
    showCreate,
    creating,
    createError,
    fTitle,
    fMsg,
    fVariant,
    fEnds,
    minAnnouncementEndsAt,
  } = announcementState;
  const setAnnouncementField = <K extends keyof AdminAnnouncementsState>(
    field: K,
    value: SetStateAction<AdminAnnouncementsState[K]>,
  ) => dispatchAnnouncementState(createAdminAnnouncementsFieldPatch(field, value));
  const setItems = (value: SetStateAction<Announcement[]>) =>
    setAnnouncementField("items", value);
  const setLoading = (value: SetStateAction<boolean>) =>
    setAnnouncementField("loading", value);
  const setError = (value: SetStateAction<string>) =>
    setAnnouncementField("error", value);
  const setShowCreate = (value: SetStateAction<boolean>) => {
    dispatchAnnouncementState((current) => {
      const showCreate =
        typeof value === "function"
          ? (value as (previous: boolean) => boolean)(current.showCreate)
          : value;
      return {
        showCreate,
        ...(showCreate
          ? { minAnnouncementEndsAt: toDateTimeLocalInput(new Date()) }
          : {}),
      };
    });
  };
  const setCreating = (value: SetStateAction<boolean>) =>
    setAnnouncementField("creating", value);
  const setCreateError = (value: SetStateAction<string>) =>
    setAnnouncementField("createError", value);
  const setFTitle = (value: SetStateAction<string>) =>
    setAnnouncementField("fTitle", value);
  const setFMsg = (value: SetStateAction<string>) =>
    setAnnouncementField("fMsg", value);
  const setFVariant = (value: SetStateAction<string>) =>
    setAnnouncementField("fVariant", value);
  const setFEnds = (value: SetStateAction<string>) =>
    setAnnouncementField("fEnds", value);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await fetchAdminAnnouncements<Announcement>());
    } catch (loadError) {
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : t.common_error);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeSubscription(ADMIN_ANNOUNCEMENT_REALTIME_EVENTS, () => {
    clearApiCache("/admin/announcements");
    clearApiCache("/announcements/active");
    void load();
  });

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const normalizedEndsAt = fEnds.trim();
      if (normalizedEndsAt && Number.isNaN(new Date(normalizedEndsAt).getTime())) {
        setCreateError(t.common_error);
        return;
      }

      await createAdminAnnouncement({
        title: fTitle,
        message: fMsg,
        variant: fVariant,
        is_active: true,
        starts_at: null,
        ends_at: normalizedEndsAt || null,
      });
      setShowCreate(false);
      setFTitle("");
      setFMsg("");
      setFEnds("");
      setFVariant("info");
      void load();
    } catch (submitError) {
      setCreateError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setCreating(false);
    }
  };

  const onDelete = useCallback(async (id: string) => {
    setError("");
    try {
      await deleteAdminAnnouncement(id);
      void load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t.common_error);
    }
  }, [load, t.common_error]);

  const variantLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ANNOUNCEMENT_VARIANT_LABEL_KEYS, t),
    [t],
  );

  const columns = useMemo<ColumnDef<Announcement>[]>(() => [
    {
      id: "title",
      label: t.field_name,
      accessor: (announcement) => announcement.title,
      sortable: true,
      width: 220,
      render: (announcement) => (
        <span className="font-medium text-foreground">{announcement.title}</span>
      ),
    },
    {
      id: "message",
      label: t.ann_message,
      accessor: (announcement) => announcement.message,
      sortable: true,
      width: 300,
      render: (announcement) => (
        <span className="truncate text-xs text-muted-foreground" title={announcement.message}>
          {announcement.message}
        </span>
      ),
    },
    {
      id: "variant",
      label: t.ann_variant,
      accessor: (announcement) => announcement.variant,
      sortable: true,
      width: 130,
      render: (announcement) => (
        <Badge
          className={
            VARIANT_COLORS[announcement.variant] ??
            "bg-neutral-500/15 text-neutral-700 dark:text-neutral-400"
          }
        >
          {variantLabel(announcement.variant)}
        </Badge>
      ),
    },
    {
      id: "status",
      label: t.users_status,
      accessor: (announcement) => announcement.is_active,
      sortable: true,
      width: 130,
      render: (announcement) =>
        announcement.is_active ? (
          <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
            {t.ann_active}
          </Badge>
        ) : (
          <Badge className="bg-neutral-500/15 text-neutral-700 dark:text-neutral-400">
            {t.providers_inactive}
          </Badge>
        ),
    },
    {
      id: "starts_at",
      label: t.ann_starts,
      accessor: (announcement) => announcement.starts_at,
      sortable: true,
      width: 150,
      render: (announcement) => (
        <span className="font-mono text-xs text-muted-foreground">
          {compactDt(announcement.starts_at)}
        </span>
      ),
    },
    {
      id: "ends_at",
      label: t.ann_ends,
      accessor: (announcement) => announcement.ends_at,
      sortable: true,
      width: 150,
      render: (announcement) => (
        <span className="font-mono text-xs text-muted-foreground">
          {compactDt(announcement.ends_at)}
        </span>
      ),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (announcement) => announcement.id,
      width: 130,
      render: (announcement) => (
        <Button
          size="sm"
          variant="destructive"
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(announcement.id);
          }}
        >
          {t.common_delete}
        </Button>
      ),
    },
  ], [
    onDelete,
    t.ann_active,
    t.ann_ends,
    t.ann_message,
    t.ann_starts,
    t.ann_variant,
    t.common_delete,
    t.field_name,
    t.providers_inactive,
    t.users_actions,
    t.users_status,
    variantLabel,
  ]);

  return {
    columns,
    createError,
    creating,
    error,
    fEnds,
    fMsg,
    fTitle,
    fVariant,
    items,
    loading,
    minAnnouncementEndsAt,
    onCreate,
    refresh: load,
    setFEnds,
    setFMsg,
    setFTitle,
    setFVariant,
    setShowCreate,
    showCreate,
  };
}

export function AdminAnnouncementsPage() {
  const { t } = useLang();
  const {
    columns,
    createError,
    creating,
    error,
    fEnds,
    fMsg,
    fTitle,
    fVariant,
    items,
    loading,
    minAnnouncementEndsAt,
    onCreate,
    refresh,
    setFEnds,
    setFMsg,
    setFTitle,
    setFVariant,
    setShowCreate,
    showCreate,
  } = useAdminAnnouncementsController(t);

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.ann_title}
          description={t.ann_subtitle}
          actions={(
            <AdminAnnouncementsHeaderActions
              t={t}
              onCreate={() => setShowCreate(true)}
              onRefresh={() => void refresh()}
            />
          )}
        />

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminAnnouncementsTable
            columns={columns}
            items={items}
            t={t}
          />
        ) : null}
      </div>

      <AdminAnnouncementCreateSheet
        createError={createError}
        creating={creating}
        fEnds={fEnds}
        fMsg={fMsg}
        fTitle={fTitle}
        fVariant={fVariant}
        minAnnouncementEndsAt={minAnnouncementEndsAt}
        showCreate={showCreate}
        t={t}
        onCreate={onCreate}
        onEndsChange={setFEnds}
        onMessageChange={setFMsg}
        onOpenChange={setShowCreate}
        onTitleChange={setFTitle}
        onVariantChange={setFVariant}
      />
    </>
  );
}
