import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarRange,
  Download,
  EyeOff,
  FileInput,
  Hash,
  Lock,
  Pencil,
  Scale,
  StickyNote,
  Trash2,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import {
  Banner,
  CountBadge,
  EmptyCell,
  ListItem,
  PageHeader,
  Section,
  StatusBadge,
  TabLoader,
} from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { formatUiText, useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import {
  personnelApi,
  type PersonnelCategory,
  type PersonnelDocument,
  type PersonnelEmployeeFile,
  type PersonnelEvent,
  type PersonnelProfileDocument,
} from "./api";
import { ArchiveDialog, type ArchiveDialogMode } from "./archive-dialog";
import { PersonnelDocumentsTable } from "./documents-list";
import { EmployeeDialog } from "./employee-dialog";
import { canOfferDeletion, eventActionKey, formatEmploymentPeriod } from "./model";
import {
  ArchiveName,
  FilePreviewDialog,
  MutedNote,
  ReasonDialog,
  RowIconAction,
  TableTitle,
  errorMessage,
} from "./personnel-ui";

/** One personnel file: master data, archived documents with versions, journal. */
export function PersonnelEmployeePage() {
  const { employeeId = "" } = useParams<{ employeeId: string }>();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { user } = useAuth();
  const can = useMemo(
    () => ({
      upload: hasCapability(user, "personnel.upload"),
      manage: hasCapability(user, "personnel.manage"),
      retention: hasCapability(user, "personnel.retention"),
    }),
    [user],
  );
  const [file, setFile] = useState<PersonnelEmployeeFile | null>(null);
  const [categories, setCategories] = useState<PersonnelCategory[]>([]);
  const [deletionEnabled, setDeletionEnabled] = useState(false);
  const [events, setEvents] = useState<PersonnelEvent[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [archiveMode, setArchiveMode] = useState<ArchiveDialogMode | null>(null);
  const [previewing, setPreviewing] = useState<PersonnelDocument | null>(null);
  const [holdTarget, setHoldTarget] = useState<PersonnelDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonnelDocument | null>(null);
  const [profileDocuments, setProfileDocuments] = useState<PersonnelProfileDocument[]>([]);

  const load = useCallback(() => {
    setError("");
    personnelApi
      .employee(employeeId)
      .then(setFile)
      .catch((reason: unknown) => setError(errorMessage(reason, t.common_failed_load)));
  }, [employeeId, t.common_failed_load]);

  const loadEvents = useCallback(() => {
    personnelApi
      .events(employeeId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [employeeId]);

  useEffect(() => load(), [load]);
  useEffect(() => loadEvents(), [loadEvents]);
  useEffect(() => {
    personnelApi.categories().then(setCategories).catch(() => setCategories([]));
  }, []);
  useEffect(() => {
    if (!can.retention) return;
    personnelApi
      .settings()
      .then((settings) => setDeletionEnabled(settings.deletion_enabled))
      .catch(() => setDeletionEnabled(false));
  }, [can.retention]);

  const linkedUserId = file?.employee.user_id ?? null;
  const loadProfileDocuments = useCallback(() => {
    if (!can.upload || !linkedUserId) {
      setProfileDocuments([]);
      return;
    }
    personnelApi
      .profileDocuments(employeeId)
      .then(setProfileDocuments)
      .catch(() => setProfileDocuments([]));
  }, [can.upload, employeeId, linkedUserId]);
  useEffect(() => loadProfileDocuments(), [loadProfileDocuments]);
  const importable = profileDocuments.filter((document) => !document.imported);

  const categoryOrder = useMemo(() => categories.map((category) => category.code), [categories]);
  const employee = file?.employee;

  const refreshAfterChange = () => {
    load();
    loadProfileDocuments();
    loadEvents();
  };

  const showDeletion = can.retention && deletionEnabled;
  const documentActionsWidth = 40 + (can.upload ? 92 : 0) + (can.manage ? 32 : 0) + (showDeletion ? 32 : 0);
  const documentActions = (document: PersonnelDocument, isCurrent: boolean) => (
    <>
      {can.upload && isCurrent ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-md px-2 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            setArchiveMode({ kind: "upload", employeeId, supersedes: document });
          }}
        >
          {t.personnel_upload_correction}
        </Button>
      ) : null}
      <RowIconAction
        icon={Download}
        label={t.personnel_download}
        onClick={() =>
          void personnelApi
            .downloadDocument(document)
            .catch((reason: unknown) => toast.error(errorMessage(reason, t.common_failed_load)))
        }
      />
      {can.manage ? (
        <RowIconAction
          icon={Scale}
          label={document.legal_hold ? t.personnel_legal_hold_release : t.personnel_legal_hold_set}
          onClick={() => setHoldTarget(document)}
        />
      ) : null}
      {canOfferDeletion(document, { canRetention: can.retention, deletionEnabled }) ? (
        <RowIconAction icon={Trash2} label={t.personnel_delete} destructive onClick={() => setDeleteTarget(document)} />
      ) : null}
    </>
  );

  return (
    <div className="space-y-4">
      <StaffLink
        to="/personnel"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {t.nav_personnel}
      </StaffLink>
      <PageHeader
        title={employee ? employee.display_name : t.nav_personnel}
        actions={
          employee && can.upload ? (
            <Button
              type="button"
              className="h-9 gap-1.5 rounded-lg px-3.5"
              onClick={() => setArchiveMode({ kind: "upload", employeeId })}
            >
              <Upload className="size-4" />
              {t.personnel_upload}
            </Button>
          ) : null
        }
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!file && !error ? <TabLoader /> : null}

      {employee ? (
        <>
          <section className="relative overflow-hidden rounded-lg border border-border/70 bg-card px-7 py-4">
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-4 h-12 w-1 rounded-r-full",
                employee.is_active ? "bg-emerald-500" : "bg-muted-foreground/30",
              )}
            />
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2
                      className="min-w-0 truncate text-xl font-semibold leading-tight text-foreground"
                      title={employee.display_name}
                    >
                      {employee.display_name}
                    </h2>
                    <StatusBadge tone={employee.is_active ? "success" : "neutral"} className="shrink-0">
                      {employee.is_active ? t.personnel_status_active : t.personnel_status_former}
                    </StatusBadge>
                  </div>
                  {employee.user_name ? (
                    <p className="mt-1.5 break-words text-sm text-muted-foreground">{employee.user_name}</p>
                  ) : null}
                </div>
                {can.manage ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 rounded-lg"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="size-3.5" />
                    {t.personnel_employee_edit}
                  </Button>
                ) : null}
              </div>
              <div className="grid overflow-hidden rounded-lg border border-border/70 bg-card md:grid-cols-2">
                <HeroInfoRow icon={Hash} label={t.personnel_number}>
                  <span className="font-mono">{employee.personnel_number || "—"}</span>
                </HeroInfoRow>
                <HeroInfoRow icon={CalendarRange} label={t.personnel_employment_period}>
                  {formatEmploymentPeriod(employee.employment_start, employee.employment_end, t.personnel_since) || "—"}
                </HeroInfoRow>
                <HeroInfoRow icon={UserRound} label={t.personnel_user_link}>
                  {employee.user_name || "—"}
                </HeroInfoRow>
                {employee.notes ? (
                  <HeroInfoRow icon={StickyNote} label={t.personnel_notes} className="md:col-span-2">
                    <span className="whitespace-pre-line font-normal">{employee.notes}</span>
                  </HeroInfoRow>
                ) : null}
              </div>
            </div>
          </section>

          <MutedNote icon={Lock}>
            {formatUiText(t.personnel_immutable_notice, { days: file?.late_days ?? 7 })}
          </MutedNote>
          {file?.health_hidden ? <MutedNote icon={EyeOff}>{t.personnel_health_hidden}</MutedNote> : null}

          {importable.length > 0 ? (
            <Section title={t.personnel_import_section} accessory={<CountBadge>{importable.length}</CountBadge>}>
              <p className="text-xs text-muted-foreground">{t.personnel_import_hint}</p>
              <div className="grid gap-2 md:grid-cols-2">
                {importable.map((document) => (
                  <ListItem key={document.document_id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <ArchiveName name={document.original_file_name || document.title} />
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {document.title}
                        {document.uploaded_at ? ` · ${formatAppDateTime(document.uploaded_at)}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1.5 rounded-md px-2 text-xs"
                      onClick={() => setArchiveMode({ kind: "profile", employeeId, document })}
                    >
                      <FileInput className="size-3.5" />
                      {t.personnel_import_action}
                    </Button>
                  </ListItem>
                ))}
              </div>
            </Section>
          ) : null}

          <PersonnelDocumentsTable
            title={t.personnel_tab_documents}
            documents={file?.documents ?? []}
            categoryOrder={categoryOrder}
            onPreview={setPreviewing}
            rowActions={documentActions}
            rowActionsWidth={documentActionsWidth}
            emptyText={t.personnel_documents_empty}
            storageKey="personnel-employee-documents"
          />

          {events === null ? <TabLoader /> : <JournalTable events={events} tr={tr} />}
        </>
      ) : null}

      {employee && can.manage ? (
        <EmployeeDialog
          open={editing}
          employee={employee}
          onClose={() => setEditing(false)}
          onSaved={() => refreshAfterChange()}
        />
      ) : null}
      <ArchiveDialog
        open={Boolean(archiveMode)}
        mode={archiveMode}
        categories={categories}
        onClose={() => setArchiveMode(null)}
        onArchived={(document) => {
          toast.success(formatUiText(t.personnel_archived_toast, { name: document.archive_file_name }));
          refreshAfterChange();
        }}
      />
      <FilePreviewDialog
        open={Boolean(previewing)}
        fileName={previewing?.archive_file_name ?? ""}
        mimeType={previewing?.mime_type ?? ""}
        load={() => personnelApi.documentFile(previewing?.id ?? "", true)}
        onClose={() => {
          setPreviewing(null);
          loadEvents();
        }}
        note={t.personnel_access_logged}
      />
      <ReasonDialog
        open={Boolean(holdTarget)}
        title={holdTarget?.legal_hold ? t.personnel_legal_hold_release : t.personnel_legal_hold_set}
        description={
          <>
            {t.personnel_legal_hold_hint} <ArchiveName name={holdTarget?.archive_file_name ?? ""} />
          </>
        }
        confirmLabel={holdTarget?.legal_hold ? t.personnel_legal_hold_release : t.personnel_legal_hold_set}
        optional
        onConfirm={async (reason) => {
          if (!holdTarget) return;
          await personnelApi.setLegalHold(holdTarget.id, !holdTarget.legal_hold, reason);
          refreshAfterChange();
        }}
        onClose={() => setHoldTarget(null)}
      />
      <ReasonDialog
        open={Boolean(deleteTarget)}
        title={t.personnel_delete_title}
        description={
          deleteTarget
            ? formatUiText(t.personnel_delete_description, { name: deleteTarget.archive_file_name })
            : undefined
        }
        confirmLabel={t.personnel_delete}
        destructive
        onConfirm={async (reason) => {
          if (!deleteTarget) return;
          await personnelApi.deleteDocument(deleteTarget.id, reason);
          toast.success(t.personnel_deleted_toast);
          refreshAfterChange();
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/** One fact of the hero card (as on the provider page). */
function HeroInfoRow({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-4 px-3 py-2.5 sm:grid-cols-[10.25rem_minmax(0,1fr)]", className)}>
      <div className="flex min-w-0 items-start gap-2 text-xs font-medium leading-5 text-foreground">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-foreground/75" />
        <span className="min-w-0 break-words">{label}</span>
      </div>
      <div className="-mt-0.5 min-w-0 break-words text-sm font-semibold leading-5 text-foreground">{children}</div>
    </div>
  );
}

function JournalTable({ events, tr }: { events: PersonnelEvent[]; tr: Record<string, string> }) {
  const actionLabel = useCallback(
    (action: string) => {
      const key = eventActionKey(action);
      return key ? tr[key] ?? action : action;
    },
    [tr],
  );
  const columns = useMemo<ColumnDef<PersonnelEvent>[]>(
    () => [
      {
        id: "created_at",
        label: tr.personnel_journal_time,
        accessor: (event) => event.created_at,
        filterType: "date",
        sortable: true,
        width: 160,
        render: (event) => (
          <span className="font-mono text-xs tabular-nums text-foreground">{formatAppDateTime(event.created_at)}</span>
        ),
      },
      {
        id: "action",
        label: tr.personnel_journal_action,
        accessor: (event) => actionLabel(event.action),
        filterType: "text",
        sortable: true,
        required: true,
        width: 280,
        render: (event) => <span className="truncate text-xs font-medium text-foreground">{actionLabel(event.action)}</span>,
      },
      {
        id: "actor",
        label: tr.personnel_journal_actor,
        accessor: (event) => event.actor_name ?? "",
        filterType: "text",
        sortable: true,
        width: 180,
        render: (event) => <span className="truncate text-xs">{event.actor_name || "—"}</span>,
      },
      {
        id: "archive_file_name",
        label: tr.personnel_will_be_archived_as,
        accessor: (event) => event.archive_file_name ?? "",
        filterType: "text",
        minWidth: 320,
        render: (event) =>
          event.archive_file_name ? (
            <span className="truncate font-mono text-xs" title={event.archive_file_name}>
              {event.archive_file_name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [actionLabel, tr],
  );

  return (
    <DataTableSurface
      rows={events}
      columns={columns}
      rowId={(event) => event.id}
      defaultDensity="comfortable"
      dictionary={tr}
      storageKey="personnel-employee-journal"
      mobilePrimaryColumnId="action"
      mobileDetailColumnIds={["created_at", "actor", "archive_file_name"]}
      pagination={{ pageSize: 25 }}
      toolbarStart={<TableTitle count={events.length}>{tr.personnel_tab_journal}</TableTitle>}
      emptyState={<EmptyCell>{tr.personnel_journal_empty}</EmptyCell>}
    />
  );
}
