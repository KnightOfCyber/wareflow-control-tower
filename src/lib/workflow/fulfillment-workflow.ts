import type { ExceptionRecord, WarehouseState } from "@/types";
import { createExceptionRecord } from "./exception-workflow";

/**
 * FULFILLMENT WORKFLOW
 * Order Created → Prioritized → Allocated → Picking → Packing →
 * Quality Check → Ready for Dispatch → Dispatched.
 * Every transition mutates the passed state (callers pass a draft clone).
 */

export function startPicking(state: WarehouseState, orderId: string, pickerId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  const picker = state.pickers.find((p) => p.id === pickerId);
  if (!order || !picker) return false;
  if (order.status !== "allocated" && order.status !== "prioritized" && order.status !== "created") return false;
  if (picker.status === "unavailable") return false;

  const prev = state.pickers.find((p) => p.id === order.pickerId);
  if (prev && prev.id !== picker.id) prev.status = "available";

  order.pickerId = picker.id;
  picker.status = "busy";
  picker.workload = Math.max(0, picker.workload - 1);
  order.status = "picking";
  return true;
}

export function completePicking(state: WarehouseState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "picking") return false;
  for (const item of order.items) item.picked = item.allocated;

  const picker = order.pickerId ? state.pickers.find((p) => p.id === order.pickerId) : undefined;
  if (picker) picker.status = "available";

  // Auto-assign the least-loaded packing station.
  const station = [...state.stations].sort((a, b) => a.queue - b.queue)[0];
  order.stationId = station.id;
  station.queue += 1;
  station.status = "packing";
  order.status = "packing";
  return true;
}

export function startPacking(state: WarehouseState, orderId: string, stationId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  const station = state.stations.find((s) => s.id === stationId);
  if (!order || !station || order.status !== "packing") return false;
  if (order.stationId && order.stationId !== stationId) {
    const prev = state.stations.find((s) => s.id === order.stationId);
    if (prev) prev.queue = Math.max(0, prev.queue - 1);
  }
  order.stationId = station.id;
  station.queue += 1;
  station.status = "packing";
  return true;
}

export function completePacking(state: WarehouseState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "packing") return false;
  for (const item of order.items) item.packed = item.allocated;
  const station = order.stationId ? state.stations.find((s) => s.id === order.stationId) : undefined;
  if (station) station.queue = Math.max(0, station.queue - 1);
  order.status = "quality-check";
  return true;
}

export function passQc(state: WarehouseState, orderId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "quality-check") return false;
  order.qcFailed = false;
  order.status = "ready";
  return true;
}

export function failQc(
  state: WarehouseState,
  orderId: string,
  reason: string,
): ExceptionRecord | null {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "quality-check") return null;
  order.qcFailed = true;
  order.status = "exception";
  const ex = createExceptionRecord(
    state,
    "qc-failure",
    orderId,
    undefined,
    `QC failed on order #${orderId}: ${reason}`,
    "medium",
  );
  state.exceptions.unshift(ex);
  state.nextExceptionNum += 1;
  order.exceptionId = ex.id;
  return ex;
}

export function dispatchOrder(state: WarehouseState, orderId: string, vehicleId: string): boolean {
  const order = state.orders.find((o) => o.id === orderId);
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  if (!order || !vehicle) return false;
  if (order.status !== "ready" && order.status !== "exception") return false;
  if (vehicle.status === "delayed") return false;

  const prev = order.vehicleId ? state.vehicles.find((v) => v.id === order.vehicleId) : undefined;
  if (prev && prev.id !== vehicle.id) prev.assigned = Math.max(0, prev.assigned - 1);

  order.vehicleId = vehicle.id;
  vehicle.assigned += 1;
  vehicle.status = "enroute";
  order.status = "dispatched";

  // Inventory leaves the building: reserved → consumed.
  for (const item of order.items) {
    const p = state.products.find((x) => x.sku === item.sku);
    if (p) p.reserved = Math.max(0, p.reserved - item.allocated);
  }
  return true;
}
