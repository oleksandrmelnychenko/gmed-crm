import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCcw } from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
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

export function AdminAnnouncementsPage() {
  const { t } = useLang();

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fMsg, setFMsg] = useState("");
  const [fVariant, setFVariant] = useState("info");
  const [fEnds, setFEnds] = useState("");
  const [minAnnouncementEndsAt, setMinAnnouncementEndsAt] = useState(() => toDateTimeLocalInput(new Date()));

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

  useEffect(() => {
    if (!showCreate) {
      return;
    }
    setMinAnnouncementEndsAt(toDateTimeLocalInput(new Date()));
  }, [showCreate]);

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
    await deleteAdminAnnouncement(id);
    void load();
  }, [load]);

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

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.ann_title}
          description={t.ann_subtitle}
          actions={(
            <>
              <AdminGuideButton title={t.ann_title} description={t.ann_subtitle} />
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="size-3.5" />
                {t.ann_new}
              </Button>
            </>
          )}
        />

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminTableCard
            title={t.ann_title}
            description={t.ann_subtitle}
            count={items.length}
          >
            <DataTableSurface
              rows={items}
              columns={columns}
              defaultDensity="compact"
              dictionary={t as unknown as Record<string, string>}
              rowId={(announcement) => announcement.id}
              emptyState={<EmptyCell>{t.ann_no_announcements}</EmptyCell>}
              tableClassName="min-h-[320px]"
            />
          </AdminTableCard>
        ) : null}
      </div>

      <Sheet open={showCreate} onOpenChange={setShowCreate}>
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
                  onCancel={() => setShowCreate(false)}
                />
              )}
            >
              {createError ? <Banner tone="error">{createError}</Banner> : null}

              <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={`${t.field_name} *`} htmlFor="announcement-title">
                    <Input
                      id="announcement-title"
                      required
                      value={fTitle}
                      onChange={(e) => setFTitle(e.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </Field>
                  <Field label={t.ann_variant} htmlFor="announcement-variant">
                    <NativeComboboxSelect value={fVariant}
                      onChange={(event) => setFVariant(event.target.value ?? "info")} id="announcement-variant" className="!h-9 w-full rounded-lg bg-card">
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
                    onChange={(e) => setFMsg(e.target.value)}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
                <Field label={t.ann_ends} htmlFor="announcement-ends">
                  <Input
                    id="announcement-ends"
                    type="datetime-local"
                    value={fEnds}
                    onChange={(e) => setFEnds(e.target.value)}
                    min={minAnnouncementEndsAt}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
