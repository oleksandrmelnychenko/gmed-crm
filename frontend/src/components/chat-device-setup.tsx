import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { canAccessChat } from "@/pages/chat/model/chat-model";

// Register on sign-in so colleagues can start a secure conversation even when
// the recipient is working elsewhere in the application.
export function ChatDeviceSetup() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !canAccessChat(user.role)) return;
    let cancelled = false;
    let pending = false;
    let ready = false;
    const setup = async () => {
      if (cancelled || pending || ready || !navigator.onLine) return;
      pending = true;
      try {
        const { ensureServerMessageKey } = await import("@/lib/chat-e2e");
        if (cancelled) return;
        await ensureServerMessageKey(user.id);
        ready = true;
      } catch {
        // The chat page exposes setup errors and a retry action.
      } finally {
        pending = false;
      }
    };
    void setup();
    const timer = window.setInterval(() => void setup(), 30_000);
    window.addEventListener("online", setup);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", setup);
    };
  }, [user?.id, user?.role]);
  return null;
}
