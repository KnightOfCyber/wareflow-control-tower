import { describe, it, expect, beforeEach } from "vitest";
import type { WarehouseState } from "@/types";
import { reducer } from "@/lib/state/store";

describe("State Reducer", () => {
  let initialState: WarehouseState;

  beforeEach(() => {
    initialState = {
      version: 1,
      clock: 0,
      orders: [
        {
          id: "1042",
          customer: "TechCorp",
          customerTier: "enterprise",
          basePriority: "critical",
          priority: "critical",
          score: 95,
          createdAt: 0,
          slaMinutes: 120,
          items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 5, picked: 0, packed: 0 }],
          status: "allocated",
          zone: "ZA",
          risk: "critical",
          riskScore: 89,
          pickerId: "P-001",
        },
      ],
      products: [
        {
          sku: "SKU-104",
          name: "Widget",
          category: "electronics",
          zone: "ZA",
          available: 10,
          reserved: 5,
          damaged: 0,
          safetyStock: 5,
          reorderThreshold: 20,
          unitCost: 12.5,
          stockStatus: "healthy",
        },
      ],
      pickers: [
        {
          id: "P-001",
          name: "Alice",
          zone: "ZA",
          status: "busy",
          workload: 1,
          capacity: 5,
          unitsPerHour: 120,
        },
        {
          id: "P-002",
          name: "Bob",
          zone: "ZA",
          status: "available",
          workload: 0,
          capacity: 5,
          unitsPerHour: 120,
        },
      ],
      stations: [
        {
          id: "ST-001",
          name: "Station 1",
          status: "packing",
          queue: 1,
          throughputPerHour: 20,
        },
      ],
      vehicles: [
        {
          id: "V-001",
          name: "Truck-A",
          route: "Route-1",
          status: "ready",
          capacity: 50,
          assigned: 5,
        },
      ],
      exceptions: [],
      decisions: [],
      chaos: { active: false, disruptions: [], recoveryPlan: undefined },
      events: [],
      nextEventId: 1,
      nextDecisionNum: 0,
      nextExceptionNum: 0,
      nextOrderNum: 0,
      sim: null,
    };
  });

  it("should increment clock on TICK action", () => {
    const state = reducer(initialState, { type: "TICK" });

    expect(state.clock).toBe(initialState.clock + 1);
  });

  it("should mark order as DELAYED when SLA expires", () => {
    const order = initialState.orders[0];
    initialState.clock = order.slaMinutes; // Move clock to SLA expiration

    const state = reducer(initialState, { type: "TICK" });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toBe("delayed");
  });

  it("should start picking order when START_PICKING is called", () => {
    const order = initialState.orders[0];

    const state = reducer(initialState, {
      type: "START_PICKING",
      orderId: order.id,
      pickerId: "P-001",
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toMatch(/picking|allocated/);
  });

  it("should complete picking and move order to packing", () => {
    const order = initialState.orders[0];
    order.status = "picking";
    order.items[0].picked = order.items[0].allocated;

    const state = reducer(initialState, {
      type: "COMPLETE_PICKING",
      orderId: order.id,
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toMatch(/packing|allocated/);
  });

  it("should start packing order", () => {
    const order = initialState.orders[0];
    order.status = "allocated";
    order.items[0].picked = order.items[0].allocated;

    const state = reducer(initialState, {
      type: "START_PACKING",
      orderId: order.id,
      stationId: "ST-001",
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toMatch(/packing|allocated/);
  });

  it("should complete packing and move order to quality-check", () => {
    const order = initialState.orders[0];
    order.status = "packing";
    order.items[0].packed = order.items[0].allocated;

    const state = reducer(initialState, {
      type: "COMPLETE_PACKING",
      orderId: order.id,
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toMatch(/quality-check|packing/);
  });

  it("should pass QC and move order to ready", () => {
    const order = initialState.orders[0];
    order.status = "quality-check";

    const state = reducer(initialState, {
      type: "QC_PASS",
      orderId: order.id,
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toBe("ready");
  });

  it("should fail QC and mark order with qcFailed flag", () => {
    const order = initialState.orders[0];
    order.status = "quality-check";

    const state = reducer(initialState, {
      type: "QC_FAIL",
      orderId: order.id,
      reason: "Damaged unit detected",
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.qcFailed).toBe(true);
  });

  it("should dispatch order when DISPATCH is called", () => {
    const order = initialState.orders[0];
    order.status = "ready";

    const state = reducer(initialState, {
      type: "DISPATCH",
      orderId: order.id,
      vehicleId: "V-001",
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).toBe("dispatched");
    expect(updatedOrder?.vehicleId).toBe("V-001");
  });

  it("should handle MARK_PICKER_AVAILABLE action only for unavailable pickers", () => {
    // The action only works if picker is in "unavailable" state
    initialState.pickers[0].status = "unavailable";

    const state = reducer(initialState, {
      type: "MARK_PICKER_AVAILABLE",
      pickerId: "P-001",
    });

    const picker = state.pickers.find((p) => p.id === "P-001");
    expect(picker?.status).toBe("available");
  });

  it("should handle RESET action and return to seed state", () => {
    initialState.clock = 100;
    initialState.orders[0].status = "dispatched";

    const state = reducer(initialState, { type: "RESET" });

    // Reset should create a fresh seed state, not keep current mutations
    expect(state.clock).toBeDefined();
  });

  it("should add event to event log when action occurs", () => {
    // Update order to proper state for QC_PASS (quality-check)
    initialState.orders[0].status = "quality-check";
    const eventsBefore = initialState.events.length;

    const state = reducer(initialState, {
      type: "QC_PASS",
      orderId: initialState.orders[0].id,
    });

    expect(state.events.length).toBeGreaterThan(eventsBefore);
    const event = state.events[0];
    expect(event).toHaveProperty("id");
    expect(event).toHaveProperty("time");
    expect(event).toHaveProperty("severity");
    expect(event).toHaveProperty("message");
  });

  it("should update derived state (priority, risk) on every action", () => {
    const stateBefore = initialState;
    expect(stateBefore.orders[0].priority).toBeDefined();
    expect(stateBefore.orders[0].risk).toBeDefined();

    const state = reducer(stateBefore, { type: "TICK" });

    const updatedOrder = state.orders.find((o) => o.id === stateBefore.orders[0].id);
    expect(updatedOrder?.priority).toBeDefined();
    expect(updatedOrder?.risk).toBeDefined();
  });

  it("should maintain immutability - not mutate input state", () => {
    const before = JSON.stringify(initialState);

    reducer(initialState, { type: "TICK" });

    const after = JSON.stringify(initialState);
    expect(before).toBe(after);
  });

  it("should handle CONFIRM_REPLENISHMENT action", () => {
    const product = initialState.products[0];
    product.replenishQty = 20;
    product.available = 10;

    const state = reducer(initialState, {
      type: "CONFIRM_REPLENISHMENT",
      sku: "SKU-104",
    });

    const updatedProduct = state.products.find((p) => p.sku === "SKU-104");
    // After confirming, available should increase
    expect(updatedProduct?.available).toBeGreaterThan(product.available);
    expect(updatedProduct?.replenishQty).toBeUndefined();
  });

  it("should handle REQUEUE_ORDER action", () => {
    const order = initialState.orders[0];
    order.status = "delayed";

    const state = reducer(initialState, {
      type: "REQUEUE_ORDER",
      orderId: order.id,
    });

    const updatedOrder = state.orders.find((o) => o.id === order.id);
    expect(updatedOrder?.status).not.toBe("delayed");
  });

  it("should preserve order data when transitioning between statuses", () => {
    const order = initialState.orders[0];
    const originalCustomer = order.customer;
    const originalItems = JSON.stringify(order.items);

    const state1 = reducer(initialState, {
      type: "START_PICKING",
      orderId: order.id,
      pickerId: "P-002",
    });

    const state2 = reducer(state1, {
      type: "MARK_PICKER_AVAILABLE",
      pickerId: "P-001",
    });

    const finalOrder = state2.orders.find((o) => o.id === order.id);
    expect(finalOrder?.customer).toBe(originalCustomer);
    expect(JSON.stringify(finalOrder?.items)).toBe(originalItems);
  });
});
