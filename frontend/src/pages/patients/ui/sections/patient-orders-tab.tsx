import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  TabLoader,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type { OrderItem } from "../../model/detail-tab-types";

type PatientOrdersDictionary = {
  orders_title: string;
};

type PatientOrdersTabProps = {
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenOrder: (orderId: string) => void;
  orderPhaseLabel: (value: string) => string;
  orders: OrderItem[];
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientOrdersDictionary;
  tabLoading: boolean;
};

export function PatientOrdersTab({
  emptyLabel,
  formatDate,
  onOpenOrder,
  orderPhaseLabel,
  orders,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientOrdersTabProps) {
  return (
    <TabsContent value="orders" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.orders_title}
        accessory={<CountBadge>{orders.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : orders.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {orders.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenOrder(item.id)}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{item.order_number}</span>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {item.needs_description || item.order_number}
                </p>
                <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                  <span>{orderPhaseLabel(item.phase)}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
