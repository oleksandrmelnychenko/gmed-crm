import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banner, CountBadge, Section, tokens } from "@/components/ui-shell";
import type {
  OrderServiceGroup,
  ServiceGroupParticipant,
} from "@/lib/api/clinical";

type OrderServiceGroupPanelProps = {
  group: Pick<
    OrderServiceGroup,
    "group_title" | "status" | "quantity" | "unit_price" | "currency" | "vat_rate"
  > & {
    participants: ServiceGroupParticipant[];
    generated_line_count?: number;
  };
  generating?: boolean;
  error?: string;
  onGenerate?: () => void;
};

export function OrderServiceGroupPanel({
  group,
  generating = false,
  error,
  onGenerate,
}: OrderServiceGroupPanelProps) {
  const previewCount = group.participants.length;
  const generatedLineCount = group.generated_line_count ?? 0;

  return (
    <Section
      title="Split service by doctors"
      accessory={<CountBadge>{previewCount} participants</CountBadge>}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {group.group_title}
          </h3>
          <p className={tokens.text.muted}>
            {previewCount} doctors create {previewCount} generated billing lines.
            Generated lines use source_service_group_participant_id, not
            source_medical_appointment_id.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full">
              {group.status}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {group.quantity} × {group.unit_price} {group.currency}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              VAT {group.vat_rate}%
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {generatedLineCount} generated
            </Badge>
          </div>
        </div>
        {onGenerate ? (
          <Button
            type="button"
            size="sm"
            className="rounded-lg"
            disabled={generating || previewCount === 0}
            onClick={onGenerate}
          >
            {generating ? "Generating..." : "Generate lines"}
          </Button>
        ) : null}
      </div>

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {group.participants.map((participant, index) => (
          <article
            key={participant.id ?? `${participant.doctor_id}:${index}`}
            className="rounded-xl border border-border/50 bg-card/60 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {participant.doctor_name ?? participant.doctor_id}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {participant.provider_name ?? participant.provider_id}
                </p>
              </div>
              <Badge variant="outline" className="rounded-full">
                line {index + 1}
              </Badge>
            </div>
            {participant.role_label ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {participant.role_label}
              </p>
            ) : null}
            {participant.generated_leistung_id ? (
              <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                Generated line: {participant.generated_leistung_id}
              </p>
            ) : (
              <p className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] text-muted-foreground">
                Preview only: billing line will be created from this participant.
              </p>
            )}
          </article>
        ))}
      </div>
    </Section>
  );
}
