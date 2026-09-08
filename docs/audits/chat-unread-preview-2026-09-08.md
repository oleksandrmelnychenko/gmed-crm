# Chat unread counters and encrypted previews — 2026-09-08

The reported conversation kept its unread badge after opening and always displayed an encrypted-message placeholder in the conversation list.

- Opening a visible conversation now acknowledges displayed incoming messages, including unavailable-message notices. Both badges refresh only after the server accepts the read receipt. Preview lookups alone never acknowledge a message. This intentionally changes the earlier policy that an unread decryption failure blocked the entire conversation's receipt.
- Conversation previews fetch only the latest message and decrypt it locally using the same keys as history. Successful previews remain in memory until the conversation changes. Requests are deduplicated, failures retry, and delayed preview requests cannot overwrite a newer list or delay foreground message reconciliation. No decrypted previews are sent to the server or persisted in browser storage.
- Legacy key migration now verifies ownership for each historical key, imports inactive keys as well as the current key, and removes legacy material only after durable storage succeeds. Other accounts' keys and keys that cannot yet be verified are preserved. Setup reuses the current server key when it exists locally; an unrelated historical lookup failure does not disable an already verified current device.

Validation: 28 targeted unit tests, all 38 secure-chat browser scenarios, and a further six browser checks after the final migration availability adjustment passed. Browser checks use mocked HTTP endpoints with real browser encryption and IndexedDB, including historical-message decryption and non-extractable private-key storage. TypeScript, targeted ESLint and diff whitespace checks passed.

The existing API supports these client changes; no backend or deployment changes were made. The specific live ciphertext in the user's screenshot was not recovered or independently diagnosed. Keys remain device-bound: if a private key was already deleted or exists only in another browser/device, this change cannot reconstruct it from server ciphertext. Automatic multi-device key synchronization is not implemented.
