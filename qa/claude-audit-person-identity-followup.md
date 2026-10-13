# Cabinet audit — person, identity and submission

Date: 2026-10-13. Source: Claude `form-fix/C-person-identity-send.md`.
All listed changes below are implemented in the shared working tree. Runtime validation is recorded separately; implementation alone is not a release sign-off.

| Finding | Result |
| --- | --- |
| C-1 | Phone required for an adult submission; the child's phone is excluded for minors, whose representative contact requirements remain. |
| C-2 | A guardian cannot clear the child's birth date or make the child an adult. An own login cannot clear an existing birth date. A cleared date input restores the saved date. |
| C-3 | Non-Latin names remain saveable drafts but block submission, including representatives. Passport spelling hints and suggestions also cover representatives. |
| C-4 | Autosave retains refused values per field and retries the other changed fields. |
| C-5 | Custody starts with a choice placeholder until explicitly answered; missing custody blocks submission. |
| C-6 | Inquiry consent retains version 2026-10-03. Health consent uses version 2026-10-13 and covers services, documents and the description of the concern in all four languages. |
| C-M1 | Cabinet upserts cannot overwrite staff identity columns. Both staff identity handlers lock the lead first. |
| C-M2 | Identity copies taken over through staff identity entry cannot be withdrawn. Staff with leads.edit can review identity/authority files through the API without medical access. Saving identity details remains the existing wizard takeover action; the medical review badge remains medical-only. |
| C-M3 | Base edits compare against the base submission time; separate follow-up markers compare against the follow-up answer time. Sending a follow-up cannot consume an unsent address/name/recipient edit. |
| C-M4 | An active identity document already held for the lead/prospect satisfies the passport-copy requirement. |
| C-M5 | The concern text requires active health consent at the server and is disabled until consent in the cabinet. |
| C-7 | Taking back an adult representation answer preserves persons already used elsewhere without blocking the answer. |
| C-8 | Copying the child's address uses the current form draft and preserves destination values where the source is blank. |
| C-10 | Minor-access copy refers to GMED/our team. |
| C-11 | German/English passport-name hints use neutral wording, also appropriate for parents. |
| C-12 | Adult court-appointed representatives are distinguished from a minor's guardian in RU/UK/EN. |
| C-13 | Guardian-only errors trigger a request-list reload at the API boundary, including errors consumed by autosave validation handlers. |
| C-14 | Person controls mirror server name/address/date/citizenship limits. |
| C-L1 | Upload and withdrawal timestamps are taken after acquiring the lead lock. |
| C-L2 | Submission summary includes consent choices, named recipients and save attribution/time; the D implementation records the change marker. |
| C-L4 | Medical upload controls use the server's combined document count, with a compatible combined-list fallback. |
| C-L5 | Common upload/submission/consent errors have localized messages in all four languages. |
| C-L6 | Deletion availability includes reviewed, shared, moved, in-review and staff-used identity files. |
| C-L7 | Legacy requirements with no visible input appear under Further information in the sending summary. |
| C-L8 | A disappearing follow-up tab returns to the sending summary. |

## Verification

- Targeted person/model/representation/summary/name/step unit tests passed (90 before the additional autosave/legacy-key cases; those additional cases passed in the subsequent 37-test model/step run).
- Four new isolated browser regressions passed: consent-gated concern and combined document limit; multiple rejected autosave fields with successful remaining edits; mid-session guardian-only transition; visible legacy requirements.
- Targeted ESLint passed for the person/identity/submission code and tests.
- Production frontend build and full ESLint passed. The full frontend unit batch passed 3261 cases; its only obsolete payer-link copy assertion was updated and its entire 9-case file passed on rerun (3262 distinct cases verified).
- All 43 full-cabinet browser cases passed across the initial 39 successful cases and four corrected payer-fixture retries. All nine representation cases and seven follow-up cases also passed against the built frontend.
- Backend regressions passed: 912 library cases; all 31 cabinet, six representation and six risk API cases verified across the combined run and targeted retries, plus the 71-case lead lifecycle suite. Old fixtures were updated for required health consent, base submission before follow-up, and keeping a protected representative when the answer changes to No. The dedicated health/identity/base-change and concurrent upload regressions passed.
- Final full-workspace Clippy, rustfmt and diff checks passed. See the aggregate report for the complete 188-case targeted API evidence and remaining CI/release gates.
- Independent review checked purpose-specific consent versions, staff identity preservation, upload deletion symmetry and base/follow-up timestamps. It found a rejected-minor notification regression, fixed by the lifecycle worker with a regression test.

No live patient data was changed by these checks. Mocked browser servers proxy only to a closed local port; API tests use disposable local PostgreSQL.
