import { useEffect, useState } from "react";

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
  const [linkedPreviewLoading, setLinkedPreviewLoading] = useState(false);
  const [linkedPreviewError, setLinkedPreviewError] = useState("");
  const [linkedPreviewPayload, setLinkedPreviewPayload] =
    useState<LinkedPreviewPayload | null>(null);
  const [linkedProviderDetailLoading, setLinkedProviderDetailLoading] =
    useState(false);
  const [linkedProviderDetailError, setLinkedProviderDetailError] =
    useState("");
  const [linkedProviderDetail, setLinkedProviderDetail] =
    useState<ProviderSheetDetail | null>(null);
  const [linkedCasesLoading, setLinkedCasesLoading] = useState(false);
  const [linkedCasesError, setLinkedCasesError] = useState("");
  const [linkedCasesItems, setLinkedCasesItems] = useState<CaseRosterItem[]>(
    [],
  );
  const [linkedDocumentsLoading, setLinkedDocumentsLoading] = useState(false);
  const [linkedDocumentsError, setLinkedDocumentsError] = useState("");
  const [linkedDocumentsItems, setLinkedDocumentsItems] = useState<
    LinkedDocumentItem[]
  >([]);

  useEffect(() => {
    if (!linkedPreviewOpen || !linkedPreviewKind || !detail) {
      setLinkedPreviewLoading(false);
      setLinkedPreviewError("");
      setLinkedPreviewPayload(null);
      return;
    }

    const currentDetail = detail;
    let active = true;

    async function loadLinkedPreview() {
      setLinkedPreviewLoading(true);
      setLinkedPreviewError("");
      setLinkedPreviewPayload(null);

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
          endpoint = `/documents?appointment=${currentDetail.id}&patient=${currentDetail.patient_id}`;
        } else {
          endpoint = `/cases?patient=${currentDetail.patient_id}`;
        }

        const payload = await apiFetch<unknown>(endpoint);
        if (!active) return;
        setLinkedPreviewPayload(normalizeLinkedPreviewPayload(payload));
      } catch (error) {
        if (!active) return;
        setLinkedPreviewError(
          error instanceof Error
            ? error.message
            : appointmentText(
                "Verknupfte Daten konnten nicht geladen werden.",
                "Не удалось загрузить связанные данные.",
                "Failed to load linked records",
              ),
        );
      } finally {
        if (active) {
          setLinkedPreviewLoading(false);
        }
      }
    }

    void loadLinkedPreview();
    return () => {
      active = false;
    };
  }, [detail, linkedPreviewKind, linkedPreviewOpen]);

  useEffect(() => {
    if (!linkedProviderOpen || !linkedProviderId) {
      setLinkedProviderDetailLoading(false);
      setLinkedProviderDetailError("");
      setLinkedProviderDetail(null);
      return;
    }

    let active = true;
    setLinkedProviderDetailLoading(true);
    setLinkedProviderDetailError("");

    void apiFetch<ProviderSheetDetail>(`/providers/${linkedProviderId}`)
      .then((providerDetail) => {
        if (!active) return;
        setLinkedProviderDetail(providerDetail);
      })
      .catch((error) => {
        if (!active) return;
        setLinkedProviderDetail(null);
        setLinkedProviderDetailError(
          error instanceof Error ? error.message : failedLoadMessage,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedProviderDetailLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [failedLoadMessage, linkedProviderId, linkedProviderOpen]);

  useEffect(() => {
    if (!linkedCasesOpen || !detail?.patient_id) {
      setLinkedCasesLoading(false);
      setLinkedCasesError("");
      setLinkedCasesItems([]);
      return;
    }

    let active = true;
    setLinkedCasesLoading(true);
    setLinkedCasesError("");

    void apiFetch<CaseRosterItem[]>(`/cases?patient_id=${detail.patient_id}`)
      .then((items) => {
        if (!active) return;
        setLinkedCasesItems(items);
      })
      .catch((error) => {
        if (!active) return;
        setLinkedCasesItems([]);
        setLinkedCasesError(
          error instanceof Error ? error.message : failedLoadMessage,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedCasesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [detail?.patient_id, failedLoadMessage, linkedCasesOpen]);

  useEffect(() => {
    if (!linkedDocumentsOpen || !detail?.id || !detail.patient_id) {
      setLinkedDocumentsLoading(false);
      setLinkedDocumentsError("");
      setLinkedDocumentsItems([]);
      return;
    }

    let active = true;
    setLinkedDocumentsLoading(true);
    setLinkedDocumentsError("");

    void apiFetch<LinkedDocumentItem[]>(
      `/documents?appointment_id=${detail.id}&patient_id=${detail.patient_id}`,
    )
      .then((items) => {
        if (!active) return;
        const patientScoped = items.filter(
          (item) => item.patient_id === detail.patient_id,
        );
        setLinkedDocumentsItems(sortLinkedDocuments(patientScoped));
      })
      .catch((error) => {
        if (!active) return;
        setLinkedDocumentsItems([]);
        setLinkedDocumentsError(
          error instanceof Error ? error.message : failedLoadMessage,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedDocumentsLoading(false);
        }
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
