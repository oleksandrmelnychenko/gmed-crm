import React from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { DocumentReviewStatus } from "../../../src/pages/documents/ui/document-review-status";

createRoot(document.getElementById("root")!).render(<main className="p-4"><h1>Предварительный расчёт медицинских расходов</h1><DocumentReviewStatus documentId="review-fixture" /></main>);
