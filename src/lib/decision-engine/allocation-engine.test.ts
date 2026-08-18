import { describe, it, expect } from "vitest";
import type { Order, Product, WarehouseState } from "@/types";
import { getAllocationConflict, findActiveConflicts } from "@/lib/decision-engine/allocation-engine";

describe("Allocation Engine", () => {
  const createTestState = (orders: Order[], products: Product[]): WarehouseState => ({
    version: 1,
    clock: 60,
    orders,
    products,
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

  it("should detect allocation conflict when order needs more stock than available", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
    };

    const product: Product = {
      sku: "SKU-104",
      name: "Widget",
      category: "electronics",
      zone: "ZA",
      available: 7,
      reserved: 3,
      damaged: 0,
      safetyStock: 5,
      reorderThreshold: 20,
      unitCost: 12.5,
      stockStatus: "critical",
    };

    const state = createTestState([order], [product]);
    const conflict = getAllocationConflict(state, "1042", "SKU-104");

    expect(conflict).toBeDefined();
    expect(conflict?.orderId).toBe("1042");
    expect(conflict?.sku).toBe("SKU-104");
    expect(conflict?.requiredQty).toBe(10);
    expect(conflict?.availableQty).toBe(7);
    expect(conflict?.shortfall).toBe(3);
  });

  it("should generate multiple allocation scenarios", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
    };

    const competingOrder: Order = {
      id: "1055",
      customer: "RetailCo",
      customerTier: "retail",
      basePriority: "low",
      priority: "low",
      score: 25,
      createdAt: 10,
      slaMinutes: 240,
      items: [{ sku: "SKU-104", name: "Widget", qty: 5, allocated: 5, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const product: Product = {
      sku: "SKU-104",
      name: "Widget",
      category: "electronics",
      zone: "ZA",
      available: 7,
      reserved: 5,
      damaged: 0,
      safetyStock: 5,
      reorderThreshold: 20,
      unitCost: 12.5,
      stockStatus: "critical",
    };

    const state = createTestState([order, competingOrder], [product]);
    const conflict = getAllocationConflict(state, "1042", "SKU-104");

    expect(conflict).toBeDefined();
    expect(conflict?.options.length).toBeGreaterThanOrEqual(3); // Should have A, B, C scenarios
    expect(conflict?.options[0]).toHaveProperty("id");
    expect(conflict?.options[0]).toHaveProperty("label");
    expect(conflict?.options[0]).toHaveProperty("fulfillmentAfter");
    expect(conflict?.options[0]).toHaveProperty("riskScore");
  });

  it("should score scenarios based on SLA risk, fulfillment, delay, and movement", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
    };

    const product: Product = {
      sku: "SKU-104",
      name: "Widget",
      category: "electronics",
      zone: "ZA",
      available: 7,
      reserved: 0,
      damaged: 0,
      safetyStock: 5,
      reorderThreshold: 20,
      unitCost: 12.5,
      stockStatus: "critical",
    };

    const state = createTestState([order], [product]);
    const conflict = getAllocationConflict(state, "1042", "SKU-104");

    expect(conflict?.options).toBeDefined();
    const optionsWithScores = conflict?.options || [];
    
    // Verify all scenarios have risk scores
    optionsWithScores.forEach((opt) => {
      expect(opt.riskScore).toBeGreaterThanOrEqual(0);
      expect(opt.riskScore).toBeLessThanOrEqual(100);
      expect(typeof opt.fulfillmentAfter).toBe("number");
      expect(typeof opt.expectedDelayMin).toBe("number");
    });

    // Recommended option should have lowest risk score
    const recommended = optionsWithScores.find((o) => o.id === conflict?.recommendedOptionId);
    expect(recommended).toBeDefined();
    const hasLowerRisk = optionsWithScores.some((o) => o.riskScore < (recommended?.riskScore || 999));
    expect(hasLowerRisk).toBeFalsy();
  });

  it("should generate proactive scenarios even when sufficient stock available", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const product: Product = {
      sku: "SKU-104",
      name: "Widget",
      category: "electronics",
      zone: "ZA",
      available: 20,
      reserved: 0,
      damaged: 0,
      safetyStock: 5,
      reorderThreshold: 20,
      unitCost: 12.5,
      stockStatus: "healthy",
    };

    const state = createTestState([order], [product]);
    const conflict = getAllocationConflict(state, "1042", "SKU-104");

    // Engine generates scenarios proactively (for forward planning)
    expect(conflict).toBeDefined();
    expect(conflict?.options.length).toBeGreaterThanOrEqual(3);
    expect(conflict?.shortfall).toBe(0);
  });

  it("should find active allocation conflicts in warehouse state", () => {
    const order1: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
    };

    const order2: Order = {
      id: "1043",
      customer: "RetailCo",
      customerTier: "retail",
      basePriority: "medium",
      priority: "medium",
      score: 50,
      createdAt: 5,
      slaMinutes: 180,
      items: [{ sku: "SKU-105", name: "Gadget", qty: 8, allocated: 0, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZB",
      risk: "medium",
      riskScore: 45,
    };

    const product1: Product = {
      sku: "SKU-104",
      name: "Widget",
      category: "electronics",
      zone: "ZA",
      available: 5,
      reserved: 0,
      damaged: 0,
      safetyStock: 5,
      reorderThreshold: 20,
      unitCost: 12.5,
      stockStatus: "critical",
    };

    const product2: Product = {
      sku: "SKU-105",
      name: "Gadget",
      category: "hardware",
      zone: "ZB",
      available: 20,
      reserved: 0,
      damaged: 0,
      safetyStock: 5,
      reorderThreshold: 20,
      unitCost: 8.0,
      stockStatus: "healthy",
    };

    const state = createTestState([order1, order2], [product1, product2]);
    const conflicts = findActiveConflicts(state);

    // Should find conflict for order1/SKU-104 but not order2 (has enough stock)
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.orderId === "1042" && c.sku === "SKU-104")).toBe(true);
  });
});
