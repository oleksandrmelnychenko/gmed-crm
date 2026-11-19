import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PositionTaxProfile } from "../model/order-model";

/**
 * The active tax profiles an order position can carry (owner 2026-11-19),
 * read once when `enabled` turns true. Empty when the reader may not list
 * them; the positions then show their stored profile only.
 */
export function usePositionTaxProfiles(enabled: boolean): PositionTaxProfile[] {
  const [profiles, setProfiles] = useState<PositionTaxProfile[]>([]);
  useEffect(() => {
    if (!enabled || profiles.length) return;
    let cancelled = false;
    apiFetch<PositionTaxProfile[] | { items?: PositionTaxProfile[] }>("/tax-profiles")
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload) ? payload : payload.items ?? [];
        setProfiles(items.filter((profile) => profile.is_active));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, profiles.length]);
  return profiles;
}
