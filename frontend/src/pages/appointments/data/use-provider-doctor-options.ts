import { useEffect, useState } from "react";

import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import type { DoctorOption } from "@/pages/appointments/model/types";

const EMPTY_DOCTOR_OPTIONS: DoctorOption[] = [];

export function useProviderDoctorOptions(providerId: string) {
  const [providerDoctorOptions, setProviderDoctorOptions] = useState<
    DoctorOption[]
  >([]);

  useEffect(() => {
    if (!providerId) return;

    let active = true;

    void getProviderDoctors(providerId)
      .then((rows) => {
        if (active) setProviderDoctorOptions(rows);
      })
      .catch(() => {
        if (active) setProviderDoctorOptions([]);
      });

    return () => {
      active = false;
    };
  }, [providerId]);

  return providerId ? providerDoctorOptions : EMPTY_DOCTOR_OPTIONS;
}
