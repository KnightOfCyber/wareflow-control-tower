import type { WarehouseState } from "@/types";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";
import type { CopilotContext } from "./types";

/**
 * COPILOT CONTEXT
 * A compact structured snapshot of the live warehouse state. Rebuilt on
 * every state change so the chat's "current context" indicator stays true
 * to what the assistant can actually see.
 */

export function buildCopilotContext(state: WarehouseState): CopilotContext {
  const open = state.orders.filter((o) => o.status !== "dispatched");
  const atRisk = open.filter((o) => {
    const r = computeOrderRisk(o, state);
    return r.level === "high" || r.level === "critical";
  });
  const critical = open.filter((o) => {
    const r = computeOrderRisk(o, state);
    return r.level === "critical";
  });

  return {
    clock: state.clock,
    openOrders: open.length,
    atRisk: atRisk.length,
    criticalRisk: critical.length,
    openExceptions: state.exceptions.filter((e) => e.status === "open").length,
    openDecisions: state.decisions.filter((d) => d.status === "open").length,
    disruptions: state.chaos.disruptions.length,
    lowStock: state.products.filter(
      (p) => p.stockStatus === "low" || p.stockStatus === "critical",
    ).length,
    outStock: state.products.filter((p) => p.stockStatus === "out").length,
    draftedPos: state.products.filter((p) => p.replenishQty !== undefined).length,
    delayedOrders: state.orders.filter((o) => o.status === "delayed").length,
    delayedTrucks: state.vehicles.filter((v) => v.status === "delayed").length,
  };
}

/** Chips for the context bar, e.g. "LIVE · 08:58", "6 EXCEPTIONS". */
export function contextChips(ctx: CopilotContext): string[] {
  const chips: string[] = [];
  if (ctx.disruptions > 0) chips.push(`${ctx.disruptions} DISRUPTION${ctx.disruptions > 1 ? "S" : ""}`);
  if (ctx.openExceptions > 0) chips.push(`${ctx.openExceptions} EXCEPTION${ctx.openExceptions > 1 ? "S" : ""}`);
  if (ctx.atRisk > 0) chips.push(`${ctx.atRisk} ORDERS AT RISK`);
  if (ctx.openDecisions > 0) chips.push(`${ctx.openDecisions} DECISION${ctx.openDecisions > 1 ? "S" : ""} OPEN`);
  if (ctx.outStock > 0) chips.push(`${ctx.outStock} OUT OF STOCK`);
  else if (ctx.lowStock > 0) chips.push(`${ctx.lowStock} LOW-STOCK`);
  if (ctx.draftedPos > 0) chips.push(`${ctx.draftedPos} PO DRAFTED`);
  if (ctx.delayedTrucks > 0) chips.push(`${ctx.delayedTrucks} TRUCK DELAYED`);
  if (ctx.delayedOrders > 0) chips.push(`${ctx.delayedOrders} DELAYED ORDER${ctx.delayedOrders > 1 ? "S" : ""}`);
  if (chips.length === 0) chips.push("ALL SYSTEMS NOMINAL");
  return chips;
}
