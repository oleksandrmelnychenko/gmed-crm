import { useCallback, useState } from "react";

import { hasAppointmentFormChanges } from "@/pages/appointments/model/form-factories";
import type { AppointmentFormState } from "@/pages/appointments/model/types";

type UseAppointmentOverlayStateOptions = {
  createBlankAppointmentForm: () => AppointmentFormState;
  preloadCreateSheet: () => void;
  preloadSearchSheet: () => void;
  preloadQueueSheet: () => void;
};

export function useAppointmentOverlayState({
  createBlankAppointmentForm,
  preloadCreateSheet,
  preloadSearchSheet,
  preloadQueueSheet,
}: UseAppointmentOverlayStateOptions) {
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<AppointmentFormState>(() =>
    createBlankAppointmentForm(),
  );
  const [createDraft, setCreateDraft] =
    useState<AppointmentFormState | null>(null);

  const hasPendingCreateDraft = createDraft
    ? hasAppointmentFormChanges(createDraft, createSeed)
    : false;

  const handleFiltersModalOpenChange = useCallback((open: boolean) => {
    setFiltersModalOpen(open);
  }, []);

  const openFiltersModal = useCallback(() => {
    setFiltersModalOpen(true);
  }, []);

  const handleSearchModalOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        preloadSearchSheet();
      }
      setSearchModalOpen(open);
    },
    [preloadSearchSheet],
  );

  const openSearchModal = useCallback(() => {
    preloadSearchSheet();
    setSearchModalOpen(true);
  }, [preloadSearchSheet]);

  const handleQueueModalOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        preloadQueueSheet();
      }
      setQueueModalOpen(open);
    },
    [preloadQueueSheet],
  );

  const openQueueModal = useCallback(() => {
    preloadQueueSheet();
    setQueueModalOpen(true);
  }, [preloadQueueSheet]);

  const handleCreateOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        preloadCreateSheet();
        setCreateDraft((currentDraft) => currentDraft ?? createSeed);
      }
      setCreateOpen(open);
    },
    [createSeed, preloadCreateSheet],
  );

  const openCreateSeedSheet = useCallback(
    (next: AppointmentFormState) => {
      if (!hasPendingCreateDraft) {
        setCreateSeed(next);
        setCreateDraft(next);
      }
      preloadCreateSheet();
      setCreateOpen(true);
    },
    [hasPendingCreateDraft, preloadCreateSheet],
  );

  const handleCreateDraftChange = useCallback((draft: AppointmentFormState) => {
    setCreateDraft(draft);
  }, []);

  const clearCreateDraft = useCallback(() => {
    setCreateDraft(null);
    setCreateSeed(createBlankAppointmentForm());
  }, [createBlankAppointmentForm]);

  return {
    filtersModalOpen,
    searchModalOpen,
    queueModalOpen,
    createOpen,
    createSeed,
    createDraft,
    handleFiltersModalOpenChange,
    openFiltersModal,
    handleSearchModalOpenChange,
    openSearchModal,
    handleQueueModalOpenChange,
    openQueueModal,
    handleCreateOpenChange,
    handleCreateDraftChange,
    clearCreateDraft,
    openCreateSeedSheet,
  };
}
