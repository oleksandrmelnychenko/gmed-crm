import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import "dayjs/locale/de";
import "dayjs/locale/ru";
import "../../../src/index.css";
import { AuthProvider } from "../../../src/lib/auth";
import { useLang } from "../../../src/lib/i18n";
import { OrderWizard } from "../../../src/pages/orders/ui/order-wizard";
import type { PatientDetail } from "../../../src/pages/patients/model/list-model";

const patient: PatientDetail = { id: "patient-intake-qa", patient_id: "P-TEST-1", first_name: "Alex", last_name: "Beispiel",
  birth_date: "1980-01-01", gender: "male", is_active: true, created_at: "2026-09-10T10:00:00Z" };
function Fixture() {
  const { lang } = useLang();
  const [open, setOpen] = useState(true);
  return <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang}>
    <button onClick={() => setOpen(true)}>Open order wizard</button>
    {open && <OrderWizard patient={patient} orderId={new URLSearchParams(location.search).get("order") ?? undefined}
      onClose={() => setOpen(false)} onCreated={() => setOpen(false)} />}
  </LocalizationProvider>;
}
// Vite can reload the fixture entry with a timestamp after a dependency update.
// Reuse its root so the previous dialog portal is unmounted normally.
const host = window as typeof window & { orderWizardQaRoot?: ReturnType<typeof createRoot> };
host.orderWizardQaRoot ??= createRoot(document.getElementById("root")!);
host.orderWizardQaRoot.render(<MemoryRouter><AuthProvider><Fixture /></AuthProvider></MemoryRouter>);
