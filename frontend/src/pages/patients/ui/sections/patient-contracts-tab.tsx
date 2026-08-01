import { useMemo } from "react";
import { ExternalLink, Pencil, Plus } from "lucide-react";

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
import { cn } from "@/lib/utils";

import type { ContractItem } from "../../model/detail-tab-types";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;

type PatientContractsTabProps = {
  l: LocalizeFn;
  commonNotSet: string;
  tabLoading: boolean;
  contracts: ContractItem[];
  contractSignedCount: number;
  contractPendingCount: number;
  contractExpiringSoonCount: number;
  canManageContracts: boolean;
  onCreateContract: () => void;
  onEditContractStatus: (contract: ContractItem) => void;
  onOpenContract: (contractId: string) => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  isContractExpiringSoon: (contract: ContractItem) => boolean;
};

export function PatientContractsTab({
  l,
  commonNotSet,
  tabLoading,
  contracts,
  canManageContracts,
  onCreateContract,
  onEditContractStatus,
  onOpenContract,
  statusColors,
  statusLabel,
  formatDate,
  formatDateTime,
  isContractExpiringSoon,
}: PatientContractsTabProps) {
  const { t } = useLang();
  const pagination = useDataTablePagination(
    contracts,
    contracts.map((contract) => contract.id).join(":"),
  );
  const columns = useMemo<ColumnDef<ContractItem>[]>(
    () => [
      {
        id: "contract_number",
        label: l("patients_contract"),
        accessor: (contract) => contract.contract_number,
        sortable: true,
        searchable: true,
        required: true,
        width: 220,
        render: (contract) => (
          <span className="font-mono text-xs tracking-[0.12em] text-foreground">
            {contract.contract_number}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (contract) => statusLabel(contract.status),
        sortable: true,
        width: 160,
        render: (contract) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full font-mono text-[10px]",
              statusColors[contract.status] ?? "",
            )}
          >
            {statusLabel(contract.status)}
          </Badge>
        ),
      },
      {
        id: "signed_at",
        label: l("patients_signed"),
        accessor: (contract) => contract.signed_at ?? "",
        sortable: true,
        filterType: "date",
        width: 190,
        render: (contract) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDateTime(contract.signed_at, commonNotSet)}
          </span>
        ),
      },
      {
        id: "valid_from",
        label: l("patients_valid_from"),
        accessor: (contract) => contract.valid_from ?? "",
        sortable: true,
        filterType: "date",
        width: 150,
        render: (contract) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDate(contract.valid_from, commonNotSet)}
          </span>
        ),
      },
      {
        id: "valid_to",
        label: l("patients_valid_to"),
        accessor: (contract) => contract.valid_to ?? "",
        sortable: true,
        filterType: "date",
        width: 220,
        render: (contract) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
              {formatDate(contract.valid_to, commonNotSet)}
            </span>
            {contract.valid_to && isContractExpiringSoon(contract) ? (
              <Badge
                variant="outline"
                className="rounded-full border-amber-200 bg-amber-50 font-mono text-[10px] text-amber-700"
              >
                {l("patients_expiring_soon_2")}
              </Badge>
            ) : null}
          </div>
        ),
      },
    ],
    [
      commonNotSet,
      formatDate,
      formatDateTime,
      isContractExpiringSoon,
      l,
      statusColors,
      statusLabel,
      t,
    ],
  );

  return (
    <TabsContent value="contracts" className="space-y-4 mt-4 min-h-[400px]">
        {tabLoading ? (
          <TabLoader />
        ) : contracts.length === 0 ? (
          <EmptyCell>
            {l("patients_no_contract_has_been_created_for_this_patient_yet")}
          </EmptyCell>
        ) : (
          <DataTableSurface
            rows={pagination.pagedRows}
            columns={columns}
            rowId={(contract) => contract.id}
            dictionary={t as unknown as Record<string, string>}
            emptyState={
              <EmptyCell>
                {l("patients_no_contract_has_been_created_for_this_patient_yet")}
              </EmptyCell>
            }
            onRowClick={(contract) => onOpenContract(contract.id)}
            toolbarStart={
              canManageContracts ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 rounded-lg gap-1.5"
                    onClick={onCreateContract}
                  >
                    <Plus className="size-3.5" />
                    {l("patients_new_contract")}
                  </Button>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
                </>
              ) : undefined
            }
            rowActions={(contract) => (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenContract(contract.id)}
                  aria-label={l("patients_open")}
                  title={l("patients_open")}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
                {canManageContracts ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => onEditContractStatus(contract)}
                    aria-label={l("patients_update_status")}
                    title={l("patients_update_status")}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            )}
            rowActionsWidth={100}
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
