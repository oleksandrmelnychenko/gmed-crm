import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";

import "../../../src/index.css";
import "../../../src/components/app-shell/staff-portal-theme.css";
import { AppAdapterDayjs } from "../../../src/lib/app-date-adapter";
import { PatientConsentChoicesCard } from "../../../src/pages/patients/ui/sections/patient-consent-choices";

// `?dark` checks the dark tokens.
if (new URLSearchParams(window.location.search).has("dark")) document.documentElement.classList.add("dark");

// The patient card's «Согласия и доверенные лица» block; the spec mocks the API.
createRoot(document.getElementById("root")!).render(
  <LocalizationProvider dateAdapter={AppAdapterDayjs} adapterLocale="ru">
    <MemoryRouter>
      <main className="staff-portal-theme min-h-dvh bg-background p-4 text-foreground">
        <PatientConsentChoicesCard patientId="patient-qa" />
      </main>
    </MemoryRouter>
  </LocalizationProvider>,
);
