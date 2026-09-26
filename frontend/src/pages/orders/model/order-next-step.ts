import type { OrderStatusTransition } from "./types";

type LifecycleTransition = {
  phase: string;
  blocked: boolean;
  reasons: string[];
};

type LifecycleLike = {
  next_stage: string | null;
  allowed_transitions?: LifecycleTransition[] | null;
  allowed_status_transitions?: OrderStatusTransition[] | null;
};

/**
 * What the order workspace header offers next:
 * - `terminal`: a cancelled or completed order has no further step;
 * - `phase`: move to the next lifecycle phase (with its blockers);
 * - `completion`: the last phase is reached and the order waits to be
 *   completed; its blockers are the ones the server checks before completion.
 */
export type OrderNextStep =
  | { kind: "terminal"; status: "cancelled" | "completed" }
  | { kind: "phase"; nextPhase: string; blocked: boolean; reasons: string[] }
  | { kind: "completion"; blocked: boolean; reasons: string[] };

/** The server's reason when a phase or completion needs an active order. */
export function orderStatusBlockerReason(status: string) {
  return `Order status must be active (currently ${status})`;
}

/** The order status named by {@link orderStatusBlockerReason}, if the reason is one. */
export function parseOrderStatusBlocker(reason: string): string | null {
  return reason.match(/^Order status must be active (?:before changing phase )?\(currently ([a-z_]+)\)$/)?.[1] ?? null;
}

export function resolveOrderNextStep(order: {
  status: string;
  lifecycle?: LifecycleLike | null;
}): OrderNextStep {
  if (order.status === "cancelled" || order.status === "completed") {
    return { kind: "terminal", status: order.status };
  }
  const lifecycle = order.lifecycle;
  const phaseTransition = lifecycle?.allowed_transitions?.[0];
  if (lifecycle?.next_stage) {
    return {
      kind: "phase",
      nextPhase: lifecycle.next_stage,
      blocked: Boolean(phaseTransition?.blocked),
      reasons: phaseTransition?.reasons ?? [],
    };
  }
  const completion = lifecycle?.allowed_status_transitions?.find(
    (transition) => transition.status === "completed",
  );
  if (completion) {
    return {
      kind: "completion",
      blocked: completion.blocked,
      reasons: completion.reasons,
    };
  }
  // A paused order in the last phase cannot be completed before it resumes.
  return {
    kind: "completion",
    blocked: true,
    reasons: [orderStatusBlockerReason(order.status)],
  };
}
