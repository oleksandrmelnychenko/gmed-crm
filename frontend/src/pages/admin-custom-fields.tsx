import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCcw, X } from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSheetScaffold,
  SheetFormFooter,
  AdminTableCard,
  AdminToolbar,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  Banner,
  EmptyCell,
  PageHeader,
  TabLoader,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import {
  createAdminCustomField,
  deleteAdminCustomField,
  fetchAdminCustomFields,
} from "@/pages/admin/data/admin-api";

interface CustomField {
  id: string;
  entity_type: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: unknown;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

const ENTITY_TYPES = ["lead", "patient", "order", "provider"] as const;
const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;

const ADMIN_CUSTOM_FIELD_REALTIME_EVENTS = [
  "custom_field.created",
  "custom_field.updated",
  "custom_field.deleted",
] as const;

export function AdminCustomFieldsPage() {
  const { t } = useLang();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fEntity, setFEntity] = useState("lead");
  const [fKey, setFKey] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fType, setFType] = useState("text");
  const [fSort, setFSort] = useState("0");
  const [fOptions, setFOptions] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const closeUnsavedConfirmMessage =
    (t as unknown as Record<string, string>).common_discard_unsaved_confirm ??
    "Discard unsaved changes?";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFields(await fetchAdminCustomFields<CustomField>(filterEntity));
    } catch {
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [filterEntity]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeSubscription(ADMIN_CUSTOM_FIELD_REALTIME_EVENTS, () => {
    clearApiCache("/admin/custom-fields");
    void load();
  });

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    setCreateError(null);
    setCreating(true);
    let opts: unknown = undefined;
    if (fOptions.trim()) {
      try {
        opts = JSON.parse(fOptions);
      } catch {
        opts = null;
      }
    }
    try {
      await createAdminCustomField({
        entity_type: fEntity,
        field_key: fKey,
        field_label: fLabel,
        field_type: fType,
        options: opts ?? null,
        is_required: false,
        sort_order: parseInt(fSort, 10) || 0,
      });
      closeCreateSheet();
      void load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setCreateError(message);
      setMsg(message);
    } finally {
      setCreating(false);
    }
  };

  const closeCreateSheet = useCallback(() => {
    setShowCreate(false);
    setCreateError(null);
    setFEntity("lead");
    setFType("text");
    setFSort("0");
    setFKey("");
    setFLabel("");
    setFOptions("");
  }, []);

  const createDirty =
    fEntity !== "lead" ||
    fType !== "text" ||
    fSort !== "0" ||
    fKey.trim().length > 0 ||
    fLabel.trim().length > 0 ||
    fOptions.trim().length > 0;

  const handleCreateSheetOpenChange = useSheetDirtyGuard({
    isDirty: createDirty,
    onClose: closeCreateSheet,
    confirmMessage: closeUnsavedConfirmMessage,
  });

  const onDelete = useCallback(async (id: string) => {
    await deleteAdminCustomField(id);
    void load();
  }, [load]);

  const activeFields = fields.filter((f) => f.is_active);
  const columns = useMemo<ColumnDef<CustomField>[]>(() => [
    {
      id: "entity_type",
      label: t.cf_entity_type,
      accessor: (field) => field.entity_type,
      sortable: true,
      width: 150,
      render: (field) => (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">
          {field.entity_type}
        </Badge>
      ),
    },
    {
      id: "field_key",
      label: t.cf_field_key,
      accessor: (field) => field.field_key,
      sortable: true,
      width: 190,
      render: (field) => <span className="font-mono text-xs">{field.field_key}</span>,
    },
    {
      id: "field_label",
      label: t.cf_field_label,
      accessor: (field) => field.field_label,
      sortable: true,
      width: 220,
      render: (field) => <span className="font-medium">{field.field_label}</span>,
    },
    {
      id: "field_type",
      label: t.cf_field_type,
      accessor: (field) => field.field_type,
      sortable: true,
      width: 150,
      render: (field) => (
        <Badge className="bg-neutral-500/15 text-neutral-700 dark:text-neutral-400">
          {field.field_type}
        </Badge>
      ),
    },
    {
      id: "required",
      label: t.cf_required,
      accessor: (field) => field.is_required,
      sortable: true,
      width: 110,
      render: (field) => (field.is_required ? "yes" : ""),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (field) => field.id,
      width: 150,
      render: (field) => (
        <Button
          size="sm"
          variant="destructive"
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(field.id);
          }}
        >
          {t.common_delete}
        </Button>
      ),
    },
  ], [
    t.cf_entity_type,
    t.cf_field_key,
    t.cf_field_label,
    t.cf_field_type,
    t.cf_required,
    t.common_delete,
    t.users_actions,
    onDelete,
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.cf_title}
        description={t.cf_subtitle}
        actions={(
          <>
            <AdminGuideButton title={t.cf_title} description={t.cf_subtitle} />
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
              {t.cf_new}
            </Button>
          </>
        )}
      />

      {msg ? <Banner tone="error">{msg}</Banner> : null}

      <Sheet open={showCreate} onOpenChange={handleCreateSheetOpenChange}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <form onSubmit={onCreate} className="flex min-h-0 flex-1 flex-col">
            <AdminSheetScaffold
              title={t.cf_new}
              description={t.cf_subtitle}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submitting={creating}
                  onCancel={closeCreateSheet}
                />
              )}
            >
              {createError ? <Banner tone="error">{createError}</Banner> : null}
              <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_entity_type}</Label>
                    <NativeComboboxSelect value={fEntity}
                      onChange={(event) => setFEntity(event.target.value ?? ENTITY_TYPES[0] ?? "patient")} className="h-9 w-full rounded-lg bg-card">
                        {ENTITY_TYPES.map((et) => (
                          <option key={et} value={et}>
                            {et.charAt(0).toUpperCase() + et.slice(1)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_key} *</Label>
                    <Input
                      required
                      placeholder="my_field"
                      value={fKey}
                      onChange={(e) => setFKey(e.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_label} *</Label>
                    <Input
                      required
                      value={fLabel}
                      onChange={(e) => setFLabel(e.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_type}</Label>
                    <NativeComboboxSelect value={fType}
                      onChange={(event) => setFType(event.target.value ?? FIELD_TYPES[0] ?? "text")} className="h-9 w-full rounded-lg bg-card">
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft} value={ft}>
                            {ft.charAt(0).toUpperCase() + ft.slice(1)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_sort}</Label>
                    <Input
                      type="number"
                      value={fSort}
                      onChange={(e) => setFSort(e.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_options}</Label>
                    <Input
                      placeholder='["opt1","opt2"]'
                      value={fOptions}
                      onChange={(e) => setFOptions(e.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </div>
                </div>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      {loading ? <TabLoader /> : null}

      {!loading ? (
        <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
          <NativeComboboxSelect value={filterEntity}
            onChange={(event) => setFilterEntity(event.target.value ?? "")} className="h-8 w-[240px] rounded-lg bg-card text-[13px]">
              <option value="">{t.providers_all}</option>
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et.charAt(0).toUpperCase() + et.slice(1)}
                </option>
              ))}
            </NativeComboboxSelect>

          {filterEntity ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
              onClick={() => setFilterEntity("")}
            >
              <X className="size-3.5" />
              {t.common_reset}
            </Button>
          ) : null}
        </AdminToolbar>
      ) : null}

      {!loading ? (
        <AdminTableCard
          title={t.common_registry}
          description={t.cf_title}
          count={activeFields.length}
        >
          <DataTableSurface
            rows={activeFields}
            columns={columns}
            defaultDensity="compact"
            dictionary={t as unknown as Record<string, string>}
            rowId={(field) => field.id}
            emptyState={<EmptyCell>{t.cf_no_fields}</EmptyCell>}
            tableClassName="min-h-[320px]"
          />
        </AdminTableCard>
      ) : null}
    </div>
  );
}
