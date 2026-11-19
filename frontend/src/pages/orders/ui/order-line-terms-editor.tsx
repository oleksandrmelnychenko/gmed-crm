import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { parseDiscountPercent } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PositionTaxProfile } from "../model/order-model";
import { taxProfileLabel, taxProfilesForLine } from "./order-catalog-services-table";

export type OrderLineTermsPayload = { discount_percent: number; tax_profile_id: string | null };

/**
 * Discount and tax profile of a position not billed yet (owner 2026-11-19):
 * a service added during the order is priced afterwards in the order
 * positions; the next interim or final invoice bills the new terms. A billed
 * position is not offered here (the server refuses it with 409).
 */
export function OrderLineTermsEditor({ discountPercent, taxProfileId, isCostPassthrough, profiles, lang, onSave }: {
  discountPercent: unknown;
  taxProfileId: string | null | undefined;
  isCostPassthrough: boolean;
  profiles: readonly PositionTaxProfile[];
  lang: "de" | "ru";
  onSave: (payload: OrderLineTermsPayload) => Promise<void>;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  // «12,5», not «12.5» (QA3); both are read.
  const initialDiscount = Number(discountPercent ?? 0) > 0 ? String(Number(discountPercent)).replace(".", ",") : "";
  const [discount, setDiscount] = useState(initialDiscount);
  const [profileId, setProfileId] = useState(taxProfileId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = isCostPassthrough ? 0 : parseDiscountPercent(discount);
  const changed = discount !== initialDiscount || profileId !== (taxProfileId ?? "");
  const choices = taxProfilesForLine({ isCostPassthrough }, profiles);

  async function save() {
    if (parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ discount_percent: parsed, tax_profile_id: profileId || null });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-2" data-testid="order-line-terms-editor">
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        {tx("Скидка, %", "Rabatt, %")}
        <Input
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={parsed === null || undefined}
          className={cn("h-7 w-20 bg-field px-2 text-right font-mono text-xs", parsed === null && "border-destructive")}
          value={isCostPassthrough ? "" : discount}
          placeholder="0"
          disabled={busy || isCostPassthrough}
          onChange={(event) => setDiscount(event.target.value)}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
        {tx("Налоговый профиль", "Steuerprofil")}
        <NativeComboboxSelect
          className="h-7 max-w-56 px-1.5 text-xs"
          value={profileId}
          disabled={busy || choices.length === 0}
          onChange={(event) => setProfileId(event.target.value)}
        >
          <option value="">{tx("По каталогу", "Standard des Katalogs")}</option>
          {choices.map((profile) => <option key={profile.id} value={profile.id}>{taxProfileLabel(profile, lang)}</option>)}
        </NativeComboboxSelect>
      </label>
      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy || !changed || parsed === null} onClick={() => void save()}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
        {tx("Сохранить", "Speichern")}
      </Button>
      {error ? <p role="alert" className="w-full text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
