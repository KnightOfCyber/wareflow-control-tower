import type { StockStatus, WarehouseState } from "@/types";
import { computePriority } from "@/lib/decision-engine/priority-engine";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";

/** Compute stock status for one product. */
export function stockStatusOf(p: {
  available: number;
  damaged: number;
  safetyStock: number;
  reorderThreshold: number;
}): StockStatus {
  if (p.available <= 0) return "out";
  if (p.damaged > 0) return "damaged";
  if (p.available < p.safetyStock) return "critical";
  if (p.available < p.reorderThreshold) return "low";
  return "healthy";
}

/**
 * Recompute every engine-derived field (priority, risk, stock status) so the
 * displayed state always matches the decision engines. Mutates in place —
 * callers pass either the working state or a draft clone.
 */
export function refreshDerived(state: WarehouseState): void {
  for (const order of state.orders) {
    if (order.status === "dispatched") continue;
    const priority = computePriority(order, state);
    order.priority = priority.level;
    order.score = priority.score;
    const risk = computeOrderRisk(order, state);
    order.risk = risk.level;
    order.riskScore = risk.score;
    order.riskReason = risk.reason;
  }
  for (const p of state.products) {
    p.stockStatus = stockStatusOf(p);
  }
}
