# Parallel Agent Plan For Remaining 12 Business Requirements

Date: 2026-04-30
Commit baseline: 4b6fc4d `feat: add patient finance and portal workflows`

This plan is based on the already implemented foundation. It is not a from-zero plan.

All newly created pages and large UI blocks must use the existing `ui-shell` primitives so they do not visually diverge from the current site.

## Current Implemented Baseline

Already implemented before this plan:

- Patient financial summary and ledger foundation.
- Patient billing tab with profitability, ledger, service packages.
- Invoice visibility, hidden patient amounts, payer contact/relation, PDF blocking.
- Tax profiles and Finance Catalog read/create foundation.
- Service package data model and read UI.
- Patient recommendations backend and patient portal recommendations page.
- Portal next actions foundation.
- Portal document translation requests and staff document translation queue foundation.
- Interpreter patient history and interpreter suggestions foundation.
- Multi-doctor service groups and generated billing lines foundation.
- Drug product/equivalent/reference database foundation.
- Patient timeline extended with recommendations, translation requests, service packages, package consumption, service groups.
- Document category taxonomy foundation.

## Shared Rules For All Agents

- Do not revert or overwrite work from other agents.
- Each agent owns only the files listed in its section.
- If an agent needs data from another bounded context, it should use an existing API contract or add a typed client without changing the other agent's business logic.
- Do not create duplicate migrations for the same table or column.
- New UI must use `ui-shell` and existing design patterns.
- Route access changes must include tests in `frontend/src/lib/staff-route-access.test.ts`.
- Each agent must add or update targeted tests for its own area.
- Main integration pass after all agents:
  - `npm run typecheck`
  - `npm run lint`
  - targeted frontend tests
  - `cargo check -p gmed-server`
  - targeted backend tests

## Agent 1: Finance, Packages, VAT

Responsible for requirements: 1, 4, 9, 12.

### Scope

- Client profitability polish.
- Invoice visibility and payer UI.
- Tax profiles and VAT workflow.
- Service package builder, assignment, consumption, overage.

### Backend Ownership

- `crates/server/src/routes/patient_financials.rs`
- `crates/server/src/routes/invoices.rs`
- `crates/server/src/routes/tax_profiles.rs`
- `crates/server/src/routes/service_packages.rs`
- `crates/server/src/services/financial_summary.rs`, if created.
- `crates/server/src/services/invoice_visibility.rs`, if created.
- `crates/server/src/services/package_consumption.rs`, if created.
- Finance/package/tax migrations only.

### Frontend Ownership

- `frontend/src/pages/finance-catalog.tsx`
- invoice workspace files, if present.
- `frontend/src/pages/patients/ui/sections/patient-invoices-tab.tsx`
- `frontend/src/pages/patients/data/use-patient-detail-tab-data.ts`
- package UI only inside finance/billing context.

### Tasks

1. Add package create/edit UI in Finance Catalog.
2. Add assign package to patient.
3. Add package consumption from order/service.
4. Add overage approval flow.
5. Add invoice visibility/payer controls in invoice UI.
6. Add patient invoice preview for hidden amounts.
7. Add VAT profile editor.
8. Add VAT source explanation on invoice/service lines.
9. Add patient profitability filters by date/order/package.
10. Add profitability export for CEO/Billing.
11. Add tests for hidden amounts, package consumption, VAT mixed lines, margin visibility.

### Must Not Touch

- Recommendations workflow.
- Drug products/equivalents.
- Interpreter suggestions.
- Document category UI except invoice document linkage if absolutely required.

### Acceptance Criteria

- CEO/Billing can manage packages and VAT.
- Patient package usage is visible in patient billing.
- Hidden invoice amounts cannot leak to patient API/PDF.
- Termin 0% VAT and interpreter 19% VAT can coexist in one invoice.
- Package overage can be approved and invoiced.

## Agent 2: Portal, Recommendations, Documents

Responsible for requirements: 6, 7, 10, 11.

### Scope

- Staff UI for recommendations.
- Patient portal next actions UX.
- Translation request workflow.
- Document category separation.

### Backend Ownership

- `crates/server/src/routes/patient_recommendations.rs`
- `crates/server/src/routes/patient_next_actions.rs`
- `crates/server/src/routes/patient_document_requests.rs`
- `crates/server/src/routes/documents.rs`
- `crates/server/src/services/recommendations.rs`, if created.
- `crates/server/src/services/next_actions.rs`, if created.
- `crates/server/src/services/document_categories.rs`, if created.
- Recommendation/document/translation migrations only.

### Frontend Ownership

- `frontend/src/pages/patients/portal-dashboard-page.tsx`
- `frontend/src/pages/patients/portal-recommendations-page.tsx`
- `frontend/src/pages/patients/portal-documents-page.tsx`
- `frontend/src/pages/documents/**`
- recommendation-specific components inside patient workspace.
- document category UI.

### Tasks

1. Add staff recommendation create/edit UI.
2. Add recommendation source linking: doctor, appointment, document, order.
3. Add release-to-portal toggle.
4. Improve patient `/recommendations` and staff-safe CEO view.
5. Improve dashboard `Next steps` block.
6. Add document tabs/categories: correspondence, analyses, conclusions, invoices, translations.
7. Add upload category picker.
8. Add recategorize action.
9. Add translation request staff detail workflow: assign, complete, upload translated document.
10. Add tests for portal visibility and document category filtering.

### Must Not Touch

- Finance/package/VAT internals.
- Drug equivalents.
- Interpreter suggestions.
- Multi-doctor service group billing generation.

### Acceptance Criteria

- Staff can create a recommendation for a patient.
- Patient sees only portal-visible recommendations.
- Patient can request translation for own visible document.
- Staff can process translation requests.
- Documents can be clearly separated by category/provider.

## Agent 3: Clinical Ops, Interpreter, Drugs, Timeline

Responsible for requirements: 2, 3, 5, 8.

### Scope

- Interpreter continuity.
- Multi-doctor service group UX.
- Drug reference DB admin/verification.
- Timeline completeness.

### Backend Ownership

- `crates/server/src/routes/interpreters.rs`
- `crates/server/src/routes/interpreter_patient_history.rs`
- `crates/server/src/routes/order_service_groups.rs`
- `crates/server/src/routes/drug_products.rs`
- `crates/server/src/routes/patients.rs`, only timeline aggregation.
- `crates/server/src/services/interpreter_suggestions.rs`
- `crates/server/src/services/order_service_groups.rs`
- `crates/server/src/services/drug_matching.rs`
- Interpreter/order-service-group/drug migrations only.

### Frontend Ownership

- `frontend/src/pages/appointments/ui/sections/interpreter-suggestions-panel.tsx`
- `frontend/src/pages/appointments/**`, only interpreter suggestions area.
- `frontend/src/pages/orders/ui/order-service-group-panel.tsx`
- `frontend/src/pages/orders/page.tsx`, only service group integration.
- `frontend/src/pages/case-workspace/medication-equivalents-panel.tsx`
- `frontend/src/pages/case-workspace/medications-section.tsx`
- `frontend/src/lib/api/clinical.ts`
- `frontend/src/lib/timeline-labels.ts`
- timeline routing/labels.

### Tasks

1. Improve interpreter assignment UX.
2. Add interpreter history page/panel.
3. Add prefer/avoid interpreter controls.
4. Polish multi-doctor wizard: group -> doctors -> preview -> generate lines.
5. Add duplicate prevention and preview for generated billing lines.
6. Add drug admin/search/verification UI.
7. Add drug import skeleton.
8. Add timeline events for drug verification and interpreter preference changes.
9. Add timeline support for invoice visibility/package changes only through contracts agreed with Agent 1.
10. Add tests for interpreter ranking, multi-doctor generation, drug verification visibility, timeline filters.

### Must Not Touch

- Package builder.
- Recommendation creation UI.
- Document category tabs, except timeline label support.
- Invoice payer UI.

### Acceptance Criteria

- Appointment screen recommends interpreter based on prior patient history.
- Staff can mark interpreter preferred/avoid for patient.
- One service group with 3 doctors generates 3 billing lines safely.
- Drug equivalents are searchable and verified before being treated as final.
- Timeline includes clinical/interpreter/service-group events.

## Recommended Launch Order

1. Launch Agent 1 and Agent 2 in parallel.
2. Launch Agent 3 in parallel only if it keeps to clinical/interpreter/drug/timeline ownership.
3. After all agents finish, main thread performs integration pass.
4. Conflict priority:
   - Finance/package/VAT: Agent 1.
   - Portal/recommendations/documents: Agent 2.
   - Clinical/interpreter/drugs/timeline: Agent 3.

## Final Integration Checklist

- `git status --short`
- `npm run typecheck`
- `npm run lint`
- `npm run test -- <targeted frontend tests>`
- `cargo check -p gmed-server`
- `cargo test -p gmed-server --test invoices_api -- --nocapture`
- `cargo test -p gmed-server --test patient_portal_agent2_api -- --nocapture`
- `cargo test -p gmed-server --test agent3_clinical_services -- --nocapture`
- `cargo test -p gmed-server --test workspace_filters_api patient_timeline_supports_entity_type_category_source_and_range_filters -- --nocapture`
