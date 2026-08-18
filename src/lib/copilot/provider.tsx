import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeItem, WarehouseState } from "@/types";
import { useWarehouse } from "@/lib/state/store";
import { getAllocationConflict } from "@/lib/decision-engine/allocation-engine";
import { buildAllocationChanges, buildRecoveryChanges, buildResolutionChanges } from "@/lib/state/changes";
import { fmtClock } from "@/lib/format";
import { answerQuestion } from "./engine";
import { buildCopilotContext, contextChips } from "./context";
import type { ChatActionState, ChatMessage, CopilotContext } from "./types";

/**
 * WAREFLOW COPILOT PROVIDER
 * Owns the conversation and the ACTION SAFETY gate. Every state-changing
 * proposal is rendered as an impact card; only an explicit operator click
 * ("Apply") invokes the SAME store action the UI uses. After the reducer
 * applies it, the provider diffs before/after state and reports it in chat.
 */

interface PendingApply {
  messageId: string;
  before: WarehouseState;
  kind: "allocation" | "recovery" | "exception" | "replenish";
  orderId?: string;
  sku?: string;
  optionId?: string;
  decisionId?: string;
  exceptionId?: string;
}

interface CopilotApi {
  messages: ChatMessage[];
  busy: boolean;
  context: CopilotContext;
  contextLabel: string;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  send: (text: string) => void;
  clear: () => void;
  confirmAction: (messageId: string) => void;
  cancelAction: (messageId: string) => void;
}

const CopilotContextApi = createContext<CopilotApi | null>(null);

let msgSeq = 0;
function nextId() {
  msgSeq += 1;
  return `COP-${String(msgSeq).padStart(4, "0")}`;
}

function welcomeMessage(state: WarehouseState): ChatMessage {
  const ctx = buildCopilotContext(state);
  const chips = contextChips(ctx);
  return {
    id: nextId(),
    role: "assistant",
    content: `**Wareflow Copilot online** — connected to the **live warehouse state** at ${fmtClock(ctx.clock)}.\n\n${chips.join(" · ")}\n\nAsk me about orders, risk, stock, disruptions or what to do next. I only change state when you approve an action.`,
    at: state.clock,
  };
}

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const { state, actions } = useWarehouse();
  const [messages, setMessages] = useState<ChatMessage[]>(() => [welcomeMessage(state)]);
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const pendingApply = useRef<PendingApply | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const context = useMemo(() => buildCopilotContext(state), [state]);
  const contextLabel = useMemo(
    () => contextChips(context).join(" · "),
    [context],
  );

  // Clean up the simulated-thinking timer on unmount.
  useEffect(() => {
    const t = timerRef.current;
    return () => {
      if (t) clearTimeout(t);
    };
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const appendAssistant = useCallback((msg: Omit<ChatMessage, "id" | "at" | "role">, at: number) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId(), role: "assistant", at }]);
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      const at = stateRef.current.clock;
      setMessages((prev) => [...prev, { id: nextId(), role: "user", content: trimmed, at }]);
      setBusy(true);

      // Simulated "thinking" delay — the answer itself is computed from live state.
      const delay = 420 + Math.random() * 380;
      timerRef.current = setTimeout(() => {
        try {
          const reply = answerQuestion(stateRef.current, trimmed);
          appendAssistant(
            {
              content: reply.answer,
              reply,
              action: reply.action,
              actionState: reply.action ? "proposed" : undefined,
            },
            stateRef.current.clock,
          );
        } catch (err) {
          appendAssistant(
            {
              content: "I hit an error reading the live state — please try rephrasing.",
              error: err instanceof Error ? err.message : "unknown error",
            },
            stateRef.current.clock,
          );
        }
        setBusy(false);
      }, delay);
    },
    [busy, appendAssistant],
  );

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingApply.current = null;
    setBusy(false);
    setMessages([welcomeMessage(stateRef.current)]);
  }, []);

  /** Operator confirmed an action card → run the SAME store action the UI uses. */
  const confirmAction = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      const action = msg?.action;
      if (!action || !msg || msg.actionState === "applied" || msg.actionState === "applying") return;

      const before = stateRef.current;
      let ok = false;
      switch (action.kind) {
        case "allocation": {
          if (action.decisionId) {
            ok = actions.applyDecision(action.decisionId, action.optionId);
          } else if (action.orderId && action.sku) {
            ok = actions.applyAllocation(action.orderId, action.sku, action.optionId ?? "", "decision");
          }
          if (ok) {
            pendingApply.current = {
              messageId,
              before,
              kind: "allocation",
              orderId: action.orderId,
              sku: action.sku,
              optionId: action.optionId,
              decisionId: action.decisionId,
            };
          }
          break;
        }
        case "recovery":
          ok = actions.applyRecovery();
          if (ok) pendingApply.current = { messageId, before, kind: "recovery" };
          break;
        case "exception":
          if (action.exceptionId) {
            ok = actions.resolveException(action.exceptionId, action.optionId ?? "");
            if (ok) pendingApply.current = { messageId, before, kind: "exception", exceptionId: action.exceptionId };
          }
          break;
        case "replenish":
          if (action.sku) {
            ok = actions.confirmReplenishment(action.sku);
            if (ok) pendingApply.current = { messageId, before, kind: "replenish", sku: action.sku };
          }
          break;
        case "sim":
          if (action.orderId && action.sku) ok = actions.startSim(action.orderId, action.sku);
          break;
      }

      if (!ok) {
        patchMessage(messageId, { actionState: "error", appliedSummary: "The current warehouse state does not allow this action." });
        return;
      }
      patchMessage(messageId, { actionState: "applying" });
    },
    [messages, actions, patchMessage],
  );

  const cancelAction = useCallback(
    (messageId: string) => {
      patchMessage(messageId, { actionState: "error", appliedSummary: "Action cancelled by operator — no state was changed." });
    },
    [patchMessage],
  );

  /**
   * Watch for the store to apply the confirmed action, then diff before/after
   * and report the change in chat. TICKs fire this effect too — each kind has
   * a guard so a clock tick is never mistaken for an applied action.
   */
  useEffect(() => {
    const p = pendingApply.current;
    if (!p) return;
    const after = state;
    const before = p.before;

    let done = false;
    let summary = "";
    let changes: ChangeItem[] = [];

    switch (p.kind) {
      case "allocation": {
        const beforeItem = before.orders
          .find((o) => o.id === p.orderId)?.items.find((i) => i.sku === p.sku);
        const afterItem = after.orders
          .find((o) => o.id === p.orderId)?.items.find((i) => i.sku === p.sku);
        const allocatedGrew = (afterItem?.allocated ?? 0) > (beforeItem?.allocated ?? 0);
        const decisionApplied = p.decisionId
          ? after.decisions.find((d) => d.id === p.decisionId)?.status === "applied"
          : false;
        if (!allocatedGrew && !decisionApplied) return; // clock tick, still pending
        const conflict = getAllocationConflict(before, p.orderId ?? "", p.sku ?? "");
        const option = conflict?.options.find((o) => o.id === p.optionId);
        if (conflict && option) changes = buildAllocationChanges(before, after, conflict, option);
        const optionLabel = option?.label ?? "recommended scenario";
        const primary = before.orders.find((o) => o.id === p.orderId);
        const primaryAfter = after.orders.find((o) => o.id === p.orderId);
        summary = `Scenario ${option?.id ?? ""} applied — ${optionLabel}. ${primary ? `#${primary.id} is now ${primaryAfter?.items.find((i) => i.sku === p.sku)?.allocated ?? 0}/${primary.items.find((i) => i.sku === p.sku)?.qty ?? 0} allocated on ${p.sku}.` : ""}`;
        if (option?.replenishQty) summary += ` Replenishment +${option.replenishQty} × ${p.sku} drafted.`;
        done = true;
        break;
      }
      case "recovery": {
        if (before.chaos.disruptions.length === 0) return;
        if (after.chaos.disruptions.length > 0) return; // still active — not applied yet
        const plan = before.chaos.recoveryPlan;
        summary = `Recovery plan applied — ${plan?.steps.length ?? 0} coordinated actions executed. ${plan?.predictedImprovement[0] ?? ""}`;
        changes = buildRecoveryChanges(before);
        done = true;
        break;
      }
      case "exception": {
        const beforeEx = before.exceptions.find((e) => e.id === p.exceptionId);
        const afterEx = after.exceptions.find((e) => e.id === p.exceptionId);
        if (!beforeEx || beforeEx.status !== "open") return;
        if (afterEx?.status !== "resolved") return;
        changes = afterEx.resolvedChanges ?? buildResolutionChanges(before, after, p.exceptionId!);
        summary = `${afterEx.id} resolved — ${afterEx.resolution ?? "recommended option applied"}.`;
        done = true;
        break;
      }
      case "replenish": {
        const beforeP = before.products.find((x) => x.sku === p.sku);
        const afterP = after.products.find((x) => x.sku === p.sku);
        if (!beforeP || beforeP.replenishQty === undefined) return;
        if (afterP?.replenishQty !== undefined || (afterP?.available ?? 0) <= beforeP.available) return;
        summary = `Replenishment received — **+${beforeP.replenishQty} × ${p.sku}** moved into available stock (${beforeP.available} → ${afterP?.available}).`;
        changes = [
          {
            label: `${p.sku} available stock`,
            before: String(beforeP.available),
            after: String(afterP?.available ?? 0),
            tone: "green",
          },
        ];
        done = true;
        break;
      }
    }

    if (!done) return;
    pendingApply.current = null;
    patchMessage(p.messageId, { actionState: "applied", appliedSummary: summary, appliedChanges: changes });
    appendAssistant(
      {
        content: `**Applied successfully.** ${summary}`,
        reply: {
          answer: `**Applied successfully.** ${summary}`,
          facts: changes.map((c) => `${c.label}: ${c.before} → ${c.after}`),
          confidence: 1,
          reasoning: ["State change captured by diffing before/after the store action"],
          refs: { orders: [], skus: [], decisions: [], exceptions: [] },
          changeItems: changes,
        },
      },
      after.clock,
    );
  }, [state, patchMessage, appendAssistant]);

  const api = useMemo<CopilotApi>(
    () => ({
      messages,
      busy,
      context,
      contextLabel,
      drawerOpen,
      setDrawerOpen,
      send,
      clear,
      confirmAction,
      cancelAction,
    }),
    [messages, busy, context, contextLabel, drawerOpen, send, clear, confirmAction, cancelAction],
  );

  return <CopilotContextApi.Provider value={api}>{children}</CopilotContextApi.Provider>;
}

export function useCopilot(): CopilotApi {
  const ctx = useContext(CopilotContextApi);
  if (!ctx) throw new Error("useCopilot must be used within CopilotProvider");
  return ctx;
}

export type { ChatActionState };
