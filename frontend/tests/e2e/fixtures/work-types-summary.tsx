import React from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { SelectedWorkTypesSummary } from "../../../src/pages/leads/ui/lead-wizard";

const params = new URLSearchParams(window.location.search);
const lang = params.get("lang") === "de" ? "de" : "ru";
localStorage.setItem("gmed_lang", lang);
const hours = Number(params.get("hours") ?? 2);
createRoot(document.getElementById("root")!).render(
  <main className="p-4" data-testid="work-types-summary">
    <SelectedWorkTypesSummary
      lang={lang}
      tx={(ru, de) => lang === "de" ? de : ru}
      compact={params.get("compact") === "true"}
      specializationLabels={new Map([["dermatology", lang === "de" ? "Dermatovenerologie" : "Дерматовенерология"]])}
      workTypes={[{
        id: "dermatology-exam", specialization_id: "dermatology", specialization_ids: ["dermatology"],
        code: "dermatology-exam", name_de: "Dermatologische Untersuchung und Beratung",
        name_ru: "Обследование и консультация дерматолога", name_en: "", name_es: "",
        duration_hours: hours, min_price_eur: 250, max_price_eur: 1000,
        sort_order: 1, is_active: true, descriptions: [],
      }]}
    />
  </main>,
);
