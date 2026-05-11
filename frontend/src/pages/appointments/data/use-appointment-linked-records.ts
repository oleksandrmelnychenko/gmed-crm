import { useEffect, useReducer } from "react";

import type { CaseRosterItem } from "@/components/cases-roster-section";
import { apiFetch } from "@/lib/api";
import { normalizeLinkedPreviewPayload } from "@/pages/appointments/model/linked-preview";
import { appointmentText } from "@/pages/appointments/model/labels";
import { sortLinkedDocuments } from "@/pages/appointments/model/query-builders";
import type {
  AppointmentDetail,
  LinkedDocumentItem,
  LinkedPreviewKind,
  LinkedPreviewPayload,
} from "@/pages/appointments/model/types";
import type { ProviderDetail as ProviderSheetDetail } from "@/pages/providers";

type UseAppointmentLinkedRecordsOptions = {
  detail: AppointmentDetail | null;
  linkedPreviewOpen: boolean;
  linkedPreviewKind: LinkedPreviewKind | null;
  linkedProviderOpen: boolean;
  linkedProviderId: string;
  linkedCasesOpen: boolean;
  linkedDocumentsOpen: boolean;
  failedLoadMessage: string;
};

type LinkedRecordsState = {
  linkedPreviewLoading: boolean;
  linkedPreviewError: string;
  linkedPreviewPayload: LinkedPreviewPayload | null;
  linkedProviderDetailLoading: boolean;
  linkedProviderDetailError: string;
  linkedProviderDetail: ProviderSheetDetail | null;
  linkedCasesLoading: boolean;
  linkedCasesError: string;
  linkedCasesItems: CaseRosterItem[];
  linkedDocumentsLoading: boolean;
  linkedDocumentsError: string;
  linkedDocumentsItems: LinkedDocumentItem[];
};

type LinkedRecordsPatch =
  | Partial<LinkedRecordsState>
  | ((current: LinkedRecordsState) => Partial<LinkedRecordsState>);

function createLinkedRecordsState(): LinkedRecordsState {
  return {
    linkedPreviewLoading: false,
    linkedPreviewError: "",
    linkedPreviewPayload: null,
    linkedProviderDetailLoading: false,
    linkedProviderDetailError: "",
    linkedProviderDetail: null,
    linkedCasesLoading: false,
    linkedCasesError: "",
    linkedCasesItems: [],
    linkedDocumentsLoading: false,
    linkedDocumentsError: "",
    linkedDocumentsItems: [],
  };
}

function linkedRecordsReducer(
  state: LinkedRecordsState,
  patch: LinkedRecordsPatch,
): LinkedRecordsState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function useAppointmentLinkedRecords({
  detail,
  linkedPreviewOpen,
  linkedPreviewKind,
  linkedProviderOpen,
  linkedProviderId,
  linkedCasesOpen,
  linkedDocumentsOpen,
  failedLoadMessage,
}: UseAppointmentLinkedRecordsOptions) {
  const [linkedRecordsState, dispatchLinkedRecordsState] = useReducer(
    linkedRecordsReducer,
    undefined,
    createLinkedRecordsState,
  );
  const {
    linkedPreviewLoading,
    linkedPreviewError,
    linkedPreviewPayload,
    linkedProviderDetailLoading,
    linkedProviderDetailError,
    linkedProviderDetail,
    linkedCasesLoading,
    linkedCasesError,
    linkedCasesItems,
    linkedDocumentsLoading,
    linkedDocumentsError,
    linkedDocumentsItems,
  } = linkedRecordsState;

  useEffect(() => {
    if (!linkedPreviewOpen || !linkedPreviewKind || !detail) {
      dispatchLinkedRecordsState({
        linkedPreviewLoading: false,
        linkedPreviewError: "",
        linkedPreviewPayload: null,
      });
      return;
    }

    const currentDetail = detail;
    let active = true;

    async function loadLinkedPreview() {
      dispatchLinkedRecordsState({
        linkedPreviewLoading: true,
        linkedPreviewError: "",
        linkedPreviewPayload: null,
      });

      try {
        let endpoint = "";
        if (linkedPreviewKind === "order") {
          if (!currentDetail.order_id) {
            throw new Error(
              appointmentText(
                "Kein Auftrag mit diesem Termin verknupft.",
                "Для этого приёма нет связанного заказа.",
                "No linked order for this appointment.",
              ),
            );
          }
          endpoint = `/orders/${currentDetail.order_id}`;
        } else if (linkedPreviewKind === "provider") {
          if (!currentDetail.provider_id) {
            throw new Error(
              appointmentText(
                "Keine Klinik mit diesem Termin verknupft.",
                "Для этого приёма нет связанной клиники.",
                "No linked provider for this appointment.",
              ),
            );
          }
          endpoint = `/providers/${currentDetail.provider_id}`;
        } else if (linkedPreviewKind === "documents") {
          endpoint = `/documents?appointment_id=${currentDetail.id}&patient_id=${currentDetail.patient_id}`;
        } else {
          endpoint = `/cases?patient_id=${currentDetail.patient_id}`;
        }

        const payload = await apiFetch<unknown>(endpoint);
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedPreviewPayload: normalizeLinkedPreviewPayload(payload),
          linkedPreviewLoading: false,
        });
      } catch (error) {
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedPreviewError:
            error instanceof Error
              ? error.message
              : appointmentText(
                "Verknupfte Daten konnten nicht geladen werden.",
                "Не удалось загрузить связанные данные.",
                "Failed to load linked records",
              ),
          linkedPreviewLoading: false,
        });
      }
    }

    void loadLinkedPreview();
    return () => {
      active = false;
    };
  }, [detail, linkedPreviewKind, linkedPreviewOpen]);

  useEffect(() => {
    if (!linkedProviderOpen || !linkedProviderId) {
      dispatchLinkedRecordsState({
        linkedProviderDetailLoading: false,
        linkedProviderDetailError: "",
        linkedProviderDetail: null,
      });
      return;
    }

    let active = true;
    dispatchLinkedRecordsState({
      linkedProviderDetailLoading: true,
      linkedProviderDetailError: "",
    });

    void apiFetch<ProviderSheetDetail>(`/providers/${linkedProviderId}`)
      .then((providerDetail) => {
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedProviderDetail: providerDetail,
          linkedProviderDetailLoading: false,
        });
      })
      .catch((error) => {
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedProviderDetail: null,
          linkedProviderDetailError:
            error instanceof Error ? error.message : failedLoadMessage,
          linkedProviderDetailLoading: false,
        });
      });

    return () => {
      active = false;
    };
  }, [failedLoadMessage, linkedProviderId, linkedProviderOpen]);

  useEffect(() => {
    if (!linkedCasesOpen || !detail?.patient_id) {
      dispatchLinkedRecordsState({
        linkedCasesLoading: false,
        linkedCasesError: "",
        linkedCasesItems: [],
      });
      return;
    }

    let active = true;
    dispatchLinkedRecordsState({
      linkedCasesLoading: true,
      linkedCasesError: "",
    });

    void apiFetch<CaseRosterItem[]>(`/cases?patient_id=${detail.patient_id}`)
      .then((items) => {
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedCasesItems: items,
          linkedCasesLoading: false,
        });
      })
      .catch((error) => {
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedCasesItems: [],
          linkedCasesError:
            error instanceof Error ? error.message : failedLoadMessage,
          linkedCasesLoading: false,
        });
      });

    return () => {
      active = false;
    };
  }, [detail?.patient_id, failedLoadMessage, linkedCasesOpen]);

  useEffect(() => {
    if (!linkedDocumentsOpen || !detail?.id || !detail.patient_id) {
      dispatchLinkedRecordsState({
        linkedDocumentsLoading: false,
        linkedDocumentsError: "",
        linkedDocumentsItems: [],
      });
      return;
    }

    let active = true;
    dispatchLinkedRecordsState({
      linkedDocumentsLoading: true,
      linkedDocumentsError: "",
    });

    void apiFetch<LinkedDocumentItem[]>(
      `/documents?appointment_id=${detail.id}&patient_id=${detail.patient_id}`,
    )
      .then((items) => {
        if (!active) return;
        const patientScoped = items.filter(
          (item) => item.patient_id === detail.patient_id,
        );
        dispatchLinkedRecordsState({
          linkedDocumentsItems: sortLinkedDocuments(patientScoped),
          linkedDocumentsLoading: false,
        });
      })
      .catch((error) => {
        if (!active) return;
        dispatchLinkedRecordsState({
          linkedDocumentsItems: [],
          linkedDocumentsError:
            error instanceof Error ? error.message : failedLoadMessage,
          linkedDocumentsLoading: false,
        });
      });

    return () => {
      active = false;
    };
  }, [detail?.id, detail?.patient_id, failedLoadMessage, linkedDocumentsOpen]);

  return {
    linkedPreviewLoading,
    linkedPreviewError,
    linkedPreviewPayload,
    linkedProviderDetailLoading,
    linkedProviderDetailError,
    linkedProviderDetail,
    linkedCasesLoading,
    linkedCasesError,
    linkedCasesItems,
    linkedDocumentsLoading,
    linkedDocumentsError,
    linkedDocumentsItems,
  };
}
