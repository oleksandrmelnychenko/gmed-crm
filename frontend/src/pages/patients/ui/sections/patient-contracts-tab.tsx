import { useMemo, useState } from "react";
import { Ban, Eye, FileSignature, Pencil, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  canTerminateContractStatus,
  isContractClosed,
} from "@/pages/contracts/model/contracts-model";
import {
  ContractTerminationNote,
  TerminateContractDialog,
} from "@/pages/contracts/ui/terminate-contract-dialog";

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
  canManageContracts: boolean;
  onCreateContract: () => void;
  onEditContractStatus: (contract: ContractItem) => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  /** Reloads the patient's contracts after a termination. */
  onContractTerminated: () => void;
};

export function PatientContractsTab({
  l,
  commonNotSet,
  tabLoading,
  contracts,
  canManageContracts,
  onCreateContract,
  onEditContractStatus,
  statusColors,
  statusLabel,
  formatDate,
  formatDateTime,
  onContractTerminated,
}: PatientContractsTabProps) {
  const { t, lang } = useLang();
  const canTerminateContracts = useCan("contracts.terminate");
  const [selectedContract, setSelectedContract] = useState<ContractItem | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<ContractItem | null>(null);
  const terminateLabel = lang === "de" ? "Vertrag kündigen" : "Расторгнуть договор";
  const canTerminate = (contract: ContractItem) =>
    canTerminateContracts && canTerminateContractStatus(contract.status);
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
        id: "terminated_at",
        label: lang === "de" ? "Gekündigt am" : "Расторгнут",
        accessor: (contract) => contract.terminated_at ?? "",
        sortable: true,
        filterType: "date",
        width: 170,
        render: (contract) => (
          <span
            className="font-mono text-xs tabular-nums text-foreground"
            title={contract.termination_reason ?? undefined}
          >
            {formatDate(contract.terminated_at, commonNotSet)}
          </span>
        ),
      },
    ],
    [
      commonNotSet,
      formatDate,
      formatDateTime,
      l,
      lang,
      statusColors,
      statusLabel,
      t,
    ],
  );

  return (
    <>
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
            onRowClick={(contract) => setSelectedContract(contract)}
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
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedContract(contract);
                  }}
                  aria-label={l("patients_open")}
                  title={l("patients_open")}
                >
                  <Eye className="size-3.5" />
                </Button>
                {canManageContracts && !isContractClosed(contract.status) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditContractStatus(contract);
                    }}
                    aria-label={l("patients_update_status")}
                    title={l("patients_update_status")}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                ) : null}
                {canTerminate(contract) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 rounded-full text-muted-foreground hover:text-destructive"
                    onClick={(event) => {
                      event.stopPropagation();
                      setTerminateTarget(contract);
                    }}
                    aria-label={`${terminateLabel}: ${contract.contract_number}`}
                    title={terminateLabel}
                  >
                    <Ban className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            )}
            rowActionsWidth={132}
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

      <Dialog
        open={Boolean(selectedContract)}
        onOpenChange={(open) => {
          if (!open) setSelectedContract(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileSignature aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="break-words font-mono text-base tracking-[0.08em]">
                  {selectedContract?.contract_number}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {l("patients_contract")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedContract ? (
            <div className="overflow-hidden rounded-xl border border-border/70">
              {[
                [
                  t.users_status,
                  <Badge
                    key="status"
                    variant="outline"
                    className={cn(
                      "rounded-full font-mono text-[10px]",
                      statusColors[selectedContract.status] ?? "",
                    )}
                  >
                    {statusLabel(selectedContract.status)}
                  </Badge>,
                ],
                [l("patients_signed"), formatDateTime(selectedContract.signed_at, commonNotSet)],
                [t.users_created, formatDateTime(selectedContract.created_at, commonNotSet)],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-4 border-b border-border/60 px-4 py-3 text-sm last:border-b-0"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="min-w-0 break-words text-right font-medium text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {selectedContract ? (
            <ContractTerminationNote contract={selectedContract} lang={lang} />
          ) : null}

          <DialogFooter>
            {selectedContract && canTerminate(selectedContract) ? (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  const contract = selectedContract;
                  setSelectedContract(null);
                  setTerminateTarget(contract);
                }}
              >
                <Ban aria-hidden="true" className="size-3.5" />
                {terminateLabel}
              </Button>
            ) : null}
            {selectedContract && canManageContracts && !isContractClosed(selectedContract.status) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const contract = selectedContract;
                  setSelectedContract(null);
                  onEditContractStatus(contract);
                }}
              >
                <Pencil aria-hidden="true" className="size-3.5" />
                {l("patients_update_status")}
              </Button>
            ) : null}
            <Button type="button" onClick={() => setSelectedContract(null)}>
              {t.common_close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TerminateContractDialog
        contract={terminateTarget}
        lang={lang}
        onClose={() => setTerminateTarget(null)}
        onTerminated={() => onContractTerminated()}
      />
    </>
  );
}
