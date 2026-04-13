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

### Identity / session security

- `logout_blacklists_current_access_token_and_revokes_family_refresh`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:83`
  `docs/backlog/01_mvp-backlog_ua.md:25`
  Covers:
  protected logout path inserts the current access-token `jti` into the denylist, blacklists the whole refresh-token family and makes both the old bearer token and refresh token unusable immediately instead of waiting for access-token expiry.

- `logout_all_revokes_other_session_access_tokens_too`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:83`
  `docs/backlog/01_mvp-backlog_ua.md:25`
  Covers:
  user-driven `logout-all` revokes every active session family for the same account, so a second still-open device loses both bearer and refresh access right away instead of surviving until token expiry.

### CEO analytics

- `ceo_dashboard_exposes_supported_finance_operational_and_feedback_kpis`
  Source:
  `docs/backlog/01_mvp-backlog_ua.md:119`
  `docs/backlog/04_implementation-tasks_ua.md:171`
  `docs/backlog/04_implementation-tasks_ua.md:173`
  `docs/backlog/04_implementation-tasks_ua.md:268`
  `docs/backlog/04_implementation-tasks_ua.md:269`
  `docs/backlog/04_implementation-tasks_ua.md:316`
  Covers:
  CEO dashboard aggregates current-state revenue, receivables, patient geography, PM workload, interpreter and concierge productivity, clinic volume and NPS-adjacent feedback signals from existing transactional tables.

- `ceo_dashboard_is_forbidden_for_patient_manager`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:14`
  `docs/backlog/02_rbac-matrix_ua.md:15`
  Covers:
  executive analytics endpoint stays limited to `ceo` and `ceo_assistant` instead of leaking the full cross-workspace read model to patient managers.

- `ceo_can_open_risk_analysis_workspace`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:15`
  `docs/backlog/03_kpi-catalog_ua.md:25`
  Covers:
  CEO can open the combined risk-analysis workspace and see both the patient-manager and billing signal layers, matching the executive analytics scope instead of being blocked by a stale route guard.

- `ceo_assistant_can_open_reports_forecasting_and_risk_workspaces`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:9`
  `docs/backlog/02_rbac-matrix_ua.md:15`
  Covers:
  `ceo_assistant` can open reports, forecasting and risk-analysis workspaces with financial visibility and export rights aligned to the current partial-executive read model.

- `risk_analysis_returns_role_scoped_patient_manager_and_billing_signals`
  Source:
  `docs/requirements/03_product-backlog_ua.md:422`
  `docs/requirements/03_product-backlog_ua.md:424`
  `docs/backlog/04_implementation-tasks_ua.md:178`
  `docs/backlog/04_implementation-tasks_ua.md:179`
  Covers:
  current-state risk-analysis workspace surfaces automatic patient-manager signals for complex assigned cases and overdue operational follow-up, plus billing signals for overdue invoices, blocked billing release/package coverage and exposure gaps on active orders.

- `forecasting_workspace_returns_pipeline_collection_followup_and_capacity_signals`
  Source:
  `docs/backlog/04_implementation-tasks_ua.md:171`
  `docs/backlog/04_implementation-tasks_ua.md:178`
  `docs/backlog/04_implementation-tasks_ua.md:179`
  Covers:
  forecasting workspace aggregates quote pipeline weighting, due-soon and overdue collections, debt-workflow pressure, follow-up milestones due in the next 30 days and clinic capacity derived from planned appointments.

- `forecasting_workspace_counts_package_end_followup_due_next_30_days`
  Source:
  `docs/requirements/01_process-mapping_ua.md:135`
  `docs/backlog/04_implementation-tasks_ua.md:145`
  `docs/backlog/04_implementation-tasks_ua.md:178`
  Covers:
  forecasting follow-up KPI payload counts a package-end milestone inside the next 30 days as its own due bucket and rolls it into the aggregate milestone pressure figure.

### Reports and learning

- `reports_workspace_returns_role_scoped_sections`
  Source:
  `docs/backlog/04_implementation-tasks_ua.md:171`
  `docs/backlog/02_rbac-matrix_ua.md:14`
  `docs/backlog/02_rbac-matrix_ua.md:15`
  Covers:
  reports workspace exposes clinic, doctor, country, service-type and non-medical provider reporting through a role-scoped read model, including counts-only mode for non-financial roles, CSV export for permitted sections, provider-quality metrics based on treatment feedback / doctor communication / follow-up completion, organization/service/ambience/value scores, treatment-success and complication rates, written-findings turnaround, response-time KPI signals from appointment communications and concierge-oriented partner load by service portfolio, vendors and request status.

- `reports_workspace_exposes_billing_and_sales_kpi_scorecards`
  Source:
  `docs/backlog/03_kpi-catalog_ua.md:49`
  `docs/backlog/03_kpi-catalog_ua.md:61`
  `docs/backlog/03_kpi-catalog_ua.md:79`
  Covers:
  reports workspace now exposes explicit billing KPI scorecards for executive and billing roles with invoices per 30 days, service-to-invoice timing, on-time-14-day rate, open receivables, dunning share, self-pay mix and cost-passthrough share, while sales/executive users get a separate lead-and-partner KPI scorecard with recent lead volume, qualified/converted counts, lead-to-patient conversion, lead-country spread and new partner clinics per quarter.

- `provider_cost_report_tracks_historical_price_changes`
  Source:
  `docs/requirements/03_product-backlog_ua.md:55`
  `docs/testing/user-stories-excel-backlog-audit_ua.md:65`
  Covers:
  reports workspace exposes a dedicated medical-provider cost-intelligence section for `ceo`, `ceo_assistant`, `patient_manager` and `billing`, tracks first/latest/average gross unit prices per delivered service, derives monthly trend points, supports CSV export and keeps the section hidden from `sales`.

- `sales_medical_provider_report_exposes_partner_revenue_without_restricted_exports`
  Source:
  `docs/requirements/03_product-backlog_ua.md:58`
  `docs/requirements/03_product-backlog_ua.md:311`
  Covers:
  sales role gets a dedicated medical-provider performance section with aggregated partner revenue, appointment volume, service mix, specialty mix and patient-country mix, while `clinics` and `doctors` exports stay restricted.

- `patient_manager_forecasting_hides_collections_but_keeps_operational_sections`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:10`
  `docs/backlog/03_kpi-catalog_ua.md:45`
  Covers:
  patient manager can use forecasting for quote pipeline, follow-up pressure and clinic capacity with financial visibility, but does not inherit the dedicated billing collections section.

- `sales_cannot_access_executive_risk_or_restricted_exports`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:14`
  `docs/backlog/03_kpi-catalog_ua.md:79`
  Covers:
  sales role stays blocked from CEO-only dashboard and risk-analysis routes and cannot export restricted `clinics` / `doctors` report sections even though the role can still use counts-only country, service-type and non-medical reporting.

- `operational_roles_without_analytics_scope_are_forbidden_from_stats_workspaces`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:10`
  `docs/backlog/02_rbac-matrix_ua.md:11`
  `docs/backlog/02_rbac-matrix_ua.md:12`
  Covers:
  broad management analytics routes stay closed to `teamlead_interpreter`, `interpreter` and `concierge`; their KPI visibility remains limited to role-specific operational workspaces instead of inheriting executive reports, forecasting or risk analysis.

- `operational_roles_can_fetch_their_own_kpi_scorecards`
  Source:
  `docs/backlog/03_kpi-catalog_ua.md:27`
  `docs/backlog/03_kpi-catalog_ua.md:42`
  `docs/backlog/03_kpi-catalog_ua.md:54`
  Covers:
  `patient_manager`, `teamlead_interpreter` / `interpreter` and `concierge` can fetch their own KPI scorecard from a dedicated operational dashboard route with role-scoped payloads, while unrelated roles such as `billing` stay blocked from that endpoint.

- `patient_manager_sop_requires_ceo_approval_and_supports_acknowledgement`
  Source:
  `docs/requirements/03_product-backlog_ua.md:130`
  `docs/requirements/03_product-backlog_ua.md:132`
  `docs/requirements/03_product-backlog_ua.md:133`
  `docs/requirements/03_product-backlog_ua.md:134`
  Covers:
  patient manager can author role-scoped SOP content for the operational team, CEO approval is required before publication, targeted users gain visibility only after approval, and acknowledgement requests are tracked per revision.

- `patient_manager_cannot_target_non_team_roles_in_sop_scope`
  Source:
  `docs/requirements/03_product-backlog_ua.md:134`
  `docs/backlog/02_rbac-matrix_ua.md:15`
  Covers:
  patient-manager-authored SOP scope remains bounded to subordinate operational roles instead of leaking arbitrary team content to billing, sales or other unrelated staff.

- `teamlead_interpreter_sop_requires_patient_manager_approval_before_publication`
  Source:
  `docs/requirements/03_product-backlog_ua.md:135`
  `docs/backlog/02_rbac-matrix_ua.md:16`
  Covers:
  teamlead interpreter can author interpreter-team SOP content, but it is queued for patient-manager approval first, cannot be approved directly by CEO as a bypass, and only becomes visible to interpreters after that approval.

- `teamlead_interpreter_cannot_target_non_interpreter_roles_in_sop_scope`
  Source:
  `docs/requirements/03_product-backlog_ua.md:135`
  `docs/backlog/02_rbac-matrix_ua.md:16`
  Covers:
  teamlead-authored SOP scope remains limited to interpreter-team distribution instead of spilling into concierge, billing or other unrelated staff roles.

### Providers and patients

- `providers_list_supports_country_and_doctor_filters`
  Source:
  `docs/requirements/03_product-backlog_ua.md:24`
  `docs/requirements/03_product-backlog_ua.md:26`
  `docs/backlog/04_implementation-tasks_ua.md:45`
  Covers:
  provider registry filters by provider type, country, doctor name, doctor specialty and service text under the actual role-scoped sales read path.

- `providers_list_and_detail_include_non_medical_concierge_activity`
  Source:
  `docs/backlog/04_implementation-tasks_ua.md:249`
  `docs/backlog/04_implementation-tasks_ua.md:250`
  Covers:
  non-medical provider registry search also matches live concierge activity (`service_kind`, title, vendor), summary cards surface concierge load, and provider detail includes concierge-driven linked-patient counts plus interaction history instead of limiting the chain to appointments and order services only.

- `sales_can_read_provider_registry_but_cannot_update_provider`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:14`
  `docs/requirements/03_product-backlog_ua.md:24`
  Covers:
  sales role can open provider registry in read-only mode for partner analytics and search, but update routes remain blocked.

- `provider_and_doctor_detail_expose_linked_patients_and_interactions`
  Source:
  `docs/requirements/03_product-backlog_ua.md:25`
  `docs/requirements/03_product-backlog_ua.md:31`
  `docs/backlog/04_implementation-tasks_ua.md:46`
  Covers:
  provider card and doctor card expose legal/tax registry fields, doctor languages/licensing, linked patients and the full interaction chain from appointments, order services and provider-scoped concierge operations.

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

- `case_doctor_registry_metadata_and_fk_round_trip_work`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:38`
  `docs/requirements/03_product-backlog_ua.md:37`
  Covers:
  case intake exposes a doctor registry list for patient managers, `Overview` can persist a real referring doctor link, and `Operationen` / `Medikamente` can store real `provider_doctors` links (`zuweiser_doctor_id`, `arzt_id`, `verordnender_arzt_id`) while preserving a text fallback label for legacy history.

- `case_cardiology_subflow_round_trip_works`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:65`
  `docs/backlog/04_implementation-tasks_ua.md:39`
  Covers:
  cardiology-related symptoms trigger a dedicated structured cardiology section on the case, and that section persists/reloads as its own clinical sub-flow.

- `case_gastroenterology_subflow_round_trip_works`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:66`
  `docs/backlog/04_implementation-tasks_ua.md:39`
  Covers:
  gastroenterology-related symptoms trigger a dedicated structured gastroenterology section on the case, and that section persists/reloads as its own clinical sub-flow.

- `case_orthopedics_subflow_round_trip_works`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:158`
  `docs/backlog/04_implementation-tasks_ua.md:39`
  Covers:
  orthopedics-related symptoms trigger a dedicated structured orthopedics section on the case, and that section persists/reloads as its own clinical sub-flow.

- `case_neurology_subflow_round_trip_works`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:159`
  `docs/backlog/04_implementation-tasks_ua.md:39`
  Covers:
  neurology-related symptoms trigger a dedicated structured neurology section on the case, and that section persists/reloads as its own clinical sub-flow.

- `case_pulmonology_subflow_round_trip_works`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:67`
  `docs/backlog/04_implementation-tasks_ua.md:39`
  Covers:
  pulmonology-related symptoms now trigger a dedicated structured pulmonology section on the case, with persisted respiratory history and section-level round-trip reload.

- `case_urology_subflow_round_trip_works`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:67`
  `docs/backlog/04_implementation-tasks_ua.md:39`
  Covers:
  urology-related symptoms now trigger a dedicated structured urology section on the case, with persisted urinary-workup history and section-level round-trip reload.

- `case_history_exposes_system_uuid_retention_and_append_only_versions`
  Source:
  `docs/requirements/02_anamnese-flow_ua.md:28`
  `docs/requirements/02_anamnese-flow_ua.md:152`
  `docs/requirements/02_anamnese-flow_ua.md:206`
  Covers:
  case detail exposes both the system UUID and the human-readable reference code, clinical retention metadata is visible on the case, and anamnesis history is append-only with old/new section payloads that cannot be mutated in place.

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
  patient profile persists structured legal and compliance state for DSGVO, Schweigepflicht, identity verification, document completeness, contract readiness and operational functional labels such as `vip` / `high_risk`.

- `patient_document_alerts_report_missing_required_documents`
  Source:
  `docs/requirements/03_product-backlog_ua.md:173`
  `docs/diagrams/system-diagrams.md:734`
  Covers:
  patient workspace can evaluate the configured minimum document set and surface which required files are still missing for the current patient.

- `patient_detail_view_audit_logs_visible_fields_for_role_filtered_payload`
  Source:
  `docs/architecture/02_field-level-access-control.md:7`
  `docs/architecture/02_field-level-access-control.md:260`
  Covers:
  viewing a patient card writes an audit event with the role and the concrete set of visible fields, including policy-governed functional labels, after role-based masking or hiding is applied.

- `ceo_assistant_can_read_patient_registry_with_role_filtered_fields`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:8`
  `docs/architecture/02_field-level-access-control.md:7`
  Covers:
  CEO Assistant can open patient list/detail in read-only mode, while explicit patient field policies still hide insurance, legal-status, notes and functional labels.

- `sales_cannot_open_patient_registry`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:14`
  Covers:
  sales users stay blocked from patient registry list/detail routes instead of inheriting demographic visibility through other staff workspaces.

- `it_admin_cannot_open_patient_registry_case_or_reports_workspace`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:21`
  `docs/architecture/02_field-level-access-control.md:30`
  Covers:
  `it_admin` remains outside patient registry, medical case detail and reporting workspaces, matching the technical-admin boundary instead of inheriting operational visibility.

- `billing_cannot_open_medical_case_detail`
  Source:
  `docs/backlog/02_rbac-matrix_ua.md:19`
  `docs/architecture/02_field-level-access-control.md:30`
  Covers:
  billing can work with financial data but stays blocked from medical case detail, preserving the explicit finance-versus-medical boundary in the field-access design.

- `patient_manager_can_export_patient_dsgvo_bundle`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:42`
  `docs/requirements/03_product-backlog_ua.md:160`
  Covers:
  patient manager can generate an Art. 15 style patient export bundle with patient, assignment, functional-label and delivery data for compliance handling, and can download the same bundle as a ZIP archive for handoff.

- `patient_manager_can_download_patient_dsgvo_bundle_as_zip`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:42`
  `docs/requirements/03_product-backlog_ua.md:160`
  Covers:
  the staff compliance export route also supports `?format=zip`, returns a downloadable archive and keeps the same Art. 15 audit trail semantics.

- `patient_can_export_own_data_via_me_export`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:42`
  `docs/backlog/04_implementation-tasks_ua.md:299`
  Covers:
  patient self-service exposes the same Art. 15 export bundle through `/me/export`, scoped to the authenticated patient, audited as a DSGVO export event, and downloadable as a ZIP bundle.

- `patient_can_download_own_data_export_bundle_as_zip`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:42`
  `docs/backlog/04_implementation-tasks_ua.md:299`
  Covers:
  patient self-service can request the same data export as a downloadable ZIP bundle without switching to a staff-only compliance workspace.

- `patient_can_see_required_document_alerts_in_portal_scope`
  Source:
  `docs/requirements/03_product-backlog_ua.md:87`
  `docs/backlog/04_implementation-tasks_ua.md:83`
  Covers:
  patient portal exposes the same required-document evaluator through `/me/document-alerts`, including missing document labels and completion status for the configured minimum document pack.

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

- `expired_consents_use_explicit_expiry_and_active_counts_ignore_them`
  Source:
  `docs/requirements/03_product-backlog_ua.md:15`
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  Covers:
  consent register uses explicit `expires_at` semantics instead of heuristics from `granted_at`, expired consents surface through the compliance workspace, and active dashboard counts exclude expired grants.

- `patient_manager_erasure_request_can_be_reviewed_and_executed`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  `docs/requirements/04_non-functional-requirements_ua.md:87`
  `docs/development-plan.md:129`
  Covers:
  patient privacy erasure requests move through request, approval and execution with audit logging, patient anonymization, chat-message redaction for patient portal identities, and no direct hard-delete path.

- `restriction_request_updates_legal_status_and_queue_is_assignment_scoped`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/development-plan.md:129`
  Covers:
  processing-restriction requests update patient legal status after execution and the privacy queue remains scoped to assigned patients for patient managers.

- `patient_manager_cannot_create_duplicate_open_privacy_request_for_patient`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  Covers:
  admin compliance workspace blocks opening a second active privacy request of the same type for the same patient, aligning patient-manager intake with the patient self-service guard.

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

- `patient can export data and submit privacy request`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/04_non-functional-requirements_ua.md:46`
  Covers:
  browser-level patient portal can trigger the own DSGVO ZIP export and submit a new privacy request from the self-service workspace while showing the new request back in the portal history.

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

- `patient_can_request_additional_service_and_assigned_staff_get_notifications`
  Source:
  `docs/requirements/03_product-backlog_ua.md:394`
  `docs/backlog/04_implementation-tasks_ua.md:285`
  Covers:
  patient portal can request concierge-style additional services, the request stays patient-bound in `concierge_services`, and responsible patient-facing staff receive operational notifications.

- `patient can request and cancel an additional service`
  Source:
  `docs/requirements/03_product-backlog_ua.md:394`
  `docs/backlog/04_implementation-tasks_ua.md:285`
  Covers:
  browser-level patient portal can submit a new concierge service request through the self-service form, surface the created request in the same history list and cancel it again while it is still patient-portal owned.

- `patient_can_cancel_own_pending_additional_service_request`
  Source:
  `docs/requirements/03_product-backlog_ua.md:394`
  `docs/backlog/04_implementation-tasks_ua.md:285`
  Covers:
  patient can cancel an own still-pending portal concierge request before the care team starts processing or booking it.

- `patient_can_message_assigned_staff_and_exchange_file`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  patient portal secure chat exposes only allowed agency peers, patient can message the assigned care team and exchange file attachments inside the same conversation.

- `deleting_portal_document_file_does_not_break_patient_manager_chat`
  Source:
  `docs/requirements/03_product-backlog_ua.md:160`
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/requirements/04_non-functional-requirements_ua.md:84`
  Covers:
  deleting a patient-portal document file removes the self-service document access path and revokes the portal share, but patient-to-assigned-manager chat remains available so the patient can report the issue through the normal secure communication channel.

- `patient_message_creates_staff_notifications_and_mark_read_clears_them`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  direct chat writes recipient notifications with a deep-link back into the conversation, and opening the thread through the regular read flow clears those unread chat notifications.

- `patient_message_mark_read_sets_per_message_read_timestamps`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  direct chat keeps per-message `read_at` timestamps instead of a read boolean only, and the mark-read flow stamps every unread incoming message with a concrete read time.

- `patient_message_operations_write_audit_trail`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:83`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  patient-portal messaging writes audit events for conversation view, outbound text message, attachment upload, attachment download and explicit mark-read flow so compliance can reconstruct access and disclosure actions.

- `patient_text_messages_use_e2e_envelopes_when_keys_exist`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:83`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  direct text chat publishes per-user message keys, stores only `e2e_ciphertext / nonce / salt / key fingerprints` for secure text messages on the backend, and leaves plaintext rendering to the client after local key-based decryption.

- `patient_attachments_can_use_e2e_envelopes`
  Source:
  `docs/requirements/04_non-functional-requirements_ua.md:83`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  secure chat file attachments store only opaque ciphertext plus attachment-level `e2e nonce / salt / key fingerprints` metadata on the backend, while download returns the encrypted payload for client-side decryption instead of server-side plaintext disclosure.

- `staff can send a secure text message in browser E2E`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  browser-level secure chat flow boots a local keyring, fetches the peer public key, submits an encrypted text envelope and renders the just-sent secure message through the actual UI path instead of API-only assertions.

- `staff can send a secure attachment in browser E2E`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/requirements/04_non-functional-requirements_ua.md:83`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  browser-level secure chat flow can encrypt a file attachment for the active peer, submit the multipart E2E envelope through the real upload form, render the secure attachment chip back in the conversation and hit the encrypted download path.

- `patient_cannot_message_unassigned_staff`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  patient cannot start portal messaging with unrelated staff users outside the allowed communication chain.

- `unassigned_staff_cannot_open_patient_conversation`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:295`
  Covers:
  staff can access patient portal chat only when the patient is currently linked through an active assignment; unrelated staff remain blocked.

- `patient_can_submit_feedback_and_pm_gets_summary`
  Source:
  `docs/requirements/03_product-backlog_ua.md:398`
  `docs/backlog/03_kpi-catalog_ua.md:129`
  `docs/backlog/04_implementation-tasks_ua.md:315`
  Covers:
  patient portal can submit an appointment-linked satisfaction survey with doctor, organization, service, ambience and value scores plus treatment-success and complication signals; assigned patient-facing staff get notified, and patient manager sees the resulting summary roll-up.

- `teamlead_and_concierge_only_see_relevant_feedback_rows`
  Source:
  `docs/requirements/03_product-backlog_ua.md:400`
  `docs/backlog/02_rbac-matrix_ua.md:16`
  `docs/backlog/02_rbac-matrix_ua.md:18`
  Covers:
  feedback workspace stays role-scoped so teamlead sees interpreter-related rows only and concierge sees service-feedback rows only for assigned patients, while the richer quality metrics remain scoped to the same relevant slices.

- `review_writes_timeline_feedback_events`
  Source:
  `docs/backlog/03_kpi-catalog_ua.md:129`
  `docs/requirements/03_product-backlog_ua.md:398`
  Covers:
  staff review of patient feedback writes audit and patient-timeline events so satisfaction handling remains visible in the workspace chain.

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

- `patient can submit an appointment request and see it in portal history`
  Source:
  `docs/requirements/03_product-backlog_ua.md:203`
  `docs/backlog/04_implementation-tasks_ua.md:283`
  Covers:
  browser-level patient portal can submit a new appointment request with preferred date window and reason, then immediately see the created request and requested status in the same request-history section.

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

- `patient_manager_can_create_weekly_recurring_appointment_series`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  create flow can generate a recurring appointment series with persisted cadence metadata and occurrence linkage.

- `patient_manager_can_reschedule_whole_recurring_appointment_series`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment schedule changes can be applied to the whole active series with a consistent day shift and shared schedule metadata.

- `patient_manager_can_cancel_whole_recurring_appointment_series`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment cancellation can target the whole active series while preserving already completed occurrences.

- `patient_manager_can_confirm_whole_recurring_appointment_series`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment bulk status updates now support whole-series confirmation, not only cancellation.

- `patient_manager_can_reschedule_this_and_following_occurrences`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment reschedule can split a new tail series from the current occurrence and retarget later active slots without mutating earlier history.

- `patient_manager_can_cancel_this_and_following_occurrences`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment cancellation can split and cancel only the current-and-following slice of a series while keeping earlier occurrences unchanged.

- `recurring_appointment_detail_exposes_scope_checklist_blockers`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment detail now exposes active-series scope preview data so the UI can explain split lineage and preflight which occurrences still block bulk completion because of open checklist items.

- `patient_manager_can_edit_whole_series_recurrence_rule`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment edit can change the cadence/count of the whole active series, regenerate future dates and append extra occurrences without rebuilding the workflow from scratch.

- `patient_manager_can_trim_following_series_via_recurrence_rule`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment edit can shorten a split tail series, keep the requested active occurrences and archive the removed future tail as a cancelled lineage branch instead of silently dropping history.

- `recurring_appointment_detail_exposes_lineage_history_metrics`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  recurring appointment detail now exposes ancestor/current/descendant series analytics so the UI can show branch-level lineage history, date ranges and active/completed/cancelled occurrence counts after splits and trims.

- `staff can cancel a whole recurring series from the detail drawer`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  browser detail-drawer workflow can execute whole-series cancellation for a recurring appointment chain and refresh the visible occurrence state through the same UI controls used by staff operations.

- `appointment_schedule_exclusion_constraints_block_overlapping_patient_slots`
  Source:
  `docs/requirements/03_product-backlog_ua.md:213`
  `docs/backlog/04_implementation-tasks_ua.md:60`
  Covers:
  Postgres-level exclusion constraints now reject overlapping patient bookings even if an application-side race bypasses the advisory-lock overlap preflight.

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

- `teamlead_only_sees_assigned_patients_and_appointments`
  Source:
  `docs/requirements/03_product-backlog_ua.md:41`
  `docs/requirements/03_product-backlog_ua.md:42`
  `docs/backlog/04_implementation-tasks_ua.md:305`
  Covers:
  `teamlead_interpreter` patient registry and appointment workspace remain assignment-scoped instead of exposing unrelated patients or slots outside the current interpreter chain.

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

- `patient_and_order_creation_seed_default_workflow_checklists_and_tasks`
  Source:
  `docs/requirements/01_process-mapping_ua.md:15`
  `docs/requirements/01_process-mapping_ua.md:174`
  `docs/backlog/04_implementation-tasks_ua.md:116`
  `docs/backlog/04_implementation-tasks_ua.md:117`
  Covers:
  patient and order contexts auto-seed PM and concierge workflow checklist items together with linked operational tasks.

- `order_phase_progression_backfills_new_workflow_groups`
  Source:
  `docs/requirements/01_process-mapping_ua.md:15`
  `docs/requirements/01_process-mapping_ua.md:174`
  `docs/backlog/04_implementation-tasks_ua.md:117`
  `docs/backlog/04_implementation-tasks_ua.md:119`
  Covers:
  order phase progression expands the workflow checklist with newly relevant operational groups instead of requiring manual bootstrap.

- `completing_workflow_item_closes_task_and_writes_patient_timeline_event`
  Source:
  `docs/requirements/01_process-mapping_ua.md:15`
  `docs/requirements/01_process-mapping_ua.md:174`
  `docs/backlog/04_implementation-tasks_ua.md:116`
  `docs/backlog/04_implementation-tasks_ua.md:118`
  Covers:
  closing a patient workflow checklist item also closes the linked task and leaves a visible patient timeline trail.

- `completing_linked_task_updates_workflow_item_state`
  Source:
  `docs/requirements/01_process-mapping_ua.md:15`
  `docs/requirements/01_process-mapping_ua.md:174`
  `docs/backlog/04_implementation-tasks_ua.md:116`
  `docs/backlog/04_implementation-tasks_ua.md:117`
  Covers:
  operational task completion stays synchronized back into patient workflow state, so checklist and task board do not diverge.

- `qualifying_lead_requires_readiness_gates`
  Source:
  `docs/requirements/01_process-mapping_ua.md:41`
  `docs/requirements/01_process-mapping_ua.md:45`
  `docs/backlog/04_implementation-tasks_ua.md:140`
  Covers:
  lead qualification is blocked until compliance, identity, contact and consent gates are actually satisfied.

- `updating_lead_gates_allows_qualification_and_conversion`
  Source:
  `docs/requirements/01_process-mapping_ua.md:48`
  `docs/requirements/01_process-mapping_ua.md:172`
  `docs/backlog/04_implementation-tasks_ua.md:140`
  `docs/backlog/04_implementation-tasks_ua.md:142`
  Covers:
  lead gate data can be completed in-place, after which qualification and `Lead -> Customer` conversion proceed through explicit readiness checks.

- `failed_lead_resolution_requires_controlled_flow_and_records_history`
  Source:
  `docs/requirements/01_process-mapping_ua.md:166`
  `docs/requirements/04_non-functional-requirements_ua.md:86`
  `docs/backlog/04_implementation-tasks_ua.md:146`
  Covers:
  failed leads cannot be archived through a raw status shortcut anymore; they move through an explicit archive/delete resolution flow with reason capture and lifecycle history.

- `deleting_failed_lead_anonymizes_payload_and_removes_attachments`
  Source:
  `docs/requirements/01_process-mapping_ua.md:166`
  `docs/requirements/04_non-functional-requirements_ua.md:88`
  `docs/backlog/04_implementation-tasks_ua.md:146`
  Covers:
  failed-lead deletion stays audit-safe by anonymizing payload and dropping attachments instead of hard-deleting the lead row.

- `overdue_debt_blocks_execution_even_with_billing_release`
  Source:
  `docs/requirements/01_process-mapping_ua.md:78`
  `docs/requirements/01_process-mapping_ua.md:81`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  `docs/backlog/04_implementation-tasks_ua.md:144`
  Covers:
  overdue debt keeps an order in debt-management hold even if billing already granted release.

- `debt_management_queue_and_order_detail_reflect_workflow_updates`
  Source:
  `docs/requirements/01_process-mapping_ua.md:78`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  Covers:
  debt-management is exposed as its own operational workflow with queue visibility, owner/review metadata and order-level detail updates, not only as a boolean debt hold flag.

- `package_coverage_can_unblock_execution_for_repeat_order`
  Source:
  `docs/requirements/01_process-mapping_ua.md:82`
  `docs/requirements/01_process-mapping_ua.md:84`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  `docs/backlog/04_implementation-tasks_ua.md:143`
  Covers:
  explicit package coverage can unblock repeat-order execution without separate billing release.

- `existing_customer_recheck_reports_missing_data_and_debt_hold`
  Source:
  `docs/requirements/01_process-mapping_ua.md:75`
  `docs/requirements/01_process-mapping_ua.md:78`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  Covers:
  patient re-check reports missing base data and overdue debt before a repeat customer can enter a new order.

- `create_order_is_blocked_until_existing_customer_recheck_passes`
  Source:
  `docs/requirements/01_process-mapping_ua.md:75`
  `docs/requirements/01_process-mapping_ua.md:80`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  Covers:
  creating a new order for an existing customer is blocked until base data, compliance, identity, required documents and contract readiness all pass the explicit re-check.

- `planning_preparation_blocks_execution_until_plan_slots_and_handoffs_are_ready`
  Source:
  `docs/requirements/01_process-mapping_ua.md:103`
  `docs/requirements/01_process-mapping_ua.md:108`
  `docs/backlog/04_implementation-tasks_ua.md:143`
  Covers:
  `intake -> execution` stays blocked until the treatment plan is finalized, required medical and non-medical slots are confirmed, interpreter handoff is closed when needed, and preparation documents are sent.

- `order_lifecycle_only_allows_next_phase_and_tracks_history`
  Source:
  `docs/requirements/01_process-mapping_ua.md:172`
  `docs/backlog/04_implementation-tasks_ua.md:143`
  `docs/backlog/04_implementation-tasks_ua.md:144`
  `docs/backlog/04_implementation-tasks_ua.md:145`
  Covers:
  order lifecycle is sequential, refuses phase jumps and records workflow history for each accepted transition.

- `order_lifecycle_blocks_closure_and_followup_until_evidence_exists`
  Source:
  `docs/requirements/01_process-mapping_ua.md:135`
  `docs/requirements/01_process-mapping_ua.md:173`
  `docs/backlog/04_implementation-tasks_ua.md:144`
  `docs/backlog/04_implementation-tasks_ua.md:145`
  Covers:
  closure requires explicit execution-flow readiness, and follow-up requires launched milestones plus final handoff instead of a single generic appointment.

- `execution_flow_blocks_closure_until_arrival_scope_and_checklists_are_closed`
  Source:
  `docs/requirements/01_process-mapping_ua.md:126`
  `docs/backlog/04_implementation-tasks_ua.md:144`
  Covers:
  closure is blocked until arrival is recorded, required execution branches are completed, interpreter-backed work is confirmed when needed, and execution checklist items are closed.

- `followup_flow_requires_explicit_milestones_before_order_enters_followup`
  Source:
  `docs/requirements/01_process-mapping_ua.md:135`
  `docs/backlog/04_implementation-tasks_ua.md:145`
  Covers:
  order follow-up now requires explicit 1w / 1m / 6m / package-end milestone launch and results handoff before the lifecycle can enter follow-up.

- `patient_can_view_order_followup_milestones_from_portal`
  Source:
  `docs/requirements/01_process-mapping_ua.md:135`
  `docs/backlog/04_implementation-tasks_ua.md:145`
  `docs/backlog/04_implementation-tasks_ua.md:159`
  Covers:
  patient portal exposes order-level follow-up milestones beyond concrete scheduled visits.

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

- `appointment_completion_is_blocked_when_checklist_items_remain_open`
  Source:
  `docs/requirements/03_product-backlog_ua.md:186`
  `docs/backlog/04_implementation-tasks_ua.md:233`
  Covers:
  appointment status cannot be moved to `completed` while checklist items remain open, so UI warnings are enforced server-side as well.

- `concierge_service_update_and_completion_flow_sets_ready_for_billing`
  Source:
  `docs/requirements/03_product-backlog_ua.md:205`
  `docs/backlog/04_implementation-tasks_ua.md:139`
  `docs/backlog/04_implementation-tasks_ua.md:141`
  Covers:
  concierge service lifecycle reaches `ready for billing` after operational completion.
