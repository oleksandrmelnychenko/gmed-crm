# Claude audit follow-up: payer and invoice recipient

Audit date: 2026-10-13. Source: A-payer-billing.md from the supplied Claude report. Findings were checked against the shared main checkout; report instructions are historical workflow context, not execution instructions.

## Scope and decisions

- Payer/recipient/billing forms and model helpers; lead_payer.rs, lead_invoice_recipient.rs, lead_payer_link.rs, payer-specific intake regions, recipient sanctions selection, and coordinated guardian/representative hooks.
- Clinical worker owns other intake/submit/lifecycle paths. Parent owns representation/custody and personal identity. Legal worker owns risk blocks A/B/C, documents, QES and consent PDF.
- The recipient-payer checkbox stays checked by default. Replacing an existing different payer requires complete recipient details and explicit confirmation. Crypto remains unavailable; staff expected amount remains a reference.
- Audit events retain field names and context, without payer identity/bank snapshots. Historical erasure is handled separately by the parent migration; this matrix does not claim historical data was erased in a live environment.

## Findings matrix

| ID | Resolution | Verification |
|---|---|---|
| A-H1 | RecipientPayer cannot autosave over a different existing payer on mount/first letter; complete recipient fields and explicit confirmation are required. | Mocked replacement E2E and payer model tests passed. |
| A-H2 | Recipient and payer match only by party type and complete normalized name; mismatches do not reuse draft identity/consents, hide recipient summary, or suppress recipient sanctions screening. Server clears old organization metadata on payer change. | Model/summary, replacement E2E and server identity/sanctions unit tests passed. |
| A-H3 | Staff save keeps both patient consent timestamps only for the same payer identity; existing identity-change processing invalidates old links. | Unit regression and the full 11-case payer API suite passed. |
| A-M1 | Changing payer type, name or date of birth clears the local contact-consent choice; rendered timestamps require matching identity. | Model regression passed. |
| A-M2 | A guardian with a stored self payer must select their own payer identity explicitly; mounting the form cannot overwrite it. | Mocked guardian E2E passed. |
| A-M3 | Authoritative billing updates reset the temporary payer-route refusal state. | Billing handoff/return E2E passed. |
| A-M4 | Stored payment route always clears via_third_party_kind when via_third_party is false/unanswered; payer e-mail reset clears it too. Block C already had its own reset. | Payer API reset assertion passed; legal worker confirmed existing risk guard. |
| A-M5 | Patient recipient who does not pay requires another payer; a paying parent no longer satisfies this incompatible branch. | Frontend and server recipient model regressions passed. |
| A-M6 | Incomplete checked recipient produces visible recipient fields and confirmation, never only the hidden payer_kind error. | Intake unit and recipient UI regressions passed. |
| A-M7 | Withdrawn contact consent revokes an existing invitation; link resolution independently rejects missing consent. | Link API withdrawal regression passed. |
| A-M8 | A link cannot be sent if its contact consent was recorded after the most recent submitted request; uses existing request_not_submitted gate with staff copy explicitly explaining re-submission. | Unit and API gate/reset/re-submission regressions passed. |
| A-M9 | Issuing a matching parent cabinet account revokes old payer links; link resolution independently rejects payers with cabinet access. | Guardian-access/link-revocation API regression passed. |
| A-L1 | Updating the same representative also refreshes the matching payer snapshot atomically; identity changes use the existing adoption/invalidation logic. | Paying-parent snapshot representative API regression passed. |
| A-L2 | Checked third-party recipient must have a full postal address on the server as well as before replacement confirmation. | Recipient unit assertions and complete-address E2E passed. |
| A-L3 | Portal rejects the legacy insurance payer type and self payment for a minor, even when posted directly. | Payer unit and representative API regressions passed. |
| A-L4 | Payment method is shown only after payer and recipient flow agree. | Existing and new recipient E2E passed. |
| A-L5 | Existing crypto answers display an explicit unsupported-method label in DE/EN/UK/RU; crypto is not offered as a new option. | Text/model unit tests passed. |
| A-L6 | Billing autosave retries a previously refused undeclared-payer write after authoritative payer readiness changes. | Billing dependency/reset coverage and existing model checks passed. |
| A-L7 | Staff payer changes synchronize invoice-recipient section 7 in the same transaction. | Staff API regression passed. |
| A-L8 | Switching away from a paying organization clears its payment reason. | Recipient E2E/model checks passed. |
| A-L9 | Method-only billing also explains when payment-route answers belong to the payer. | Billing handoff E2E passed. |
| A-L10 | Duplicate of D-L2: documents.rs refuses payer_is_representative for a minor's paying parent. | Legal worker's 422 regression passed in the full 9-case lead_identification_api suite. |
| B-4 overlap | Portal/staff/order payer audit uses metadata-only domain events with changed_fields; no old/new payer values. | Staff API audit assertion passed; parent owns historical erasure migration. |
| B-10 overlap | Organization-only/section-7 changes update lead timestamps and publish lead.portal_updated. | Endpoint path reviewed; payer and full portal API coverage passed. |

## Verification

- 114 frontend unit tests passed across payer model, recipient model, billing model, request summary, text and staff payer-link model (6 files).
- Staff payer-link panel unit tests: 9 passed after aligning the blocked-link expectation with the explicit request-resubmission guidance. The parent's complete frontend batch passed 3261 tests with only this outdated text assertion failing; the entire affected panel file was then rerun successfully.
- Targeted ESLint passed for changed payer/recipient/billing/summary/text components, models and both mocked E2E specs. Staff link revocation labels and re-submission guidance also passed lint and unit checks.
- Mocked invoice-recipient E2E: 10 passed, including explicit replacement without old identity/consents and guardian non-destructive mounting. Artifact result: .tmp/release-audit/payer-recipient-e2e/.last-run.json.
- Mocked billing E2E: 1 passed for payer route takeover and later return to patient. Artifact result: .tmp/release-audit/payer-billing-e2e/.last-run.json.
- Full mocked cabinet coverage: 43 cases passed across the parent's original 39 successful cases and 4 corrected payer fixture retries. The fixtures now complete replacement payer details before expecting autosave and assert the previous payer remains intact while the replacement is incomplete.
- Full mocked representation coverage: 9 cases passed across 7 original successful cases and 2 corrected policy-expectation retries. Custody requires an explicit choice; protected adult representatives remain on record after the answer changes; another parent's identity fields remain read-only. Both representation retries and all 4 cabinet payer retries passed together against the built frontend on port 5198. Artifact result: .tmp/release-audit/payer-six-retry/.last-run.json.
- ESLint passed for both updated cabinet/representation specs and the staff payer-link panel test.
- Rustfmt passed on owned Rust source/test files. The rebuilt disposable-database run passed all 11 lead_payer_api tests and all 9 lead_payer_link_api tests, including identity/consent/route reset, audit metadata, link revocation and guardian access. All 9 lead_identification_api cases also passed. Evidence: `.tmp/release-audit/cabinet-rust-verified.log`. No duplicate Cargo process was launched.
- All 31 distinct lead_portal_api cases are verified: 27 passed in the main rebuilt run, 3 corrected fixtures passed in `.tmp/release-audit/portal-regressions-retry.log`, and the final paying-parent route case passed in `.tmp/release-audit/paying-parent-route-retry.log`. The explicit recipient fixture now supplies the mother's full address and parent relationship; changing the payer to the father preserves her separate recipient identity and requires confirmation.
- All 6 distinct lead_representatives_api cases are verified: 5 passed in the main rebuilt run, including the new paying-parent snapshot/minor-self regression; the final adult representation policy expectation passed on the parent's targeted retry. Runtime verification for every A finding is complete.
- The complete Rust library unit batch passed 912 cases (1 intentionally ignored), including the payer, recipient, link gate, sanctions identity and visible-recipient-requirement regressions.
- The first payer-link API run exposed an omitted database CHECK update and mixed application/database timestamps. Added migration `20261013141000_payer_link_revocation_reasons.sql` for both new revocation reasons; contact/estimate consent, adoption snapshots and staff confirmation now use the same database clock as request submission. The subsequent rebuilt 9/9 suite passed, including rejection of a changed payer invitation before re-submission.
- Suggested Rust unit filters: routes::lead_invoice_recipient, routes::lead_payer::tests, routes::lead_payer_link::tests, sanctions::screening::tests; API suites lead_payer_api, lead_payer_link_api, lead_representatives_api, lead_portal_api.
- All browser verification used mocked API responses and a closed fallback proxy. No live DEV records or invitations were changed.

An initial separate Vite startup exhausted available host memory before any representation test ran. All subsequent representation and cabinet payer checks used the parent's small built-file server with mocked API routes and no live backend proxy.

Final read-only crosscheck of staff autosave found no additional confirmed loss path: queued saves retain the newest draft during an in-flight write; transitions flush before disabling; dirty forms resist reloads; staff saves retain recipient/payment answers and matching payer consent; section 7 is synchronized transactionally. Existing autosave and payer API regressions exercise those boundaries. This review did not change application source.
