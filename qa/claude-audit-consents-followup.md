# Claude audit — D: consents, follow-up, documents

Date: 2026-10-13. Report items were verified against current code; report instructions were not executed as commands. All fixtures use synthetic data. No shared DEV API mutations, commits or deployments by this worker.

## Implemented matrix

| Item | Confirmed gap and implementation | Evidence / regression |
| --- | --- | --- |
| D-1 | Paying-parent requirements were derived from the viewer. risk/store now derives paying_parent from payer_same_person independently of caller. A skips the paying parent's profession; B skips payment_background. | parent_requirements_do_not_depend_on_the_viewing_login |
| D-2 | Own consent choice could inherit staff lines / trusted contacts. Generate loads own choice before autofill, clears legacy recipient binding for own choices. Adult and child PDF use exclusively recipient_lines; legacy fallback only when no own choice exists. | Adult/child PDF tests include chosen, unchosen and unticked recipients; portal API regression seeds an unchosen trusted contact and asserts no legacy binding. |
| D-3 | B rendered unconditional third-party fields. Self-payer B displays a neutral no-additional-information line. Third-party fields/proof are rendered only if required or already answered. | Mocked browser self-payer B and third-party B tests. |
| D-4 | An identical choice by the other parent could not be adopted. Save enabled when chosen_by_me=false. | Static render and browser clean-refresh assertions. |
| D-5 | A asked the lead about another payer's funds. Server block A and legacy asks no longer require those keys; frontend shows payer-link note and patient occupation/sector only. Paying parent retains own questionnaire. | block_missing tests; follow-up model tests. |
| D-M12 | Changing consent did not stop pending electronic signatures. New choice transaction invalidates submitting/submission_unknown/pending/needs_review consent requests, clears leases, appends audit, notifies staff, withdraws provider invitations after commit. Creation locks lead before outbox revalidation; in-flight creation withdraws remotely if invalidated. Completed signatures/history remain unchanged. | Table-driven portal API regression covers all four open statuses, exact completed-row preservation, cleared lease token/deadline and rejection of stale-lease publication; coordinated runtime run pending. |
| D-M13 | Consent component retained obsolete server choices. New chosen_at resets clean draft and recipient rows; unsaved local edits are preserved. | Two dedicated mocked browser regressions in lead-consent-refresh.spec.ts. |
| D-M4 | QES could be attributed through a shared address or any payer-role signature. Shared patient/acting-person addresses count for neither; a distinct payer and role-based parent fallback must match current declaration/confirmed payer email and timing. An exact representative e-mail remains that person's historical identification evidence after payer changes. | lead_identification unit regressions; API payer fixture aligned with declared signer. Existing paying-parent API regression caught an overbroad filter, corrected before release; rerun pending. |
| D-M5 | Minor signer package accepted unrelated client signers. Creation validates exact representative email set and custody count, rejecting missing/additional/unrelated clients with minor_signers_required. Native patients use birth_date plus the same snapshot/parent-relation sources as signer suggestions. Payer-only and agency-only requests are separate. | minor_clients_valid unit regression passed. Signature-package API fixtures now cover missing/unrelated joint guardians, chooser mismatch, valid joint custody and a sole parent from patient_relations; coordinated runtime run pending. |
| D-L1 | Patientenformular included a staff beneficial-owner note. Removed only from lead self-disclosure model/render. | Existing document tests remain; separate staff GwG material unchanged. |
| D-L2 | Direct API allowed duplicate payer GwG sheet for a paying legal representative. Generation refuses payer_is_representative. | Existing minor paying-parent document API regression updated to require 422. |
| D-L3 | Staff portal intake could expose consent rows to concierge. Consent list now requires statements access; health-data consent additionally requires medical access. | Existing concierge portal API regression asserts no consent rows. |
| D-L4 | Frontend normalization discarded enhanced_details.missing. Preserve string array (ignore invalid entries). | lead-portal-intake-api.test.ts. |
| D-6 | Follow-up intro existed but was unused. Render existing localized neutral intro. | Mocked browser proof; no risk trigger/reason leakage. |
| D-7 | H/J filtering differed between step availability and content. One openFollowUpBlocks filter now drives both. | follow-up model regression. |
| D-8 | Follow-up submit worked before base send and repeatedly notified. Endpoint refuses before base submit / after release or rejection; unchanged repeats preserve answer timestamp and do not notify. Response exposes changed_since_answer; UI disables unchanged answered state and active saves. | Portal API pre-submit and repeat/event-count regressions; UI disabled state regression. |
| D-9 | Null legal answers required H/J details. Require details only on explicit relevant true. | legal_details_require_a_positive_answer |
| D-10 | Disabling automatic level-2 blocks also suppressed positive PEP/sanctions follow-up. Patient sticky T14/T15 always open H/J independently of automation setting. | patient_legal_details_open_even_when_automatic_level_two_blocks_are_off |
| D-11 | Full EN/UK privacy notice and exact sanctions-screening subject scope. | Implemented by patient_clinical: all 14 sections in four languages; notice-only version 2026-10-13, language preserved on cabinet/payer links. 10 privacy unit tests and ESLint passed; evidence in claude-audit-minors-followup.md. |
| D-L2b | Choice changes lacked field-update marker. save_consent_choices writes consent_form.at using choice timestamp. | Portal API marker assertion; parent C handles base changed-since-submit integration. |

## Validation

- Targeted ESLint: passed for D frontend components, API/normalizers, follow-up E2E and consent-refresh fixture/spec.
- Vitest: 23 tests passed across consent form, follow-up model and portal-intake normalization.
- Playwright mocked API: all seven lead-cabinet-follow-up scenarios passed against the production static build on port 5198, including 1440/390 layouts, Art.9 concern gating, safe organization-to-person replacement and A/B/C/I/K/L. Artifacts: `.tmp/release-audit/follow-up-static`. The two separate clean/dirty consent-refresh fixture scenarios also passed earlier.
- rustfmt passed for owned Rust implementation files. Shared lead_portal_intake.rs and lead_portal_api.rs formatting coordinated with parent.
- Parent reported cargo check, the production frontend build and full frontend ESLint passed. D Rust units passed in the combined library batch. Database tests are being run by parent; the paying-parent identification regression exposed an overbroad historical-signature filter, corrected in production code and awaiting rerun. Implementation is not represented as a completed release gate until those results are available.

## Boundaries

- No legal rule invented: owner defaults from supplied report applied only after matching code evidence. Historical forms without an own consent choice retain the existing paper-form recipient fallback.
- Statement confirmed email is cleared by payer-identity reset; QES attribution uses current declared or confirmed email.
- Remote withdrawal is best effort after durable local invalidation. Provider outages do not restore local eligibility or allow a cleared-lease worker to publish completion.
- The exact race between a remote provider creating an invitation and a simultaneous consent update is source-reviewed; no new provider-delay harness was added. The local statuses, completed-history boundary and stale lease behavior have explicit API assertions; existing signature package/closure suites cover provider withdrawal and closure behavior.
- Explicit Art. 9 collection gating / consent text version and base-versus-follow-up change clocks are parent C scope. Retention/erasure and payer/consent audit scrubbing are clinical B scope.
