import type { Order, RecoveryPlan, RecoveryStep, WarehouseState } from "@/types";
import { refreshDerived } from "@/lib/state/derived";
import { applyAllocationsToState } from "@/lib/workflow/allocations";

/**
 * RECOVERY ENGINE
 * Turns detected disruptions into an ordered, executable recovery plan and
 * predicts its impact by simulating the plan on a copy of the state.
 */

let stepSeq = 0;
function step(
  type: RecoveryStep["type"],
  title: string,
  detail: string,
  payload: RecoveryStep["payload"],
): RecoveryStep {
  stepSeq += 1;
  return { id: `RS-${stepSeq}`, type, title, detail, payload };
}

/** Apply one recovery step to a state (mutates — pass a draft). */
export function applyRecoveryStep(state: WarehouseState, s: RecoveryStep): void {
  switch (s.type) {
    case "reassign-picker": {
      const order = state.orders.find((o) => o.id === s.payload.orderId);
      const picker = state.pickers.find((p) => p.id === s.payload.pickerId);
      if (order && picker) {
        const prev = state.pickers.find((p) => p.id === order.pickerId);
        if (prev) prev.status = "available";
        order.pickerId = picker.id;
        picker.status = "busy";
        if (order.status === "allocated" || order.status === "exception") order.status = "picking";
      }
      break;
    }
    case "release-reservation": {
      applyAllocationsToState(state, [], [
        { orderId: String(s.payload.orderId), sku: String(s.payload.sku), qty: Number(s.payload.qty), source: "recall" },
      ]);
      break;
    }
    case "reallocate": {
      applyAllocationsToState(state, [], [
        { orderId: String(s.payload.orderId), sku: String(s.payload.sku), qty: Number(s.payload.qty), source: "available" },
      ]);
      break;
    }
    case "rebook-vehicle": {
      const order = state.orders.find((o) => o.id === s.payload.orderId);
      const vehicle = state.vehicles.find((v) => v.id === s.payload.vehicleId);
      if (order && vehicle) {
        const prev = state.vehicles.find((v) => v.id === order.vehicleId);
        if (prev) prev.assigned = Math.max(0, prev.assigned - 1);
        order.vehicleId = vehicle.id;
        vehicle.assigned += 1;
        if (vehicle.status === "ready" || vehicle.status === "delayed") vehicle.status = "loading";
        if (order.status === "exception" || order.status === "ready") order.status = "ready";
      }
      break;
    }
    case "replenish": {
      const product = state.products.find((p) => p.sku === s.payload.sku);
      if (product) {
        product.available += Number(s.payload.qty);
        product.replenishQty = undefined;
      }
      break;
    }
    case "resequence": {
      const order = state.orders.find((o) => o.id === s.payload.orderId);
      if (order) {
        if (order.status === "created" || order.status === "prioritized") order.status = "prioritized";
        const free = state.pickers.find((p) => p.status === "available" && p.zone === order.zone);
        if (free && order.items.every((i) => i.allocated > 0)) {
          order.pickerId = free.id;
          free.status = "busy";
          order.status = "picking";
        }
      }
      break;
    }
    case "requeue": {
      const order = state.orders.find((o) => o.id === s.payload.orderId);
      if (order) {
        const stage = String(s.payload.stage);
        order.status = stage as Order["status"];
        if (stage === "quality-check") order.qcFailed = false;
        if (stage === "packing" || stage === "quality-check" || stage === "ready") {
          for (const item of order.items) {
            item.picked = item.allocated;
            item.packed = stage === "quality-check" || stage === "ready" ? item.allocated : item.packed;
          }
        }
        if (stage === "ready") {
          const station = state.stations.find((s) => s.queue < 2);
          if (station) order.stationId = station.id;
        }
      }
      break;
    }
    case "substitute": {
      // Reserve the substitute SKU against the order line and note the swap.
      const order = state.orders.find((o) => o.id === s.payload.orderId);
      const sub = state.products.find((p) => p.sku === s.payload.substituteSku);
      if (order && sub) {
        const give = Math.min(Number(s.payload.qty), sub.available);
        sub.available -= give;
        sub.reserved += give;
        if (order.status === "created" || order.status === "prioritized") order.status = "allocated";
      }
      break;
    }
  }
}

function countRisk(state: WarehouseState): number {
  return state.orders.filter((o) => o.status !== "dispatched" && (o.risk === "high" || o.risk === "critical")).length;
}

function countSlaFailures(state: WarehouseState): number {
  return state.orders.filter(
    (o) => o.status !== "dispatched" && o.slaMinutes - (state.clock - o.createdAt) <= 0,
  ).length;
}

export function buildRecoveryPlan(state: WarehouseState): RecoveryPlan {
  stepSeq = 0;
  const steps: RecoveryStep[] = [];
  const planId = `RP-${state.clock}`;

  for (const d of state.chaos.disruptions) {
    switch (d.kind) {
      case "picker-out": {
        const orderId = d.affectedOrders[0];
        const order = state.orders.find((o) => o.id === orderId);
        if (order) {
          const candidate =
            state.pickers.find((p) => p.status === "available" && p.zone === order.zone) ??
            state.pickers.find((p) => p.status === "available");
          if (candidate)
            steps.push(
              step(
                "reassign-picker",
                `Reassign ${candidate.name} to order #${orderId}`,
                `Picker ${candidate.id} (${candidate.zone}) is available with zero workload.`,
                { orderId, pickerId: candidate.id },
              ),
            );
        }
        break;
      }
      case "damage-stock": {
        const sku = d.affectedSkus[0];
        const product = state.products.find((p) => p.sku === sku);
        if (product) {
          steps.push(
            step(
              "replenish",
              `Replenish ${sku} (${product.name})`,
              `Damage detected — draft replenishment of ${product.reorderThreshold + 5} units to restore buffer.`,
              { sku, qty: product.reorderThreshold + 5 },
            ),
          );
        }
        break;
      }
      case "truck-delay": {
        const orderId = d.affectedOrders[0];
        const order = state.orders.find((o) => o.id === orderId);
        if (order) {
          const truck = state.vehicles.find((v) => v.status === "ready");
          if (truck)
            steps.push(
              step(
                "rebook-vehicle",
                `Rebook #${orderId} to ${truck.name}`,
                `${truck.name} (${truck.route}) is ready with ${Math.max(0, truck.capacity - truck.assigned)} free slots.`,
                { orderId, vehicleId: truck.id },
              ),
            );
        }
        break;
      }
      case "order-surge": {
        for (const orderId of d.affectedOrders) {
          const order = state.orders.find((o) => o.id === orderId);
          if (!order) continue;
          steps.push(
            step(
              "resequence",
              `Fast-track order #${orderId}`,
              `Priority ${order.priority.toUpperCase()} — pull ahead in the pick queue.`,
              { orderId },
            ),
          );
          for (const item of order.items) {
            const p = state.products.find((x) => x.sku === item.sku);
            if (p && (p.stockStatus === "critical" || p.stockStatus === "out")) {
              steps.push(
                step(
                  "replenish",
                  `Replenish ${p.sku}`,
                  `Surge demand on ${p.sku} — stock below safety.`,
                  { sku: p.sku, qty: p.reorderThreshold + 5 },
                ),
              );
            }
          }
        }
        break;
      }
    }
  }

  // Always top up any critical/out-of-stock item as a safety net.
  for (const p of state.products) {
    if ((p.stockStatus === "critical" || p.stockStatus === "out") && p.replenishQty === undefined) {
      steps.push(
        step(
          "replenish",
          `Replenish ${p.sku} (${p.name})`,
          `Stock ${p.stockStatus.toUpperCase()} (${p.available} avail / safety ${p.safetyStock}).`,
          { sku: p.sku, qty: p.reorderThreshold + 5 },
        ),
      );
    }
  }

  // One replenishment action per SKU — no redundant steps.
  const seenReplenish = new Set<string>();
  const deduped: RecoveryStep[] = [];
  for (const s of steps) {
    if (s.type === "replenish") {
      const key = String(s.payload.sku);
      if (seenReplenish.has(key)) continue;
      seenReplenish.add(key);
    }
    deduped.push(s);
  }
  steps.length = 0;
  steps.push(...deduped);

  // Predict the improvement.
  const before = countRisk(state);
  const slaBefore = countSlaFailures(state);
  const draft = structuredClone(state);
  for (const s of steps) applyRecoveryStep(draft, s);
  refreshDerived(draft);
  const after = countRisk(draft);
  const slaAfter = countSlaFailures(draft);

  const predictedImprovement: string[] = [];
  if (after < before) predictedImprovement.push(`Orders at risk: ${before} → ${after}`);
  if (slaAfter < slaBefore) predictedImprovement.push(`Predicted SLA failures: ${slaBefore} → ${slaAfter}`);
  if (steps.length > 0) predictedImprovement.push(`${steps.length} coordinated actions applied`);
  predictedImprovement.push(
    `Critical SKU buffer restored for ${draft.products.filter((p) => p.stockStatus === "healthy").length}/${draft.products.length} SKUs`,
  );

  return {
    id: planId,
    title: "Recovery plan — coordinated disruption response",
    steps,
    riskBefore: before,
    riskAfter: after,
    slaFailuresBefore: slaBefore,
    slaFailuresAfter: slaAfter,
    predictedImprovement,
  };
}
