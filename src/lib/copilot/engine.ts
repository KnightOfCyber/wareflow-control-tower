import type {
  AllocationConflict,
  AllocationOption,
  ExceptionRecord,
  Order,
  Product,
  WarehouseState,
} from "@/types";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";
import { remainingSla } from "@/lib/decision-engine/priority-engine";
import {
  findActiveConflicts,
  getAllocationConflict,
  REPLENISH_ETA_MIN,
} from "@/lib/decision-engine/allocation-engine";
import { detectBottlenecks } from "@/lib/decision-engine/bottleneck-engine";
import { fmtClock, fmtSla } from "@/lib/format";
import type {
  CopilotActionProposal,
  CopilotReply,
  CopilotRefs,
} from "./types";

/**
 * WAREFLOW COPILOT ENGINE (deterministic fallback)
 *
 * No LLM is configured for this project, so the Copilot is a deterministic
 * operational assistant. It classifies the operator's question, then builds
 * the answer exclusively from live warehouse state through the SAME engines
 * the UI uses (priority, risk, allocation, bottleneck, recovery). Nothing is
 * hardcoded per question — every number below is computed from `state`.
 *
 * Safety: any state-changing proposal (`action`) is surfaced as an impact
 * card in the chat and only executes after explicit operator confirmation,
 * via the existing store actions.
 */

type IntentId =
  | "truck"
  | "delayed"
  | "order_risk"
  | "changes"
  | "decision_reason"
  | "disruption"
  | "critical_skus"
  | "sku"
  | "simulate"
  | "sla_miss"
  | "top_risk"
  | "health"
  | "bottlenecks"
  | "prioritize"
  | "summary"
  | "fallback";

const MATCHERS: Array<{ intent: IntentId; re: RegExp; needOrder?: boolean; needSku?: boolean }> = [
  { intent: "truck", re: /(truck|vehicle|dispatch lane|which truck)/ },
  { intent: "delayed", re: /\b(delayed|late|stuck|stalled)\b/ },
  { intent: "order_risk", re: /(at risk|risk|danger|threat|why is|why are|why does)/, needOrder: true },
  { intent: "changes", re: /(what changed|after applying|what happened after|before.*after|result of the)/ },
  { intent: "decision_reason", re: /(why.*(scenario|recommend|decision|choose)|scenario [abc]|recommended scenario|why.*chose)/ },
  { intent: "disruption", re: /(disruption|chaos|recovery plan|what happened|recover)/ },
  { intent: "sku", re: /(what should i do|do about|recommend.*sku|for sku|on sku)/, needSku: true },
  { intent: "simulate", re: /(simulate|what if|wait for replenishment|scenario|compare)/ },
  { intent: "critical_skus", re: /(which sku|skus? are|critical sku|low stock|out of stock|need replenishment|replenish|stock status|inventory)/ },
  { intent: "sla_miss", re: /\b(sla|deadline|on.?time|breach|miss(es|ing)?)\b/ },
  { intent: "top_risk", re: /(biggest risk|most risk|top risk|risk right now|biggest threat|causing.*risk|worst|what.*risk)/ },
  { intent: "health", re: /(health)/ },
  { intent: "bottlenecks", re: /(bottleneck|backlog|congestion|queue|slow|bottlenecks)/ },
  { intent: "prioritize", re: /(prioritize|what should i do next|what do i do|next action|what to do|next step|next move)/ },
  { intent: "summary", re: /(summary|overview|status|how is.*warehouse|give me|report|everything)/ },
];

interface Parsed {
  intent: IntentId;
  orderId?: string;
  sku?: string;
}

function parseQuestion(question: string): Parsed {
  const q = question.toLowerCase();
  const orderMatch = q.match(/#?(\d{4})\b/);
  const orderId = orderMatch ? orderMatch[1] : undefined;
  const skuMatch = q.match(/(?:sku[- ]?)(\d{3})/);
  const sku = skuMatch ? `SKU-${skuMatch[1]}` : undefined;

  for (const m of MATCHERS) {
    if (m.needOrder && !orderId) continue;
    if (m.needSku && !sku) continue;
    if (m.re.test(q)) return { intent: m.intent, orderId, sku };
  }
  if (orderId) return { intent: "order_risk", orderId, sku };
  if (sku) return { intent: "sku", orderId, sku };
  return { intent: "fallback", orderId, sku };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function refs(
  orders: string[] = [],
  skus: string[] = [],
  decisions: string[] = [],
  exceptions: string[] = [],
): CopilotRefs {
  const uniq = (a: string[]) => [...new Set(a)].filter(Boolean);
  return { orders: uniq(orders), skus: uniq(skus), decisions: uniq(decisions), exceptions: uniq(exceptions) };
}

function riskOf(state: WarehouseState, order: Order) {
  return computeOrderRisk(order, state);
}

function openOrders(state: WarehouseState): Order[] {
  return state.orders.filter((o) => o.status !== "dispatched");
}

function atRiskSorted(state: WarehouseState): Order[] {
  return openOrders(state)
    .map((o) => ({ o, r: riskOf(state, o) }))
    .sort((a, b) => b.r.score - a.r.score)
    .map((x) => x.o);
}

function demandForSku(state: WarehouseState, sku: string): Order[] {
  return openOrders(state).filter((o) => o.items.some((i) => i.sku === sku));
}

function conflictForOrder(state: WarehouseState, orderId: string): AllocationConflict | null {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;
  for (const item of order.items) {
    const p = state.products.find((x) => x.sku === item.sku);
    const need = item.qty - item.allocated;
    if (p && need > 0 && p.available < need) {
      const c = getAllocationConflict(state, order.id, item.sku);
      if (c) return c;
    }
  }
  return null;
}

function conflictForSku(state: WarehouseState, sku: string): AllocationConflict | null {
  const conflicts = findActiveConflicts(state);
  return conflicts.find((c) => c.sku === sku) ?? null;
}

function topConflict(state: WarehouseState): AllocationConflict | null {
  const conflicts = findActiveConflicts(state);
  if (conflicts.length === 0) return null;
  return [...conflicts].sort((a, b) => {
    const ra = state.orders.find((o) => o.id === a.orderId);
    const rb = state.orders.find((o) => o.id === b.orderId);
    return (rb ? riskOf(state, rb).score : 0) - (ra ? riskOf(state, ra).score : 0);
  })[0];
}

/** Build the executable allocation proposal from an engine conflict. */
function allocationProposal(
  state: WarehouseState,
  conflict: AllocationConflict,
): CopilotActionProposal {
  const option = conflict.options.find((o) => o.id === conflict.recommendedOptionId) ?? conflict.options[0];
  const decision = state.decisions.find(
    (d) =>
      d.status === "open" &&
      d.type === "allocation" &&
      d.orderId === conflict.orderId &&
      d.sku === conflict.sku,
  );
  return {
    kind: "allocation",
    title: `Apply Scenario ${option.id} — ${option.label}`,
    summary: `Recommended by the Allocation Engine: lowest composite risk (${option.riskScore}) across SLA risk, fulfillment, delay and movement.`,
    impact: impactLines(conflict, option),
    decisionId: decision?.id,
    orderId: conflict.orderId,
    sku: conflict.sku,
    optionId: option.id,
    optionLabel: option.label,
    conflictKey: `${conflict.orderId}:${conflict.sku}`,
  };
}

function impactLines(conflict: AllocationConflict, option: AllocationOption): string[] {
  const lines: string[] = [];
  const primary = option.allocations.find((a) => a.orderId === conflict.orderId);
  if (primary) lines.push(`${primary.qty} × ${conflict.sku} allocated to #${conflict.orderId}`);
  for (const r of option.releases) lines.push(`${r.qty} unit(s) recalled from reservation #${r.orderId}`);
  for (const a of option.allocations) {
    if (a.orderId !== conflict.orderId) lines.push(`${a.qty} × ${conflict.sku} allocated to #${a.orderId}`);
  }
  if (option.replenishQty > 0) lines.push(`+${option.replenishQty} × ${conflict.sku} replenishment drafted (ETA ${REPLENISH_ETA_MIN}m)`);
  lines.push(`expected fulfillment: ${option.fulfillmentAfter}%`);
  lines.push(`expected delay: ${option.expectedDelayMin === 0 ? "0m" : `${option.expectedDelayMin}m`}`);
  lines.push(`composite risk score: ${option.riskScore}`);
  return lines;
}

function exceptionProposal(ex: ExceptionRecord): CopilotActionProposal | undefined {
  const opt = ex.options.find((o) => o.id === ex.recommendedOptionId);
  if (!opt) return undefined;
  return {
    kind: "exception",
    title: `Resolve ${ex.id} — ${opt.label}`,
    summary: opt.summary,
    impact: opt.effect,
    exceptionId: ex.id,
    exceptionOptionLabel: opt.label,
    optionId: opt.id,
    orderId: ex.orderId,
    sku: ex.sku,
  };
}

function replenishProposal(state: WarehouseState, sku: string): CopilotActionProposal | undefined {
  const p = state.products.find((x) => x.sku === sku);
  if (!p || p.replenishQty === undefined) return undefined;
  return {
    kind: "replenish",
    title: `Confirm replenishment receipt — ${sku}`,
    summary: `A PO for +${p.replenishQty} units is drafted. Confirming the receipt moves it into available stock.`,
    impact: [
      `+${p.replenishQty} × ${sku} moved to available stock`,
      `${sku} available: ${p.available} → ${p.available + p.replenishQty}`,
    ],
    sku,
  };
}

function simProposal(state: WarehouseState, conflict: AllocationConflict): CopilotActionProposal {
  return {
    kind: "sim",
    title: `Open What-If Simulator — ${conflict.orderId} · ${conflict.sku}`,
    summary: `Compare all ${conflict.options.length} scenarios side by side on a copy of live state. Nothing changes until you apply one.`,
    impact: conflict.options.map(
      (o) => `Scenario ${o.id} (${o.label}): fulfillment ${o.fulfillmentAfter}% · delay ${o.expectedDelayMin === 0 ? "0m" : `${o.expectedDelayMin}m`} · risk ${o.riskScore}`,
    ),
    orderId: conflict.orderId,
    sku: conflict.sku,
    optionId: conflict.recommendedOptionId,
    conflictKey: `${conflict.orderId}:${conflict.sku}`,
  };
}

function stockLine(p: Product): string {
  return `${p.sku} (${p.name}): ${p.available} avail / ${p.safetyStock} safety — ${p.stockStatus.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// answer builders
// ---------------------------------------------------------------------------

function answerOrderRisk(state: WarehouseState, orderId: string): CopilotReply {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) {
    return {
      answer: `I can't find order **#${orderId}** in the live order book.`,
      facts: [`No order with id ${orderId} exists in the current state`],
      confidence: 0.9,
      reasoning: ["Entity lookup failed against live orders"],
      refs: refs(),
    };
  }
  const risk = riskOf(state, order);
  const remaining = remainingSla(order, state.clock);
  const conflict = conflictForOrder(state, order.id);
  const itemLines = order.items.map((i) => {
    const p = state.products.find((x) => x.sku === i.sku);
    const need = i.qty - i.allocated;
    const short = p ? Math.max(0, need - p.available) : need;
    return `- ${i.sku}: ${i.allocated}/${i.qty} allocated, ${need} still needed, ${p?.available ?? 0} available${short > 0 ? ` (**${short} short**)` : ""}`;
  });

  const reasons: string[] = [];
  if (remaining <= 0) reasons.push(`its SLA window has already expired (${fmtSla(remaining)} remaining)`);
  else if (remaining <= 30) reasons.push(`only ${fmtSla(remaining)} left on its SLA`);
  if (order.items.some((i) => i.qty - i.allocated > 0)) reasons.push("lines are still unallocated");
  if (order.status === "exception") reasons.push(`it is stalled by ${order.exceptionId ?? "an exception"}`);

  let answer = `Order **#${order.id}** is **${risk.level.toUpperCase()} risk** (score ${risk.score}/100) because ${reasons.join(" and ") || risk.reason}.`;
  answer += `\n\n${itemLines.join("\n")}`;
  answer += `\n\n**SLA window:** ${fmtSla(Math.max(0, remaining))} remaining (deadline ${fmtClock(order.createdAt + order.slaMinutes)}).`;

  if (conflict) {
    const rec = conflict.options.find((o) => o.id === conflict.recommendedOptionId);
    answer += `\n\nThe Allocation Engine evaluated **${conflict.options.length} scenario(s)** for ${conflict.sku}. Scenario **${rec?.id}** has the lowest risk score (**${rec?.riskScore}**), ${rec?.fulfillmentAfter}% fulfillment and ${rec?.expectedDelayMin === 0 ? "0m expected delay" : `${rec?.expectedDelayMin}m expected delay`}.`;
  } else if (order.status === "exception" && order.exceptionId) {
    const ex = state.exceptions.find((e) => e.id === order.exceptionId);
    if (ex) answer += `\n\nIt is held by exception **${ex.id}** — the recommended resolution is "${ex.recommendation}".`;
  }

  const facts = [
    `Customer: ${order.customer} (${order.customerTier})`,
    `Engine priority: ${order.priority.toUpperCase()} (score ${order.score})`,
    `Status: ${order.status.toUpperCase()} · zone ${order.zone}`,
    `Risk cause: ${risk.reason} — ${risk.predictedIssue}`,
  ];

  const action =
    conflict ? allocationProposal(state, conflict)
    : order.exceptionId ? (() => { const ex = state.exceptions.find((e) => e.id === order.exceptionId); return ex ? exceptionProposal(ex) : undefined; })()
    : undefined;

  return {
    answer,
    facts,
    recommendedAction: action ? action.title : "No live action proposed — monitor.",
    confidence: 0.95,
    reasoning: [
      `Detected intent: risk analysis for order #${order.id}`,
      `Risk computed by the Risk Engine (${risk.reason})`,
      conflict ? `Allocation Engine scored ${conflict.options.length} scenarios on SLA, fulfillment, delay, movement` : "No active allocation conflict on this order",
    ],
    refs: refs([order.id], conflict ? [conflict.sku] : [], conflict ? state.decisions.filter((d) => d.status === "open" && d.orderId === order.id).map((d) => d.id) : [], order.exceptionId ? [order.exceptionId] : []),
    action,
  };
}

function answerTruck(state: WarehouseState, orderId?: string): CopilotReply {
  const order =
    (orderId && state.orders.find((o) => o.id === orderId)) ||
    state.orders.find((o) => o.status !== "dispatched" && o.vehicleId && state.vehicles.find((v) => v.id === o.vehicleId)?.status === "delayed") ||
    state.orders.find((o) => o.status === "ready");

  if (!order) {
    return {
      answer: "There are no orders waiting on a dispatch lane right now.",
      facts: [`${state.vehicles.filter((v) => v.status === "ready").length} truck(s) ready`],
      confidence: 0.8,
      reasoning: ["No order with an assigned or ready dispatch state found"],
      refs: refs(),
    };
  }

  const assigned = order.vehicleId ? state.vehicles.find((v) => v.id === order.vehicleId) : undefined;
  const readyTrucks = state.vehicles
    .filter((v) => v.status === "ready")
    .sort((a, b) => b.capacity - b.assigned - (a.capacity - a.assigned));

  const best = readyTrucks[0];
  let answer = `Order **#${order.id}** is ${order.status === "ready" ? "packed and waiting at the dock" : `assigned to **${assigned?.name ?? "—"} (${assigned?.route ?? ""})**`}.`;

  if (assigned && assigned.status === "delayed") {
    answer += `\n\n${assigned.name} is **delayed** (${assigned.route}), which puts the dispatch SLA at risk.`;
    if (best) {
      answer += `\n\n**Recommendation:** rebook #${order.id} onto **${best.name} (${best.route})** — it is ready with ${best.capacity - best.assigned} free slots.`;
    }
  } else if (best) {
    answer += `\n\nA ready truck is available: **${best.name} (${best.route})** with ${best.capacity - best.assigned} free slots.`;
  }

  const ex = state.exceptions.find((e) => e.status === "open" && e.orderId === order.id && e.type === "dispatch-delay");
  const action = ex ? exceptionProposal(ex) : undefined;
  const facts = [
    `Assigned vehicle: ${assigned?.name ?? "none"} — ${assigned?.status ?? "—"}`,
    `Ready trucks: ${readyTrucks.map((v) => `${v.name} (${v.capacity - v.assigned} free)`).join(", ") || "none"}`,
    `SLA: ${fmtSla(Math.max(0, remainingSla(order, state.clock)))} remaining`,
  ];

  return {
    answer,
    facts,
    recommendedAction: action ? action.title : "Dispatch lane healthy — no rebooking needed.",
    confidence: 0.92,
    reasoning: ["Compared assigned vehicle status against ready trucks with spare capacity"],
    refs: refs([order.id], [], [], ex ? [ex.id] : []),
    action,
  };
}

function answerDelayed(state: WarehouseState, orderId?: string): CopilotReply {
  const order = orderId ? state.orders.find((o) => o.id === orderId) : undefined;
  if (order) {
    const remaining = remainingSla(order, state.clock);
    return {
      answer: `Order **#${order.id}** (${order.customer}) is **DELAYED** — its SLA window expired ${fmtSla(-remaining)} ago while in ${order.status === "delayed" ? "the pipeline" : order.status} status. The order is held on ${order.items.map((i) => i.sku).join(", ")}.`,
      facts: [`Status: ${order.status.toUpperCase()}`, `SLA: ${fmtSla(Math.max(0, remaining))} remaining`, `Customer: ${order.customer} (${order.customerTier})`],
      confidence: 0.93,
      reasoning: ["Direct order lookup — SLA math from live clock"],
      refs: refs([order.id]),
    };
  }

  const delayed = state.orders.filter((o) => o.status === "delayed");
  const trucks = state.vehicles.filter((v) => v.status === "delayed");
  const stalledPickers = state.pickers.filter((p) => p.status === "unavailable");

  let answer = `Currently **${delayed.length} order(s)** are delayed`;
  if (delayed.length > 0) {
    answer += `:\n${delayed.slice(0, 5).map((o) => `- #${o.id} ${o.customer} — ${o.items.map((i) => i.sku).join(", ")}`).join("\n")}`;
  }
  if (trucks.length > 0) {
    answer += `\n\n**${trucks.length} truck(s)** on delayed lanes: ${trucks.map((t) => `${t.name} (${t.route})`).join(", ")}.`;
  }
  if (stalledPickers.length > 0) {
    answer += `\n\n${stalledPickers.length} picker(s) unavailable: ${stalledPickers.map((p) => `${p.id} (${p.zone})`).join(", ")} — queued work is stalled.`;
  }

  const dispatchEx = state.exceptions.find((e) => e.status === "open" && e.type === "dispatch-delay");
  return {
    answer,
    facts: [
      `${delayed.length} delayed orders`,
      `${trucks.length} delayed trucks`,
      `${stalledPickers.length} unavailable pickers`,
    ],
    recommendedAction: dispatchEx ? `Resolve ${dispatchEx.id} — ${dispatchEx.recommendation}` : "Review delayed orders on the Orders page",
    confidence: 0.9,
    reasoning: ["Filtered live state for DELAYED status, delayed vehicles and unavailable pickers"],
    refs: refs(delayed.map((o) => o.id), [], [], dispatchEx ? [dispatchEx.id] : []),
    action: dispatchEx ? exceptionProposal(dispatchEx) : undefined,
  };
}

function answerSku(state: WarehouseState, sku: string): CopilotReply {
  const p = state.products.find((x) => x.sku === sku);
  if (!p) {
    return {
      answer: `I can't find **${sku}** in the inventory.`,
      facts: ["SKU lookup failed against live products"],
      confidence: 0.9,
      reasoning: ["Entity lookup failed"],
      refs: refs([], [sku]),
    };
  }
  const demand = demandForSku(state, sku);
  const needing = demand.filter((o) => o.items.some((i) => i.sku === sku && i.qty - i.allocated > 0));
  const holders = demand.filter((o) => o.items.some((i) => i.sku === sku && i.allocated > 0));
  const conflict = conflictForSku(state, sku);

  let answer = `**${sku} — ${p.name}** is **${p.stockStatus.toUpperCase()}**: ${p.available} available, ${p.reserved} reserved, ${p.damaged} damaged (safety stock ${p.safetyStock}, reorder at ${p.reorderThreshold}).`;
  if (p.available < p.safetyStock) answer += `\n\nStock is below the safety buffer — every further allocation pressures this SKU.`;

  if (needing.length > 0) {
    answer += `\n\n**Open demand:**`;
    answer += `\n${needing
      .map((o) => {
        const line = o.items.find((i) => i.sku === sku);
        const need = (line?.qty ?? 0) - (line?.allocated ?? 0);
        return `- #${o.id} needs ${need} more (priority ${o.priority.toUpperCase()}, score ${o.score})`;
      })
      .join("\n")}`;
  }
  if (holders.length > 0) {
    answer += `\n\n**Reservations held:** ${holders.map((o) => `#${o.id} ×${o.items.find((i) => i.sku === sku)?.allocated}`).join(", ")}.`;
  }

  let action: CopilotActionProposal | undefined;
  if (conflict) {
    const rec = conflict.options.find((o) => o.id === conflict.recommendedOptionId);
    answer += `\n\nThe Allocation Engine scored **${conflict.options.length} strategies** for ${sku}. Recommended: Scenario **${rec?.id}** (risk ${rec?.riskScore}, fulfillment ${rec?.fulfillmentAfter}%, delay ${rec?.expectedDelayMin === 0 ? "0m" : `${rec?.expectedDelayMin}m`}).`;
    action = allocationProposal(state, conflict);
  } else if (p.stockStatus === "out" || p.stockStatus === "critical") {
    action = replenishProposal(state, sku);
    if (!action) answer += `\n\nNo replenishment PO is drafted yet — this SKU should be flagged for replenishment.`;
  }

  return {
    answer,
    facts: [
      `${p.available} available / ${p.reserved} reserved / ${p.damaged} damaged`,
      `Safety stock ${p.safetyStock} · reorder threshold ${p.reorderThreshold}`,
      `${needing.length} order(s) with unmet demand`,
      `${holders.length} order(s) holding reservations`,
    ],
    recommendedAction: action?.title,
    confidence: 0.95,
    reasoning: [
      `Detected intent: SKU advisory for ${sku}`,
      `Stock status from live inventory (${p.stockStatus})`,
      conflict ? `Allocation Engine generated ${conflict.options.length} scenarios` : "No allocation conflict — stock covers demand",
    ],
    refs: refs(needing.map((o) => o.id), [sku], conflict ? state.decisions.filter((d) => d.status === "open" && d.sku === sku).map((d) => d.id) : []),
    action,
  };
}

function answerCriticalSkus(state: WarehouseState): CopilotReply {
  const critical = state.products
    .filter((p) => p.stockStatus === "out" || p.stockStatus === "critical")
    .sort((a, b) => (a.stockStatus === "out" ? 0 : 1) - (b.stockStatus === "out" ? 0 : 1) || a.available - b.available);

  if (critical.length === 0) {
    return {
      answer: "No SKUs are in critical or out-of-stock condition right now. Every SKU is at or above its safety stock.",
      facts: [`${state.products.length} SKUs tracked, all healthy`],
      confidence: 0.9,
      reasoning: ["Scanned live inventory for critical/out status"],
      refs: refs(),
    };
  }

  let answer = `**${critical.length} SKU(s)** need attention:\n`;
  answer += critical.map((p) => `- ${stockLine(p)}`).join("\n");

  const withPo = critical.find((p) => p.replenishQty !== undefined);
  const withoutPo = critical.find((p) => p.replenishQty === undefined);
  let action: CopilotActionProposal | undefined;
  if (withPo) action = replenishProposal(state, withPo.sku);
  if (!action && withoutPo) {
    const conflict = conflictForSku(state, withoutPo.sku);
    if (conflict) action = allocationProposal(state, conflict);
  }
  answer += `\n\n${withPo ? `A replenishment PO is drafted for **${withPo.sku}** (+${withPo.replenishQty}) — confirm receipt to restore stock.` : "No POs drafted yet — these SKUs should be flagged for replenishment."}`;

  return {
    answer,
    facts: [
      `${critical.filter((p) => p.stockStatus === "out").length} out of stock`,
      `${critical.filter((p) => p.stockStatus === "critical").length} below safety stock`,
      `${state.products.filter((p) => p.replenishQty !== undefined).length} PO(s) drafted`,
    ],
    recommendedAction: action?.title,
    confidence: 0.92,
    reasoning: ["Ranked live inventory by stock status and safety-stock gap"],
    refs: refs([], critical.map((p) => p.sku)),
    action,
  };
}

function answerTopRisk(state: WarehouseState): CopilotReply {
  const ranked = atRiskSorted(state);
  const atRisk = ranked.filter((o) => {
    const r = riskOf(state, o);
    return r.level === "high" || r.level === "critical";
  });

  if (atRisk.length === 0) {
    return {
      answer: "No orders are currently at high or critical risk. The pipeline is on track — the main watch item is stock that sits below safety levels.",
      facts: [`${state.products.filter((p) => p.stockStatus !== "healthy").length} SKUs below healthy`],
      confidence: 0.85,
      reasoning: ["Risk Engine scan found no high/critical orders"],
      refs: refs(),
    };
  }

  const top = atRisk[0];
  const r = riskOf(state, top);
  const remaining = remainingSla(top, state.clock);
  const conflict = conflictForOrder(state, top.id);

  let answer = `The biggest risk right now is **order #${top.id}** (${top.customer}) — **${r.level.toUpperCase()} risk, score ${r.score}**. ${r.reason}. ${fmtSla(Math.max(0, remaining))} of SLA remains (deadline ${fmtClock(top.createdAt + top.slaMinutes)}).`;
  answer += `\n\n**Why it matters:** ${r.predictedIssue}.`;

  if (atRisk.length > 1) {
    answer += `\n\nAlso at risk:`;
    answer += `\n${atRisk.slice(1, 4).map((o) => `- #${o.id} (${riskOf(state, o).level.toUpperCase()}, score ${riskOf(state, o).score}) — ${riskOf(state, o).reason}`).join("\n")}`;
  }

  let action: CopilotActionProposal | undefined;
  if (state.chaos.disruptions.length > 0 && state.chaos.recoveryPlan) {
    action = {
      kind: "recovery",
      title: `Apply recovery plan — ${state.chaos.recoveryPlan.steps.length} steps`,
      summary: "The Recovery Engine generated a coordinated plan covering every active disruption.",
      impact: state.chaos.recoveryPlan.predictedImprovement,
    };
  } else if (conflict) {
    action = allocationProposal(state, conflict);
  } else if (top.exceptionId) {
    const ex = state.exceptions.find((e) => e.id === top.exceptionId);
    if (ex) action = exceptionProposal(ex);
  }

  return {
    answer,
    facts: [
      `${atRisk.length} order(s) at high/critical risk`,
      `Top risk: #${top.id} — ${r.reason}`,
      `Critical: ${state.chaos.disruptions.length > 0 ? `${state.chaos.disruptions.length} disruption(s) active` : "none"}`,
    ],
    recommendedAction: action?.title,
    confidence: 0.9,
    reasoning: ["Risk Engine ranked every open order by risk score", "Top issue mapped to its live recovery/allocation path"],
    refs: refs(atRisk.slice(0, 4).map((o) => o.id), conflict ? [conflict.sku] : [], state.chaos.disruptions.length > 0 ? [] : state.decisions.filter((d) => d.status === "open").map((d) => d.id)),
    action,
  };
}

function answerHealth(state: WarehouseState): CopilotReply {
  const atRiskCount = atRiskSorted(state).filter((o) => {
    const r = riskOf(state, o);
    return r.level === "high" || r.level === "critical";
  }).length;
  const bottlenecks = detectBottlenecks(state);
  const criticalBn = bottlenecks.filter((b) => b.severity === "critical").length;
  const health = Math.max(0, 100 - atRiskCount * 9 - criticalBn * 12);
  const outStock = state.products.filter((p) => p.stockStatus === "out").length;
  const delayedTrucks = state.vehicles.filter((v) => v.status === "delayed").length;

  let answer = `Warehouse health is **${health}%**. It is computed as ${100} minus **${atRiskCount}** order(s) at risk (×9) and **${criticalBn}** critical bottleneck(s) (×12).`;
  const drivers: string[] = [];
  if (atRiskCount > 0) drivers.push(`${atRiskCount} orders at risk`);
  if (criticalBn > 0) drivers.push(`${criticalBn} critical bottleneck${criticalBn > 1 ? "s" : ""}`);
  if (outStock > 0) drivers.push(`${outStock} SKU(s) out of stock`);
  if (delayedTrucks > 0) drivers.push(`${delayedTrucks} delayed truck(s)`);
  if (drivers.length > 0) answer += `\n\n**What's dragging it down:** ${drivers.join(", ")}.`;
  else answer += `\n\nNo major drags — health is high.`;

  const top = atRiskSorted(state)[0];
  const conflict = top ? conflictForOrder(state, top.id) : null;
  let action: CopilotActionProposal | undefined;
  if (state.chaos.disruptions.length > 0 && state.chaos.recoveryPlan) {
    action = { kind: "recovery", title: "Apply recovery plan", summary: "Clears the active disruptions that are depressing health.", impact: state.chaos.recoveryPlan.predictedImprovement };
  } else if (conflict) action = allocationProposal(state, conflict);

  return {
    answer,
    facts: [
      `${atRiskCount} orders at risk (high/critical)`,
      `${bottlenecks.length} bottleneck(s), ${criticalBn} critical`,
      `${outStock} out of stock · ${delayedTrucks} truck(s) delayed`,
    ],
    recommendedAction: action?.title,
    confidence: 0.88,
    reasoning: ["Health formula mirrors the Control Tower KPI", "Drivers derived from live risk, bottleneck and stock scans"],
    refs: refs(atRiskCount > 0 ? [atRiskSorted(state)[0].id] : [], state.products.filter((p) => p.stockStatus === "out").map((p) => p.sku)),
    action,
  };
}

function answerSlaMiss(state: WarehouseState): CopilotReply {
  const open = openOrders(state);
  const breached = open.filter((o) => remainingSla(o, state.clock) <= 0);
  const tight = open
    .filter((o) => {
      const r = riskOf(state, o);
      const rem = remainingSla(o, state.clock);
      return rem > 0 && rem <= 60 && (r.level === "high" || r.level === "critical");
    })
    .sort((a, b) => remainingSla(a, state.clock) - remainingSla(b, state.clock));

  let answer: string;
  if (breached.length === 0 && tight.length === 0) {
    answer = "No orders are currently breaching or near breaching their SLA windows.";
  } else {
    answer = "";
    if (breached.length > 0) {
      answer += `**${breached.length} order(s)** have already breached their SLA:\n`;
      answer += breached.slice(0, 6).map((o) => `- #${o.id} — ${fmtSla(remainingSla(o, state.clock))} past deadline, status ${o.status.toUpperCase()}`).join("\n");
    }
    if (tight.length > 0) {
      if (breached.length > 0) answer += `\n`;
      answer += `\n**${tight.length} more** are at real risk of missing their window (≤60m left, high/critical risk):\n`;
      answer += tight.slice(0, 6).map((o) => `- #${o.id} — ${fmtSla(Math.max(0, remainingSla(o, state.clock)))} left, ${riskOf(state, o).reason}`).join("\n");
    }
  }

  const top = tight[0] ?? breached[0];
  const conflict = top ? conflictForOrder(state, top.id) : null;
  const action = conflict ? allocationProposal(state, conflict) : undefined;

  return {
    answer,
    facts: [
      `${breached.length} breached · ${tight.length} at risk of breach`,
      `${open.length} open orders in the pipeline`,
    ],
    recommendedAction: action?.title,
    confidence: 0.9,
    reasoning: ["SLA math from live clock vs each order's deadline", "Tight window + risk-engine score filtered the near-miss set"],
    refs: refs([...breached.slice(0, 6).map((o) => o.id), ...tight.slice(0, 6).map((o) => o.id)], conflict ? [conflict.sku] : []),
    action,
  };
}

function answerDisruption(state: WarehouseState): CopilotReply {
  const active = state.chaos.disruptions;
  const plan = state.chaos.recoveryPlan;

  if (active.length === 0) {
    const recent = state.events.filter((e) => e.severity === "critical" || e.severity === "warning").slice(0, 5);
    const applied = state.chaos.appliedAt !== undefined;
    let answer = applied
      ? `No active disruptions — the last recovery plan was applied at **${fmtClock(state.chaos.appliedAt ?? 0)}** and stabilized the operation.`
      : "No disruptions are active right now.";
    if (recent.length > 0) {
      answer += `\n\n**Recent operational events:**\n${recent.map((e) => `- [${fmtClock(e.time)}] ${e.message}`).join("\n")}`;
    }
    return {
      answer,
      facts: [`${state.exceptions.filter((e) => e.status === "open").length} open exceptions still on the board`],
      confidence: 0.85,
      reasoning: ["Chaos state shows zero active disruptions", "Fell back to recent critical/warning events"],
      refs: refs([], [], [], state.exceptions.filter((e) => e.status === "open").slice(0, 3).map((e) => e.id)),
    };
  }

  let answer = `**${active.length} disruption(s)** are active right now:\n`;
  answer += active.map((d) => `- **${d.title}** — ${d.detail}${d.affectedOrders.length > 0 ? ` (orders ${d.affectedOrders.map((o) => `#${o}`).join(", ")})` : ""}`).join("\n");

  if (plan) {
    answer += `\n\n**Recovery plan (${plan.steps.length} steps):**`;
    answer += `\n${plan.steps.map((s) => `- ${s.title} — ${s.detail}`).join("\n")}`;
    answer += `\n\n**Predicted impact:** ${plan.predictedImprovement.join("; ")}.`;
  }

  const action: CopilotActionProposal | undefined = plan
    ? {
        kind: "recovery",
        title: `Apply recovery plan — ${plan.steps.length} steps`,
        summary: "One coordinated plan covering every active disruption. Applying it executes all steps in order.",
        impact: plan.predictedImprovement,
      }
    : undefined;

  const affectedOrders = [...new Set(active.flatMap((d) => d.affectedOrders))];
  const affectedSkus = [...new Set(active.flatMap((d) => d.affectedSkus))];

  return {
    answer,
    facts: [
      `${active.length} active disruption(s)`,
      `${affectedOrders.length} affected order(s) · ${affectedSkus.length} affected SKU(s)`,
      plan ? `Predicted: ${plan.riskBefore} → ${plan.riskAfter} orders at risk` : "No recovery plan generated yet",
    ],
    recommendedAction: action?.title,
    confidence: 0.95,
    reasoning: ["Enumerated every active disruption from the chaos state", "Recovery plan generated by the Recovery Engine with predicted before/after"],
    refs: refs(affectedOrders, affectedSkus, [], state.exceptions.filter((e) => e.status === "open" && affectedOrders.includes(e.orderId ?? "")).map((e) => e.id)),
    action,
  };
}

function answerDecisionReason(state: WarehouseState): CopilotReply {
  const openDecision = state.decisions.find((d) => d.status === "open" && d.type === "allocation");
  const conflict =
    (openDecision && openDecision.orderId && openDecision.sku
      ? getAllocationConflict(state, openDecision.orderId, openDecision.sku)
      : null) ?? topConflict(state);

  if (!conflict) {
    const lastApplied = state.decisions.filter((d) => d.status === "applied").sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0))[0];
    if (lastApplied) {
      return {
        answer: `The last applied decision was **${lastApplied.id}** (${lastApplied.title}). ${lastApplied.recommendation}`,
        facts: lastApplied.impact,
        confidence: 0.8,
        reasoning: ["No open allocation decision — reported the most recent applied one"],
        refs: refs([], [], [lastApplied.id]),
        changeItems: lastApplied.changes,
      };
    }
    return {
      answer: "There is no open allocation decision right now, and no applied decisions to explain yet.",
      facts: ["No decisions in the log"],
      confidence: 0.8,
      reasoning: ["Decision log scan"],
      refs: refs(),
    };
  }

  const rec = conflict.options.find((o) => o.id === conflict.recommendedOptionId);
  const others = conflict.options.filter((o) => o.id !== conflict.recommendedOptionId);

  let answer = `Scenario **${rec?.id}** was selected for **#${conflict.orderId} · ${conflict.sku}** because it has the lowest composite risk score — **${rec?.riskScore}**`;
  if (others.length > 0) {
    answer += ` versus ${others.map((o) => `${o.riskScore} (${o.id})`).join(" and ")}`;
  }
  answer += `. The score weights SLA risk (×0.4), fulfillment gap (×0.3), expected delay (×0.2) and warehouse movement (×0.1).`;
  answer += `\n\nScenario ${rec?.id} still delivers **${rec?.fulfillmentAfter}% fulfillment** and **${rec?.expectedDelayMin === 0 ? "0m expected delay" : `${rec?.expectedDelayMin}m expected delay`}** — the best risk-adjusted outcome.`;
  answer += `\n\n**Alternatives considered:**\n${conflict.options.map((o) => `- Scenario ${o.id} (${o.label}): fulfillment ${o.fulfillmentAfter}%, delay ${o.expectedDelayMin === 0 ? "0m" : `${o.expectedDelayMin}m`}, risk ${o.riskScore}`).join("\n")}`;

  return {
    answer,
    facts: [
      `Recommended: Scenario ${rec?.id} — risk ${rec?.riskScore}, fulfillment ${rec?.fulfillmentAfter}%, delay ${rec?.expectedDelayMin === 0 ? "0m" : `${rec?.expectedDelayMin}m`}`,
      ...others.map((o) => `Alternative ${o.id}: risk ${o.riskScore}`),
    ],
    recommendedAction: `Apply Scenario ${rec?.id}`,
    confidence: 0.9,
    reasoning: ["Read the Allocation Engine's weighted scoring breakdown for the live conflict"],
    refs: refs([conflict.orderId], [conflict.sku], openDecision ? [openDecision.id] : []),
    action: allocationProposal(state, conflict),
  };
}

function answerChanges(state: WarehouseState): CopilotReply {
  const applied = state.decisions
    .filter((d) => d.status === "applied" && d.changes && d.changes.length > 0)
    .sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0))[0];

  if (!applied) {
    return {
      answer: "No decision has been applied yet in this session, so there are no before → after changes to report. Apply a decision from the Decision Center or the Copilot and I'll show you exactly what changed.",
      facts: ["0 applied decisions with recorded changes"],
      confidence: 0.85,
      reasoning: ["Scanned the decision log for applied decisions with change reports"],
      refs: refs(),
    };
  }

  return {
    answer: `**${applied.id}** was applied at **${fmtClock(applied.appliedAt ?? 0)}** — here is exactly what changed:\n${(applied.changes ?? []).map((c) => `- ${c.label}: ~~${c.before}~~ → **${c.after}**`).join("\n")}`,
    facts: [
      `${applied.changes?.length ?? 0} tracked changes`,
      `Impact: ${applied.impact[0] ?? "recorded"}`,
    ],
    confidence: 0.9,
    reasoning: ["Diff captured at application time by the store's change reporter"],
    refs: refs([], [], [applied.id]),
    changeItems: applied.changes,
  };
}

function answerSimulate(state: WarehouseState): CopilotReply {
  const conflict = topConflict(state);
  if (!conflict) {
    return {
      answer: "There's no active allocation conflict to simulate right now — the engine only simulates real pressure points. Trigger Chaos Mode or resolve the current SKU-104 shortage to create one.",
      facts: ["No active allocation conflicts"],
      confidence: 0.85,
      reasoning: ["findActiveConflicts returned nothing"],
      refs: refs(),
    };
  }

  const wait = conflict.options.find((o) => o.id === "C") ?? conflict.options[conflict.options.length - 1];
  const rec = conflict.options.find((o) => o.id === conflict.recommendedOptionId);

  let answer = `If you **wait for replenishment** on **#${conflict.orderId} · ${conflict.sku}**: nothing is allocated immediately — fulfillment drops to **${wait.fulfillmentAfter}%** with **${wait.expectedDelayMin === 0 ? "0m" : `${wait.expectedDelayMin}m`} expected delay** while a +${wait.replenishQty} PO lands (ETA ${REPLENISH_ETA_MIN}m). Risk score **${wait.riskScore}**.`;
  answer += `\n\nThe engine instead recommends Scenario **${rec?.id}** (risk ${rec?.riskScore}, fulfillment ${rec?.fulfillmentAfter}%, delay ${rec?.expectedDelayMin === 0 ? "0m" : `${rec?.expectedDelayMin}m`}) — it protects the SLA while still drafting the same replenishment.`;

  return {
    answer,
    facts: [
      `Wait scenario (${wait.id}): fulfillment ${wait.fulfillmentAfter}%, delay ${wait.expectedDelayMin}m, risk ${wait.riskScore}`,
      `Recommended (${rec?.id}): fulfillment ${rec?.fulfillmentAfter}%, delay ${rec?.expectedDelayMin === 0 ? "0m" : `${rec?.expectedDelayMin}m`}, risk ${rec?.riskScore}`,
    ],
    recommendedAction: `Compare all ${conflict.options.length} scenarios in the What-If Simulator`,
    confidence: 0.88,
    reasoning: ["Simulated the wait outcome from the Allocation Engine's scenario set", "Compared against the recommended scenario on the same metrics"],
    refs: refs([conflict.orderId], [conflict.sku]),
    action: simProposal(state, conflict),
  };
}

function answerBottlenecks(state: WarehouseState): CopilotReply {
  const bottlenecks = detectBottlenecks(state);
  if (bottlenecks.length === 0) {
    return {
      answer: "No bottlenecks detected — every stage (picking, packing, QC, dispatch, replenishment) is within capacity.",
      facts: ["0 bottlenecks"],
      confidence: 0.85,
      reasoning: ["Bottleneck Engine scan across all pipeline stages"],
      refs: refs(),
    };
  }

  const top = bottlenecks.slice(0, 4);
  let answer = `**${bottlenecks.length} bottleneck(s)** detected:\n`;
  answer += top
    .map((b) => `- **${b.title}** (${b.severity.toUpperCase()}) — ${b.detail} *Recommended:* ${b.recommendation}`)
    .join("\n");
  if (bottlenecks.length > 4) answer += `\n\n…and ${bottlenecks.length - 4} more on the Control Tower.`;

  const stall = bottlenecks.find((b) => b.stage === "picking" && b.title.includes("stalled"));
  const dispatch = bottlenecks.find((b) => b.stage === "dispatch");
  let action: CopilotActionProposal | undefined;
  if (dispatch) {
    const ex = state.exceptions.find((e) => e.status === "open" && e.type === "dispatch-delay");
    if (ex) action = exceptionProposal(ex);
  }
  if (!action && stall) {
    const ex = state.exceptions.find((e) => e.status === "open" && e.type === "picker-unavailable");
    if (ex) action = exceptionProposal(ex);
  }

  return {
    answer,
    facts: [
      `${bottlenecks.filter((b) => b.severity === "critical").length} critical`,
      `${bottlenecks.filter((b) => b.severity === "high").length} high`,
      `${bottlenecks.filter((b) => b.severity === "medium").length} medium`,
    ],
    recommendedAction: action?.title,
    confidence: 0.88,
    reasoning: ["Bottleneck Engine flagged stages where throughput trails demand", "Mapped the top bottleneck to its live exception/recovery path"],
    refs: refs(bottlenecks.flatMap((b) => (b.stage === "dispatch" ? state.orders.filter((o) => o.status === "ready").map((o) => o.id) : [])), [], [], action?.exceptionId ? [action.exceptionId] : []),
    action,
  };
}

function answerPrioritize(state: WarehouseState): CopilotReply {
  const priorities: string[] = [];
  let action: CopilotActionProposal | undefined;

  if (state.chaos.disruptions.length > 0 && state.chaos.recoveryPlan) {
    priorities.push(`**1. Apply the recovery plan** — ${state.chaos.disruptions.length} active disruption(s) are driving the risk picture. The ${state.chaos.recoveryPlan.steps.length}-step plan predicts ${state.chaos.recoveryPlan.riskBefore} → ${state.chaos.recoveryPlan.riskAfter} orders at risk.`);
    action = { kind: "recovery", title: `Apply recovery plan — ${state.chaos.recoveryPlan.steps.length} steps`, summary: "Coordinated plan covering all active disruptions.", impact: state.chaos.recoveryPlan.predictedImprovement };
  }

  const openDecision = state.decisions.find((d) => d.status === "open" && d.type === "allocation");
  const conflict = openDecision && openDecision.orderId && openDecision.sku ? getAllocationConflict(state, openDecision.orderId, openDecision.sku) : null;
  if (conflict) {
    const rec = conflict.options.find((o) => o.id === conflict.recommendedOptionId);
    priorities.push(`**${priorities.length + 1}. Resolve the ${conflict.sku} allocation conflict** — #${conflict.orderId} needs ${conflict.requiredQty} units with ${conflict.availableQty} available. Recommended Scenario ${rec?.id} (risk ${rec?.riskScore}, ${rec?.fulfillmentAfter}% fulfillment).`);
    if (!action) action = allocationProposal(state, conflict);
  }

  const ranked = atRiskSorted(state).filter((o) => {
    const r = riskOf(state, o);
    return r.level === "high" || r.level === "critical";
  });
  if (ranked.length > 0) {
    const top = ranked[0];
    const r = riskOf(state, top);
    priorities.push(`**${priorities.length + 1}. Watch order #${top.id}** — ${r.level.toUpperCase()} risk (${r.score}) · ${r.reason} · ${fmtSla(Math.max(0, remainingSla(top, state.clock)))} of SLA left.`);
    if (!action && top.exceptionId) {
      const ex = state.exceptions.find((e) => e.id === top.exceptionId);
      if (ex) action = exceptionProposal(ex);
    }
  }

  const outStock = state.products.filter((p) => p.stockStatus === "out" || p.stockStatus === "critical");
  if (outStock.length > 0) {
    priorities.push(`**${priorities.length + 1}. Replenish ${outStock.slice(0, 3).map((p) => p.sku).join(", ")}**${outStock.length > 3 ? ` +${outStock.length - 3} more` : ""} — ${outStock.filter((p) => p.stockStatus === "out").length} out of stock, ${outStock.filter((p) => p.stockStatus === "critical").length} below safety.`);
    if (!action) {
      const withPo = outStock.find((p) => p.replenishQty !== undefined);
      if (withPo) action = replenishProposal(state, withPo.sku);
    }
  }

  const delayedTrucks = state.vehicles.filter((v) => v.status === "delayed");
  if (delayedTrucks.length > 0) {
    priorities.push(`**${priorities.length + 1}. Rebook the ${delayedTrucks.map((t) => t.name).join(", ")} lane** — ${delayedTrucks.length} truck(s) delayed, ready trucks have spare slots.`);
    if (!action) {
      const ex = state.exceptions.find((e) => e.status === "open" && e.type === "dispatch-delay");
      if (ex) action = exceptionProposal(ex);
    }
  }

  if (priorities.length === 0) {
    priorities.push("**1. Keep the pipeline moving** — no disruptions, no open decisions, no at-risk orders. Focus on steady picking/packing throughput.");
  }

  return {
    answer: `Here's what I'd prioritize right now, in order:\n\n${priorities.join("\n")}`,
    facts: [
      `${state.chaos.disruptions.length} active disruption(s)`,
      `${state.decisions.filter((d) => d.status === "open").length} open decision(s)`,
      `${ranked.length} order(s) at risk`,
      `${outStock.length} SKU(s) below safety`,
    ],
    recommendedAction: action?.title,
    confidence: 0.87,
    reasoning: ["Priority order follows the operator rubric: disruptions → critical/SLA orders → inventory → workload", "Each item is backed by a live engine scan"],
    refs: refs(ranked.slice(0, 3).map((o) => o.id), outStock.slice(0, 3).map((p) => p.sku), openDecision ? [openDecision.id] : [], action?.exceptionId ? [action.exceptionId] : []),
    action,
  };
}

function answerSummary(state: WarehouseState): CopilotReply {
  const open = openOrders(state);
  const atRisk = atRiskSorted(state).filter((o) => {
    const r = riskOf(state, o);
    return r.level === "high" || r.level === "critical";
  });
  const bottlenecks = detectBottlenecks(state);
  const pipeline = {
    created: open.filter((o) => o.status === "created" || o.status === "prioritized").length,
    allocated: open.filter((o) => o.status === "allocated").length,
    picking: open.filter((o) => o.status === "picking").length,
    packing: open.filter((o) => o.status === "packing").length,
    qc: open.filter((o) => o.status === "quality-check").length,
    ready: open.filter((o) => o.status === "ready").length,
    dispatched: state.orders.filter((o) => o.status === "dispatched").length,
  };
  const critical = state.products.filter((p) => p.stockStatus === "critical" || p.stockStatus === "out");

  let answer = `**Shift summary — ${fmtClock(state.clock)}**\n\n`;
  answer += `- **Pipeline:** ${pipeline.created} queued · ${pipeline.allocated} allocated · ${pipeline.picking} picking · ${pipeline.packing} packing · ${pipeline.qc} in QC · ${pipeline.ready} ready · ${pipeline.dispatched} dispatched`;
  answer += `\n- **Risk:** ${atRisk.length} order(s) at risk (${atRisk.filter((o) => riskOf(state, o).level === "critical").length} critical)${atRisk[0] ? ` — top: #${atRisk[0].id} (${riskOf(state, atRisk[0]).reason})` : ""}`;
  answer += `\n- **Exceptions:** ${state.exceptions.filter((e) => e.status === "open").length} open · **Decisions:** ${state.decisions.filter((d) => d.status === "open").length} open`;
  answer += `\n- **Inventory:** ${critical.length} SKU(s) below safety (${critical.filter((p) => p.stockStatus === "out").length} out) · ${state.products.filter((p) => p.replenishQty !== undefined).length} PO(s) drafted`;
  answer += `\n- **Dispatch:** ${state.vehicles.filter((v) => v.status === "ready").length} truck(s) ready · ${state.vehicles.filter((v) => v.status === "delayed").length} delayed`;
  answer += `\n- **Bottlenecks:** ${bottlenecks.length} detected (${bottlenecks.filter((b) => b.severity === "critical").length} critical)`;
  if (state.chaos.disruptions.length > 0) {
    answer += `\n- **Disruptions:** ${state.chaos.disruptions.length} ACTIVE — recovery plan ready`;
  }

  let action: CopilotActionProposal | undefined;
  if (state.chaos.disruptions.length > 0 && state.chaos.recoveryPlan) {
    action = { kind: "recovery", title: "Apply recovery plan", summary: "Clears all active disruptions.", impact: state.chaos.recoveryPlan.predictedImprovement };
  } else {
    const conflict = topConflict(state);
    if (conflict) action = allocationProposal(state, conflict);
  }

  return {
    answer,
    facts: [
      `${open.length} open orders`,
      `${atRisk.length} at risk`,
      `${state.exceptions.filter((e) => e.status === "open").length} open exceptions`,
      `${critical.length} SKUs below safety`,
    ],
    recommendedAction: action?.title,
    confidence: 0.9,
    reasoning: ["Compiled the compact live-state snapshot the session was initialized with"],
    refs: refs(atRisk.slice(0, 3).map((o) => o.id), critical.slice(0, 3).map((p) => p.sku), state.decisions.filter((d) => d.status === "open").map((d) => d.id), state.exceptions.filter((e) => e.status === "open").slice(0, 3).map((e) => e.id)),
    action,
  };
}

function answerFallback(state: WarehouseState, question: string): CopilotReply {
  const summary = answerSummary(state);
  return {
    answer: `I read your question as "${question.trim()}". I'm the WAREFLOW operational assistant — I can explain why orders are at risk, which SKUs need attention, what to prioritize, what happened during disruptions, and simulate or apply decisions.\n\nHere's the current picture:\n${summary.answer.split("\n").slice(1).join("\n")}`,
    facts: summary.facts,
    recommendedAction: summary.recommendedAction,
    confidence: 0.6,
    reasoning: ["No high-confidence intent match — returned the live-state overview", "Try asking about a specific order (#id), SKU, decision or disruption"],
    refs: summary.refs,
    action: summary.action,
  };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function answerQuestion(state: WarehouseState, question: string): CopilotReply {
  const parsed = parseQuestion(question);
  switch (parsed.intent) {
    case "truck":
      return answerTruck(state, parsed.orderId);
    case "delayed":
      return answerDelayed(state, parsed.orderId);
    case "order_risk":
      return answerOrderRisk(state, parsed.orderId!);
    case "changes":
      return answerChanges(state);
    case "decision_reason":
      return answerDecisionReason(state);
    case "disruption":
      return answerDisruption(state);
    case "critical_skus":
      return answerCriticalSkus(state);
    case "sku":
      return answerSku(state, parsed.sku!);
    case "simulate":
      return answerSimulate(state);
    case "sla_miss":
      return answerSlaMiss(state);
    case "top_risk":
      return answerTopRisk(state);
    case "health":
      return answerHealth(state);
    case "bottlenecks":
      return answerBottlenecks(state);
    case "prioritize":
      return answerPrioritize(state);
    case "summary":
      return answerSummary(state);
    case "fallback":
      return answerFallback(state, question);
  }
}
