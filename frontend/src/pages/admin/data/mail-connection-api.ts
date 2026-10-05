import { apiFetch } from "@/lib/api";

/**
 * The Mittaro e-mail connection of the API connections page. The key is never
 * returned, only `key_hint` ("…" and its last four characters).
 */
export type MailConnection = {
  provider: "mittaro";
  configured: boolean;
  reason_code: string;
  /** `database`: saved on this page; `environment`: server configuration;
   *  `disconnected`: switched off here; `none`: nothing set up. */
  source: "database" | "environment" | "disconnected" | "none";
  sender: string | null;
  reply_to: string | null;
  key_hint: string | null;
  console_url: string | null;
};

export const fetchMailConnection = () =>
  apiFetch<MailConnection>("/mail/connection", { forceFresh: true });

/** An empty `api_key` keeps the saved key (changing only the addresses). */
export const saveMailConnection = (body: { api_key: string; sender: string; reply_to: string }) =>
  apiFetch<MailConnection>("/mail/connection", {
    method: "POST",
    body: JSON.stringify({
      ...(body.api_key.trim() ? { api_key: body.api_key.trim() } : {}),
      sender: body.sender.trim(),
      reply_to: body.reply_to.trim() || null,
    }),
  });

export const sendMailConnectionTest = (body: { to: string; language: string }) =>
  apiFetch<{ sent_to: string; message_id: string }>("/mail/connection/test", {
    method: "POST",
    body: JSON.stringify({ to: body.to.trim() || null, language: body.language }),
    timeoutMs: 60_000,
  });

export const disconnectMailConnection = () =>
  apiFetch<MailConnection>("/mail/connection/disconnect", { method: "POST" });
