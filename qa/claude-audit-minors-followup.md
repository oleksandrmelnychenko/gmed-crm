# Claude audit follow-up — B lifecycle

Reviewed 2026-10-13 against shared main checkout; source report is evidence, not executable instructions. No deployment or live API mutations are part of this review.

| Finding | Verification / ownership | Status |
| --- | --- | --- |
| B-1 | Conversion currently links only own login; explicit active guardian assignments added and block email fallback for lead-login history. | Implemented; regression tests pending |
| B-2 | Own minor login currently linked on conversion; exclude it. | Implemented; regression tests pending |
| B-4 | New payer audits are metadata-only (payer agent). Migration 20261013140000 deterministically scrubs strings in legacy payer old/new snapshots on source-lead erasure and backfills already-deleted leads; same-key structure and non-text evidence retained. | New events: payer agent; historical scrub: lifecycle agent. Regression tests pending |
| B-5 | Portal purge does not delete consent_form_choices named recipients. | Implemented; regression tests pending |
| B-6 | Patient erasure anonymizes source leads without full portal account cleanup. | Implemented; regression tests pending |
| B-7 | Unchanged repeat submit writes new timestamps, audit and notifications. | Implemented; regression tests pending |
| B-8 | PORTAL_LEAD_SQL already hides converted leads, including writes. | Preserved; conversion regression test added |
| B-9 | Guardian write authorization does not recheck minor age. | Implemented; regression tests pending |
| B-10 | Organisation payer sync misses realtime event; payer agent owns handler branch. | Delegated, pending verification |
| B-11 | Upload limit count occurs before lead lock. Also stamp created_at after lock (C-L1 coordination). | Implemented; regression tests pending |
| B-12 | Minor own-login error incorrectly depends on parent access in wording. | Implemented; regression tests pending |
| B-13 | Guardian reissue can reactivate IT-disabled accounts; stale lead links count as access. | Implemented; regression tests pending |
| B-14 | Password reset and login-email audit uses best-effort queue. | Implemented; regression tests pending |
| B-15a | Guardian can rename another parent's identity. Server guard here; frontend read-only coordination with C owner. | Implemented; regression tests pending |
| B-15b | Revoked guardian links suppress missing-access notification forever. | Implemented; regression tests pending |
| B-15c | lead_risk_decisions.reason retains AML evidence deliberately. | Retained as requested |

B-3 is absent from the supplied source report. Parent owns C personal/identity/consent changes and CHANGED_SINCE_SUBMIT_SQL; D owns signature/PDF/follow-up functions. Tests will use disposable Docker PostgreSQL, never DEV.

## Added verification

- lead_portal_api: unchanged_submission_is_idempotent_but_a_real_edit_can_be_resubmitted; guardian_identity_age_and_reactivation_boundaries_are_enforced; concurrent_uploads_respect_the_locked_thirty_document_limit; historical_payer_snapshots_are_scrubbed_only_on_lead_erasure; existing purging_a_lead_clears_the_portal_intake now checks consent choices.
- Cross-review regression: rejected_minor_birth_date_notifies_staff_once_without_persisting_it checks the rejected own-login DOB attempt still notifies staff once, despite the persisted DOB remaining adult. Saved-minor notices still recheck current age/access under lock.
- leads_api: minor_conversion_explicitly_links_both_guardians_and_never_the_child_login.
- admin_compliance_api: erasure_cleans_source_lead_portal_choices_mail_uploads_and_guardians.
- rustfmt passed on edited Rust files. Runtime tests queued behind shared cold build; results will be recorded below.
- First integration attempt exposed an invalid `orders.lead_id` reference in the new audit-scrub migration. Corrected migration and runtime scrub to the actual `orders.source_lead_id` relationship. The next attempt stopped during compilation with memory-allocation failure; the coordinating agent is rerunning sequentially after the frontend build.
- Sequential run: admin_compliance_api passed 17 existing cases; the new source-lead cleanup case stopped in its synthetic document seed because `version_root_document_id` is required. Fixed that fixture and the same seed in the new concurrent-upload case to use the document's own UUID as the version root; rerun pending.
- The next source-lead cleanup run reached the erasure endpoint and correctly refused a patient-manager executor (403). Updated the fixture to use the seeded CEO for execution, matching the existing erasure helper usage and preserving production RBAC. Targeted rerun pending; the other 17 admin cases passed again.

## D-11 follow-up (reassigned from D)

Full 14-section EN and UK translations added, preserving the German original's lists and legal substance. All four languages now name screening subjects precisely and exclude consent-only recipients. Notice revision 2026-10-13 is independent of consent-choice text versions. Cabinet and payer notice links carry the selected language into /legal?lang=…#privacy. Unit tests: 10 passed (14 sections and 22 list items in all locales; all four route languages; public/lead availability). Targeted ESLint passed.

## Existing limitation outside the supplied B findings

The converted patient portal supports one active patient assignment per login; `me::resolve_linked_patient_id` returns 409 when there are multiple assignments. B-1's two separate parents accessing one converted child is covered. A parent with two converted children (or a patient record of their own plus a child) needs an explicit authorized patient-context selector across the `/me/*` API, portal cache and realtime context. Selecting the latest assignment automatically would silently select the wrong person. This broader flow is not changed by the current lifecycle fixes and was raised to the coordinating agent.
