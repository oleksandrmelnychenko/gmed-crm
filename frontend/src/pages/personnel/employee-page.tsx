import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Eye,
  FileInput,
  FilePen,
  Lock,
  Pencil,
  Scale,
  Trash2,
  Upload,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner, PageHeader, StatusBadge, TabLoader } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { formatUiText, useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";

import {
  personnelApi,
  type PersonnelCategory,
  type PersonnelDocument,
  type PersonnelEmployeeFile,
  type PersonnelEvent,
  type PersonnelProfileDocument,
} from "./api";
import { ArchiveDialog, type ArchiveDialogMode } from "./archive-dialog";
import { PersonnelDocumentsList } from "./documents-list";
import { EmployeeDialog } from "./employee-dialog";
import { canOfferDeletion, eventActionKey, formatEmploymentPeriod } from "./model";
import {
  ArchiveName,
  FilePreviewDialog,
  ReasonDialog,
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
  const [tab, setTab] = useState<"documents" | "journal">("documents");
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
  useEffect(() => {
    if (tab === "journal") loadEvents();
  }, [loadEvents, tab]);

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
    if (tab === "journal") loadEvents();
  };

  const documentActions = (document: PersonnelDocument, isCurrent: boolean) => (
    <>
      <Button type="button" size="xs" variant="outline" onClick={() => setPreviewing(document)}>
        <Eye />
        {t.personnel_preview}
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() =>
          void personnelApi
            .downloadDocument(document)
            .catch((reason: unknown) => toast.error(errorMessage(reason, t.common_failed_load)))
        }
      >
        <Download />
        {t.personnel_download}
      </Button>
      {can.upload && isCurrent ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setArchiveMode({ kind: "upload", employeeId, supersedes: document })}
        >
          <FilePen />
          {t.personnel_upload_correction}
        </Button>
      ) : null}
      {can.manage ? (
        <Button type="button" size="xs" variant="ghost" onClick={() => setHoldTarget(document)}>
          <Scale />
          {document.legal_hold ? t.personnel_legal_hold_release : t.personnel_legal_hold_set}
        </Button>
      ) : null}
      {canOfferDeletion(document, { canRetention: can.retention, deletionEnabled }) ? (
        <Button type="button" size="xs" variant="destructive" onClick={() => setDeleteTarget(document)}>
          <Trash2 />
          {t.personnel_delete}
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={employee ? employee.display_name : t.nav_personnel}
        actions={
          employee ? (
            <>
              {can.manage ? (
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil />
                  {t.personnel_employee_edit}
                </Button>
              ) : null}
              {can.upload ? (
                <Button type="button" onClick={() => setArchiveMode({ kind: "upload", employeeId })}>
                  <Upload />
                  {t.personnel_upload}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      <StaffLink to="/personnel" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t.nav_personnel}
      </StaffLink>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!file && !error ? <TabLoader /> : null}

      {employee ? (
        <>
          <section className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <HeaderItem label={t.personnel_status}>
              <StatusBadge tone={employee.is_active ? "success" : "neutral"}>
                {employee.is_active ? t.personnel_status_active : t.personnel_status_former}
              </StatusBadge>
            </HeaderItem>
            <HeaderItem label={t.personnel_number}>
              <span className="font-mono">{employee.personnel_number || "—"}</span>
            </HeaderItem>
            <HeaderItem label={t.personnel_employment_period}>
              {formatEmploymentPeriod(employee.employment_start, employee.employment_end, t.personnel_since) || "—"}
            </HeaderItem>
            <HeaderItem label={t.personnel_user_link}>{employee.user_name || "—"}</HeaderItem>
            {employee.notes ? (
              <HeaderItem label={t.personnel_notes} className="sm:col-span-2 lg:col-span-4">
                <span className="whitespace-pre-line">{employee.notes}</span>
              </HeaderItem>
            ) : null}
          </section>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>{formatUiText(t.personnel_immutable_notice, { days: file?.late_days ?? 7 })}</span>
          </div>
          {file?.health_hidden ? (
            <p className="text-xs text-muted-foreground">{t.personnel_health_hidden}</p>
          ) : null}

          {importable.length > 0 ? (
            <section className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-sky-950">
                <FileInput className="size-4" />
                {t.personnel_import_section}
              </p>
              <p className="text-xs text-sky-900/80">{t.personnel_import_hint}</p>
              <ul className="divide-y divide-sky-200/70">
                {importable.map((document) => (
                  <li
                    key={document.document_id}
                    className="flex flex-col gap-1.5 py-1.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <ArchiveName name={document.original_file_name || document.title} />
                      <p className="text-xs text-muted-foreground">
                        {document.title}
                        {document.uploaded_at ? ` · ${formatAppDateTime(document.uploaded_at)}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => setArchiveMode({ kind: "profile", employeeId, document })}
                    >
                      <FileInput />
                      {t.personnel_import_action}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Tabs value={tab} onValueChange={(value) => setTab(value as "documents" | "journal")}>
            <TabsList>
              <TabsTrigger value="documents">
                {t.personnel_tab_documents}
              </TabsTrigger>
              <TabsTrigger value="journal">{t.personnel_tab_journal}</TabsTrigger>
            </TabsList>
            <TabsContent value="documents" className="pt-2">
              <PersonnelDocumentsList
                documents={file?.documents ?? []}
                categoryOrder={categoryOrder}
                actions={documentActions}
                emptyText={t.personnel_documents_empty}
              />
            </TabsContent>
            <TabsContent value="journal" className="pt-2">
              {events === null ? <TabLoader /> : <JournalList events={events} tr={tr} />}
            </TabsContent>
          </Tabs>
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
        title={t.personnel_preview}
        fileName={previewing?.archive_file_name ?? ""}
        mimeType={previewing?.mime_type ?? ""}
        load={() => personnelApi.documentFile(previewing?.id ?? "", true)}
        onClose={() => setPreviewing(null)}
        footerNote={t.personnel_access_logged}
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

function HeaderItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}

function JournalList({ events, tr }: { events: PersonnelEvent[]; tr: Record<string, string> }) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{tr.personnel_journal_empty}</p>;
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {events.map((event) => {
        const key = eventActionKey(event.action);
        return (
          <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-start sm:gap-4">
            <span className="w-36 shrink-0 text-xs text-muted-foreground">
              {formatAppDateTime(event.created_at)}
            </span>
            <div className="min-w-0 space-y-0.5">
              <p>
                <span className="font-medium">{key ? tr[key] ?? event.action : event.action}</span>
                {event.actor_name ? (
                  <span className="text-muted-foreground"> · {event.actor_name}</span>
                ) : null}
              </p>
              {event.archive_file_name ? <ArchiveName name={event.archive_file_name} /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
