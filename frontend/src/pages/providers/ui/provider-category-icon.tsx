import { createElement } from "react";
import {
  Ambulance,
  Building2,
  Car,
  Coffee,
  Dumbbell,
  Hotel,
  Landmark,
  Plane,
  Sparkles,
  Stethoscope,
  Truck,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react";

/**
 * Picks a distinct icon for a provider from its type + most-specific taxonomy
 * category key. Medical providers use the stethoscope; non-medical providers get
 * a category-specific icon instead of a single generic building.
 *
 * `categoryKey` is matched by keyword, so any taxonomy key that contains the
 * category word works (e.g. "nonmedical_hotels", "nonmedical_spa_wellness"); pass
 * the provider's most-specific taxonomy node key (or a space-joined set of keys).
 */
export function providerCategoryIcon(
  providerType: string | null | undefined,
  categoryKey: string | null | undefined,
): LucideIcon {
  if (providerType === "medical") return Stethoscope;

  const key = (categoryKey ?? "").toLowerCase();
  const has = (...needles: string[]) => needles.some((needle) => key.includes(needle));

  if (has("hotel", "lodging")) return Hotel;
  if (has("cafe", "kaffee", "кафе", "кафе́")) return Coffee;
  if (has("restaurant", "catering", "gastronomy", "nutrition")) return Utensils;
  if (has("aviation", "airport", "flight")) return Plane;
  if (has("medical_ground", "ambulance")) return Ambulance;
  if (has("chauffeur", "car_rental", "ground_transport", "transport", "vehicle")) return Car;
  if (has("logistics")) return Truck;
  if (has("spa", "wellness")) return Sparkles;
  if (has("sport")) return Dumbbell;
  if (has("nightclub", "adult", "entertainment")) return Wine;
  if (has("culture")) return Landmark;
  return Building2;
}

/** Convenience wrapper that renders the resolved provider-category icon. */
export function ProviderCategoryIcon({
  providerType,
  categoryKey,
  className,
}: {
  providerType?: string | null;
  categoryKey?: string | null;
  className?: string;
}) {
  return createElement(providerCategoryIcon(providerType, categoryKey), { className });
}
