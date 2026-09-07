# Realtime and chat reconnect loop — 2026-09-07

## Evidence and cause

DEV logs repeatedly reported `realtime websocket connection quota exceeded`.
The backend container had not restarted (`RestartCount=0`), so these disconnects
were not caused by a container restart loop.

Both `/events/ws` and `/messages/ws` authenticated the first frame, then waited
only for broadcasts, authorization checks and token expiry. Neither handler
continued reading the transport. An idle client closing its tab therefore did
not promptly release its shared per-account connection permit. Chat and realtime
consume the same limit, so accumulated connections affect both features.

Neither handler sent periodic keepalive traffic. On the frontend, the browser's
transport `open` event was treated as successful authentication, and reset the
retry counter before the server had accepted the account. An immediate quota
rejection could consequently flash the connected indicator and repeat at the
minimum retry delay.

## Changes

- Both handlers read close/error/EOF frames and release their RAII permits.
- Authorization checks send a ping every 15 seconds. Missing pongs for 45 seconds
  end the handler; writes are bounded by five seconds and access-token expiry.
- Chat sends `messages.connected` only after authorization and quota admission.
  Realtime retains its existing `realtime.connected` acknowledgement.
- Both clients wait for the matching user's acknowledgement before showing
  connected or resetting retry backoff. An acknowledgement timeout closes a
  stalled connection after ten seconds.
- Realtime refreshes expiring access tokens using the same helper as chat.
- Pending socket attempts are guarded against duplicate connections on focus
  and against callbacks from disposed connections.

The account and process quota values are unchanged.

## Validation

- TypeScript build and targeted ESLint: passed.
- Vite production build: passed (existing bundle-size warnings).
- API/token unit tests: 16 passed, including concurrent refresh and failed refresh.
- Secure-chat browser suite: all 29 scenarios passed across the initial run and
  targeted rerun. Two test-fixture issues were corrected: a hardcoded secondary
  browser port and retry timing measured across login navigation. The backoff
  test now starts directly in an authenticated chat page and verifies the
  successive 1/2/4-second delays for both transports.
- Rust websocket registry unit tests: 4 passed.
- New real-transport integration suite compiled. Its three cases cover idle
  close/EOF releasing the shared quota, rejection without a readiness frame,
  and periodic idle pings. Execution was skipped by the existing test harness
  because local Docker's Linux engine is unavailable; these are **not verified
  integration-test passes**. Attempting to start Docker did not make its engine
  available.
- Clippy was blocked before linting by Windows Application Control when starting
  a `gmed-db` build-script executable (OS error 4551).

## Deployment and remaining checks

These changes have not been deployed to DEV by this task. Source transfer to DEV
requires the user's explicit approval following an earlier automatic approval
review rejection in this conversation.

Before deployment, run `cargo test -p gmed-server --test websocket_lifecycle_api
-- --nocapture` against a disposable PostgreSQL database and confirm that no
suite is skipped. Run server Clippy in the same supported build environment.

Deploy the backend before the frontend: the new chat client requires the new
readiness frame. Existing clients tolerate the extra frame. A backend replacement
also clears any connection permits accumulated by the old handlers.

After deployment, open chat in several tabs, close/reopen them, and leave a tab
idle for more than a minute. Check that the two indicators stay connected, chat
still receives messages, and quota warnings no longer recur under normal use.
Rollback should restore the frontend before restoring an older backend.
