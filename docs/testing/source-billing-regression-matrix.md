# Source-Derived Billing Regression Matrix

Цей файл фіксує regression-тести для поточного `billing` slice, зібрані з вихідних джерел:

- `Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`
- `1 (Update 2) User Story Salesforce.xlsx`
- нормалізованих markdown-артефактів у `docs/requirements/*` і `docs/backlog/*`

Важлива межа: це покриває **реалізований current-state billing layer**, тобто `order_leistungen`, billing handoff, `quotes`, `invoices`, `Mahnwesen`, `concierge_services`, patient-portal invoice visibility і financial document access. Поза цим current-state все ще лишаються окремі фінансові сценарії на кшталт `DATEV`, `E-Rechnung`, real payment-provider checkout, tax/accounting export і частина advanced settlement logic.

> **Трасованість:** `03_product-backlog_ua.md` синхронізується з Excel скриптом `generate_product_backlog_from_excel.py`; посилання `:рядок` на цей файл у матриці нижче можуть застаріти — шукайте відповідний **Excel ряд.** у беклозі (EPIC 9) або аудит `user-stories-excel-backlog-audit_ua.md`.

## Source signals

- `Process Mapping PDF`: після `Execution` виставляються фінальні або проміжні рахунки, а follow-up і billing завершують цикл кейсу.
- `User Stories.xlsx / Appointments & Orders`: автоматичний перенос послуг у billing, частина послуг паушальна, частина прив'язана до термінів.
- `User Stories.xlsx / Finance`: підтверджені PM послуги переходять у billing; власні послуги мають `19% VAT`, `Kostenübernahme` і pass-through витрати йдуть без VAT; години й concierge/VIP витрати мають передаватись у billing.
- `User Stories.xlsx / VIP services`: concierge/VIP services мають окремий billing trail.

## Automated tests

- `framework_contract_create_list_and_sign_flow_work`
  Source:
  `docs/requirements/03_product-backlog_ua.md:235`
  Covers:
  framework contract exists as a patient-bound commercial basis, can be created, listed and moved to `signed`.

- `create_order_rejects_contract_from_other_patient`
  Source:
  `docs/requirements/03_product-backlog_ua.md:235`
  `docs/backlog/04_implementation-tasks_ua.md:53`
  Covers:
  order cannot be linked to a framework contract that belongs to another patient.

- `quote_creation_from_order_services_computes_totals_and_updates_order`
  Source:
  `docs/requirements/03_product-backlog_ua.md:72`
  `docs/requirements/03_product-backlog_ua.md:119`
  `docs/requirements/03_product-backlog_ua.md:121`
  `docs/requirements/03_product-backlog_ua.md:235`
  `docs/backlog/04_implementation-tasks_ua.md:61`
  Covers:
  quote generation from order service lines, with net/vat/gross totals and order estimate update.

- `billing_can_update_quote_status_and_payment_but_interpreter_cannot_access_quote`
  Source:
  `docs/requirements/03_product-backlog_ua.md:116`
  `docs/requirements/03_product-backlog_ua.md:129`
  `docs/requirements/03_product-backlog_ua.md:141`
  Covers:
  billing can move quote status and record payment amount, while non-financial operational roles cannot access quote detail.

- `quote_versions_capture_initial_and_status_update_snapshots`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/backlog/04_implementation-tasks_ua.md:61`
  Covers:
  quote creation writes an initial immutable snapshot, later status/payment updates append a new quote version instead of overwriting the only historical state, and the quote detail workspace can read back that version chain.

- `invoice_creation_from_quote_marks_order_services_invoiced`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/requirements/03_product-backlog_ua.md:244`
  `docs/requirements/03_product-backlog_ua.md:245`
  Covers:
  invoice is materialized from quote snapshot, remains patient/order bound, and approved order services are moved to `invoiced`.

- `invoice_creation_requires_billing_release_gate`
  Source:
  `docs/requirements/01_process-mapping_ua.md:81`
  `docs/requirements/03_product-backlog_ua.md:486`
  `docs/diagrams/system-diagrams.md:414`
  Covers:
  quote-to-invoice conversion is blocked until billing explicitly grants `Freigabe Abrechnung`; PM service approval alone is not enough.

- `second_active_non_advance_invoice_for_same_quote_is_rejected`
  Source:
  `docs/requirements/03_product-backlog_ua.md:245`
  Covers:
  one active non-advance invoice scope per quote is enforced to prevent duplicate billing of the same quote snapshot.

- `advance_invoice_does_not_consume_order_services`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/requirements/03_product-backlog_ua.md:129`
  Covers:
  advance invoices can be issued from quote context without consuming approved order service lines.

- `second_advance_invoice_for_same_quote_is_rejected`
  Source:
  `docs/requirements/03_product-backlog_ua.md:245`
  Covers:
  one active advance invoice scope per quote is enforced as well, so the same quote cannot spawn duplicate prepayment invoices.

- `billing_can_update_invoice_payment_state_and_interpreter_cannot_access_invoice`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/requirements/03_product-backlog_ua.md:141`
  `docs/requirements/03_product-backlog_ua.md:171`
  Covers:
  billing updates invoice payment state while operational non-financial roles remain blocked from invoice detail.

- `patient_can_list_own_invoices_and_payment_proof_status`
  Source:
  `docs/requirements/03_product-backlog_ua.md:131`
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:284`
  Covers:
  patient portal sees own invoice snapshots only, can open invoice detail, and payment-proof uploads feed back into billing-facing invoice metadata.

- `patient can upload payment proof from invoice detail`
  Source:
  `docs/requirements/03_product-backlog_ua.md:131`
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:284`
  Covers:
  browser-level patient portal invoice detail can attach a payment proof file, submit it to the billing handoff endpoint and surface the resulting upload timestamp back in the UI.

- `patient_cannot_see_draft_invoices_in_portal_scope`
  Source:
  `docs/requirements/03_product-backlog_ua.md:131`
  `docs/backlog/04_implementation-tasks_ua.md:284`
  Covers:
  patient portal excludes draft invoices from list, detail and PDF download until billing has published a patient-visible invoice state.

- `staff_can_download_invoice_pdf_document`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/requirements/03_product-backlog_ua.md:131`
  Covers:
  billing workspace can render a patient/order-bound invoice snapshot as PDF and return a real `application/pdf` document.

- `patient_can_download_own_invoice_pdf`
  Source:
  `docs/requirements/03_product-backlog_ua.md:131`
  `docs/backlog/04_implementation-tasks_ua.md:284`
  Covers:
  patient portal can open and download the same invoice PDF for the linked patient record without exposing invoices from other patients.

- `billing_can_run_first_and_second_dunning_then_collections`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/backlog/04_implementation-tasks_ua.md:164`
  Covers:
  invoice dunning follows the enforced sequence `1st reminder -> 2nd reminder -> collections`, and billing can explicitly escalate the overdue invoice through each stage.

- `dunning_sequence_requires_previous_step_and_billing_role`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  `docs/requirements/03_product-backlog_ua.md:122`
  `docs/backlog/04_implementation-tasks_ua.md:164`
  Covers:
  second reminder requires a first reminder, and operational non-financial roles such as PM cannot trigger dunning escalation.

- `dunning_is_blocked_for_paid_invoice`
  Source:
  `docs/requirements/03_product-backlog_ua.md:117`
  Covers:
  paid invoices cannot re-enter Mahnwesen escalation.

- `auto_dunning_scheduler_marks_overdue_and_advances_reminder_levels`
  Source:
  `docs/requirements/03_product-backlog_ua.md:244`
  `docs/backlog/04_implementation-tasks_ua.md:164`
  Covers:
  background auto-dunning marks overdue invoices, creates the first reminder once the due date is missed, and advances `1st reminder -> 2nd -> collections` after the configured scheduler delays without duplicating existing levels.

- `billing_sees_order_leistung_vat_and_cost_passthrough_fields`
  Source:
  `docs/requirements/03_product-backlog_ua.md:119`
  `docs/requirements/03_product-backlog_ua.md:121`
  `docs/requirements/03_product-backlog_ua.md:235`
  `docs/backlog/04_implementation-tasks_ua.md:89`
  Covers:
  `order_leistungen` keep default `19% VAT` for own services and `0% + is_cost_passthrough=true` for cost pass-through items, and billing can read both via order service list.

- `only_patient_manager_can_approve_delivered_leistung_for_billing_flow`
  Source:
  `docs/requirements/03_product-backlog_ua.md:115`
  `docs/requirements/03_product-backlog_ua.md:121`
  `docs/backlog/04_implementation-tasks_ua.md:56`
  Covers:
  PM approval is the gate before a delivered service becomes billing-ready; billing may consume the result but cannot perform the PM freigabe itself.

- `order_detail_includes_provider_and_doctor_chain_for_leistungen`
  Source:
  `docs/requirements/03_product-backlog_ua.md:72`
  `docs/requirements/03_product-backlog_ua.md:121`
  `docs/requirements/03_product-backlog_ua.md:127`
  Covers:
  order detail exposes clinic/doctor chain per service line for downstream billing and provider analytics.

- `completed_non_medical_appointment_creates_billing_handoff_task`
  Source:
  `docs/requirements/03_product-backlog_ua.md:121`
  `docs/requirements/03_product-backlog_ua.md:186`
  `docs/backlog/04_implementation-tasks_ua.md:234`
  Covers:
  completed concierge execution creates an explicit billing handoff task.

- `concierge_service_update_and_completion_flow_sets_ready_for_billing`
  Source:
  `docs/requirements/03_product-backlog_ua.md:186`
  `docs/backlog/04_implementation-tasks_ua.md:232`
  `docs/backlog/04_implementation-tasks_ua.md:234`
  Covers:
  concierge/VIP service can move from operational execution into `ready for billing`.

- `billing_can_only_update_financial_fields_on_concierge_service`
  Source:
  `docs/requirements/03_product-backlog_ua.md:121`
  `docs/requirements/03_product-backlog_ua.md:186`
  Covers:
  billing can update financial handoff fields such as `actual_cost`, `billing_status`, `billing_notes`, but cannot rewrite operational concierge data.

- `billing_can_access_financial_documents_but_not_medical_ones`
  Source:
  `docs/requirements/03_product-backlog_ua.md:126`
  `docs/requirements/03_product-backlog_ua.md:141`
  Covers:
  billing role can read invoice-like financial documents but is blocked from medical findings.

## Not automated yet

- anti-duplication logic across multiple invoices for one order
- DATEV export and tax/accounting compliance
- automatic attachment of external cost receipts to `Kostenübernahme`
- final invoice deduction of `Vorkasse / Kostenvoranschlag` payments
- real payment-provider checkout / settlement confirmation beyond payment-proof handoff
