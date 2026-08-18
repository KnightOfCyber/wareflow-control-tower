import type {
  AllocationConflict,
  AllocationEntry,
  AllocationOption,
  Order,
  RiskLevel,
  WarehouseState,
} from "@/types";
import { computeOrderRisk } from "./risk-engine";
import { applyAllocationsToState } from "@/lib/workflow/allocations";

/**
 * ALLOCATION ENGINE
 * When demand for a SKU exceeds supply, evaluate the competing claims on
 * that stock and produce a ranked set of options with predicted impact.
 *
 * Fully deterministic: scoring is a fixed weighted composite over
 * simulated outcomes (SLA risk, fulfillment, delay, movement).
 */

export const REPLENISH_ETA_MIN = 40;
export const EXPRESS_ETA_MIN = 90;

function cloneState(state: WarehouseState): WarehouseState {
  return structuredClone(state);
}

function riskScoreOf(level: RiskLevel): number {
  switch (level) {
    case "critical":
      return 100;
    case "high":
      return 75;
    case "medium":
      return 45;
    default:
      return 15;
  }
}

interface Demand {
  order: Order;
  need: number;
}

/** Orders with an unmet demand for this SKU (excluding the primary). */
function otherDemand(state: WarehouseState, sku: string, primaryId: string): Demand[] {
  const out: Demand[] = [];
  for (const o of state.orders) {
    if (o.id === primaryId || o.status === "dispatched") continue;
    const item = o.items.find((i) => i.sku === sku);
    if (!item) continue;
    const need = item.qty - item.allocated;
    if (need > 0) out.push({ order: o, need });
  }
  return out.sort((a, b) => b.order.score - a.order.score);
}

/** Orders currently holding a reservation on this SKU (recall candidates). */
function holders(state: WarehouseState, sku: string): Order[] {
  return state.orders
    .filter((o) => o.status !== "dispatched")
    .filter((o) => o.items.some((i) => i.sku === sku && i.allocated > 0))
    .sort((a, b) => a.score - b.score); // lowest score first = best recall target
}

function optionScore(option: AllocationOption): number {
  return option.riskScore;
}

function buildOption(
  id: string,
  label: string,
  summary: string,
  releases: AllocationEntry[],
  allocations: AllocationEntry[],
  replenishQty: number,
  state: WarehouseState,
  primary: Order,
  sku: string,
  demanders: Demand[],
): AllocationOption {
  const draft = cloneState(state);
  applyAllocationsToState(draft, releases, allocations);

  const pItem = primary.items.find((i) => i.sku === sku);
  const required = pItem?.qty ?? 0;
  const after = draft.orders.find((o) => o.id === primary.id);
  const afterItem = after?.items.find((i) => i.sku === sku);
  const allocatedNow = afterItem?.allocated ?? 0;
  const fulfillmentAfter = Math.round((allocatedNow / required) * 100);

  const primaryRisk = after ? computeOrderRisk(after, draft) : null;
  const slaRisk = primaryRisk ? primaryRisk.level : "low";

  // Delay: how long the primary waits for any uncovered units.
  const uncovered = Math.max(0, required - allocatedNow);
  const primaryDelay = uncovered > 0 ? REPLENISH_ETA_MIN : 0;

  const affected = new Set<string>([
    primary.id,
    ...releases.map((r) => r.orderId),
    ...allocations.map((a) => a.orderId),
  ]);
  for (const d of demanders) affected.add(d.order.id);

  const movement = releases.reduce((a, r) => a + r.qty, 0) + allocations.length;

  // Delay metric is the PRIMARY order's wait; competitor delays surface in
  // the orders-affected column and the impact notes.
  const maxDelay = primaryDelay;
  const slaComp = riskScoreOf(slaRisk) * 0.4;
  const fulfillmentComp = (100 - fulfillmentAfter) * 0.3;
  const delayComp = Math.min(100, (maxDelay / 120) * 100) * 0.2;
  const movementComp = Math.min(100, movement * 4) * 0.1;
  const riskScore = Math.round(slaComp + fulfillmentComp + delayComp + movementComp);

  return {
    id,
    label,
    summary,
    releases,
    allocations,
    replenishQty,
    expectedDelayMin: maxDelay,
    slaRisk,
    fulfillmentAfter,
    ordersAffected: [...affected],
    movement,
    riskScore,
    breakdown: {
      sla: Math.round(slaComp),
      fulfillment: Math.round(fulfillmentComp),
      delay: Math.round(delayComp),
      movement: Math.round(movementComp),
    },
    pros: [],
    cons: [],
  };
}

export function getAllocationConflict(
  state: WarehouseState,
  orderId: string,
  sku: string,
): AllocationConflict | null {
  const primary = state.orders.find((o) => o.id === orderId);
  const product = state.products.find((p) => p.sku === sku);
  const item = primary?.items.find((i) => i.sku === sku);
  if (!primary || !product || !item) return null;

  const required = item.qty - item.allocated;
  if (required <= 0) return null;
  const avail = product.available;
  const recoverable = holders(state, sku).reduce(
    (a, o) => a + (o.items.find((i) => i.sku === sku)?.allocated ?? 0),
    0,
  );
  const shortfall = Math.max(0, required - avail - recoverable);
  const demanders = otherDemand(state, sku, primary.id);
  const id = `C-${orderId}-${sku}`;

  const description = `Order #${orderId} requires ${required} × ${sku} (${product.name}). Available: ${avail}${recoverable > 0 ? `, recoverable from reservations: ${recoverable}` : ""}. ${shortfall > 0 ? `Shortfall: ${shortfall}.` : ""}`;

  const replenishProposal = Math.max(product.reorderThreshold, shortfall + product.safetyStock);

  const options: AllocationOption[] = [];

  // ---- A: protect the primary order (available + recall) -----------------
  {
    const releases: AllocationEntry[] = [];
    const allocations: AllocationEntry[] = [];
    let toCover = required;
    const fromAvail = Math.min(toCover, avail);
    if (fromAvail > 0) {
      allocations.push({ orderId, sku, qty: fromAvail, source: "available" });
      toCover -= fromAvail;
    }
    let recalled = 0;
    const hold = holders(state, sku);
    for (const h of hold) {
      if (toCover <= 0) break;
      const hItem = h.items.find((i) => i.sku === sku);
      if (!hItem) continue;
      const take = Math.min(hItem.allocated, toCover);
      releases.push({ orderId: h.id, sku, qty: take, source: "recall" });
      recalled += take;
      toCover -= take;
    }
    // Recalled reservations flow back to available, then straight to the primary.
    if (recalled > 0) allocations.push({ orderId, sku, qty: recalled, source: "available" });
    if (releases.length > 0 || allocations.length > 0) {
      options.push(
        buildOption(
          "A",
          "Protect critical order",
          `Allocate ${Math.min(required, avail + (recalled > 0 ? recalled : 0))} unit(s) of the available pool to #${orderId}${recalled > 0 ? ` (${recalled} recalled from low-priority reservation${recalled > 1 ? "s" : ""})` : ""}. Defer competitors to replenishment.`,
          releases,
          allocations,
          replenishProposal,
          state,
          primary,
          sku,
          demanders,
        ),
      );
    }
  }

  // ---- B: split available proportionally by priority ---------------------
  {
    const pool = [primary, ...demanders.map((d) => d.order)];
    const weights = pool.map((o) => Math.max(1, o.score));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const allocations: AllocationEntry[] = [];
    let remaining = avail;
    pool.forEach((o, i) => {
      const share = Math.floor((avail * weights[i]) / totalWeight);
      const take = Math.min(share, remaining, o.items.find((x) => x.sku === sku)?.qty ?? 0);
      if (take > 0) {
        allocations.push({ orderId: o.id, sku, qty: take, source: "available" });
        remaining -= take;
      }
    });
    options.push(
      buildOption(
        "B",
        "Split stock proportionally",
        `Split the ${avail} available units across all demanders weighted by priority score. Everyone is partially fulfilled; critical SLA remains partially uncovered.`,
        [],
        allocations,
        replenishProposal,
        state,
        primary,
        sku,
        demanders,
      ),
    );
  }

  // ---- C: wait for replenishment -----------------------------------------
  {
    options.push(
      buildOption(
        "C",
        "Wait for replenishment",
        `Hold allocation and wait ${REPLENISH_ETA_MIN}m for a replenishment of ${replenishProposal} units. Nothing is allocated to anyone.`,
        [],
        [],
        replenishProposal,
        state,
        primary,
        sku,
        demanders,
      ),
    );
  }

  for (const opt of options) {
    opt.pros = prosFor(opt);
    opt.cons = consFor(opt);
  }

  options.sort((a, b) => optionScore(a) - optionScore(b) || b.fulfillmentAfter - a.fulfillmentAfter);
  const recommended = options[0];

  const explanation = [
    `Detected: #${orderId} needs ${required} × ${sku}; ${avail} available${shortfall > 0 ? `; shortfall ${shortfall}` : ""}.`,
    ...demanders.map(
      (d) =>
        `Competing demand: #${d.order.id} needs ${d.need} × ${sku} (score ${d.order.score}).`,
    ),
    `Scored ${options.length} allocation scenario(s) on SLA risk, fulfillment, delay and movement.`,
    `Recommended: ${recommended.label} — lowest composite risk (${recommended.riskScore}).`,
  ];

  const impact = impactFor(recommended, primary, sku);

  return {
    id,
    orderId,
    sku,
    requiredQty: required,
    availableQty: avail,
    reservedRecoverable: recoverable,
    shortfall,
    description,
    options,
    recommendedOptionId: recommended.id,
    explanation,
    impact,
  };
}

function prosFor(opt: AllocationOption): string[] {
  const out: string[] = [];
  if (opt.fulfillmentAfter >= 100) out.push("Primary order fully fulfilled");
  else out.push(`Primary order ${opt.fulfillmentAfter}% fulfilled`);
  if (opt.slaRisk === "low" || opt.slaRisk === "medium") out.push("Critical SLA remains protected");
  if (opt.replenishQty > 0) out.push(`Replenishment of ${opt.replenishQty} units drafted (ETA ${REPLENISH_ETA_MIN}m)`);
  if (opt.movement <= 2) out.push("Minimal additional warehouse movement");
  if (opt.releases.length === 0) out.push("No existing reservations disturbed");
  return out;
}

function consFor(opt: AllocationOption): string[] {
  const out: string[] = [];
  if (opt.fulfillmentAfter < 100) out.push(`Primary order delayed ~${opt.expectedDelayMin}m for remaining units`);
  if (opt.slaRisk === "critical") out.push("Critical SLA remains at high risk");
  if (opt.releases.length > 0)
    out.push(
      `Releases ${opt.releases.reduce((a, r) => a + r.qty, 0)} unit(s) from order(s) ${opt.releases.map((r) => `#${r.orderId}`).join(", ")}`,
    );
  if (opt.movement > 2) out.push(`${opt.movement} extra warehouse operations required`);
  return out;
}

function impactFor(opt: AllocationOption, primary: Order, sku: string): string[] {
  const out: string[] = [];
  const covered = Math.round((opt.fulfillmentAfter / 100) * (primary.items.find((i) => i.sku === sku)?.qty ?? 0));
  out.push(`#${primary.id} gets ${covered}/${primary.items.find((i) => i.sku === sku)?.qty} units of ${sku} — ${opt.fulfillmentAfter}% fulfilled.`);
  for (const r of opt.releases)
    out.push(`#${r.orderId} loses ${r.qty} reserved unit(s) — re-queued after replenishment.`);
  for (const a of opt.allocations)
    if (a.orderId !== primary.id)
      out.push(`#${a.orderId} receives ${a.qty} unit(s) of ${sku}.`);
  if (opt.replenishQty > 0)
    out.push(`Replenishment order drafted: +${opt.replenishQty} units of ${sku} (ETA ${REPLENISH_ETA_MIN}m).`);
  return out;
}

/** Scan the warehouse for active allocation conflicts worth deciding on. */
export function findActiveConflicts(state: WarehouseState): AllocationConflict[] {
  const conflicts: AllocationConflict[] = [];
  for (const order of state.orders) {
    // Orders already in an exception have their own resolution workflow.
    if (order.status === "dispatched" || order.status === "delayed" || order.status === "exception") continue;
    for (const item of order.items) {
      const p = state.products.find((x) => x.sku === item.sku);
      if (!p) continue;
      const need = item.qty - item.allocated;
      if (need <= 0) continue;
      if (p.available < need) {
        const conflict = getAllocationConflict(state, order.id, item.sku);
        if (conflict) conflicts.push(conflict);
        break;
      }
    }
  }
  return conflicts;
}
