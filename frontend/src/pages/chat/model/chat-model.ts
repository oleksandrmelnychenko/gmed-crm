export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function roleDisplay(role: string) {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
