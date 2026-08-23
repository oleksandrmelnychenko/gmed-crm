import { useMemo } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import {
  EmptyCell,
  TabLoader,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";

import type { RelationItem } from "../../model/detail-tab-types";

type Localize = (key: string) => string;

type PatientRelationsTabProps = {
  canManageRelations: boolean;
  formatDateTime: (value?: string | null, fallback?: string) => string;
  l: Localize;
  onCreateRelation: () => void;
  onDeleteRelation: (relationId: string) => void;
  onEditRelation: (relation: RelationItem) => void;
  onOpenPatient: (patientId: string) => void;
  relationTypeLabel: (value: string) => string;
  relations: RelationItem[];
  tabLoading: boolean;
};

function localizeRelationNotes(value: string | null | undefined, lang: "de" | "ru") {
  if (!value) return "";
  const labels =
    lang === "de"
      ? { email: "E-Mail:", birthDate: "Geburtsdatum:", address: "Adresse:" }
      : { email: "Электронная почта:", birthDate: "Дата рождения:", address: "Адрес:" };
  return value
    .replace(/\bEmail:/gi, labels.email)
    .replace(/\bGeburtsdatum:/gi, labels.birthDate)
    .replace(/\bAdresse:/gi, labels.address);
}

export function PatientRelationsTab({
  canManageRelations,
  formatDateTime,
  l,
  onCreateRelation,
  onDeleteRelation,
  onEditRelation,
  onOpenPatient,
  relationTypeLabel,
  relations,
  tabLoading,
}: PatientRelationsTabProps) {
  const { lang, t } = useLang();
  const pagination = useDataTablePagination(
    relations,
    relations.map((item) => item.id).join(":"),
  );
  const columns = useMemo<ColumnDef<RelationItem>[]>(
    () => [
      {
        id: "name",
        label: t.users_name,
        accessor: (relation) => relation.related_display_name || relation.related_name,
        sortable: true,
        searchable: true,
        required: true,
        width: 220,
        render: (relation) => (
          <span className="truncate font-mono text-xs font-medium text-foreground">
            {relation.related_display_name || relation.related_name}
          </span>
        ),
      },
      {
        id: "relation_type",
        label: t.providers_type,
        accessor: (relation) => relationTypeLabel(relation.relation_type),
        sortable: true,
        width: 220,
        render: (relation) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <Badge variant="outline" className="rounded-full font-mono text-[10px]">
              {relationTypeLabel(relation.relation_type)}
            </Badge>
            {relation.is_emergency_contact ? (
              <Badge
                variant="outline"
                className="rounded-full border-rose-200 bg-rose-50 font-mono text-[10px] text-rose-700"
              >
                {l("patients_emergency")}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "pid",
        label: l("documents_pid_fallback"),
        accessor: (relation) => relation.related_patient_pid ?? "",
        sortable: true,
        searchable: true,
        width: 150,
        render: (relation) =>
          relation.related_patient_pid ? (
            <span className="truncate font-mono text-xs text-foreground">
              {relation.related_patient_pid}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
          ),
      },
      {
        id: "phone",
        label: t.field_phone,
        accessor: (relation) => relation.phone ?? "",
        searchable: true,
        width: 160,
        render: (relation) =>
          relation.phone ? (
            <span className="truncate font-mono text-xs tabular-nums text-foreground">
              {relation.phone}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
          ),
      },
      {
        id: "notes",
        label: t.patients_notes,
        accessor: (relation) => localizeRelationNotes(relation.notes, lang),
        searchable: true,
        width: 240,
        render: (relation) => (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={localizeRelationNotes(relation.notes, lang) || undefined}
          >
            {localizeRelationNotes(relation.notes, lang) || t.common_not_set}
          </span>
        ),
      },
      {
        id: "created_at",
        label: t.users_created,
        accessor: (relation) => relation.created_at,
        sortable: true,
        filterType: "date",
        width: 150,
        render: (relation) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatDateTime(relation.created_at)}
          </span>
        ),
      },
    ],
    [formatDateTime, l, lang, relationTypeLabel, t],
  );

  return (
    <TabsContent value="relations" className="mt-4 min-h-[400px]">
        {tabLoading ? (
          <TabLoader />
        ) : relations.length === 0 ? (
          <EmptyCell>{l("patients_not_recorded_yet")}</EmptyCell>
        ) : (
          <DataTableSurface
            rows={pagination.pagedRows}
            columns={columns}
            rowId={(relation) => relation.id}
            dictionary={t as unknown as Record<string, string>}
            emptyState={<EmptyCell>{l("patients_not_recorded_yet")}</EmptyCell>}
            toolbarStart={
              <>
                {canManageRelations ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 rounded-lg gap-1.5"
                    onClick={onCreateRelation}
                  >
                    <Plus className="size-3.5" />
                    {l("patients_new_relation")}
                  </Button>
                ) : null}
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
              </>
            }
            rowActions={(relation) => (
              <div className="flex items-center gap-1">
                {relation.related_patient_id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => onOpenPatient(relation.related_patient_id as string)}
                    aria-label={l("patients_open_patient")}
                    title={l("patients_open_patient")}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                ) : null}
                {canManageRelations ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => onEditRelation(relation)}
                      aria-label={l("patients_edit")}
                      title={l("patients_edit")}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-full text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => onDeleteRelation(relation.id)}
                      aria-label={l("patients_delete")}
                      title={l("patients_delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>
            )}
            rowActionsWidth={120}
            toolbarAfter={
              <DataTablePager
                pageIndex={pagination.pageIndex}
                pageSize={pagination.pageSize}
                totalPages={pagination.totalPages}
                totalRows={pagination.totalRows}
                previousLabel={t.pagination_previous}
                nextLabel={t.pagination_next}
                onPageChange={pagination.onPageChange}
              />
            }
          />
        )}
    </TabsContent>
  );
}
