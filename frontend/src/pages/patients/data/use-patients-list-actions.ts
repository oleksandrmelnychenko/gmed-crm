import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { PatientSummary } from "../model/list-model";
import { togglePatientActivation } from "./patient-mutations";

type UsePatientsListActionsArgs = {
  failedToggleMessage: string;
  setListError: Dispatch<SetStateAction<string>>;
  setPatients: Dispatch<SetStateAction<PatientSummary[]>>;
};

export function usePatientsListActions({
  failedToggleMessage,
  setListError,
  setPatients,
}: UsePatientsListActionsArgs) {
  const handleToggleArchive = useCallback(
    async (patient: PatientSummary) => {
      const nextActive = !patient.is_active;

      setPatients((current) =>
        current.map((item) => (item.id === patient.id ? { ...item, is_active: nextActive } : item)),
      );

      try {
        await togglePatientActivation(patient.id, patient.is_active);
      } catch (error) {
        setPatients((current) =>
          current.map((item) =>
            item.id === patient.id ? { ...item, is_active: !nextActive } : item,
          ),
        );
        setListError(error instanceof Error ? error.message : failedToggleMessage);
      }
    },
    [failedToggleMessage, setListError, setPatients],
  );

  return {
    handleToggleArchive,
  };
}
