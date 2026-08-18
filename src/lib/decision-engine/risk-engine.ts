import type { Order, RiskLevel, WarehouseState } from "@/types";
import { remainingSla, urgencyOfRemaining } from "./priority-engine";

/**
 * RISK ENGINE
 * Predicts whether an order is likely to miss its fulfillment target.
 * Combines SLA pressure, pipeline progress, stock availability and
 * exception state into a single explainable score.
 */

const STAGE_ORDER = [
  "created",
  "prioritized",
  "allocated",
  "picking",
  "packing",
  "quality-check",
  "ready",
  "dispatched",
] as const;

export function stageProgress(order: Order): number {
  const idx = STAGE_ORDER.indexOf(order.status as (typeof STAGE_ORDER)[number]);
  if (order.status === "exception") return 0.25;
  if (idx < 0) return 0;
  return idx / (STAGE_ORDER.length - 1);
}

export interface RiskResult {
  level: RiskLevel;
  score: number;
  reason: string;
  predictedIssue: string;
}

export function riskLevelOf(score: number): RiskLevel {
  if (score >= 78) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function computeOrderRisk(order: Order, state: WarehouseState): RiskResult {
  const clock = state.clock;
  const remaining = remainingSla(order, clock);
  const slaUrgency = urgencyOfRemaining(remaining);

  // Availability shortfall for not-yet-covered units.
  let shortage = 0;
  let shortageUnits = 0;
  for (const item of order.items) {
    const p = state.products.find((x) => x.sku === item.sku);
    if (!p) continue;
    const need = item.qty - item.allocated;
    if (need <= 0) continue;
    const short = Math.max(0, need - p.available);
    if (short > 0) {
      shortageUnits += short;
      shortage = Math.max(shortage, (short / need) * 100);
    }
  }

  const progress = stageProgress(order);
  const progressRisk = (1 - progress) * 100;

  let score =
    slaUrgency * 0.5 + progressRisk * 0.25 + shortage * 0.15 + (order.status === "exception" ? 10 : 0);

  // Tight window + missing stock is the classic failure combination.
  if (remaining <= 60 && shortage > 0) score += 12;
  if (order.qcFailed) score += 8;

  score = Math.round(Math.min(100, score));

  let reason: string;
  if (remaining <= 15) reason = `SLA expiring in ${Math.max(0, Math.round(remaining))}m`;
  else if (shortage > 0) reason = `missing ${shortageUnits} unit${shortageUnits > 1 ? "s" : ""} of stock`;
  else if (order.status === "exception") reason = `stalled by ${order.exceptionId ?? "exception"}`;
  else if (remaining <= 90)
    reason = `SLA window ${Math.max(0, Math.round(remaining))}m with only ${Math.round(progress * 100)}% through pipeline`;
  else reason = `comfortable SLA (${Math.max(0, Math.round(remaining))}m)`;

  const predictedIssue =
    score >= 78
      ? `High probability of missing the ${Math.max(0, Math.round(remaining))}m fulfillment window`
      : score >= 55
        ? `Likely delay of 10–30m unless action is taken`
        : score >= 30
          ? `Possible minor delay — monitor`
          : `On track for on-time fulfillment`;

  return { level: riskLevelOf(score), score, reason, predictedIssue };
}

export function computeOrderRisks(state: WarehouseState): Array<{
  order: Order;
  risk: RiskResult;
}> {
  return state.orders
    .filter((o) => o.status !== "dispatched")
    .map((order) => ({ order, risk: computeOrderRisk(order, state) }));
}

/** Orders currently at high/critical risk. */
export function atRiskOrders(state: WarehouseState): Order[] {
  return state.orders.filter((o) => {
    if (o.status === "dispatched") return false;
    return computeOrderRisk(o, state).level === "high" || computeOrderRisk(o, state).level === "critical";
  });
}

/** Warehouse-wide risk snapshot used by the control tower. */
export function warehouseRisk(state: WarehouseState): {
  count: number;
  criticalCount: number;
  highest: RiskLevel;
} {
  const open = state.orders.filter((o) => o.status !== "dispatched");
  const criticalCount = open.filter((o) => computeOrderRisk(o, state).level === "critical").length;
  const highCount = open.filter((o) => computeOrderRisk(o, state).level === "high").length;
  const highest: RiskLevel =
    criticalCount > 0 ? "critical" : highCount > 0 ? "high" : "low";
  return { count: highCount + criticalCount, criticalCount, highest };
}
