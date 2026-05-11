import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type { PatientTimelineItem, PatientTimelineRangeFilter } from "../model/detail-model";
import type {
  AppointmentItem,
  CaseItem,
  ContractItem,
  DocumentAlerts,
  DocumentItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientServicePackageItem,
  InvoiceItem,
  OrderItem,
  RelationItem,
  WorkflowChecklistResponse,
} from "../model/detail-tab-types";

type UsePatientDetailTabDataArgs = {
  activeTab: string;
  canViewContracts: boolean;
  canViewDocuments: boolean;
  canViewInvoices: boolean;
  canViewOperationalSurface: boolean;
  deferredTimelineSearch: string;
  id: string | undefined;
  tabVersion: number;
  timelineCategoryFilter: string;
  timelineEntityFilter: string;
  timelineLimit: number;
  timelineOffset: number;
  timelineRangeFilter: PatientTimelineRangeFilter;
  timelineSourceFilter: string;
};

type TabState = {
  appointments: AppointmentItem[];
  cases: CaseItem[];
  contracts: ContractItem[];
  documentAlerts: DocumentAlerts | null;
  documents: DocumentItem[];
  financialLedger: PatientFinancialLedger | null;
  financialSummary: PatientFinancialSummary | null;
  invoices: InvoiceItem[];
  orders: OrderItem[];
  relations: RelationItem[];
  servicePackages: PatientServicePackageItem[];
  timeline: PatientTimelineItem[];
  timelineTotal: number;
  workflowChecklist: WorkflowChecklistResponse | null;
};

type InvoiceListResponse = {
  items: InvoiceItem[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

const EMPTY_TAB_STATE: TabState = {
  appointments: [],
  cases: [],
  contracts: [],
  documentAlerts: null,
  documents: [],
  financialLedger: null,
  financialSummary: null,
  invoices: [],
  orders: [],
  relations: [],
  servicePackages: [],
  timeline: [],
  timelineTotal: 0,
  workflowChecklist: null,
};

type PatientDetailTabDataState = {
  tabs: TabState;
  settledKey: string;
};

type PatientDetailTabDataAction = {
  type: "settle";
  requestKey: string;
  update: (current: TabState) => TabState;
};

const EMPTY_PATIENT_DETAIL_TAB_DATA_STATE: PatientDetailTabDataState = {
  tabs: EMPTY_TAB_STATE,
  settledKey: "",
};

function patientDetailTabDataReducer(
  state: PatientDetailTabDataState,
  action: PatientDetailTabDataAction,
): PatientDetailTabDataState {
  switch (action.type) {
    case "settle":
      return {
        tabs: action.update(state.tabs),
        settledKey: action.requestKey,
      };
    default:
      return state;
  }
}

export function usePatientDetailTabData({
  activeTab,
  canViewContracts,
  canViewDocuments,
  canViewInvoices,
  canViewOperationalSurface,
  deferredTimelineSearch,
  id,
  tabVersion,
  timelineCategoryFilter,
  timelineEntityFilter,
  timelineLimit,
  timelineOffset,
  timelineRangeFilter,
  timelineSourceFilter,
}: UsePatientDetailTabDataArgs) {
  const [{ tabs, settledKey }, dispatchTabData] = useReducer(
    patientDetailTabDataReducer,
    EMPTY_PATIENT_DETAIL_TAB_DATA_STATE,
  );

  const requestKey =
    !id ||
    activeTab === "profile" ||
    (activeTab === "documents" && !canViewDocuments) ||
    (activeTab === "contracts" && !canViewContracts) ||
    (activeTab === "invoices" && !canViewInvoices) ||
    ((activeTab === "relations" ||
      activeTab === "cases" ||
      activeTab === "orders" ||
      activeTab === "appointments" ||
      activeTab === "workflow" ||
      activeTab === "timeline") &&
      !canViewOperationalSurface)
      ? ""
      : [
          id,
          activeTab,
          tabVersion,
          timelineEntityFilter,
          timelineCategoryFilter,
          timelineSourceFilter,
          timelineRangeFilter,
          deferredTimelineSearch.trim(),
          timelineOffset,
          timelineLimit,
        ].join(":");

  useEffect(() => {
    if (!requestKey || !id) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function loadTabData() {
      try {
        switch (activeTab) {
          case "relations": {
            const result = await apiFetch<RelationItem[]>(`/patients/${id}/relations`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({ ...current, relations: result }),
              });
            });
            break;
          }
          case "cases": {
            const result = await apiFetch<CaseItem[]>(`/patients/${id}/cases`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({ ...current, cases: result }),
              });
            });
            break;
          }
          case "orders": {
            const result = await apiFetch<OrderItem[]>(`/patients/${id}/orders`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({ ...current, orders: result }),
              });
            });
            break;
          }
          case "appointments": {
            const result = await apiFetch<AppointmentItem[]>(`/patients/${id}/appointments`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({ ...current, appointments: result }),
              });
            });
            break;
          }
          case "documents": {
            const [documents, orders, appointments, documentAlerts] = await Promise.all([
              apiFetch<DocumentItem[]>(`/patients/${id}/documents`, { signal }),
              apiFetch<OrderItem[]>(`/patients/${id}/orders`, { signal }).catch(() => []),
              apiFetch<AppointmentItem[]>(`/patients/${id}/appointments`, { signal }).catch(() => []),
              apiFetch<DocumentAlerts>(`/patients/${id}/document-alerts`, { signal }).catch(() => null),
            ]);
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({
                  ...current,
                  appointments,
                  documentAlerts,
                  documents,
                  orders,
                }),
              });
            });
            break;
          }
          case "contracts": {
            const result = await apiFetch<ContractItem[]>(`/patients/${id}/framework-contracts`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({ ...current, contracts: result }),
              });
            });
            break;
          }
          case "invoices": {
            const [result, financialSummary, financialLedger, servicePackages] =
              await Promise.all([
                apiFetch<InvoiceListResponse>(
                  `/invoices?patient_id=${encodeURIComponent(id ?? "")}&per_page=50`,
                  { signal },
                ),
                apiFetch<PatientFinancialSummary>(
                  `/patients/${id}/financial-summary`,
                  { signal },
                ).catch(() => null),
                apiFetch<PatientFinancialLedger>(
                  `/patients/${id}/financial-ledger`,
                  { signal },
                ).catch(() => null),
                apiFetch<PatientServicePackageItem[]>(
                  `/patients/${id}/service-packages`,
                  { signal },
                ).catch(() => []),
              ]);
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({
                  ...current,
                  financialLedger,
                  financialSummary,
                  invoices: result.items ?? [],
                  servicePackages,
                }),
              });
            });
            break;
          }
          case "workflow": {
            const result = await apiFetch<WorkflowChecklistResponse>(`/patients/${id}/workflow-checklist`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({ ...current, workflowChecklist: result }),
              });
            });
            break;
          }
          case "timeline": {
            const params = new URLSearchParams();
            if (timelineEntityFilter !== "all") params.set("entity_type", timelineEntityFilter);
            if (timelineCategoryFilter !== "all") params.set("category", timelineCategoryFilter);
            if (timelineSourceFilter !== "all") params.set("source", timelineSourceFilter);
            if (timelineRangeFilter !== "all") params.set("range", timelineRangeFilter);
            if (deferredTimelineSearch.trim()) params.set("search", deferredTimelineSearch.trim());
            params.set("limit", String(timelineLimit));
            params.set("offset", String(timelineOffset));
            const result = await apiFetch<{
              items: PatientTimelineItem[];
              total: number;
              limit: number;
              offset: number;
              has_more: boolean;
            }>(`/patients/${id}/timeline?${params.toString()}`, { signal });
            if (signal.aborted) return;
            startTransition(() => {
              dispatchTabData({
                type: "settle",
                requestKey,
                update: (current) => ({
                  ...current,
                  timeline: result.items ?? [],
                  timelineTotal: result.total ?? 0,
                }),
              });
            });
            break;
          }
          default:
            break;
        }
      } catch {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchTabData({
            type: "settle",
            requestKey,
            update: (current) => {
              switch (activeTab) {
                case "relations":
                  return { ...current, relations: [] };
                case "cases":
                  return { ...current, cases: [] };
                case "orders":
                  return { ...current, orders: [] };
                case "appointments":
                  return { ...current, appointments: [] };
                case "documents":
                  return { ...current, documentAlerts: null, documents: [] };
                case "contracts":
                  return { ...current, contracts: [] };
                case "invoices":
                  return {
                    ...current,
                    financialLedger: null,
                    financialSummary: null,
                    invoices: [],
                    servicePackages: [],
                  };
                case "workflow":
                  return { ...current, workflowChecklist: null };
                case "timeline":
                  return { ...current, timeline: [], timelineTotal: 0 };
                default:
                  return current;
              }
            },
          });
        });
      }
    }

    void loadTabData();

    return () => {
      controller.abort();
    };
  }, [
    activeTab,
    deferredTimelineSearch,
    id,
    requestKey,
    timelineCategoryFilter,
    timelineEntityFilter,
    timelineLimit,
    timelineOffset,
    timelineRangeFilter,
    timelineSourceFilter,
  ]);

  return {
    ...tabs,
    tabLoading: Boolean(requestKey) && settledKey !== requestKey,
  };
}
