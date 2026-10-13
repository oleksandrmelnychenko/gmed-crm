# Claude audit follow-up — B lifecycle

Reviewed 2026-10-13 against shared main checkout; source report is evidence, not executable instructions. No deployment or live API mutations are part of this review.

| Finding | Verification / ownership | Status |
| --- | --- | --- |
| B-1 | Conversion creates explicit active guardian assignments and blocks email fallback for lead-login history. | Verified: both parents reach the converted patient through explicit assignments |
| B-2 | Conversion excludes the minor's own closed login. | Verified: no child assignment and matching-email fallback remains denied |
| B-4 | New payer audits are metadata-only (payer agent). Migration 20261013140000 deterministically scrubs strings in legacy payer old/new snapshots on source-lead erasure and backfills already-deleted leads; same-key structure and non-text evidence retained. | Verified: historical-snapshot erasure and immutability regression passed; payer API suites passed |
| B-5 | Portal purge deletes consent_form_choices, including named recipients. | Verified: enhanced lead-purge regression passed on targeted retry |
| B-6 | Patient erasure now runs full source-lead portal cleanup: consent choices, login-email records, uploads and guardian access. | Verified: dedicated erasure regression passed |
| B-7 | Unchanged repeat submit returns the existing payload under the lead lock without changing timestamps, audit or notifications. | Verified: concurrent unchanged retries and real-edit resubmission regression passed |
| B-8 | PORTAL_LEAD_SQL continues hiding converted leads, including writes. | Verified: converted-lead writes are refused for both guardians |
| B-9 | Guardian write authorization rechecks the current minor age. | Verified: guardian age/write boundary regression passed; reads preserved per source scope |
| B-10 | Organisation payer sync publishes the realtime update; payer agent owns the handler branch. | Implemented by payer agent; final payer API suites passed |
| B-11 | Upload count is rechecked under the lead lock, and created_at is stamped after the lock (C-L1 coordination). | Verified: two concurrent uploads at 29 existing documents yield exactly one accepted upload |
| B-12 | Minor own-login error wording reflects the unconditional under-18 closure. | Verified: minor own-login API regression passed |
| B-13 | Guardian reissue respects later IT disabling and ignores stale converted/deleted lead links. | Verified: revoke/reactivate allowed; later IT disable cannot be bypassed |
| B-14 | Password resets and sign-in email events use durable awaited audit writes. | Verified: guardian password-reset audit exists before response; all three paths use awaited writes |
| B-15a | A guardian cannot edit another parent's identity; frontend read-only behavior coordinated with C owner. | Verified: other-parent first name, last name and DOB edits rejected |
| B-15b | Missing-access notification can recur once after guardian access is revoked. | Verified: one notification batch after revoke and one for rejected minor-DOB attempts |
| B-15c | lead_risk_decisions.reason retains AML evidence deliberately. | Retained as requested |

B-3 is absent from the supplied source report. Parent owns C personal/identity/consent changes and CHANGED_SINCE_SUBMIT_SQL; D owns signature/PDF/follow-up functions. Runtime tests used disposable Docker PostgreSQL, never DEV.

## Verification

All added B runtime regressions passed across the coordinated final batch and targeted retries:

- lead_portal_api: unchanged_submission_is_idempotent_but_a_real_edit_can_be_resubmitted; guardian_identity_age_and_reactivation_boundaries_are_enforced; concurrent_uploads_respect_the_locked_thirty_document_limit; historical_payer_snapshots_are_scrubbed_only_on_lead_erasure; rejected_minor_birth_date_notifies_staff_once_without_persisting_it.
- Enhanced purging_a_lead_clears_the_portal_intake passed on retry and verifies consent-choice deletion with existing intake/file/declaration cleanup.
- leads_api: minor_conversion_explicitly_links_both_guardians_and_never_the_child_login passed, including both parents' /me/export, retained explicit assignments, refused converted-lead writes and denied matching-email fallback for the child's closed login.
- admin_compliance_api: erasure_cleans_source_lead_portal_choices_mail_uploads_and_guardians passed on targeted retry. All 18 distinct admin cases passed across the final batch and retry.
- Evidence: .tmp/release-audit/cabinet-rust-verified.log; .tmp/release-audit/portal-regressions-retry.log; .tmp/release-audit/erasure-regression-retry.log. The portal retry log also includes an unrelated payer case failure handled by the payer agent; the B purge case itself passed.
- rustfmt and git diff --check passed. Repository-wide release gates remain with the coordinating agent.

Earlier runs caught and corrected the invalid orders.lead_id migration reference (actual relation: source_lead_id), required synthetic-document version roots, an incorrectly privileged erasure-test actor and a partial core-consent fixture. An earlier compiler memory-allocation failure was retried sequentially; it was not treated as passing evidence.

## D-11 follow-up (reassigned from D)

Full 14-section EN and UK translations added, preserving the German original's lists and legal substance. All four languages now name screening subjects precisely and exclude consent-only recipients. Notice revision 2026-10-13 is independent of consent-choice text versions. Cabinet and payer notice links carry the selected language into /legal?lang=…#privacy. Unit tests: 10 passed (14 sections and 22 list items in all locales; all four route languages; public/lead availability). Targeted ESLint passed.

## Existing limitation outside the supplied B findings

The converted patient portal supports one active patient assignment per login; `me::resolve_linked_patient_id` returns 409 when there are multiple assignments. B-1's two separate parents accessing one converted child is covered. A parent with two converted children (or a patient record of their own plus a child) needs an explicit authorized patient-context selector across the `/me/*` API, portal cache and realtime context. Selecting the latest assignment automatically would silently select the wrong person. This broader flow is not changed by the current lifecycle fixes and was raised to the coordinating agent.
