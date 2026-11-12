import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  ListFilter,
  ListPlus,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSectionTitle,
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
import { formatEnumLabelFromKeys, formatUiText, useLang, type TranslationKey } from "@/lib/i18n";
import { codedAdminErrorText } from "@/pages/admin-pages.helpers";
import { useRealtimeSubscription } from "@/lib/realtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import {
  createAdminCustomField,
  deleteAdminCustomField,
  fetchAdminCustomFields,
  updateAdminCustomField,
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

/** The key rule the server checks too (screens QA 2026-11-12, E F9). */
export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** The list options typed as "a, b, c": trimmed, without empty or repeated ones. */
export function parseCustomFieldOptions(raw: string): string[] {
  const options: string[] = [];
  for (const value of raw.split(",")) {
    const option = value.trim();
    if (option && !options.includes(option)) options.push(option);
  }
  return options;
}

/** The stored options of a field as the form shows them. */
export function customFieldOptionsText(options: unknown): string {
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string").join(", ")
    : "";
}

const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;

const ENTITY_TYPE_LABEL_KEYS = {
  lead: "cf_entity_lead",
  patient: "cf_entity_patient",
  order: "cf_entity_order",
  provider: "cf_entity_provider",
} as const satisfies Partial<Record<string, TranslationKey>>;

const FIELD_TYPE_LABEL_KEYS = {
  text: "cf_field_type_text",
  number: "cf_field_type_number",
  date: "cf_field_type_date",
  boolean: "cf_field_type_boolean",
  select: "cf_field_type_select",
} as const satisfies Partial<Record<string, TranslationKey>>;

const ADMIN_CUSTOM_FIELD_REALTIME_EVENTS = [
  "custom_field.created",
  "custom_field.updated",
  "custom_field.deleted",
] as const;

type AdminCustomFieldsState = {
  fields: CustomField[];
  loading: boolean;
  filterEntity: string;
  msg: string | null;
  showCreate: boolean;
  /** The field the form edits; empty for a new field. */
  editingId: string;
  creating: boolean;
  fEntity: string;
  fKey: string;
  fLabel: string;
  fType: string;
  fSort: string;
  fOptions: string;
  fRequired: boolean;
  createError: string | null;
};

type AdminCustomFieldsPatch =
  | Partial<AdminCustomFieldsState>
  | ((current: AdminCustomFieldsState) => Partial<AdminCustomFieldsState>);

function adminCustomFieldsReducer(
  current: AdminCustomFieldsState,
  patch: AdminCustomFieldsPatch,
): AdminCustomFieldsState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveAdminCustomFieldsStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createAdminCustomFieldsPatch<K extends keyof AdminCustomFieldsState>(
  field: K,
  nextValue: SetStateAction<AdminCustomFieldsState[K]>,
): AdminCustomFieldsPatch {
  return (current) => ({
    [field]: resolveAdminCustomFieldsStateAction(nextValue, current[field]),
  } as Partial<AdminCustomFieldsState>);
}

type AdminCustomFieldsHeaderActionsProps = {
  t: Record<string, string>;
  onCreate: () => void;
  onRefresh: () => void;
};

function AdminCustomFieldsHeaderActions({
  t,
  onCreate,
  onRefresh,
}: AdminCustomFieldsHeaderActionsProps) {
  return (
    <>
      <AdminGuideButton title={t.cf_title} description={t.cf_subtitle} />
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
        {t.cf_new}
      </Button>
    </>
  );
}

type AdminCustomFieldsPageHeaderProps = {
  t: Record<string, string>;
  onCreate: () => void;
  onRefresh: () => void;
};

function AdminCustomFieldsPageHeader({
  t,
  onCreate,
  onRefresh,
}: AdminCustomFieldsPageHeaderProps) {
  return (
    <PageHeader
      title={t.cf_title}
      description={t.cf_subtitle}
      actions={(
        <AdminCustomFieldsHeaderActions
          t={t}
          onCreate={onCreate}
          onRefresh={onRefresh}
        />
      )}
    />
  );
}

type AdminCustomFieldCreateSheetProps = {
  createError: string | null;
  creating: boolean;
  entityTypeLabel: (value: string | null | undefined) => string;
  fieldTypeLabel: (value: string | null | undefined) => string;
  fEntity: string;
  fKey: string;
  fLabel: string;
  fOptions: string;
  fSort: string;
  fType: string;
  fRequired: boolean;
  editing: boolean;
  showCreate: boolean;
  dirty: boolean;
  t: Record<string, string>;
  onClose: () => void;
  onCreate: (event: FormEvent) => void;
  onEntityChange: (value: string) => void;
  onKeyChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onOptionsChange: (value: string) => void;
  onRequiredChange: (value: boolean) => void;
  onSortChange: (value: string) => void;
  onTypeChange: (value: string) => void;
};

function AdminCustomFieldCreateSheet({
  createError,
  creating,
  entityTypeLabel,
  fieldTypeLabel,
  fEntity,
  fKey,
  fLabel,
  fOptions,
  fSort,
  fType,
  fRequired,
  editing,
  showCreate,
  dirty,
  t,
  onClose,
  onCreate,
  onEntityChange,
  onKeyChange,
  onLabelChange,
  onOpenChange,
  onOptionsChange,
  onRequiredChange,
  onSortChange,
  onTypeChange,
}: AdminCustomFieldCreateSheetProps) {
  const title = editing ? t.cf_edit : t.cf_new;
  return (
    <Sheet open={showCreate} onOpenChange={onOpenChange} dirty={dirty}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
        <form onSubmit={onCreate} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            icon={ListPlus}
            title={title}
            description={t.cf_subtitle}
            footer={(
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={t.common_save}
                submitting={creating}
                onCancel={onClose}
              />
            )}
          >
            {createError ? <Banner tone="error">{createError}</Banner> : null}
            <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5">
              <AdminSectionTitle icon={ListPlus}>{title}</AdminSectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_entity_type}</Label>
                  <NativeComboboxSelect value={fEntity} disabled={editing}
                    onChange={(event) => onEntityChange(event.target.value ?? ENTITY_TYPES[0] ?? "patient")} className="h-9 w-full rounded-lg bg-field">
                      {ENTITY_TYPES.map((et) => (
                        <option key={et} value={et}>
                          {entityTypeLabel(et)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_key} *</Label>
                  <Input
                    required
                    disabled={editing}
                    maxLength={63}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={t.cf_field_key_placeholder}
                    value={fKey}
                    onChange={(event) => onKeyChange(event.target.value)}
                    className="h-9 rounded-lg bg-field font-mono"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {editing ? t.cf_key_locked_hint : t.cf_key_hint}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_label} *</Label>
                  <Input
                    required
                    maxLength={120}
                    value={fLabel}
                    onChange={(event) => onLabelChange(event.target.value)}
                    className="h-9 rounded-lg bg-field"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_type}</Label>
                  <NativeComboboxSelect value={fType}
                    onChange={(event) => onTypeChange(event.target.value ?? FIELD_TYPES[0] ?? "text")} className="h-9 w-full rounded-lg bg-field">
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft} value={ft}>
                          {fieldTypeLabel(ft)}
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
                    onChange={(event) => onSortChange(event.target.value)}
                    className="h-9 rounded-lg bg-field"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_options}</Label>
                  <Input
                    placeholder={t.cf_options_placeholder}
                    value={fOptions}
                    disabled={fType !== "select"}
                    required={fType === "select"}
                    onChange={(event) => onOptionsChange(event.target.value)}
                    className="h-9 rounded-lg bg-field"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">{t.cf_options_hint}</p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={fRequired}
                  onChange={(event) => onRequiredChange(event.target.checked)}
                />
                {t.cf_required}
                <span className="text-[11.5px] text-muted-foreground">· {t.cf_required_hint}</span>
              </label>
            </section>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type AdminCustomFieldsToolbarSectionProps = {
  entityTypeLabel: (value: string | null | undefined) => string;
  filterEntity: string;
  t: Record<string, string>;
  onFilterEntityChange: (value: string) => void;
};

function AdminCustomFieldsToolbarSection({
  entityTypeLabel,
  filterEntity,
  t,
  onFilterEntityChange,
}: AdminCustomFieldsToolbarSectionProps) {
  return (
    <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
      <NativeComboboxSelect value={filterEntity}
        onChange={(event) => onFilterEntityChange(event.target.value ?? "")} className="h-8 w-[240px] rounded-lg bg-field text-[13px]">
          <option value="">{t.providers_all}</option>
          {ENTITY_TYPES.map((et) => (
            <option key={et} value={et}>
              {entityTypeLabel(et)}
            </option>
          ))}
        </NativeComboboxSelect>

      {filterEntity ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
          onClick={() => onFilterEntityChange("")}
        >
          <X className="size-3.5" />
          {t.common_reset}
        </Button>
      ) : null}
    </AdminToolbar>
  );
}

type AdminCustomFieldsTableProps = {
  activeFields: CustomField[];
  columns: ColumnDef<CustomField>[];
  t: Record<string, string>;
};

function AdminCustomFieldsTable({
  activeFields,
  columns,
  t,
}: AdminCustomFieldsTableProps) {
  return (
    <AdminTableCard
      icon={ListFilter}
      title={t.common_registry}
      description={t.cf_title}
      count={activeFields.length}
    >
      <DataTableSurface
        rows={activeFields}
        columns={columns}
        defaultDensity="compact"
        dictionary={t}
        rowId={(field) => field.id}
        emptyState={<EmptyCell>{t.cf_no_fields}</EmptyCell>}
        tableClassName="min-h-[320px]"
      />
    </AdminTableCard>
  );
}

export function AdminCustomFieldsPage() {
  const { t } = useLang();

  const [customFieldsState, dispatchCustomFieldsState] = useReducer(
    adminCustomFieldsReducer,
    undefined,
    (): AdminCustomFieldsState => ({
      fields: [],
      loading: true,
      filterEntity: "",
      msg: null,
      showCreate: false,
      editingId: "",
      creating: false,
      fEntity: "lead",
      fKey: "",
      fLabel: "",
      fType: "text",
      fSort: "0",
      fOptions: "",
      fRequired: false,
      createError: null,
    }),
  );
  const {
    createError,
    creating,
    editingId,
    fields,
    filterEntity,
    fEntity,
    fKey,
    fLabel,
    fOptions,
    fRequired,
    fSort,
    fType,
    loading,
    msg,
    showCreate,
  } = customFieldsState;
  const setCustomFieldsField = <K extends keyof AdminCustomFieldsState>(
    field: K,
    nextValue: SetStateAction<AdminCustomFieldsState[K]>,
  ) =>
    dispatchCustomFieldsState(
      createAdminCustomFieldsPatch(field, nextValue),
    );
  const setFields = (nextValue: SetStateAction<CustomField[]>) =>
    setCustomFieldsField("fields", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setCustomFieldsField("loading", nextValue);
  const setFilterEntity = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("filterEntity", nextValue);
  const setMsg = (nextValue: SetStateAction<string | null>) =>
    setCustomFieldsField("msg", nextValue);
  const setShowCreate = (nextValue: SetStateAction<boolean>) =>
    setCustomFieldsField("showCreate", nextValue);
  const setCreating = (nextValue: SetStateAction<boolean>) =>
    setCustomFieldsField("creating", nextValue);
  const setFEntity = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("fEntity", nextValue);
  const setFKey = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("fKey", nextValue);
  const setFLabel = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("fLabel", nextValue);
  const setFType = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("fType", nextValue);
  const setFSort = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("fSort", nextValue);
  const setFOptions = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("fOptions", nextValue);
  const setEditingId = (nextValue: SetStateAction<string>) =>
    setCustomFieldsField("editingId", nextValue);
  const setFRequired = (nextValue: SetStateAction<boolean>) =>
    setCustomFieldsField("fRequired", nextValue);
  const setCreateError = (nextValue: SetStateAction<string | null>) =>
    setCustomFieldsField("createError", nextValue);

  const closeUnsavedConfirmMessage = t.common_discard_unsaved_confirm;

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      setFields(await fetchAdminCustomFields<CustomField>(filterEntity));
    } catch (loadError) {
      setFields([]);
      setMsg(loadError instanceof Error ? loadError.message : t.common_error);
    } finally {
      setLoading(false);
    }
  }, [filterEntity, t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeSubscription(ADMIN_CUSTOM_FIELD_REALTIME_EVENTS, () => {
    clearApiCache("/admin/custom-fields");
    void load();
  });

  const fieldErrorMessages = useMemo(
    () => ({
      custom_field_key_invalid: t.cf_error_key_invalid,
      custom_field_key_exists: t.cf_error_key_exists,
      custom_field_label_invalid: t.cf_error_label_invalid,
      custom_field_type_invalid: t.cf_error_type_invalid,
      custom_field_entity_invalid: t.cf_error_entity_invalid,
      custom_field_options_required: t.cf_error_options_required,
      custom_field_options_invalid: t.cf_error_options_invalid,
      custom_field_not_found: t.cf_error_not_found,
    }),
    [t],
  );

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    setCreateError(null);
    const fieldKey = fKey.trim();
    if (!editingId && !CUSTOM_FIELD_KEY_PATTERN.test(fieldKey)) {
      setCreateError(t.cf_error_key_invalid);
      return;
    }
    const options = fType === "select" ? parseCustomFieldOptions(fOptions) : [];
    if (fType === "select" && (options.length === 0 || options.length > 100)) {
      setCreateError(t.cf_error_options_required);
      return;
    }
    setCreating(true);
    const payload = {
      entity_type: fEntity,
      field_key: fieldKey,
      field_label: fLabel.trim(),
      field_type: fType,
      options: options.length > 0 ? options : null,
      is_required: fRequired,
      sort_order: parseInt(fSort, 10) || 0,
    };
    try {
      if (editingId) {
        await updateAdminCustomField(editingId, payload);
      } else {
        await createAdminCustomField(payload);
      }
      closeCreateSheet();
      void load();
    } catch (e) {
      setCreateError(codedAdminErrorText(e, fieldErrorMessages, t.common_error));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = useCallback((field: CustomField) => {
    dispatchCustomFieldsState({
      createError: null,
      editingId: field.id,
      fEntity: field.entity_type,
      fKey: field.field_key,
      fLabel: field.field_label,
      fOptions: customFieldOptionsText(field.options),
      fRequired: field.is_required,
      fSort: String(field.sort_order ?? 0),
      fType: field.field_type,
      showCreate: true,
    });
  }, []);

  const closeCreateSheet = useCallback(() => {
    setShowCreate(false);
    setCreateError(null);
    setEditingId("");
    setFRequired(false);
    setFEntity("lead");
    setFType("text");
    setFSort("0");
    setFKey("");
    setFLabel("");
    setFOptions("");
  }, []);

  const editedField = editingId ? fields.find((field) => field.id === editingId) : undefined;
  const createDirty = editedField
    ? fLabel !== editedField.field_label ||
      fType !== editedField.field_type ||
      fRequired !== editedField.is_required ||
      fSort !== String(editedField.sort_order ?? 0) ||
      fOptions !== customFieldOptionsText(editedField.options)
    : fRequired ||
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

  // A deleted field disappears from the list: ask first (screens QA E F6), in
  // the page's own dialog like the other admin deletes — a suppressed browser
  // confirm() made the button silently do nothing (QA 2026-11-12 S3-12).
  const [pendingDelete, setPendingDelete] = useState<CustomField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const onDelete = useCallback((field: CustomField) => {
    setPendingDelete(field);
  }, []);
  const confirmDelete = useCallback(async () => {
    const field = pendingDelete;
    if (!field) return;
    setDeleting(true);
    setMsg(null);
    try {
      await deleteAdminCustomField(field.id);
    } catch (e) {
      setMsg(codedAdminErrorText(e, fieldErrorMessages, t.common_error));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
    void load();
  }, [fieldErrorMessages, load, pendingDelete, t.common_error]);

  const activeFields = fields.filter((f) => f.is_active);
  const entityTypeLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ENTITY_TYPE_LABEL_KEYS, t),
    [t],
  );
  const fieldTypeLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, FIELD_TYPE_LABEL_KEYS, t),
    [t],
  );
  const columns = useMemo<ColumnDef<CustomField>[]>(() => [
    {
      id: "entity_type",
      label: t.cf_entity_type,
      accessor: (field) => field.entity_type,
      sortable: true,
      width: 150,
      render: (field) => (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">
          {entityTypeLabel(field.entity_type)}
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
      render: (field) => <span className="">{field.field_label}</span>,
    },
    {
      id: "field_type",
      label: t.cf_field_type,
      accessor: (field) => field.field_type,
      sortable: true,
      width: 150,
      render: (field) => (
        <Badge className="bg-neutral-500/15 text-neutral-700 dark:text-neutral-400">
          {fieldTypeLabel(field.field_type)}
        </Badge>
      ),
    },
    {
      id: "required",
      label: t.cf_required,
      accessor: (field) => field.is_required,
      sortable: true,
      width: 110,
      render: (field) => (field.is_required ? t.common_yes : ""),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (field) => field.id,
      width: 200,
      render: (field) => (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation();
              openEdit(field);
            }}
          >
            {t.common_edit}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(field);
            }}
          >
            {t.common_delete}
          </Button>
        </div>
      ),
    },
  ], [
    t.common_edit,
    openEdit,
    t.cf_entity_type,
    t.cf_field_key,
    t.cf_field_label,
    t.cf_field_type,
    t.cf_required,
    t.common_delete,
    t.common_yes,
    t.users_actions,
    entityTypeLabel,
    fieldTypeLabel,
    onDelete,
  ]);

  return (
    <div className="space-y-3">
      <AdminCustomFieldsPageHeader
        t={t as unknown as Record<string, string>}
        onCreate={() => setShowCreate(true)}
        onRefresh={() => void load()}
      />

      <Banner tone="warning">{t.cf_not_on_forms}</Banner>

      {msg ? <Banner tone="error">{msg}</Banner> : null}

      <AdminCustomFieldCreateSheet
        createError={createError} creating={creating}
        entityTypeLabel={entityTypeLabel} fieldTypeLabel={fieldTypeLabel}
        fEntity={fEntity} fKey={fKey} fLabel={fLabel}
        fOptions={fOptions} fSort={fSort} fType={fType} showCreate={showCreate}
        fRequired={fRequired} editing={Boolean(editingId)}
        onRequiredChange={setFRequired}
        dirty={createDirty}
        t={t as unknown as Record<string, string>}
        onClose={closeCreateSheet} onCreate={onCreate}
        onEntityChange={setFEntity} onKeyChange={setFKey} onLabelChange={setFLabel}
        onOpenChange={handleCreateSheetOpenChange}
        onOptionsChange={setFOptions} onSortChange={setFSort} onTypeChange={setFType}
      />

      {loading ? <TabLoader /> : null}

      {!loading ? (
        <AdminCustomFieldsToolbarSection
          entityTypeLabel={entityTypeLabel}
          filterEntity={filterEntity}
          t={t as unknown as Record<string, string>}
          onFilterEntityChange={setFilterEntity}
        />
      ) : null}

      {!loading ? (
        <AdminCustomFieldsTable
          activeFields={activeFields}
          columns={columns}
          t={t as unknown as Record<string, string>}
        />
      ) : null}

      <DirtyDismissConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={t.common_delete}
        message={pendingDelete ? formatUiText(t.cf_delete_confirm, { label: pendingDelete.field_label }) : ""}
        cancelLabel={t.common_cancel}
        confirmLabel={t.common_delete}
        confirmDisabled={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
