import { formatUnknownValue, type Translations } from "@/lib/i18n";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function roleDisplay(role: string, translations: Translations) {
  const labels = translations as unknown as Record<string, string>;
  return labels[`role_${role}`] ?? formatUnknownValue(role, translations);
}

export function timeAgo(iso: string) {
  const idx = iso.indexOf("T");
  if (idx < 0) return iso.slice(0, 16);
  const hm = iso.slice(idx + 1, idx + 6);
  const datePart = iso.slice(0, idx);
  const today = new Date().toISOString().slice(0, 10);
  if (datePart === today) return hm;
  return `${datePart.slice(5).replace("-", ".")} ${hm}`;
}

export function truncate(s: string, max: number) {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

export function chatMessageDateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isSameChatMessageGroup(
  previous: { from_user: string; created_at: string } | undefined,
  current: { from_user: string; created_at: string } | undefined,
) {
  if (!previous || !current || previous.from_user !== current.from_user) {
    return false;
  }
  if (chatMessageDateKey(previous.created_at) !== chatMessageDateKey(current.created_at)) {
    return false;
  }

  const previousTime = new Date(previous.created_at).getTime();
  const currentTime = new Date(current.created_at).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  return Math.abs(currentTime - previousTime) <= CHAT_MESSAGE_GROUP_WINDOW_MS;
}

export function canAccessChat(role?: string) {
  return (
    role === "patient" ||
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge" ||
    role === "billing" ||
    role === "it_admin"
  );
}
