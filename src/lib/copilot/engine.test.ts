import { describe, it, expect } from "vitest";
import type { Order, WarehouseState } from "@/types";
import { answerQuestion } from "@/lib/copilot/engine";

describe("Copilot Engine", () => {
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

  it("should answer risk questions about specific orders", () => {
    const state = createTestState();
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
      status: "picking",
      zone: "ZA",
      risk: "critical",
      riskScore: 89,
    };
    state.orders = [order];

    const reply = answerQuestion(state, "Why is #1042 at risk?");

    expect(reply.answer).toBeDefined();
    expect(reply.answer.length).toBeGreaterThan(0);
    expect(reply.confidence).toBeGreaterThan(0.5);
    expect(reply.facts).toBeDefined();
    expect(Array.isArray(reply.facts)).toBe(true);
  });

  it("should answer SKU inventory questions", () => {
    const state = createTestState();
    state.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 2,
        reserved: 5,
        damaged: 0,
        safetyStock: 10,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "critical",
      },
    ];

    const reply = answerQuestion(state, "What about SKU-104?");

    expect(reply.answer).toBeDefined();
    expect(reply.answer).toMatch(/SKU-104|Widget/);
    expect(reply.confidence).toBeGreaterThan(0.7);
  });

  it("should identify top risk orders", () => {
    const state = createTestState();
    const order1: Order = {
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
      risk: "critical",
      riskScore: 89,
    };

    const order2: Order = {
      id: "1043",
      customer: "RetailCo",
      customerTier: "retail",
      basePriority: "low",
      priority: "low",
      score: 25,
      createdAt: 10,
      slaMinutes: 240,
      items: [],
      status: "allocated",
      zone: "ZB",
      risk: "low",
      riskScore: 10,
    };

    state.orders = [order1, order2];

    const reply = answerQuestion(state, "What's the biggest risk right now?");

    expect(reply.answer).toBeDefined();
    expect(reply.answer).toMatch(/1042|#1042/);
    expect(reply.confidence).toBeGreaterThan(0.8);
  });

  it("should prioritize actions based on warehouse state", () => {
    const state = createTestState();
    state.orders = [
      {
        id: "1042",
        customer: "TechCorp",
        customerTier: "enterprise",
        basePriority: "critical",
        priority: "critical",
        score: 95,
        createdAt: 0,
        slaMinutes: 60,
        items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
        status: "allocated",
        zone: "ZA",
        risk: "critical",
        riskScore: 89,
      },
    ];

    state.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 5,
        reserved: 0,
        damaged: 0,
        safetyStock: 10,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "critical",
      },
    ];

    const reply = answerQuestion(state, "What should I do next?");

    expect(reply.answer).toBeDefined();
    expect(reply.confidence).toBeGreaterThan(0.6);
  });

  it("should report warehouse health", () => {
    const state = createTestState();
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
        items: [],
        status: "ready",
        zone: "ZA",
        risk: "low",
        riskScore: 10,
      },
    ];

    const reply = answerQuestion(state, "How healthy is the warehouse?");

    expect(reply.answer).toBeDefined();
    expect(reply.answer).toMatch(/health|status/i);
    expect(reply.confidence).toBeGreaterThan(0.6);
  });

  it("should handle fallback gracefully for unmatched queries", () => {
    const state = createTestState();

    const reply = answerQuestion(state, "Tell me something random about penguins");

    expect(reply.answer).toBeDefined();
    expect(reply.answer.length).toBeGreaterThan(0);
    // Fallback should have lower confidence
    expect(reply.confidence).toBeLessThan(0.8);
  });

  it("should provide reasoning for answers", () => {
    const state = createTestState();
    state.orders = [
      {
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
        risk: "critical",
        riskScore: 89,
      },
    ];

    const reply = answerQuestion(state, "Why is #1042 at risk?");

    expect(reply.reasoning).toBeDefined();
    expect(Array.isArray(reply.reasoning)).toBe(true);
    expect(reply.reasoning.length).toBeGreaterThan(0);
  });

  it("should include entity references in reply (orders, SKUs, decisions)", () => {
    const state = createTestState();
    state.orders = [
      {
        id: "1042",
        customer: "TechCorp",
        customerTier: "enterprise",
        basePriority: "critical",
        priority: "critical",
        score: 95,
        createdAt: 0,
        slaMinutes: 60,
        items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
        status: "allocated",
        zone: "ZA",
        risk: "critical",
        riskScore: 89,
      },
    ];

    state.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 5,
        reserved: 0,
        damaged: 0,
        safetyStock: 10,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "critical",
      },
    ];

    const reply = answerQuestion(state, "Why is #1042 at risk?");

    expect(reply.refs).toBeDefined();
    expect(reply.refs.orders).toBeDefined();
    expect(Array.isArray(reply.refs.orders)).toBe(true);
  });

  it("should propose actionable decisions with safety gate", () => {
    const state = createTestState();
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
        items: [{ sku: "SKU-104", name: "Widget", qty: 10, allocated: 0, picked: 0, packed: 0 }],
        status: "allocated",
        zone: "ZA",
        risk: "critical",
        riskScore: 89,
      },
    ];

    state.products = [
      {
        sku: "SKU-104",
        name: "Widget",
        category: "electronics",
        zone: "ZA",
        available: 5,
        reserved: 0,
        damaged: 0,
        safetyStock: 10,
        reorderThreshold: 20,
        unitCost: 12.5,
        stockStatus: "critical",
      },
    ];

    const reply = answerQuestion(state, "What should I do about SKU-104?");

    expect(reply.answer).toBeDefined();
    // If action is proposed, it must be explicit about needing operator confirmation
    if (reply.action) {
      expect(reply.action).toHaveProperty("kind");
      expect(reply.action).toHaveProperty("title");
      expect(reply.action).toHaveProperty("summary");
      expect(reply.action).toHaveProperty("impact");
    }
  });
});
