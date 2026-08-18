import type { AllocationConflict, SimSession, WarehouseState } from "@/types";

/**
 * WHAT-IF ENGINE
 * Wraps the allocation engine's scenario set into an interactive
 * SIMULATE → COMPARE → RECOMMEND → EXECUTE session. Simulation never
 * touches real state — the operator explicitly applies the chosen scenario.
 */

export function createSimSession(
  state: WarehouseState,
  conflict: AllocationConflict,
): SimSession {
  const primary = state.orders.find((o) => o.id === conflict.orderId);
  const product = state.products.find((p) => p.sku === conflict.sku);

  const situation: string[] = [
    conflict.description,
    ...conflict.explanation.slice(1, -1),
  ];

  const recommended = conflict.options.find((o) => o.id === conflict.recommendedOptionId);

  const explanation: string[] = [
    ...conflict.explanation,
    `Scenario ${recommended?.id ?? "?"} (${recommended?.label ?? ""}) achieves the lowest composite risk score (${recommended?.riskScore ?? "—"}) across SLA risk, fulfillment, delay and movement.`,
  ];

  return {
    id: `SIM-${conflict.id}`,
    conflictId: conflict.id,
    orderId: conflict.orderId,
    sku: conflict.sku,
    title: primary
      ? `Allocate ${conflict.sku}${product ? ` (${product.name})` : ""} under shortage`
      : `Allocation conflict ${conflict.id}`,
    situation,
    scenarios: conflict.options,
    recommendedScenarioId: conflict.recommendedOptionId,
    comparedAt: state.clock,
    explanation,
  };
}
