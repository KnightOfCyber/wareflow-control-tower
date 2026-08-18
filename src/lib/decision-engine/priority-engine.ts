import type { Order, PriorityLevel, WarehouseState } from "@/types";

/**
 * PRIORITY ENGINE
 * Deterministic, explainable scoring of every open order.
 *
 * Score 0..100, composed of:
 *  - SLA urgency (remaining window)
 *  - business priority (declared class)
 *  - customer tier
 *  - order age
 *  - stock availability pressure
 *  - SLA-pressure bonuses for tight enterprise/critical windows
 */

const BASE_SCORE: Record<PriorityLevel, number> = {
  critical: 90,
  high: 70,
  medium: 45,
  low: 20,
};

const TIER_ADJ: Record<Order["customerTier"], number> = {
  enterprise: 10,
  retail: 4,
  standard: 0,
  low: -6,
};

/** Absolute remaining-time urgency band (0..100) */
export function urgencyOfRemaining(remaining: number): number {
  if (remaining <= 0) return 100;
  if (remaining <= 15) return 95;
  if (remaining <= 30) return 90;
  if (remaining <= 60) return 80;
  if (remaining <= 90) return 65;
  if (remaining <= 180) return 50;
  if (remaining <= 360) return 35;
  return 20;
}

export function remainingSla(order: Order, clock: number): number {
  return order.slaMinutes - (clock - order.createdAt);
}

export function priorityLevelOf(score: number): PriorityLevel {
  if (score >= 78) return "critical";
  if (score >= 58) return "high";
  if (score >= 38) return "medium";
  return "low";
}

/** Stock shortage pressure: how far current availability is from covering this order. */
function shortageScore(order: Order, state: WarehouseState): number {
  let worst = 0;
  for (const item of order.items) {
    const p = state.products.find((x) => x.sku === item.sku);
    if (!p) continue;
    const need = item.qty - item.allocated;
    if (need <= 0) continue;
    const short = Math.max(0, need - p.available);
    worst = Math.max(worst, (short / need) * 100);
  }
  return worst;
}

export interface PriorityResult {
  level: PriorityLevel;
  score: number;
  explanation: string[];
}

export function computePriority(order: Order, state: WarehouseState): PriorityResult {
  const clock = state.clock;
  const remaining = remainingSla(order, clock);
  const urgency = urgencyOfRemaining(remaining);
  const ageFactor = Math.min(100, Math.max(0, clock - order.createdAt) * 2.5);
  const shortage = shortageScore(order, state);

  // SLA pressure: tight windows and enterprise tiers deserve extra weight.
  let pressure = 0;
  if (remaining <= 60 && remaining > 0) pressure += 8;
  if (remaining <= 30 && remaining > 0) pressure += 8;
  if (order.customerTier === "enterprise" && remaining <= 60 && remaining > 0) pressure += 6;
  if (order.basePriority === "critical" && remaining <= 60 && remaining > 0) pressure += 6;

  const score = Math.round(
    Math.min(
      100,
      0.42 * urgency +
        0.3 * BASE_SCORE[order.basePriority] +
        0.08 * TIER_ADJ[order.customerTier] +
        0.08 * ageFactor +
        0.12 * shortage +
        pressure,
    ),
  );

  const explanation: string[] = [];
  explanation.push(`SLA window ${Math.max(0, Math.round(remaining))}m → urgency ${urgency}/100`);
  explanation.push(`Business class ${order.basePriority} (${BASE_SCORE[order.basePriority]}/100)`);
  explanation.push(`Customer tier ${order.customerTier} (${TIER_ADJ[order.customerTier] >= 0 ? "+" : ""}${TIER_ADJ[order.customerTier]})`);
  if (shortage > 0) explanation.push(`Stock shortage pressure ${Math.round(shortage)}/100`);
  if (pressure > 0) explanation.push(`SLA pressure bonus +${pressure}`);

  return { level: priorityLevelOf(score), score, explanation };
}
