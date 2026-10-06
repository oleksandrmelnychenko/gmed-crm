import { describe, expect, it } from "vitest";

import { t, uiText } from "@/lib/i18n";
import { buildAttachmentFormData, buildTextMessagePayload } from "./outgoing";

const END_TO_END_FIELDS = [
  "e2e_algorithm", "e2e_ciphertext", "e2e_nonce", "e2e_salt",
  "sender_key_fingerprint", "recipient_key_fingerprint",
  "attachment_e2e_algorithm", "attachment_e2e_nonce", "attachment_e2e_salt", "attachment_plaintext_size",
];

describe("outgoing chat payloads are server-encrypted, not end-to-end", () => {
  it("sends text as text with its idempotency key and timer", () => {
    expect(buildTextMessagePayload("Synthetic follow-up", "client-1")).toEqual({
      message: "Synthetic follow-up", client_message_id: "client-1",
    });
    const timed = buildTextMessagePayload("Disappears", "client-2", 3600);
    expect(timed).toEqual({ message: "Disappears", client_message_id: "client-2", expires_in_seconds: 3600 });
    for (const field of END_TO_END_FIELDS) expect(timed).not.toHaveProperty(field);
  });

  it("uploads the original file bytes with the allow-listed type and the caption", async () => {
    const file = new File(["<script>stays literal</script> Hb 13.5"], "lab.txt", { type: "text/html" });
    const form = buildAttachmentFormData({ file, caption: "Lab results", clientMessageId: "client-3", expiresInSeconds: 60 });
    expect(form.get("client_message_id")).toBe("client-3");
    expect(form.get("expires_in_seconds")).toBe("60");
    expect(form.get("message")).toBe("Lab results");
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toBe("lab.txt");
    expect(uploaded.type).toBe("text/plain");
    expect(await uploaded.text()).toBe("<script>stays literal</script> Hb 13.5");
    for (const field of END_TO_END_FIELDS) expect(form.has(field)).toBe(false);
  });

  it("leaves out an empty caption and the timer when none is set", () => {
    const form = buildAttachmentFormData({
      file: new File(["%PDF-1.4"], "letter.pdf"), caption: "", clientMessageId: "client-4", expiresInSeconds: 0,
    });
    expect(form.has("message")).toBe(false);
    expect(form.has("expires_in_seconds")).toBe(false);
  });
});

describe("chat encryption labels", () => {
  it("names server-side encryption in every chat language", () => {
    expect(t("ru").chat_server_encryption_label).toBe("Шифрование на сервере");
    expect(t("de").chat_server_encryption_label).toBe("Serverseitig verschlüsselt");
  });

  it("explains old end-to-end messages instead of blaming the device", () => {
    expect(uiText("chat_e2e_unavailable", "ru")).toBe(
      "Старое сообщение со сквозным шифрованием: доступно только на устройстве, где оно было открыто",
    );
    expect(uiText("chat_e2e_unavailable", "de")).toBe(
      "Ältere Nachricht mit Ende-zu-Ende-Verschlüsselung: nur auf dem Gerät lesbar, auf dem sie geöffnet wurde",
    );
  });

  it("no longer claims end-to-end encryption for the chat", () => {
    for (const lang of ["ru", "de"] as const) {
      const chatTexts = Object.entries(t(lang))
        .filter(([key, value]) => key.startsWith("chat_") && typeof value === "string")
        .map(([key, value]) => `${key}=${value as string}`);
      const claims = chatTexts.filter((entry) =>
        /Сквозное шифрование"?$|сквозным шифрованием между|Ende-zu-Ende verschlüsselt$|zwischen den Geräten Ende-zu-Ende/.test(entry));
      expect(claims).toEqual([]);
    }
  });
});
