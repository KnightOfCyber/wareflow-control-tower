import { describe, it, expect } from "vitest";
import type { Order, WarehouseState, Picker, PackStation, DispatchVehicle } from "@/types";
import { detectBottlenecks } from "@/lib/decision-engine/bottleneck-engine";
import { buildRecoveryPlan, applyRecoveryStep } from "@/lib/decision-engine/recovery-engine";

describe("Bottleneck Engine", () => {
  const createTestState = (): WarehouseState => ({
    version: 1,
    clock: 60,
    orders: [],
    products: [],
    pickers: [],
    stations: [],
    vehicles: [],
    exceptions: [],
    decisions: [],
    chaos: { active: false, disruptions: [], recoveryPlan: undefined },
    events: [],
    nextEventId: 1,
    nextDecisionNum: 0,
    nextExceptionNum: 0,
    nextOrderNum: 0,
    sim: null,
  });

  it("should detect stalled picking when picker is unavailable", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 0, packed: 0 }],
      status: "picking",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
      pickerId: "P-001",
    };

    const picker: Picker = {
      id: "P-001",
      name: "Alice",
      zone: "ZA",
      status: "unavailable",
      workload: 1,
      capacity: 5,
      unitsPerHour: 120,
    };

    const state = createTestState();
    state.orders = [order];
    state.pickers = [picker];

    const bottlenecks = detectBottlenecks(state);

    const stalledPickingBottleneck = bottlenecks.find(
      (b) => b.stage === "picking" && b.title.includes("stalled")
    );
    expect(stalledPickingBottleneck).toBeDefined();
    expect(stalledPickingBottleneck?.severity).toBe("high");
  });

  it("should detect packing backlog when queue exceeds threshold", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 10, packed: 0 }],
      status: "packing",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
      stationId: "ST-001",
    };

    const station: PackStation = {
      id: "ST-001",
      name: "Station 1",
      status: "packing",
      queue: 5, // High queue
      throughputPerHour: 20,
    };

    const state = createTestState();
    state.orders = [order];
    state.stations = [station];

    const bottlenecks = detectBottlenecks(state);

    const packingBottleneck = bottlenecks.find((b) => b.stage === "packing");
    expect(packingBottleneck).toBeDefined();
    expect(packingBottleneck?.severity).toMatch(/high|medium/);
  });

  it("should detect dispatch lane delays", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 10, packed: 10 }],
      status: "ready",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
      vehicleId: "V-001",
    };

    const vehicle: DispatchVehicle = {
      id: "V-001",
      name: "Truck-A",
      route: "Route-1",
      status: "delayed",
      capacity: 50,
      assigned: 10,
    };

    const state = createTestState();
    state.orders = [order];
    state.vehicles = [vehicle];

    const bottlenecks = detectBottlenecks(state);

    const dispatchBottleneck = bottlenecks.find(
      (b) => b.stage === "dispatch" && b.title.includes("delayed")
    );
    expect(dispatchBottleneck).toBeDefined();
    expect(dispatchBottleneck?.severity).toBe("high");
  });

  it("should detect replenishment backlog for critical/out-of-stock SKUs", () => {
    const state = createTestState();
    state.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 0,
        reserved: 0,
        damaged: 0,
        safetyStock: 10,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "out",
      },
      {
        sku: "SKU-105",
        name: "Gadget",
        category: "hardware",
        zone: "ZB",
        available: 2,
        reserved: 0,
        damaged: 0,
        safetyStock: 5,
        reorderThreshold: 15,
        unitCost: 8.0,
        stockStatus: "critical",
      },
    ];

    const bottlenecks = detectBottlenecks(state);

    const replenishmentBottleneck = bottlenecks.find((b) => b.stage === "replenishment");
    expect(replenishmentBottleneck).toBeDefined();
    expect(replenishmentBottleneck?.title).toMatch(/replenishment/i);
  });

  it("should return empty bottleneck list when pipeline is healthy", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "retail",
      basePriority: "medium",
      priority: "medium",
      score: 50,
      createdAt: 0,
      slaMinutes: 240,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 10, packed: 10 }],
      status: "ready",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.orders = [order];
    state.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 100,
        reserved: 0,
        damaged: 0,
        safetyStock: 10,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "healthy",
      },
    ];

    const bottlenecks = detectBottlenecks(state);

    expect(bottlenecks.length).toBe(0);
  });
});

describe("Recovery Engine", () => {
  const createTestState = (): WarehouseState => ({
    version: 1,
    clock: 60,
    orders: [],
    products: [],
    pickers: [],
    stations: [],
    vehicles: [],
    exceptions: [],
    decisions: [],
    chaos: { active: false, disruptions: [], recoveryPlan: undefined },
    events: [],
    nextEventId: 1,
    nextDecisionNum: 0,
    nextExceptionNum: 0,
    nextOrderNum: 0,
    sim: null,
  });

  it("should build recovery plan with multiple steps for active disruptions", () => {
    const state = createTestState();
    state.chaos.disruptions = [
      {
        id: "D-001",
        kind: "picker-out",
        title: "Picker Unavailable",
        detail: "Picker P-001 is unavailable in Zone A",
        detectedAt: 60,
        affectedOrders: ["1042"],
        affectedSkus: ["SKU-104"],
      },
    ];

    state.orders = [
      {
        id: "1042",
        customer: "TechCorp",
        customerTier: "enterprise",
        basePriority: "critical",
        priority: "critical",
        score: 95,
        createdAt: 0,
        slaMinutes: 120,
        items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 0, packed: 0 }],
        status: "picking",
        zone: "ZA",
        risk: "critical",
        riskScore: 89,
        pickerId: "P-001",
      },
    ];

    state.pickers = [
      { id: "P-001", name: "Alice", zone: "ZA", status: "unavailable", workload: 1, capacity: 5, unitsPerHour: 120 },
      { id: "P-002", name: "Bob", zone: "ZA", status: "available", workload: 0, capacity: 5, unitsPerHour: 120 },
    ];

    const plan = buildRecoveryPlan(state);

    expect(plan).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]).toHaveProperty("type");
    expect(plan.steps[0]).toHaveProperty("title");
    expect(plan.steps[0]).toHaveProperty("detail");
  });

  it("should predict risk improvement from recovery plan", () => {
    const state = createTestState();
    state.chaos.disruptions = [
      {
        id: "D-001",
        kind: "truck-delay",
        title: "Truck Delayed",
        detail: "Truck V-001 is delayed",
        detectedAt: 60,
        affectedOrders: ["1042"],
        affectedSkus: [],
      },
    ];

    state.orders = [
      {
        id: "1042",
        customer: "TechCorp",
        customerTier: "enterprise",
        basePriority: "critical",
        priority: "critical",
        score: 95,
        createdAt: 0,
        slaMinutes: 120,
        items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 10, packed: 10 }],
        status: "ready",
        zone: "ZA",
        risk: "critical",
        riskScore: 89,
        vehicleId: "V-001",
      },
    ];

    state.vehicles = [
      { id: "V-001", name: "Truck-A", route: "Route-1", status: "delayed", capacity: 50, assigned: 10 },
      { id: "V-002", name: "Truck-B", route: "Route-2", status: "ready", capacity: 50, assigned: 5 },
    ];

    const plan = buildRecoveryPlan(state);

    expect(plan).toBeDefined();
    expect(plan.riskBefore).toBeGreaterThan(0);
    expect(plan.riskAfter).toBeLessThanOrEqual(plan.riskBefore);
  });

  it("should apply recovery step to mutate state correctly", () => {
    const stateBefore = createTestState();
    stateBefore.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 10,
        reserved: 0,
        damaged: 0,
        safetyStock: 5,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "healthy",
      },
    ];

    const step = {
      id: "RS-001",
      type: "replenish" as const,
      title: "Replenish SKU-104",
      detail: "Replenish 15 units",
      payload: { sku: "SKU-104", qty: 15 },
    };

    applyRecoveryStep(stateBefore, step);

    const product = stateBefore.products.find((p) => p.sku === "SKU-104");
    expect(product?.available).toBe(25); // 10 + 15
  });

  it("should return prediction of orders at risk before and after recovery", () => {
    const state = createTestState();
    state.chaos.disruptions = [
      {
        id: "D-001",
        kind: "picker-out",
        title: "Picker Unavailable",
        detail: "Picker is out",
        detectedAt: 60,
        affectedOrders: ["1042"],
        affectedSkus: [],
      },
    ];

    state.orders = [
      {
        id: "1042",
        customer: "TechCorp",
        customerTier: "enterprise",
        basePriority: "critical",
        priority: "critical",
        score: 95,
        createdAt: 0,
        slaMinutes: 120,
        items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 10, picked: 0, packed: 0 }],
        status: "picking",
        zone: "ZA",
        risk: "critical",
        riskScore: 89,
      },
    ];

    const plan = buildRecoveryPlan(state);

    expect(plan.riskBefore).toBeGreaterThanOrEqual(0);
    expect(plan.riskAfter).toBeGreaterThanOrEqual(0);
    expect(plan.predictedImprovement).toBeDefined();
    expect(Array.isArray(plan.predictedImprovement)).toBe(true);
  });
});
