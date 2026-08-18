import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type {
  DecisionRecord,
  DisruptionKind,
  WarehouseState,
} from "@/types";
import { buildSeed } from "@/lib/data/seed";
import {
  getAllocationConflict,
  REPLENISH_ETA_MIN,
} from "@/lib/decision-engine/allocation-engine";
import { applyRecoveryStep, buildRecoveryPlan } from "@/lib/decision-engine/recovery-engine";
import { refreshDerived } from "./derived";
import { applyAllocationsToState } from "@/lib/workflow/allocations";
import {
  completePacking,
  completePicking,
  dispatchOrder,
  failQc,
  passQc,
  startPacking,
  startPicking,
} from "@/lib/workflow/fulfillment-workflow";
import { triggerDisruption, triggerFullChaos } from "@/lib/simulation/chaos-engine";
import { createSimSession } from "@/lib/simulation/what-if-engine";

const STORAGE_KEY = "wareflow-demo-v1";

export type WarehouseAction =
  | { type: "TICK" }
  | { type: "APPLY_ALLOCATION"; orderId: string; sku: string; optionId: string; source: "decision" | "simulator" }
  | { type: "APPLY_DECISION"; decisionId: string; optionId?: string }
  | { type: "DISMISS_DECISION"; decisionId: string }
  | { type: "START_PICKING"; orderId: string; pickerId: string }
  | { type: "COMPLETE_PICKING"; orderId: string }
  | { type: "START_PACKING"; orderId: string; stationId: string }
  | { type: "COMPLETE_PACKING"; orderId: string }
  | { type: "QC_PASS"; orderId: string }
  | { type: "QC_FAIL"; orderId: string; reason: string }
  | { type: "DISPATCH"; orderId: string; vehicleId: string }
  | { type: "RESOLVE_EXCEPTION"; exceptionId: string; optionId: string }
  | { type: "TRIGGER_CHAOS"; kind: DisruptionKind | "full" }
  | { type: "APPLY_RECOVERY" }
  | { type: "START_SIM"; orderId: string; sku: string }
  | { type: "CLEAR_SIM" }
  | { type: "CONFIRM_REPLENISHMENT"; sku: string }
  | { type: "RESET" };

function clone(state: WarehouseState): WarehouseState {
  return structuredClone(state);
}

function pushEvent(state: WarehouseState, severity: WarehouseState["events"][number]["severity"], message: string) {
  state.events.unshift({ id: `EV-${state.nextEventId}`, time: state.clock, severity, message });
  state.nextEventId += 1;
  state.events = state.events.slice(0, 60);
}

function buildSeedState(): WarehouseState {
  const s = buildSeed();
  refreshDerived(s);
  return s;
}

function initState(): WarehouseState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WarehouseState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.orders)) {
        return parsed;
      }
    }
  } catch {
    // fall through to a fresh seed
  }
  return buildSeedState();
}

export function reducer(state: WarehouseState, action: WarehouseAction): WarehouseState {
  switch (action.type) {
    case "TICK": {
      const draft = clone(state);
      draft.clock += 1;
      // Orders that ran out of SLA while still in the pipeline become delayed.
      for (const order of draft.orders) {
        if (order.status === "dispatched" || order.status === "delayed" || order.status === "exception") continue;
        const remaining = order.slaMinutes - (draft.clock - order.createdAt);
        const inPipeline = ["created", "prioritized", "allocated", "picking", "packing", "quality-check"].includes(order.status);
        if (remaining <= 0 && inPipeline) {
          order.status = "delayed";
          pushEvent(draft, "critical", `Order #${order.id} SLA expired — marked DELAYED (was ${order.status})`);
        }
      }
      refreshDerived(draft);
      return draft;
    }

    case "APPLY_ALLOCATION": {
      const draft = clone(state);
      const conflict = getAllocationConflict(draft, action.orderId, action.sku);
      const option = conflict?.options.find((o) => o.id === action.optionId);
      if (!conflict || !option) return state;

      applyAllocationsToState(draft, option.releases, option.allocations);
      const product = draft.products.find((p) => p.sku === action.sku);
      if (product && option.replenishQty > 0) {
        product.replenishQty = option.replenishQty;
      }

      pushEvent(
        draft,
        "decision",
        `Decision Engine evaluated ${conflict.options.length} scenarios for ${action.sku} — Scenario ${option.id} (${option.label}) selected`,
      );
      for (const r of option.releases) {
        pushEvent(draft, "info", `Reservation released: #${r.orderId} −${r.qty} × ${r.sku}`);
      }
      for (const a of option.allocations) {
        const o = draft.orders.find((x) => x.id === a.orderId);
        pushEvent(draft, "success", `Order #${a.orderId} allocated ${a.qty} × ${a.sku} — ${o?.status.toUpperCase()}`);
      }
      if (product && option.replenishQty > 0) {
        pushEvent(draft, "info", `Replenishment drafted: +${option.replenishQty} × ${product.sku} (ETA ${REPLENISH_ETA_MIN}m)`);
      }
      if (action.source === "decision") {
        const decision = draft.decisions.find(
          (d) => d.type === "allocation" && d.orderId === action.orderId && d.sku === action.sku && d.status === "open",
        );
        if (decision) {
          decision.status = "applied";
          pushEvent(draft, "decision", `Decision ${decision.id} applied by operator`);
        }
      } else {
        if (draft.sim) draft.sim.appliedScenarioId = option.id;
        pushEvent(draft, "decision", `Simulator scenario applied — operator approved Scenario ${option.id}`);
      }

      refreshDerived(draft);
      return draft;
    }

    case "APPLY_DECISION": {
      const draft = clone(state);
      const decision = draft.decisions.find((d) => d.id === action.decisionId);
      if (!decision || decision.status !== "open") return state;

      if (decision.type === "allocation" && decision.orderId && decision.sku) {
        const conflict = getAllocationConflict(draft, decision.orderId, decision.sku);
        const optionId = action.optionId ?? (conflict ? conflict.recommendedOptionId : undefined);
        if (!conflict || !optionId) {
          decision.status = "applied";
          pushEvent(draft, "warning", `${decision.id}: conflict no longer exists (state changed) — recorded as applied`);
          return draft;
        }
        const option = conflict.options.find((o) => o.id === optionId);
        if (!option) return state;
        applyAllocationsToState(draft, option.releases, option.allocations);
        const product = draft.products.find((p) => p.sku === decision.sku);
        if (product && option.replenishQty > 0) product.replenishQty = option.replenishQty;
        for (const r of option.releases) pushEvent(draft, "info", `Reservation released: #${r.orderId} −${r.qty} × ${r.sku}`);
        for (const a of option.allocations) {
          const o = draft.orders.find((x) => x.id === a.orderId);
          pushEvent(draft, "success", `Order #${a.orderId} allocated ${a.qty} × ${a.sku} — ${o?.status.toUpperCase()}`);
        }
        decision.status = "applied";
        pushEvent(draft, "decision", `${decision.id} applied — ${decision.recommendation}`);
      } else if (decision.type === "recovery" && decision.planId) {
        const plan = draft.chaos.recoveryPlan;
        if (plan && plan.id === decision.planId) {
          for (const s of plan.steps) {
            applyRecoveryStep(draft, s);
            pushEvent(draft, "info", `Recovery: ${s.title}`);
          }
          draft.chaos = { ...draft.chaos, disruptions: [], recoveryPlan: undefined, appliedAt: draft.clock };
          const improvement = plan.predictedImprovement[0];
          pushEvent(draft, "decision", `RECOVERY PLAN APPLIED${improvement ? ` — ${improvement}` : ""}`);
        }
        decision.status = "applied";
      } else {
        decision.status = "applied";
      }

      refreshDerived(draft);
      return draft;
    }

    case "DISMISS_DECISION": {
      const draft = clone(state);
      const decision = draft.decisions.find((d) => d.id === action.decisionId);
      if (decision && decision.status === "open") {
        decision.status = "dismissed";
        pushEvent(draft, "info", `${decision.id} dismissed by operator`);
      }
      return draft;
    }

    case "START_PICKING": {
      const draft = clone(state);
      if (startPicking(draft, action.orderId, action.pickerId)) {
        const picker = draft.pickers.find((p) => p.id === action.pickerId);
        pushEvent(draft, "info", `Order #${action.orderId} picking started — picker ${picker?.id} (${picker?.name})`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "COMPLETE_PICKING": {
      const draft = clone(state);
      if (completePicking(draft, action.orderId)) {
        pushEvent(draft, "success", `Order #${action.orderId} picking complete — ${draft.orders.find((o) => o.id === action.orderId)?.stationId} assigned`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "START_PACKING": {
      const draft = clone(state);
      if (startPacking(draft, action.orderId, action.stationId)) {
        pushEvent(draft, "info", `Order #${action.orderId} packing started on ${action.stationId}`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "COMPLETE_PACKING": {
      const draft = clone(state);
      if (completePacking(draft, action.orderId)) {
        pushEvent(draft, "success", `Order #${action.orderId} packed — moved to Quality Check`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "QC_PASS": {
      const draft = clone(state);
      if (passQc(draft, action.orderId)) {
        pushEvent(draft, "success", `Order #${action.orderId} QC PASSED — ready for dispatch`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "QC_FAIL": {
      const draft = clone(state);
      const ex = failQc(draft, action.orderId, action.reason);
      if (ex) {
        pushEvent(draft, "critical", `Order #${action.orderId} QC FAILED (${action.reason}) — exception ${ex.id} opened`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "DISPATCH": {
      const draft = clone(state);
      if (dispatchOrder(draft, action.orderId, action.vehicleId)) {
        const vehicle = draft.vehicles.find((v) => v.id === action.vehicleId);
        pushEvent(draft, "success", `Order #${action.orderId} DISPATCHED on ${vehicle?.name} (${vehicle?.route})`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "RESOLVE_EXCEPTION": {
      const draft = clone(state);
      const ex = draft.exceptions.find((e) => e.id === action.exceptionId);
      if (!ex || ex.status !== "open") return state;

      const option = ex.options.find((o) => o.id === action.optionId) ?? ex.options.find((o) => o.id === ex.recommendedOptionId);
      if (!option) return state;

      // Insufficient-stock exceptions always draft a replenishment PO.
      if (ex.type === "insufficient-stock" && ex.sku) {
        const product = draft.products.find((p) => p.sku === ex.sku);
        if (product) product.replenishQty = Math.max(product.replenishQty ?? 0, product.reorderThreshold + 5);
      }

      if (option.action) {
        if (option.action.type === "replenish") {
          const product = ex.sku ? draft.products.find((p) => p.sku === ex.sku) : undefined;
          if (product) product.replenishQty = Math.max(product.replenishQty ?? 0, Number(option.action.payload.qty));
        } else {
          applyRecoveryStep(draft, option.action);
        }
      }

      const order = ex.orderId ? draft.orders.find((o) => o.id === ex.orderId) : undefined;
      if (order) {
        if (order.exceptionId === ex.id) order.exceptionId = undefined;
        if (order.status === "exception") order.status = "prioritized";
      }

      ex.status = "resolved";
      ex.resolvedAt = draft.clock;
      ex.resolution = `${option.label} — ${option.summary}`;
      pushEvent(draft, "success", `Exception ${ex.id} RESOLVED: ${option.label}${order ? ` (order #${order.id})` : ""}`);
      pushEvent(draft, "info", `Order #${order?.id} ${order ? order.status.toUpperCase() : ""} after exception resolution`);

      refreshDerived(draft);
      return draft;
    }

    case "TRIGGER_CHAOS": {
      const draft = clone(state);
      if (action.kind === "full") triggerFullChaos(draft);
      else triggerDisruption(draft, action.kind);
      refreshDerived(draft);
      draft.chaos.recoveryPlan = buildRecoveryPlan(draft);

      const plan = draft.chaos.recoveryPlan;
      const decision: DecisionRecord = {
        id: `D-${String(draft.nextDecisionNum).padStart(3, "0")}`,
        type: "recovery",
        title: "Recovery plan — disruption response",
        severity: "critical",
        summary: `${draft.chaos.disruptions.length} disruption(s) detected. The Recovery Engine generated a ${plan.steps.length}-step plan with predicted improvement: ${plan.riskBefore} → ${plan.riskAfter} orders at risk.`,
        analysis: draft.chaos.disruptions.map((d) => `${d.title}: ${d.detail}`),
        recommendation: `Apply the ${plan.steps.length}-step recovery plan (${plan.predictedImprovement.join("; ")})`,
        why: plan.steps.map((s) => `${s.title} — ${s.detail}`),
        impact: plan.predictedImprovement,
        status: "open",
        createdAt: draft.clock,
        planId: plan.id,
      };
      draft.nextDecisionNum += 1;
      draft.decisions.unshift(decision);
      pushEvent(draft, "critical", `DISRUPTION DETECTED — ${draft.chaos.disruptions.length} active — recovery plan generated`);
      return draft;
    }

    case "APPLY_RECOVERY": {
      const draft = clone(state);
      const plan = draft.chaos.recoveryPlan;
      if (!plan) return state;
      for (const s of plan.steps) {
        applyRecoveryStep(draft, s);
        pushEvent(draft, "info", `Recovery: ${s.title}`);
      }
      draft.chaos = { ...draft.chaos, disruptions: [], recoveryPlan: undefined, appliedAt: draft.clock };
      const decision = draft.decisions.find((d) => d.planId === plan.id && d.status === "open");
      if (decision) decision.status = "applied";
      const improvement = plan.predictedImprovement[0];
      pushEvent(draft, "decision", `RECOVERY PLAN APPLIED${improvement ? ` — ${improvement}` : ""}`);
      refreshDerived(draft);
      return draft;
    }

    case "START_SIM": {
      const draft = clone(state);
      const conflict = getAllocationConflict(draft, action.orderId, action.sku);
      if (!conflict) return state;
      draft.sim = createSimSession(draft, conflict);
      pushEvent(draft, "decision", `What-If Simulator opened — ${conflict.options.length} scenarios compared for ${action.sku}`);
      return draft;
    }

    case "CLEAR_SIM": {
      const draft = clone(state);
      draft.sim = null;
      return draft;
    }

    case "CONFIRM_REPLENISHMENT": {
      const draft = clone(state);
      const product = draft.products.find((p) => p.sku === action.sku);
      if (product && product.replenishQty) {
        const qty = product.replenishQty;
        product.available += qty;
        product.replenishQty = undefined;
        pushEvent(draft, "success", `Replenishment received: +${qty} × ${product.sku} (${product.name})`);
        refreshDerived(draft);
      }
      return draft;
    }

    case "RESET": {
      const fresh = buildSeedState();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      return fresh;
    }

    default:
      return state;
  }
}

interface StoreApi {
  state: WarehouseState;
  dispatch: React.Dispatch<WarehouseAction>;
}

const WarehouseContext = createContext<StoreApi | null>(null);

export function WarehouseProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const loaded = useRef(false);

  // Persist after every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage may be unavailable — demo still works in-memory
    }
  }, [state]);

  // Live clock: 1 simulated minute every 2.5s keeps SLAs ticking.
  useEffect(() => {
    loaded.current = true;
    const timer = setInterval(() => dispatch({ type: "TICK" }), 2500);
    return () => clearInterval(timer);
  }, []);

  const api = useMemo(() => ({ state, dispatch }), [state]);

  return <WarehouseContext.Provider value={api}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse(): StoreApi {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error("useWarehouse must be used within WarehouseProvider");
  return ctx;
}
