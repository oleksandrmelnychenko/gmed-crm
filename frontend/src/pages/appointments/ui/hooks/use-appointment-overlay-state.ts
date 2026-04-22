import { useCallback, useState } from "react";

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
      }
      setCreateOpen(open);
    },
    [preloadCreateSheet],
  );

  const openCreateSeedSheet = useCallback(
    (next: AppointmentFormState) => {
      setCreateSeed(next);
      preloadCreateSheet();
      setCreateOpen(true);
    },
    [preloadCreateSheet],
  );

  return {
    filtersModalOpen,
    searchModalOpen,
    queueModalOpen,
    createOpen,
    createSeed,
    handleFiltersModalOpenChange,
    openFiltersModal,
    handleSearchModalOpenChange,
    openSearchModal,
    handleQueueModalOpenChange,
    openQueueModal,
    handleCreateOpenChange,
    openCreateSeedSheet,
  };
}
