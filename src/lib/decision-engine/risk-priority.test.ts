import { describe, it, expect } from "vitest";
import type { Order, WarehouseState } from "@/types";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";
import { computePriority, remainingSla, priorityLevelOf } from "@/lib/decision-engine/priority-engine";

describe("Risk Engine", () => {
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

  it("should mark order as HIGH/CRITICAL risk when SLA is about to expire", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 60,
      items: [],
      status: "picking",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.clock = 58; // 58 minutes in, 2 minutes left
    const risk = computeOrderRisk(order, state);

    expect(["high", "critical"]).toContain(risk.level);
    expect(risk.score).toBeGreaterThanOrEqual(60);
  });

  it("should mark order as MEDIUM+ risk when unallocated items exist", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "high",
      priority: "high",
      score: 80,
      createdAt: 10,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 5, picked: 0, packed: 0 }],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.clock = 50;
    const risk = computeOrderRisk(order, state);

    // Unallocated items increase risk
    expect(["medium", "high", "critical"]).toContain(risk.level);
    expect(risk.score).toBeGreaterThan(30);
  });

  it("should lower risk for fully allocated, picked, and packed orders", () => {
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
    state.clock = 30;
    const risk = computeOrderRisk(order, state);

    // Fully satisfied orders should be low/medium risk
    expect(["low", "medium"]).toContain(risk.level);
    expect(risk.score).toBeLessThan(50);
  });

  it("should mark order as exception/stalled risk when in exception status", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 120,
      items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 5, picked: 0, packed: 0 }],
      status: "exception",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
      exceptionId: "EX-001",
    };

    const state = createTestState();
    state.clock = 50;
    const risk = computeOrderRisk(order, state);

    expect(risk.reason).toMatch(/exception|stalled/i);
    expect(risk.level).toMatch(/high|critical/);
  });

  it("should provide risk explanation and predicted issue", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 0,
      slaMinutes: 60,
      items: [],
      status: "picking",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.clock = 50;
    const risk = computeOrderRisk(order, state);

    expect(risk.reason).toBeDefined();
    expect(risk.predictedIssue).toBeDefined();
    expect(risk.reason.length).toBeGreaterThan(0);
    expect(risk.predictedIssue.length).toBeGreaterThan(0);
  });
});

describe("Priority Engine", () => {
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

  it("should compute remaining SLA correctly", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 30,
      slaMinutes: 120,
      items: [],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const clock = 50;
    const remaining = remainingSla(order, clock);

    expect(remaining).toBe(100); // 120 - (50 - 30) = 100
  });

  it("should mark order as CRITICAL priority when SLA is tight", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "high",
      priority: "high",
      score: 70,
      createdAt: 0,
      slaMinutes: 60,
      items: [],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.clock = 50; // 10 minutes left
    const priority = computePriority(order, state);

    expect(priority.level).toBe("critical");
    expect(priority.score).toBeGreaterThanOrEqual(78);
  });

  it("should boost enterprise customer tier priority", () => {
    const enterpriseOrder: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "high",
      priority: "high",
      score: 70,
      createdAt: 30,
      slaMinutes: 180,
      items: [],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const retailOrder: Order = {
      id: "1043",
      customer: "RetailCo",
      customerTier: "retail",
      basePriority: "high",
      priority: "high",
      score: 70,
      createdAt: 30,
      slaMinutes: 180,
      items: [],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.clock = 50;

    const enterprisePriority = computePriority(enterpriseOrder, state);
    const retailPriority = computePriority(retailOrder, state);

    // Enterprise should score higher
    expect(enterprisePriority.score).toBeGreaterThan(retailPriority.score);
  });

  it("should scale urgency from 0 to 100 based on remaining SLA", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "retail",
      basePriority: "medium",
      priority: "medium",
      score: 50,
      createdAt: 0,
      slaMinutes: 360,
      items: [],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();

    // Test urgency at different time points
    state.clock = 0; // Just created
    let priority = computePriority(order, state);
    const earlyScore = priority.score;

    state.clock = 355; // 5 minutes left
    priority = computePriority(order, state);
    const lateScore = priority.score;

    expect(lateScore).toBeGreaterThan(earlyScore);
  });

  it("should convert score to priority level correctly", () => {
    expect(priorityLevelOf(90)).toBe("critical");
    expect(priorityLevelOf(70)).toBe("high");
    expect(priorityLevelOf(50)).toBe("medium");
    expect(priorityLevelOf(25)).toBe("low");
  });

  it("should provide explanation for priority calculation", () => {
    const order: Order = {
      id: "1042",
      customer: "TechCorp",
      customerTier: "enterprise",
      basePriority: "critical",
      priority: "critical",
      score: 95,
      createdAt: 30,
      slaMinutes: 120,
      items: [],
      status: "allocated",
      zone: "ZA",
      risk: "low",
      riskScore: 10,
    };

    const state = createTestState();
    state.clock = 50;
    const priority = computePriority(order, state);

    expect(priority.explanation).toBeDefined();
    expect(Array.isArray(priority.explanation)).toBe(true);
    expect(priority.explanation.length).toBeGreaterThan(0);
    // Should include reasoning about SLA, tier, and other factors
    expect(priority.explanation.some((e) => e.includes("SLA") || e.includes("urgency"))).toBe(true);
  });
});
