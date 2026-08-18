import { useNavigate } from "react-router";
import { CheckCircle2, FlaskConical, Loader2, ShieldAlert, X } from "lucide-react";
import { useWarehouse } from "@/lib/state/store";
import { useCopilot } from "@/lib/copilot/provider";
import { Button } from "@/components/ui/button";
import { ChangeRows } from "@/components/shared/DecisionCard";
import type { ChatMessage } from "@/lib/copilot/types";
import { cn } from "@/lib/utils";

/**
 * ACTION CARD — the safety gate.
 * Proposals are never auto-applied: the card shows the impact preview, and
 * only the operator's click on "Apply" runs the existing store action.
 * "Simulate" opens the What-If Simulator (state stays untouched).
 */
export function ActionCard({
  message,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage;
  onConfirm: (messageId: string) => void;
  onCancel: (messageId: string) => void;
}) {
  const action = message.action;
  const { actions } = useWarehouse();
  const { setDrawerOpen } = useCopilot();
  const navigate = useNavigate();
  if (!action) return null;

  const state = message.actionState ?? "proposed";
  const applying = state === "applying";
  const applied = state === "applied";
  const error = state === "error";
  const simulated = state === "simulated";

  const canSimulate = action.kind === "allocation" || action.kind === "sim";
  const canApply =
    action.kind === "allocation" ||
    action.kind === "recovery" ||
    action.kind === "exception" ||
    action.kind === "replenish";

  const simulate = () => {
    setDrawerOpen(false);
    if (action.kind === "allocation" || action.kind === "sim") {
      if (action.orderId && action.sku) actions.startSim(action.orderId, action.sku);
      navigate("/simulator");
    } else if (action.kind === "recovery") {
      navigate("/chaos");
    } else if (action.kind === "exception") {
      navigate("/exceptions");
    }
  };

  return (
    <div
      className={cn(
        "wf-ribbon mt-2.5 overflow-hidden rounded-md border bg-panel",
        applied
          ? "border-signal-green/40"
          : error
            ? "border-signal-red/40"
            : "border-signal-cyan/40 wf-accent-top",
      )}
    >
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {applied ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-signal-green" />
          ) : error ? (
            <ShieldAlert className="size-3.5 shrink-0 text-signal-red" />
          ) : (
            <FlaskConical className="size-3.5 shrink-0 text-signal-cyan" />
          )}
          <div className="min-w-0">
            <div className={cn("text-[11px] font-semibold uppercase tracking-wider", applied ? "text-signal-green" : error ? "text-signal-red" : "text-foreground")}>
              {applied ? "Applied" : error ? "Not applied" : action.title}
            </div>
            {!applied && !error && (
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{action.summary}</p>
            )}
          </div>
        </div>
        {!applied && (
          <button
            type="button"
            onClick={() => onCancel(message.id)}
            className="rounded-[2px] p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Cancel action"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {applied ? (
        <>
          {message.appliedSummary && (
            <p className="border-t border-border/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {message.appliedSummary}
            </p>
          )}
          {message.appliedChanges && message.appliedChanges.length > 0 && (
            <div className="border-t border-border/50 bg-muted/20 px-3 py-2">
              <ChangeRows changes={message.appliedChanges} />
            </div>
          )}
        </>
      ) : error ? (
        <p className="border-t border-border/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {message.appliedSummary ?? "This action was not executed."}
        </p>
      ) : (
        <>
          <ul className="space-y-1 border-t border-border/50 px-3 py-2">
            {action.impact.map((line, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="text-signal-cyan">▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 px-3 py-2">
            {canSimulate && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-[3px] px-2.5 text-[10px] font-semibold uppercase tracking-wider"
                onClick={simulate}
              >
                <FlaskConical className="size-3" />
                {simulated ? "Re-open What-If" : "Simulate"}
              </Button>
            )}
            {canApply && (
              <Button
                size="sm"
                className="h-7 rounded-[3px] bg-signal-cyan px-2.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-signal-cyan/90"
                disabled={applying}
                onClick={() => onConfirm(message.id)}
              >
                {applying ? <Loader2 className="size-3 animate-spin" /> : null}
                {applying ? "Applying…" : "Apply decision"}
              </Button>
            )}
            <span className="wf-mono ml-auto text-[9px] uppercase tracking-wider text-muted-foreground/70">
              requires operator confirmation
            </span>
          </div>
        </>
      )}
    </div>
  );
}
