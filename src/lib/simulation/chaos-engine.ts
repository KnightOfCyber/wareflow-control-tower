import type { Disruption, DisruptionKind, Order, WarehouseState } from "@/types";
import { createExceptionRecord } from "@/lib/workflow/exception-workflow";

/**
 * CHAOS MODE
 * Injects coordinated disruptions into the live warehouse state, detects
 * everything they affect, and hands off to the recovery engine.
 */

let disSeq = 0;

function newDisruption(
  kind: DisruptionKind,
  title: string,
  detail: string,
  affectedOrders: string[],
  affectedSkus: string[],
  clock: number,
): Disruption {
  disSeq += 1;
  return { id: `DIS-${disSeq}`, kind, title, detail, detectedAt: clock, affectedOrders, affectedSkus };
}

function pushEvent(state: WarehouseState, severity: "info" | "warning" | "critical" | "decision", message: string) {
  state.events.unshift({ id: `EV-${state.nextEventId}`, time: state.clock, severity, message });
  state.nextEventId += 1;
  state.events = state.events.slice(0, 60);
}

/** Mutates the passed state (callers pass a fresh clone). */
export function triggerDisruption(state: WarehouseState, kind: DisruptionKind): void {
  if (!state.chaos.active) {
    state.chaos = { ...state.chaos, active: true, disruptions: [] };
  }

  switch (kind) {
    case "picker-out": {
      const order = state.orders.find((o) => o.status === "picking" && o.pickerId === "P-02");
      const picker = state.pickers.find((p) => p.id === "P-02");
      if (order && picker) {
        picker.status = "unavailable";
        state.chaos.disruptions.push(
          newDisruption(
            "picker-out",
            "Picker P-02 unavailable",
            "M. Reyes reported unavailable mid-shift — order #1065 pick is stalled.",
            [order.id],
            [],
            state.clock,
          ),
        );
        const ex = createExceptionRecord(state, "picker-unavailable", order.id, undefined, `Picker P-02 unavailable — order #${order.id} stalled.`, "high");
        state.exceptions.unshift(ex);
        order.exceptionId = ex.id;
        state.nextExceptionNum += 1;
        pushEvent(state, "critical", `DISRUPTION: Picker P-02 unavailable — order #${order.id} stalled`);
      }
      break;
    }

    case "damage-stock": {
      const product = state.products.find((p) => p.sku === "SKU-106");
      const order = state.orders.find((o) => o.id === "1065");
      if (product && order) {
        product.damaged += 5;
        state.chaos.disruptions.push(
          newDisruption(
            "damage-stock",
            "Stock damage detected — SKU-106",
            "5 units of SKU-106 (LED Work Light 24W) damaged in Zone A — affects the pick for order #1065.",
            [order.id],
            [product.sku],
            state.clock,
          ),
        );
        const ex = createExceptionRecord(state, "damaged", order.id, product.sku, `5 units of ${product.sku} damaged — order #${order.id} affected.`, "high");
        state.exceptions.unshift(ex);
        order.exceptionId = ex.id;
        state.nextExceptionNum += 1;
        pushEvent(state, "warning", `DISRUPTION: ${product.damaged} units of ${product.sku} damaged — QC impact`);
      }
      break;
    }

    case "truck-delay": {
      const truck = state.vehicles.find((v) => v.id === "TRK-2");
      const order = state.orders.find((o) => o.id === "1071");
      if (truck) {
        truck.status = "delayed";
        state.chaos.disruptions.push(
          newDisruption(
            "truck-delay",
            "Dispatch lane delayed — TRK-2",
            "TRK-2 (R2 South) mechanical delay extended by 45 minutes.",
            order && order.status !== "dispatched" ? [order.id] : [],
            [],
            state.clock,
          ),
        );
        if (order && order.status !== "dispatched") {
          const ex = createExceptionRecord(state, "dispatch-delay", order.id, undefined, `TRK-2 delay extended — order #${order.id} dispatch at risk.`, "critical");
          if (order.exceptionId) {
            const existing = state.exceptions.find((e) => e.id === order.exceptionId);
            if (existing) existing.detail = `TRK-2 delay extended to 75m — order #${order.id} dispatch at risk.`;
          } else {
            state.exceptions.unshift(ex);
            order.exceptionId = ex.id;
            state.nextExceptionNum += 1;
          }
        }
        pushEvent(state, "critical", `DISRUPTION: ${truck.name} delayed 45m — dispatch lane blocked`);
      }
      break;
    }

    case "order-surge": {
      const now = state.clock;
      const surge: Order[] = [
        surgeOrder(state, "Nova Health Systems", "enterprise", "high", 70, now, [["SKU-104", 2]]),
        surgeOrder(state, "Metro Retail Co", "retail", "high", 90, now, [["SKU-112", 4], ["SKU-121", 6]]),
        surgeOrder(state, "Vertex Components", "enterprise", "critical", 55, now, [["SKU-106", 4]]),
      ];
      state.orders.push(...surge);
      state.chaos.disruptions.push(
        newDisruption(
          "order-surge",
          "Order surge — 3 urgent orders",
          "Three urgent orders arrived simultaneously (SKU-104, SKU-112, SKU-121, SKU-106).",
          surge.map((o) => o.id),
          ["SKU-104", "SKU-112", "SKU-121", "SKU-106"],
          now,
        ),
      );
      pushEvent(state, "warning", `DISRUPTION: order surge — ${surge.map((o) => `#${o.id}`).join(", ")} received`);
      break;
    }
  }
}

function surgeOrder(
  state: WarehouseState,
  customer: string,
  tier: Order["customerTier"],
  base: Order["basePriority"],
  sla: number,
  now: number,
  lines: Array<[string, number]>,
): Order {
  const id = String(state.nextOrderNum);
  state.nextOrderNum += 1;
  const zone = state.products.find((p) => p.sku === lines[0][0])?.zone ?? "ZA";
  return {
    id,
    customer,
    customerTier: tier,
    basePriority: base,
    priority: base,
    score: 0,
    createdAt: now,
    slaMinutes: sla,
    items: lines.map(([sku, qty]) => {
      const p = state.products.find((x) => x.sku === sku);
      return { sku, name: p?.name ?? sku, qty, allocated: 0, picked: 0, packed: 0 };
    }),
    status: "created",
    zone,
    risk: "low",
    riskScore: 0,
  };
}

/** Run the full multi-disruption scenario in one shot. */
export function triggerFullChaos(state: WarehouseState): void {
  triggerDisruption(state, "picker-out");
  triggerDisruption(state, "damage-stock");
  triggerDisruption(state, "order-surge");
  triggerDisruption(state, "truck-delay");
}
