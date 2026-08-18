import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Bot, Eraser, Send, Sparkles } from "lucide-react";
import { useCopilot } from "@/lib/copilot/provider";
import type { ChatMessage, CopilotRefs } from "@/lib/copilot/types";
import { fmtClock } from "@/lib/format";
import { MiniMarkdown } from "./MiniMarkdown";
import { ActionCard } from "./ActionCard";
import { ChangeRows } from "@/components/shared/DecisionCard";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's the biggest risk right now?",
  "Why is #1048 at risk?",
  "What should I prioritize next?",
  "Explain the latest disruption",
  "Which SKUs need replenishment?",
];

function refTarget(kind: keyof CopilotRefs, id: string): string {
  switch (kind) {
    case "orders":
      return `/orders?order=${id}`;
    case "skus":
      return `/inventory?sku=${id}`;
    case "decisions":
      return `/decisions?decision=${id}`;
    case "exceptions":
      return `/exceptions?exception=${id}`;
  }
}

function RefChips({ refs }: { refs: CopilotRefs }) {
  const chips: Array<{ kind: keyof CopilotRefs; id: string }> = [
    ...refs.orders.map((id) => ({ kind: "orders" as const, id })),
    ...refs.skus.map((id) => ({ kind: "skus" as const, id })),
    ...refs.decisions.map((id) => ({ kind: "decisions" as const, id })),
    ...refs.exceptions.map((id) => ({ kind: "exceptions" as const, id })),
  ];
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <Link
          key={`${c.kind}-${c.id}-${i}`}
          to={refTarget(c.kind, c.id)}
          className="wf-mono rounded-[3px] border border-border/80 bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-signal-cyan/50 hover:bg-signal-cyan/10 hover:text-signal-cyan"
        >
          {c.kind === "orders" ? `#${c.id}` : c.kind === "exceptions" ? c.id : c.id}
        </Link>
      ))}
    </div>
  );
}

function Bubble({ message, onConfirm, onCancel }: { message: ChatMessage; onConfirm: (id: string) => void; onCancel: (id: string) => void }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-md border px-3 py-2",
          isUser
            ? "border-signal-cyan/40 bg-signal-cyan/[0.08]"
            : isSystem
              ? "border-border/70 bg-muted/30"
              : "border-border/60 bg-panel",
        )}
      >
        {!isUser && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <Bot className="size-3 text-signal-cyan" />
            <span className="wf-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-signal-cyan">
              Copilot
            </span>
            <span className="wf-mono ml-auto text-[9px] text-muted-foreground/60">{fmtClock(message.at)}</span>
          </div>
        )}
        {message.error && (
          <div className="mb-1.5 rounded-[3px] border border-signal-red/30 bg-signal-red/[0.06] px-2 py-1 text-[10px] text-signal-red">
            Error reading live state — {message.error}
          </div>
        )}
        <MiniMarkdown text={message.content} />
        {message.reply && message.reply.changeItems && message.reply.changeItems.length > 0 && (
          <div className="mt-2 rounded-[3px] border border-border/50 bg-muted/20 px-2 py-1.5">
            <ChangeRows changes={message.reply.changeItems} />
          </div>
        )}
        {message.reply && <RefChips refs={message.reply.refs} />}
        {message.action && message.actionState !== undefined && (
          <ActionCard message={message} onConfirm={onConfirm} onCancel={onCancel} />
        )}
        {!isUser && message.reply && message.reply.confidence > 0 && message.reply.confidence < 1 && (
          <div className="mt-1.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/50">
            <Sparkles className="size-2.5" />
            <span>deterministic engine · confidence {Math.round(message.reply.confidence * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CopilotChat({ variant = "page" }: { variant?: "page" | "drawer" }) {
  const { messages, busy, context, contextLabel, send, clear, confirmAction, cancelAction, setDrawerOpen } = useCopilot();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const empty = useMemo(() => messages.length <= 1, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    send(text);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Context bar */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
        <span className="wf-live-dot" />
        <span className="wf-label truncate text-signal-green">LIVE WAREHOUSE STATE</span>
        <span className="wf-mono ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtClock(context.clock)}</span>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border/50 px-3 pb-2">
        {contextLabel.split(" · ").map((chip) => (
          <span
            key={chip}
            className={cn(
              "wf-mono rounded-[2px] border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider",
              /DISRUPTION|OUT OF STOCK|TRUCK DELAYED/.test(chip)
                ? "border-signal-red/40 bg-signal-red/10 text-signal-red"
                : /AT RISK|EXCEPTION|DELAYED/.test(chip)
                  ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                  : "border-border/70 bg-muted/40 text-muted-foreground",
            )}
          >
            {chip}
          </span>
        ))}
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} onConfirm={confirmAction} onCancel={cancelAction} />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-md border border-border/60 bg-panel px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-signal-cyan" />
                <span className="size-1.5 animate-pulse rounded-full bg-signal-cyan [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-signal-cyan [animation-delay:300ms]" />
                <span className="wf-mono ml-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  Analyzing live state
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Suggestions */}
      {empty && !busy && (
        <div className="shrink-0 border-t border-border/60 px-3 py-2.5">
          <div className="mb-1.5 wf-label">TRY ASKING</div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-[3px] border border-border/70 bg-muted/30 px-2 py-1 text-left text-[10px] text-muted-foreground transition-colors hover:border-signal-cyan/50 hover:bg-signal-cyan/10 hover:text-signal-cyan"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form
        className={cn("shrink-0 border-t border-border/70 p-2.5", variant === "page" && "pb-1")}
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about risk, orders, SKUs, disruptions…"
            className="h-9 min-w-0 flex-1 rounded-[3px] border border-input bg-muted/40 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-signal-cyan focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-signal-cyan text-primary-foreground transition-colors hover:bg-signal-cyan/90 disabled:cursor-not-allowed disabled:opacity-40"
            title="Send"
          >
            <Send className="size-4" />
          </button>
          <button
            type="button"
            onClick={clear}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-border/70 bg-muted/30 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Clear conversation"
          >
            <Eraser className="size-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
            Enter to send · actions require confirmation
          </span>
          <Link
            to="/copilot"
            onClick={() => setDrawerOpen(false)}
            className="text-[9px] font-semibold uppercase tracking-wider text-signal-cyan hover:underline"
          >
            Full page →
          </Link>
        </div>
      </form>
    </div>
  );
}
