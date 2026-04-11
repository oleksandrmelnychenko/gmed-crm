# Source-Derived Workspace Regression Matrix

Цей файл фіксує regression-тести для `appointments`, `orders`, `patients` і `providers`, зібрані з вихідних джерел:

- `Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`
- `1 (Update 2) User Story Salesforce.xlsx`
- нормалізованих markdown-артефактів у `docs/requirements/*` і `docs/backlog/*`

> **Трасованість після регенерації беклогу:** `docs/requirements/03_product-backlog_ua.md` оновлюється з Excel (`python scripts/generate_product_backlog_from_excel.py`). Посилання виду ``03_product-backlog_ua.md:NN`` у розділах нижче можуть застаріти; актуальна відповідність — за маркером **«Excel … ряд. N»** у беклозі або файл `docs/testing/user-stories-excel-backlog-audit_ua.md`.

## Source signals

- `Process Mapping PDF`: `Execution`, `Daten- und Dokumentenupdate`, `Follow-up`, `Arztbriefe`, зв'язка `Lead / Customer -> Order -> Treatment Program -> Execution -> Billing -> Follow-up`.
- `User Stories.xlsx / Service Providers`: реєстр клінік і лікарів, пов'язаний ланцюг `Service Provider <-> Patient`, пошук за критеріями, історія взаємодій.
- `User Stories.xlsx / Appointments`: призначення перекладача, зв'язка `Patient ↔ Dolmetscher ↔ Teamlead ↔ Klinik/Service Provider`, blocked slots для concierge, Teamlead/Interpreter responses.
- `User Stories.xlsx / Visit cycle`: чеклісти `before -> during -> follow-up`, reminders, follow-up `1w / 1m / 6m`, необроблені post-visit дані.
- `User Stories.xlsx / Orders`: order execution із послугами, прив'язаними до клініки й лікаря.

## Automated tests

### Providers and patients

- `providers_list_supports_country_and_doctor_filters`
  Source:
  `docs/requirements/03_product-backlog_ua.md:24`
  `docs/requirements/03_product-backlog_ua.md:26`
  `docs/backlog/04_implementation-tasks_ua.md:45`
  Covers:
  provider registry filters by provider type, country, doctor name, doctor specialty, service text.

- `provider_and_doctor_detail_expose_linked_patients_and_interactions`
  Source:
  `docs/requirements/03_product-backlog_ua.md:25`
  `docs/requirements/03_product-backlog_ua.md:31`
  `docs/backlog/04_implementation-tasks_ua.md:46`
  Covers:
  provider card and doctor card expose linked patients plus full interaction chain from appointments and order services.

- `patients_list_supports_provider_and_doctor_filters_across_appointments_and_orders`
  Source:
  `docs/requirements/03_product-backlog_ua.md:33`
  `docs/backlog/04_implementation-tasks_ua.md:47`
  Covers:
  patient list can be filtered by clinic and doctor across both appointment and order context, not only one source table.

- `patient_profile_nested_endpoints_return_only_linked_records`
  Source:
  `docs/requirements/03_product-backlog_ua.md:13`
  `docs/backlog/04_implementation-tasks_ua.md:21`
  Covers:
  patient profile tabs for cases, orders, appointments, documents, framework contracts and invoices return only records linked to the current patient.

- `patient_relations_crud_round_trip`
  Source:
  `docs/requirements/03_product-backlog_ua.md:13`
  `docs/backlog/04_implementation-tasks_ua.md:21`
  Covers:
  patient card supports linked relatives and emergency-contact relations with full create, update and delete flow.

- `patient_timeline_aggregates_events_in_descending_order`
  Source:
  `docs/requirements/03_product-backlog_ua.md:15`
  `docs/backlog/04_implementation-tasks_ua.md:24`
  Covers:
  patient timeline aggregates appointments, cases, orders, services, documents, contracts and invoices in descending event order.

- `filterPatientTimelineItems`
  Source:
  `docs/requirements/03_product-backlog_ua.md:17`
  `docs/backlog/04_implementation-tasks_ua.md:24`
  Covers:
  patient timeline UI filters by event type, category, time window and source labels such as clinic or doctor, while keeping free-text search over operational metadata.

- `patient_profile_updates_structured_legal_status`
  Source:
  `docs/requirements/03_product-backlog_ua.md:15`
  `docs/backlog/01_mvp-backlog_ua.md:40`
  `docs/diagrams/system-diagrams.md:85`
  Covers:
  patient profile persists structured legal and compliance state for DSGVO, Schweigepflicht, identity verification, document completeness and contract readiness.

- `patient_detail_view_audit_logs_visible_fields_for_role_filtered_payload`
  Source:
  `docs/architecture/02_field-level-access-control.md:7`
  `docs/architecture/02_field-level-access-control.md:260`
  Covers:
  viewing a patient card writes an audit event with the role and the concrete set of visible fields after role-based masking or hiding is applied.

- `patient_manager_can_export_patient_dsgvo_bundle`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:42`
  `docs/requirements/03_product-backlog_ua.md:160`
  Covers:
  patient manager can generate an Art. 15 style patient export bundle with patient, assignment and delivery data for compliance handling.

- `patient_manager_can_fetch_patient_label_payload`
  Source:
  `docs/requirements/03_product-backlog_ua.md:151`
  `docs/development-plan.md:195`
  Covers:
  patient manager can fetch a print-ready Patientenaufkleber payload with patient identity, country shorthand, insurer, agency contact block, selectable label format metadata and audit logging.

- `settings_update_accepts_agency_profile_values`
  Source:
  `docs/requirements/03_product-backlog_ua.md:151`
  `docs/development-plan.md:241`
  Covers:
  IT admin can maintain the agency identity block used by patient labels, including agency name, c/o line, address, phone and email.

- `patient_manager_can_manage_patient_consents_and_export_contains_history`
  Source:
  `docs/requirements/03_product-backlog_ua.md:15`
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/backlog/04_implementation-tasks_ua.md:16`
  Covers:
  patient manager can maintain a patient-bound consent register with grant and revoke events, export that history in the DSGVO bundle, and see only assigned-patient consent data in the compliance workspace.

- `patient_manager_erasure_request_can_be_reviewed_and_executed`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  `docs/requirements/04_non-functional-requirements_ua.md:87`
  `docs/development-plan.md:129`
  Covers:
  patient privacy erasure requests move through request, approval and execution with audit logging, patient anonymization and no direct hard-delete path.

- `restriction_request_updates_legal_status_and_queue_is_assignment_scoped`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/development-plan.md:129`
  Covers:
  processing-restriction requests update patient legal status after execution and the privacy queue remains scoped to assigned patients for patient managers.

- `patient_can_submit_privacy_request_for_self_and_pm_gets_notification`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  Covers:
  patient self-service can create an own GDPR privacy request, see its own request history and trigger a notification for the responsible patient manager.

- `patient_can_submit_third_party_revoke_request_for_self`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  Covers:
  patient self-service can request revocation of third-party sharing and route that request into the compliance queue for the responsible patient manager.

- `document_can_be_released_to_patient_portal_and_confirmed_from_me_workspace`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/04_non-functional-requirements_ua.md:53`
  Covers:
  patient portal sees only explicitly released documents, can confirm receipt and download through self-service routes.

- `patient_can_upload_document_for_self_and_download_it`
  Source:
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:282`
  Covers:
  patient self-service can upload own portal documents for the care team, see the upload back in the portal workspace and download the submitted file again.

- `patient_can_list_own_invoices_and_payment_proof_status`
  Source:
  `docs/requirements/03_product-backlog_ua.md:131`
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:284`
  Covers:
  patient portal sees only own invoices, gets invoice detail and line-item snapshot, and payment-proof uploads are reflected back into invoice status metadata.

- `patient_can_create_appointment_request_and_pm_can_review_queue`
  Source:
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:283`
  Covers:
  patient self-service can submit an appointment request with preferred date window, and the assigned patient manager can see and review that request in a scoped queue.

- `approved_request_can_be_converted_and_patient_sees_schedule`
  Source:
  `docs/backlog/04_implementation-tasks_ua.md:281`
  `docs/backlog/04_implementation-tasks_ua.md:283`
  Covers:
  approved portal appointment request can be converted into a real appointment, and the patient sees the scheduled non-internal visit in the portal workspace.

- `patient_timeline_includes_compliance_audit_events`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:42`
  `docs/backlog/01_mvp-backlog_ua.md:40`
  Covers:
  patient timeline includes compliance audit events such as legal-status updates and DSGVO data exports.

### Orders

- `orders_list_supports_search_phase_and_provider_doctor_filters`
  Source:
  `docs/requirements/03_product-backlog_ua.md:233`
  `docs/requirements/03_product-backlog_ua.md:239`
  `docs/backlog/04_implementation-tasks_ua.md:57`
  `docs/backlog/04_implementation-tasks_ua.md:64`
  Covers:
  order list filtering by lifecycle phase and linked provider/doctor context.

- `order_detail_includes_provider_and_doctor_chain_for_leistungen`
  Source:
  `docs/requirements/03_product-backlog_ua.md:239`
  `docs/backlog/04_implementation-tasks_ua.md:64`
  Covers:
  order detail returns `leistungen` with provider and doctor identifiers and names for downstream billing and coordination flows.

### Appointments and calendar

- `appointments_list_supports_context_and_date_filters`
  Source:
  `docs/requirements/03_product-backlog_ua.md:48`
  `docs/requirements/03_product-backlog_ua.md:212`
  `docs/requirements/03_product-backlog_ua.md:217`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  `docs/backlog/04_implementation-tasks_ua.md:243`
  Covers:
  appointment list filtering by context fields and calendar date window.

- `appointment_conflicts_endpoint_reports_patient_and_interpreter_overlaps`
  Source:
  `docs/requirements/03_product-backlog_ua.md:56`
  `docs/backlog/04_implementation-tasks_ua.md:154`
  Covers:
  conflict warnings for patient and interpreter without auto-suggested replacements.

- `create_appointment_returns_conflict_payload_with_interpreter_context`
  Source:
  `docs/requirements/03_product-backlog_ua.md:56`
  `docs/requirements/03_product-backlog_ua.md:213`
  Covers:
  create flow returns operational conflict payload immediately when overlapping slots exist.

- `appointments_list_supports_owner_filter`
  Source:
  `docs/requirements/03_product-backlog_ua.md:212`
  `docs/requirements/03_product-backlog_ua.md:214`
  Covers:
  operational calendar view can be sliced by internal appointment owner.

- `patient_manager_can_reschedule_appointment_and_reassign_owner`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  PM can reschedule appointment, rebind clinic/doctor and reassign owner while still receiving conflict warnings.

- `teamlead_cannot_reassign_owner_to_patient_manager_during_reschedule`
  Source:
  `docs/requirements/03_product-backlog_ua.md:214`
  `docs/backlog/04_implementation-tasks_ua.md:243`
  Covers:
  Teamlead reschedule powers stay constrained to subordinate workflow and cannot escalate ownership upward.

- `reschedule_with_same_interpreter_resets_response_and_creates_reminder`
  Source:
  `docs/requirements/03_product-backlog_ua.md:214`
  `docs/requirements/03_product-backlog_ua.md:215`
  Covers:
  changed schedule invalidates prior interpreter acceptance and creates a fresh reminder.

### Assignments and role visibility

- `patient_assignment_chain_enforces_supported_roles`
  Source:
  `docs/requirements/03_product-backlog_ua.md:38`
  `docs/requirements/03_product-backlog_ua.md:41`
  `docs/requirements/03_product-backlog_ua.md:42`
  `docs/requirements/03_product-backlog_ua.md:43`
  `docs/backlog/04_implementation-tasks_ua.md:98`
  `docs/backlog/04_implementation-tasks_ua.md:99`
  Covers:
  supported assignment chain for PM, Teamlead, Interpreter and Concierge on a patient.

- `interpreter_and_concierge_only_see_assigned_patients`
  Source:
  `docs/requirements/03_product-backlog_ua.md:42`
  `docs/requirements/03_product-backlog_ua.md:43`
  `docs/backlog/04_implementation-tasks_ua.md:221`
  `docs/backlog/04_implementation-tasks_ua.md:222`
  Covers:
  operational visibility is assignment-based for interpreter and concierge roles.

- `concierge_sees_medical_appointments_as_blocked_slots`
  Source:
  `docs/requirements/03_product-backlog_ua.md:216`
  `docs/backlog/04_implementation-tasks_ua.md:245`
  Covers:
  concierge calendar exposes medical appointments only as blocked time windows without medical details.

- `teamlead_can_create_appointment_for_assigned_interpreter_owner`
  Source:
  `docs/requirements/03_product-backlog_ua.md:214`
  `docs/backlog/04_implementation-tasks_ua.md:243`
  Covers:
  Teamlead can create appointments for subordinate interpreter-owned flow.

- `concierge_can_only_create_non_medical_appointments_for_self_owned_flow`
  Source:
  `docs/requirements/03_product-backlog_ua.md:216`
  `docs/backlog/04_implementation-tasks_ua.md:245`
  Covers:
  concierge may create only non-medical appointments in self-owned context.

- `assign_interpreter_creates_patient_assignment_and_reminder`
  Source:
  `docs/requirements/03_product-backlog_ua.md:47`
  `docs/requirements/03_product-backlog_ua.md:214`
  Covers:
  interpreter assignment to an appointment also establishes the assignment chain and reminder trail.

- `assigned_interpreter_can_update_response_and_non_assignee_cannot`
  Source:
  `docs/requirements/03_product-backlog_ua.md:214`
  `docs/requirements/03_product-backlog_ua.md:215`
  `docs/backlog/04_implementation-tasks_ua.md:243`
  `docs/backlog/04_implementation-tasks_ua.md:244`
  Covers:
  only assigned interpreter may send `accepted / discussion_requested / declined` appointment response.

### Operational workflows around visits

- `appointments_report_endpoint_returns_latest_report_state`
  Source:
  `docs/requirements/03_product-backlog_ua.md:100`
  `docs/requirements/03_product-backlog_ua.md:137`
  `docs/requirements/03_product-backlog_ua.md:138`
  `docs/backlog/04_implementation-tasks_ua.md:217`
  `docs/backlog/04_implementation-tasks_ua.md:218`
  Covers:
  latest interpreter report state remains visible after submit and approval.

- `attention_endpoint_flags_past_visit_with_unprocessed_follow_up`
  Source:
  `docs/requirements/03_product-backlog_ua.md:96`
  `docs/requirements/03_product-backlog_ua.md:97`
  `docs/backlog/04_implementation-tasks_ua.md:122`
  Covers:
  past appointments with unfinished processing, overdue reminders and pending interpreter reporting surface in the attention queue.

- `attention_endpoint_flags_upcoming_slot_with_preparation_gaps`
  Source:
  `docs/requirements/03_product-backlog_ua.md:95`
  `docs/backlog/04_implementation-tasks_ua.md:119`
  `docs/backlog/04_implementation-tasks_ua.md:156`
  Covers:
  near-term appointments with open preparation checklist items and pending interpreter confirmation surface before the visit.

- `attention_endpoint_excludes_resolved_completed_visits`
  Source:
  `docs/requirements/03_product-backlog_ua.md:95`
  `docs/requirements/03_product-backlog_ua.md:100`
  Covers:
  resolved completed visits with approved interpreter reporting do not keep polluting the operational attention queue.

- `reminders_can_be_created_by_pm_and_completed_by_assignee`
  Source:
  `docs/requirements/03_product-backlog_ua.md:53`
  `docs/requirements/03_product-backlog_ua.md:95`
  `docs/requirements/03_product-backlog_ua.md:100`
  `docs/backlog/04_implementation-tasks_ua.md:119`
  Covers:
  PM creates visit-related reminders and assignee completes them.

- `tasks_can_be_created_for_appointment_and_completed_by_assignee`
  Source:
  `docs/requirements/03_product-backlog_ua.md:109`
  `docs/requirements/03_product-backlog_ua.md:111`
  `docs/backlog/04_implementation-tasks_ua.md:123`
  Covers:
  appointment-linked task delegation and completion tracking.

- `patient_manager_can_log_and_close_appointment_communication`
  Source:
  `docs/requirements/03_product-backlog_ua.md:114`
  `docs/backlog/04_implementation-tasks_ua.md:128`
  Covers:
  PM can log clinic/doctor communication on appointment level and move it through operational closure.

- `assigned_interpreter_can_view_appointment_communications`
  Source:
  `docs/requirements/03_product-backlog_ua.md:137`
  `docs/backlog/04_implementation-tasks_ua.md:252`
  Covers:
  assigned interpreter can see appointment-linked communication trail relevant to the current assignment.

- `concierge_cannot_access_communications_for_blocked_medical_slots`
  Source:
  `docs/requirements/03_product-backlog_ua.md:216`
  `docs/backlog/04_implementation-tasks_ua.md:128`
  Covers:
  blocked medical slot mode hides external communication details from concierge users.

- `tasks_require_patient_link_for_operational_assignee`
  Source:
  `docs/requirements/03_product-backlog_ua.md:41`
  `docs/requirements/03_product-backlog_ua.md:42`
  `docs/requirements/03_product-backlog_ua.md:43`
  Covers:
  operational assignee must be linked to the patient before task assignment is accepted.

- `non_medical_appointment_bootstraps_concierge_checklists_tasks_and_reminders`
  Source:
  `docs/requirements/03_product-backlog_ua.md:57`
  `docs/requirements/03_product-backlog_ua.md:204`
  `docs/backlog/04_implementation-tasks_ua.md:140`
  Covers:
  non-medical appointment auto-creates concierge checklist, task and reminder scaffolding.

- `non_medical_appointment_bootstraps_concierge_service_record`
  Source:
  `docs/requirements/03_product-backlog_ua.md:204`
  `docs/requirements/03_product-backlog_ua.md:205`
  `docs/backlog/04_implementation-tasks_ua.md:138`
  `docs/backlog/04_implementation-tasks_ua.md:139`
  Covers:
  concierge and VIP service record is created directly from the appointment context.

- `completed_non_medical_appointment_creates_billing_handoff_task`
  Source:
  `docs/requirements/03_product-backlog_ua.md:95`
  `docs/requirements/03_product-backlog_ua.md:205`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  Covers:
  completed concierge execution generates a billing handoff trail.

- `concierge_service_update_and_completion_flow_sets_ready_for_billing`
  Source:
  `docs/requirements/03_product-backlog_ua.md:205`
  `docs/backlog/04_implementation-tasks_ua.md:139`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  Covers:
  concierge service lifecycle reaches `ready for billing` after operational completion.

## Not automated yet

- provider and doctor productivity KPI aggregation for CEO-level reports
- package-end follow-up KPI timing assertions
- patient-facing portal visibility for follow-up milestones beyond concrete scheduled visits
