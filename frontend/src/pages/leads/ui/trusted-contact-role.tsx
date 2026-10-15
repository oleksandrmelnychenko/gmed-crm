import { StatusChip } from "@/components/ui/status-chip";
import { isParentOrGuardianRelation, trustedContactRelationLabel } from "../model/lead-trusted-contacts";

export const PARENT_ROLE_CHIP_CLASS = "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200";

export function TrustedContactRole({ relation, tx }: {
  relation: string;
  tx: (ru: string, de: string) => string;
}) {
  const label = trustedContactRelationLabel(relation, tx);
  return isParentOrGuardianRelation(relation)
    ? <StatusChip data-testid="trusted-contact-relation" className={PARENT_ROLE_CHIP_CLASS}>{label}</StatusChip>
    : <span data-testid="trusted-contact-relation" className="text-xs text-muted-foreground">{label}</span>;
}
