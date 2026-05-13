import { uiText } from "@/lib/i18n";

export function formatRelativeTime(from: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - from.getTime();
  if (diffMs < 0) return uiText("relative_time_just_now");
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return uiText("relative_time_just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return uiText("relative_time_minutes_ago", undefined, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return uiText("relative_time_hours_ago", undefined, { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return uiText("relative_time_days_ago", undefined, { count: days });
  return from.toLocaleDateString();
}
