# Chat release and rollback runbook

## Encryption model (owner decision of 2026-10-07)

The chat is encrypted **on the server**, not end-to-end. True end-to-end encryption was given up by the owner's decision of 2026-10-07: every browser kept its own device key, so after a login on another device or after clearing site data the whole history, including one's own messages, became unreadable. The client requirement "End-to-End-Verschlüsselung Kommunikation" (Excel `User Stories`, row 123, P1; `docs/requirements/03_product-backlog_ua.md`) is therefore consciously not met; record the scope change with the client as described in `docs/00_source-of-truth_ua.md`.

- **In transit:** TLS between browser and server, as for every other API call.
- **At rest:** message text and captions are sealed with AES-256-GCM using the server's message keys (`MESSAGE_ENCRYPTION_KEYS`, `crates/server/src/crypto.rs`); every row stores its key id (`encryption_key_id`) and nonce (`message_nonce`) next to `message_ciphertext`. Attachment files are sealed the same way before they are written to `uploads/chat` (`attachment_nonce`). Key rotation and the rewrap sweep cover chat rows like the other encrypted data (`crates/server/src/routes/key_rotation.rs`). New rows never use the plaintext `message` column; it only holds DSGVO redaction markers and rows from before at-rest encryption existed.
- **Reading:** the server decrypts only for the two participants of a conversation and only while the existing peer rule allows them to talk (patient assignment, `chat.use` capability). History is therefore readable on any device right after login; no device key, peer key or fingerprint check exists any more. Every conversation view and attachment download stays in the audit log.
- **Sending:** the browser sends text and files over TLS; the server checks attachment content (magic bytes, active-content block, virus scan when configured) before sealing it. Plain messages are accepted in every conversation, also between participants who registered an end-to-end device key in the past (the former `409 End-to-end encryption is required` rule is removed).

### Old end-to-end messages and their rescue

Messages written before 2026-10-07 keep their end-to-end envelope (`e2e_*` columns, `attachment_e2e_*`) until they are converted. They open only in a browser that still holds the device key it used at the time (IndexedDB `gmed-chat-e2e-v2`, or the first key ring in local storage, which is imported read-only); elsewhere the chat shows "Старое сообщение со сквозным шифрованием: доступно только на устройстве, где оно было открыто" / "Ältere Nachricht mit Ende-zu-Ende-Verschlüsselung: nur auf dem Gerät lesbar, auf dem sie geöffnet wurde".

When such a browser has opened an old message, it hands it back in the background, once per message and page session, one request at a time with a pause in between:

1. `POST /api/v1/messages/{message_id}/convert-from-e2e` with `{ "text": "…" }` (or `caption` for an attachment caption) stores the text server-encrypted, clears the envelope and keeps `created_at`/`read_at`. Only the sender or the recipient may call it, only while the message is still end-to-end encrypted (`409` afterwards), and only within the normal peer rule (`404` for other people's or deleted messages, `403` when the peer rule no longer allows the conversation).
2. `POST /api/v1/messages/{message_id}/convert-attachment-from-e2e` (multipart `file` with the decrypted bytes) runs after the caption. The bytes must match the recorded plaintext size and pass the same content checks and virus scan as a new upload; they are sealed with the active key, the old ciphertext file is removed, and an older caption key is resealed with the active one.

Both write `converted_from_e2e_at`/`converted_by` or `attachment_converted_from_e2e_at`/`attachment_converted_by` (migration `20261007090000_chat_e2e_conversion.sql`) and an audit row in the same transaction (`chat_message_converted_from_e2e`, `chat_attachment_converted_from_e2e`; identifiers and sizes only, never text). Participants receive a `message_updated` socket event. The server cannot check the handed-back text against the ciphertext; who converted a message is therefore recorded. Old messages that nobody can open any more stay unreadable.

Remaining old rows:

```sql
SELECT count(*) FILTER (WHERE e2e_ciphertext IS NOT NULL) AS e2e_texts,
       count(*) FILTER (WHERE attachment_e2e_algorithm IS NOT NULL) AS e2e_attachments
  FROM direct_messages
 WHERE deleted_at IS NULL AND redacted_at IS NULL;
```

The server still accepts end-to-end envelopes and keeps the key routes (`/messages/e2e-key…`) so browsers that have not reloaded since the release keep working and old messages can be opened. Retire the end-to-end send paths once `gmed_chat_messages_accepted_total{e2e="true"}` stays at zero.

## Release gate

A chat release may proceed only when all of the following are true:

- the repository security verification has no open High finding and no unaccepted Medium authentication, privacy, or lifecycle finding;
- Rust API/integration tests, frontend unit tests, typecheck, lint, mocked Playwright chat tests, live secure-chat tests, and live realtime tests pass;
- the `20260831160000_chat_release_hardening.sql` and `20261007090000_chat_e2e_conversion.sql` migrations have completed before the new application instances receive traffic;
- the attachment volume has at least 25% free capacity and the legacy-attachment migration reports no repeating errors;
- one on-call owner is assigned for the rollout window.

## Service objectives

The production objectives for the chat workspace are:

| Signal | Objective | Alert |
|---|---:|---:|
| HTTP send/upload availability | 99.9% over 30 days | error ratio > 2% for 10 min |
| HTTP send p95 latency | < 750 ms, excluding upload transfer time | > 1.5 s for 15 min |
| Active WebSocket admission | 99.5% for authorized users | quota rejections exceed expected client fan-out for 10 min |
| Realtime replay work | p95 < 250 inspected events | p95 >= 1,000 or any sustained resync spike |
| Expired payload purge lag | < 5 min | > 10 min for 10 min |
| Chat attachment capacity | < 80% of configured logical capacity | warning at 80%, critical at 90% |

Relevant application metrics:

- `gmed_chat_websocket_connections`
- `gmed_chat_websocket_rejections_total{reason}`
- `gmed_chat_realtime_replay_events`
- `gmed_chat_messages_accepted_total{kind,e2e}`
- `gmed_chat_lifecycle_purged_total`
- `gmed_chat_purge_lag_seconds`
- `gmed_chat_attachment_storage_bytes`

Use the standard HTTP request counter and duration metrics for `/api/v1/messages/*` alongside these chat-specific series. Metric labels must remain bounded; never add user, patient, message, file, key, email, or IP identifiers.

## Rollout

1. Take a database snapshot and confirm the attachment volume backup is current.
2. Apply migrations and verify that `user_notifications.source_message_id` and the visible-conversation index exist.
3. Deploy one backend instance. Confirm `/health`, `/api/v1/health`, and `/metrics` before increasing traffic.
4. Confirm that the legacy attachment sweep is progressing and that its error count is not recurring for the same objects.
5. Deploy the frontend together with the backend (an older backend answers `409` to plain messages between users with an old device key). Run the live patient-to-concierge message, attachment, read, delete, reconnect, and realtime replay checks; the conversation header must read "Serverseitig verschlüsselt" / "Шифрование на сервере".
6. Increase backend traffic gradually while watching error ratio, replay work, socket rejections, purge lag, and storage bytes.
7. Keep the previous backend and frontend image digests available through the observation window.

## Rollback

The database migration is additive and remains in place during an application rollback.

1. Stop traffic growth and restore the previous frontend and backend image digests together. A pre-2026-10-07 frontend encrypts end-to-end again and a pre-2026-10-07 backend rejects plain messages between users with a device key; messages already converted stay server-encrypted and readable.
2. Do not restore nonce-less attachment download behavior. Legacy objects must remain fail-closed until migrated.
3. Keep the expiry and orphan sweepers running on at least one compatible new backend instance if old application images do not include them.
4. If realtime is unstable, disable the realtime route at the edge and retain HTTP polling/read paths; do not broaden role policy as a workaround.
5. If the message key registry is unavailable or a key id is missing, stop new sends rather than storing unencrypted text, and restore `MESSAGE_ENCRYPTION_KEYS` with every key id still referenced by `encryption_key_id`.
6. If a GDPR or deletion job partially fails, rerun the idempotent cleanup and verify message envelopes, attachment metadata/files, and linked notifications before closing the incident.

## Incident checks

- A spike in `reason="per_user"` socket rejections usually indicates reconnect fan-out or a client loop. A global rejection spike requires capacity and abuse review.
- Replay histograms approaching 1,000 indicate stale cursors; clients should receive `realtime.resync_required` and perform a bounded HTTP refresh.
- Purge lag above ten minutes requires checking database availability and the scheduled sweeper task.
- Storage above 80% requires capacity expansion or retention review. Do not silently raise per-user limits.
- "Message is not readable on this device" now only concerns old end-to-end messages. Ask the user to open the conversation once in the browser they used before 2026-10-07; it hands the history back. Support cannot recover old end-to-end messages from the server.
- `decryption failed` placeholders or attachment `500` responses on server-encrypted rows point to a missing key id in `MESSAGE_ENCRYPTION_KEYS`; compare with the key rotation status.

## Privacy verification

For deletion, expiry, or erasure incidents verify all of the following independently:

- plaintext, at-rest ciphertext, old E2E ciphertext, nonces, salts, fingerprints, filenames, MIME values, sizes, and object keys are cleared from the message row (the conversion timestamps and user ids are metadata and may stay);
- the attachment object is gone or queued for bounded orphan reconciliation;
- every `user_notifications.source_message_id` derivative is removed;
- the normal conversation serializer cannot return a redacted or deleted row;
- audit records contain identifiers and outcome metadata only, never message or attachment content.
