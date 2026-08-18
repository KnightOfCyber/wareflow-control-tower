import type { WarehouseState } from "@/types";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";

/**
 * ANALYTICS
 * Every metric is computed from live state — analytics supports decisions,
 * it never replaces them.
 */

export interface WarehouseMetrics {
  fulfillmentRate: number;
  onTimeRate: number;
  avgFulfillmentMin: number;
  inventoryUtilization: number;
  lowStockCount: number;
  outStockCount: number;
  atRiskCount: number;
  pickingEfficiency: number;
  packingUtilization: number;
  dispatchPerformance: number;
  bottleneckCount: number;
  exceptionsResolved: number;
  exceptionsOpen: number;
  decisionImpact: number;
  totalUnitsShipped: number;
  totalUnitsAllocated: number;
  ordersDispatched: number;
}

export function computeMetrics(state: WarehouseState): WarehouseMetrics {
  const orders = state.orders;
  const dispatched = orders.filter((o) => o.status === "dispatched");
  const open = orders.filter((o) => o.status !== "dispatched");

  const totalUnits = orders.reduce((a, o) => a + o.items.reduce((x, i) => x + i.qty, 0), 0);
  const shippedUnits = dispatched.reduce((a, o) => a + o.items.reduce((x, i) => x + i.qty, 0), 0);
  const allocatedUnits = open.reduce(
    (a, o) => a + o.items.reduce((x, i) => x + i.allocated, 0),
    0,
  );

  // Fulfillment: weighted by units, dispatched counts fully, pipeline counts allocation progress.
  const progressUnits = orders.reduce((a, o) => {
    const total = o.items.reduce((x, i) => x + i.qty, 0);
    if (o.status === "dispatched") return a + total;
    const done = o.items.reduce((x, i) => x + Math.min(i.allocated, i.qty), 0);
    return a + done;
  }, 0);
  const fulfillmentRate = totalUnits ? (progressUnits / totalUnits) * 100 : 0;

  const onTime = dispatched.filter((o) => o.createdAt + o.slaMinutes >= state.clock).length;
  const onTimeRate = dispatched.length ? (onTime / dispatched.length) * 100 : 0;

  // Avg fulfillment time: mean elapsed time for completed (dispatched) orders.
  const tracked = dispatched.length ? dispatched : orders.filter((o) => o.status === "ready");
  const avgFulfillmentMin = tracked.length
    ? Math.round(tracked.reduce((a, o) => a + (state.clock - o.createdAt), 0) / tracked.length)
    : 0;

  const totalCapacity = state.products.reduce((a, p) => a + p.available + p.reserved + p.damaged, 0);
  const inventoryUtilization = totalCapacity
    ? ((totalCapacity - state.products.reduce((a, p) => a + p.available, 0)) / totalCapacity) * 100
    : 0;

  const lowStockCount = state.products.filter((p) => p.stockStatus === "low" || p.stockStatus === "critical").length;
  const outStockCount = state.products.filter((p) => p.stockStatus === "out").length;

  const atRiskCount = open.filter((o) => {
    const r = computeOrderRisk(o, state);
    return r.level === "high" || r.level === "critical";
  }).length;

  const busyPickers = state.pickers.filter((p) => p.status === "busy").length;
  const pickingEfficiency = state.pickers.length
    ? Math.min(100, Math.round((busyPickers / state.pickers.length) * 100) + (100 - Math.min(100, state.orders.filter((o) => o.status === "allocated").length * 8)))
    : 0;
  const pickingEfficiencySafe = Math.max(0, Math.min(100, pickingEfficiency));

  const packingUtilization = Math.round(
    (state.stations.reduce((a, s) => a + s.queue, 0) / Math.max(1, state.stations.length * 2)) * 100,
  );

  const delayedVehicles = state.vehicles.filter((v) => v.status === "delayed").length;
  const dispatchPerformance = Math.max(0, 100 - delayedVehicles * 25 - Math.max(0, open.filter((o) => o.status === "ready").length - 1) * 8);

  const exceptionsResolved = state.exceptions.filter((e) => e.status === "resolved").length;
  const exceptionsOpen = state.exceptions.filter((e) => e.status === "open").length;

  const appliedDecisions = state.decisions.filter((d) => d.status === "applied").length;
  const decisionImpact = Math.round(
    Math.max(0, 100 - atRiskCount * 12 - exceptionsOpen * 8) + appliedDecisions * 2,
  );

  return {
    fulfillmentRate,
    onTimeRate,
    avgFulfillmentMin,
    inventoryUtilization,
    lowStockCount,
    outStockCount,
    atRiskCount,
    pickingEfficiency: pickingEfficiencySafe,
    packingUtilization,
    dispatchPerformance,
    bottleneckCount: state.chaos.active ? state.chaos.disruptions.length : 0,
    exceptionsResolved,
    exceptionsOpen,
    decisionImpact,
    totalUnitsShipped: shippedUnits,
    totalUnitsAllocated: allocatedUnits,
    ordersDispatched: dispatched.length,
  };
}

/** Simple time-series for charts: last 60 minutes of operational load. */
export function computeTimeline(state: WarehouseState): Array<{
  minute: number;
  label: string;
  openOrders: number;
  picks: number;
  dispatched: number;
}> {
  const out: Array<{ minute: number; label: string; openOrders: number; picks: number; dispatched: number }> = [];
  const now = state.clock;
  for (let m = Math.max(0, now - 59); m <= now; m += 1) {
    const openOrders = state.orders.filter((o) => o.createdAt <= m && o.status !== "dispatched").length;
    const picks = state.orders.filter((o) => o.createdAt <= m && (o.status === "picking" || o.status === "packing" || o.status === "quality-check")).length;
    const dispatched = state.orders.filter((o) => o.createdAt <= m && o.status === "dispatched").length;
    out.push({
      minute: m,
      label: `${Math.floor((8 * 60 + m) / 60) % 24}:${String(Math.floor((8 * 60 + m) % 60)).padStart(2, "0")}`,
      openOrders,
      picks,
      dispatched,
    });
  }
  return out;
}
