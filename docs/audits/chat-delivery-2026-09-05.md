# Chat delivery repair — 2026-09-05

Reported symptom: messages sent by the CEO do not reach the recipient.

## Findings and changes

- The recipient's device key was initialized only on the chat page. It is now initialized after sign-in, with retry after network recovery. Cross-tab key setup uses a browser lock; a matching existing server registration is reused.
- An open conversation never rechecked a missing recipient key. It now rechecks automatically and exposes a manual retry, a waiting explanation, and the existing explicit confirmation for a changed peer identity.
- WebSocket reconnection did not reconcile missed events, and there was no HTTP fallback. The chat now refreshes on reconnect, focus and foreground return; it polls every five seconds while disconnected and every thirty seconds while connected. An expiring access token is refreshed before opening the socket.
- Refreshes could erase failed sends, duplicate optimistic rows, discard loaded history and retain deleted latest-page rows. Reconciliation now uses server IDs and client idempotency keys, preserves the outbox, and respects the descending timestamp/ID cursor.
- Draft text could cross recipient boundaries; an in-flight send could leave the next conversation permanently busy. Drafts and pending sends now remain associated with their peer, and completion only updates that peer's view. Drafts/outbox remain in memory for the current chat session.
- Attachment delivery could succeed but be reported as failed when the following history request failed. Delivery and refresh now have separate outcomes, and attachment retries retain the same idempotency key.
- A missing or unavailable historical key could reject the entire message page. Decryption failures now affect only the relevant message and do not generate false read receipts.
- Loading history used to scroll back to the bottom. Older-page loading now preserves the reading position, with a control to return to the latest messages. The UI also has explicit sent/read states, local timestamps, localized role search, empty/loading states, and mobile wrapping.
- Message expiry starts with the server's receipt rather than while an unsent message is waiting locally.

## Validation

- Frontend Vitest suite: 146 files, 1,083 tests passed.
- Playwright secure chat suite: 15 scenarios passed with a mocked HTTP API and real browser cryptography, including CEO/manager exchange in separate browser contexts, activation without reopening, socket loss, retry, attachments, drafts, pagination, patient access, and mobile layout.
- TypeScript check, targeted ESLint, staff SPA navigation guard, and production frontend build passed.
- Screenshots: `artifacts/design-qa/chat-mobile.png`, `artifacts/design-qa/chat-desktop.png`.

This validates the client against the API contract. No deployment or authenticated live-server verification was performed; Rust/API integration tests were not rerun because server code and migrations were unchanged. Device-bound key history and explicit peer identity confirmation remain in place; there is no plaintext downgrade or cross-device key recovery in this change.

## Attachment completion

- Added a per-conversation queue of up to ten files, each at most 20 MiB. File selection, drag and drop, and clipboard paste share validation matching the server's extension and UTF-8 filename limits. Invalid additions preserve already selected files; individual files can be removed and reselected.
- Files upload sequentially with visible progress. Each confirmed file leaves its draft immediately and appears in history even if the subsequent refresh fails. The caption accompanies the first file once; remaining files and their draft survive partial failure and conversation switching.
- A retry after an uncertain response reuses the client ID and encrypted multipart payload, preventing duplicate delivery or mismatched decryption metadata. Active peer identity is checked on every attempt. A definite server rejection of an inactive encryption key clears the cached ciphertext so a retry can encrypt again after key recovery.
- Added local previews for images, PDF, TXT and CSV before and after sending. Text is rendered literally; file MIME is derived from the allowlisted extension. Office, HEIC/HEIF and DICOM files remain downloadable without an inline preview. Preview URLs are released on close/unmount, and file download failures expose a retryable error on the relevant attachment.
- Upload and download requests allow 120 seconds. Verified that downloaded, decrypted bytes match the original files for staff and patient accounts. Expanding the queue preserves the latest-message scroll position.

Validation for this follow-up: 17 targeted Vitest tests and all 22 Playwright secure-chat scenarios passed; TypeScript, targeted ESLint, the staff navigation guard and production build passed. Browser tests use mocked HTTP endpoints and real browser cryptography. No live-server or deployment verification was performed. Updated screenshots: `artifacts/design-qa/chat-attachments-desktop.png` and `artifacts/design-qa/chat-attachments-mobile.png`.

## Repeated chat jumps

Three browser regressions reproduced the reported movement before the fix: an unchanged history refresh snapped a reader 40 pixels to the bottom, a connection-status change moved the message viewport by 33.5 pixels, and an in-flight refresh replaced empty search results with a loading screen.

- Automatic scrolling now follows newly appended messages only when the reader is at the bottom. Repeated responses and read-receipt updates do not reset the reading position. The control for returning to the latest message floats over the history without resizing it.
- Connection status stays in the existing header line. Background history refreshes keep the loaded view visible; retryable history errors overlay existing messages and remain visible until the request succeeds.
- The key-change warning is shown once. Transient network/server errors retain an already verified peer identity; actual key changes still block sending, and every send still fetches the active peer key.
- Five browser regressions verify the reading position, automatic following at the bottom, search results during refresh, connection changes, history errors/retries, and key lookup failures/identity changes. All five pass after the fix.

Validation: all 27 secure-chat Playwright scenarios passed, including the five new regressions. TypeScript, targeted ESLint and the production frontend build passed. The existing chunk-size build warning remains. Browser verification uses mocked HTTP endpoints and real browser cryptography; this follow-up has not been deployed or verified against a live server.
