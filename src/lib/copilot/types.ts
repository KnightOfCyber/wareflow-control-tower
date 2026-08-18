import type { ChangeItem } from "@/types";

/**
 * WAREFLOW COPILOT — domain types.
 * The Copilot is a deterministic operational assistant: it reads the live
 * warehouse state through the existing decision engines and only ever
 * mutates state by re-using the same store actions the UI already uses.
 */

/** Entity references surfaced as clickable chips in chat. */
export interface CopilotRefs {
  orders: string[];
  skus: string[];
  decisions: string[];
  exceptions: string[];
}

export type CopilotActionKind =
  | "allocation" // apply an Allocation Engine scenario (via decision or direct)
  | "recovery" // apply the Recovery Engine plan
  | "exception" // resolve an open exception with its recommended option
  | "replenish" // confirm a drafted replenishment receipt
  | "sim"; // open the What-If Simulator session (no state change)

/**
 * A proposed executable action. NEVER auto-applied: the chat renders it as
 * an action card with impact preview and requires explicit operator
 * confirmation before the store action runs.
 */
export interface CopilotActionProposal {
  kind: CopilotActionKind;
  title: string;
  summary: string;
  /** Before → after style impact lines, computed from engine data. */
  impact: string[];
  decisionId?: string;
  orderId?: string;
  sku?: string;
  optionId?: string;
  optionLabel?: string;
  conflictKey?: string;
  exceptionId?: string;
  exceptionOptionLabel?: string;
}

export interface CopilotReply {
  /** Markdown-lite answer. */
  answer: string;
  /** Supporting facts (numbers pulled from live state). */
  facts: string[];
  recommendedAction?: string;
  /** 0..1 — how confidently the intent was matched. */
  confidence: number;
  /** Why the assistant answered this way (explainability). */
  reasoning: string[];
  refs: CopilotRefs;
  /** Optional executable proposal — requires operator confirmation. */
  action?: CopilotActionProposal;
  /** Optional before/after diff rows (e.g. "what changed" questions). */
  changeItems?: ChangeItem[];
}

export type ChatActionState = "proposed" | "simulated" | "applying" | "applied" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Warehouse clock at creation time. */
  at: number;
  reply?: CopilotReply;
  action?: CopilotActionProposal;
  actionState?: ChatActionState;
  appliedSummary?: string;
  appliedChanges?: ChangeItem[];
  error?: string;
}

/** Compact live-state snapshot shown in the chat context bar. */
export interface CopilotContext {
  clock: number;
  openOrders: number;
  atRisk: number;
  criticalRisk: number;
  openExceptions: number;
  openDecisions: number;
  disruptions: number;
  lowStock: number;
  outStock: number;
  draftedPos: number;
  delayedOrders: number;
  delayedTrucks: number;
}
