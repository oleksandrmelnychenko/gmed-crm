import { useCallback, useState } from "react";

import { buildLinkedOrderWorkspaceHref } from "@/pages/appointments/model/linked-navigation";
import type { LinkedPreviewKind } from "@/pages/appointments/model/types";

type UseAppointmentLinkedSheetStateOptions = {
  detailId: string | null;
  detailPatientId: string | null;
  detailOrderId: string | null;
  detailProviderId: string | null;
  staffGo: (href: string) => void;
  preloadPatientSheet: () => void;
  preloadProviderSheet: () => void;
  preloadDocumentsSheet: () => void;
  preloadLinkedRecordsSheet: () => void;
};

export function useAppointmentLinkedSheetState({
  detailId,
  detailPatientId,
  detailOrderId,
  detailProviderId,
  staffGo,
  preloadPatientSheet,
  preloadProviderSheet,
  preloadDocumentsSheet,
  preloadLinkedRecordsSheet,
}: UseAppointmentLinkedSheetStateOptions) {
  const [linkedPreviewOpen, setLinkedPreviewOpen] = useState(false);
  const [linkedPreviewKind, setLinkedPreviewKind] =
    useState<LinkedPreviewKind | null>(null);
  const [linkedPreviewLabel, setLinkedPreviewLabel] = useState("");
  const [linkedPatientOpen, setLinkedPatientOpen] = useState(false);
  const [linkedPatientId, setLinkedPatientId] = useState("");
  const [linkedPatientVersion, setLinkedPatientVersion] = useState(0);
  const [linkedProviderOpen, setLinkedProviderOpen] = useState(false);
  const [linkedProviderId, setLinkedProviderId] = useState("");
  const [linkedDocumentsOpen, setLinkedDocumentsOpen] = useState(false);

  const refreshLinkedPatient = useCallback(() => {
    setLinkedPatientVersion((current) => current + 1);
  }, []);

  const resetLinkedSheetState = useCallback(() => {
    setLinkedPreviewOpen(false);
    setLinkedPreviewKind(null);
    setLinkedPreviewLabel("");
    setLinkedPatientOpen(false);
    setLinkedPatientId("");
    setLinkedPatientVersion(0);
    setLinkedProviderOpen(false);
    setLinkedProviderId("");
    setLinkedDocumentsOpen(false);
  }, []);

  const openLinkedPatientById = useCallback(
    (patientId: string) => {
      if (!patientId) return;
      preloadPatientSheet();
      setLinkedPreviewOpen(false);
      setLinkedPreviewKind(null);
      setLinkedPreviewLabel("");
      setLinkedProviderOpen(false);
      setLinkedProviderId("");
      setLinkedDocumentsOpen(false);
      setLinkedPatientId(patientId);
      setLinkedPatientVersion((current) => current + 1);
      setLinkedPatientOpen(true);
    },
    [preloadPatientSheet],
  );

  const openLinkedProviderById = useCallback(
    (providerId: string) => {
      if (!providerId) return;
      preloadProviderSheet();
      setLinkedPreviewOpen(false);
      setLinkedPreviewKind(null);
      setLinkedPreviewLabel("");
      setLinkedPatientOpen(false);
      setLinkedPatientId("");
      setLinkedPatientVersion(0);
      setLinkedDocumentsOpen(false);
      setLinkedProviderId(providerId);
      setLinkedProviderOpen(true);
    },
    [preloadProviderSheet],
  );

  const openLinkedDocumentsSheet = useCallback(() => {
    if (!detailId || !detailPatientId) return;
    preloadDocumentsSheet();
    setLinkedPreviewOpen(false);
    setLinkedPreviewKind(null);
    setLinkedPreviewLabel("");
    setLinkedPatientOpen(false);
    setLinkedPatientId("");
    setLinkedPatientVersion(0);
    setLinkedProviderOpen(false);
    setLinkedProviderId("");
    setLinkedDocumentsOpen(true);
  }, [detailId, detailPatientId, preloadDocumentsSheet]);

  const openLinkedPreview = useCallback(
    (kind: LinkedPreviewKind, label: string) => {
      if (kind === "patient") {
        openLinkedPatientById(detailPatientId ?? "");
        return;
      }
      if (kind === "order") {
        const href = buildLinkedOrderWorkspaceHref(detailOrderId, detailPatientId);
        if (href) staffGo(href);
        return;
      }
      if (kind === "provider") {
        openLinkedProviderById(detailProviderId ?? "");
        return;
      }
      if (kind === "documents") {
        openLinkedDocumentsSheet();
        return;
      }
      setLinkedPatientOpen(false);
      setLinkedPatientId("");
      setLinkedPatientVersion(0);
      setLinkedProviderOpen(false);
      setLinkedProviderId("");
      setLinkedDocumentsOpen(false);
      preloadLinkedRecordsSheet();
      setLinkedPreviewKind(kind);
      setLinkedPreviewLabel(label);
      setLinkedPreviewOpen(true);
    },
    [
      detailPatientId,
      detailOrderId,
      detailProviderId,
      openLinkedDocumentsSheet,
      openLinkedPatientById,
      openLinkedProviderById,
      preloadLinkedRecordsSheet,
      staffGo,
    ],
  );

  const handleLinkedPreviewOpenChange = useCallback((open: boolean) => {
    setLinkedPreviewOpen(open);
    if (!open) {
      setLinkedPreviewKind(null);
      setLinkedPreviewLabel("");
    }
  }, []);

  const handleLinkedPatientOpenChange = useCallback((open: boolean) => {
    setLinkedPatientOpen(open);
    if (!open) {
      setLinkedPatientId("");
      setLinkedPatientVersion(0);
    }
  }, []);

  const handleLinkedProviderOpenChange = useCallback((open: boolean) => {
    setLinkedProviderOpen(open);
    if (!open) {
      setLinkedProviderId("");
    }
  }, []);

  const handleLinkedDocumentsOpenChange = useCallback((open: boolean) => {
    setLinkedDocumentsOpen(open);
  }, []);

  return {
    linkedPreviewOpen,
    linkedPreviewKind,
    linkedPreviewLabel,
    linkedPatientOpen,
    linkedPatientId,
    linkedPatientVersion,
    linkedProviderOpen,
    linkedProviderId,
    linkedDocumentsOpen,
    refreshLinkedPatient,
    resetLinkedSheetState,
    openLinkedPreview,
    openLinkedPatientById,
    handleLinkedPreviewOpenChange,
    handleLinkedPatientOpenChange,
    handleLinkedProviderOpenChange,
    handleLinkedDocumentsOpenChange,
  };
}
