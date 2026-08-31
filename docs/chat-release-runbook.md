# Chat release and rollback runbook

## Release gate

A chat release may proceed only when all of the following are true:

- the repository security verification has no open High finding and no unaccepted Medium authentication, privacy, or lifecycle finding;
- Rust API/integration tests, frontend unit tests, typecheck, lint, mocked Playwright chat tests, live secure-chat tests, and live realtime tests pass;
- the `20260831160000_chat_release_hardening.sql` migration has completed before the new application instances receive traffic;
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
5. Deploy the frontend. Run the live patient-to-concierge secure message, attachment, read, delete, reconnect, and realtime replay checks.
6. Increase backend traffic gradually while watching error ratio, replay work, socket rejections, purge lag, and storage bytes.
7. Keep the previous backend and frontend image digests available through the observation window.

## Rollback

The database migration is additive and remains in place during an application rollback.

1. Stop traffic growth and restore the previous frontend and backend image digests.
2. Do not restore nonce-less attachment download behavior. Legacy objects must remain fail-closed until migrated.
3. Keep the expiry and orphan sweepers running on at least one compatible new backend instance if old application images do not include them.
4. If realtime is unstable, disable the realtime route at the edge and retain HTTP polling/read paths; do not broaden role policy as a workaround.
5. If key registration is unstable, stop new sends and preserve existing ciphertext. Never enable automatic plaintext downgrade.
6. If a GDPR or deletion job partially fails, rerun the idempotent cleanup and verify message envelopes, attachment metadata/files, and linked notifications before closing the incident.

## Incident checks

- A spike in `reason="per_user"` socket rejections usually indicates reconnect fan-out or a client loop. A global rejection spike requires capacity and abuse review.
- Replay histograms approaching 1,000 indicate stale cursors; clients should receive `realtime.resync_required` and perform a bounded HTTP refresh.
- Purge lag above ten minutes requires checking database availability and the scheduled sweeper task.
- Storage above 80% requires capacity expansion or retention review. Do not silently raise per-user limits.
- A peer-key change must remain a blocking user-visible event. Support may help users compare safety fingerprints but must not approve a new key on their behalf.

## Privacy verification

For deletion, expiry, or erasure incidents verify all of the following independently:

- plaintext, at-rest ciphertext, E2E ciphertext, nonces, salts, fingerprints, filenames, MIME values, sizes, and object keys are cleared from the message row;
- the attachment object is gone or queued for bounded orphan reconciliation;
- every `user_notifications.source_message_id` derivative is removed;
- the normal conversation serializer cannot return a redacted or deleted row;
- audit records contain identifiers and outcome metadata only, never message or attachment content.
