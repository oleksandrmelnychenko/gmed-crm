import { chatAttachmentMime } from "./attachments";

/**
 * Outgoing chat payloads. Since 2026-10-07 the browser sends the text and the
 * file itself over TLS and the server seals both with its message keys; there
 * is no device key, peer key or end-to-end envelope any more.
 */

export function buildTextMessagePayload(
  text: string,
  clientMessageId: string,
  expiresInSeconds?: number,
) {
  return {
    message: text,
    client_message_id: clientMessageId,
    ...(expiresInSeconds ? { expires_in_seconds: expiresInSeconds } : {}),
  };
}

export function buildAttachmentFormData(input: {
  file: File;
  caption: string;
  clientMessageId: string;
  expiresInSeconds?: number;
}) {
  const formData = new FormData();
  formData.append("client_message_id", input.clientMessageId);
  if (input.expiresInSeconds) formData.append("expires_in_seconds", String(input.expiresInSeconds));
  if (input.caption) formData.append("message", input.caption);
  // The declared type follows the allow-listed extension, not the browser's guess.
  formData.append(
    "file",
    new Blob([input.file], { type: chatAttachmentMime(input.file.name) }),
    input.file.name,
  );
  return formData;
}
