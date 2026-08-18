import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AllocationConflict, DecisionRecord } from "@/types";
import { fmtClock } from "@/lib/format";
import { GenericTag, RiskBadge } from "./badges";
import { MicroLabel } from "./ui";

export function DecisionCard({
  decision,
  conflict,
  onApply,
  onDismiss,
  onSimulate,
  compact,
  className,
}: {
  decision: DecisionRecord;
  conflict?: AllocationConflict | null;
  onApply?: (optionId?: string) => void;
  onDismiss?: () => void;
  onSimulate?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const severityTone =
    decision.severity === "critical" ? "red" : decision.severity === "warning" ? "amber" : "cyan";
  const recommended = conflict?.options.find((o) => o.id === conflict.recommendedOptionId);

  return (
    <article
      className={cn(
        "wf-ribbon wf-accent-top-amber rounded-md border border-signal-amber/40 bg-panel",
        decision.severity === "critical" && "wf-accent-top-red",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="wf-mono text-[10px] uppercase tracking-[0.2em] text-signal-amber">
            {decision.id}
          </span>
          <h3 className="text-sm font-semibold text-foreground">{decision.title}</h3>
          <GenericTag tone={severityTone}>
            {decision.severity.toUpperCase()}
          </GenericTag>
          {decision.status === "applied" && <GenericTag tone="green">APPLIED</GenericTag>}
        </div>
        <span className="wf-mono text-[10px] text-muted-foreground">
          OPENED {fmtClock(decision.createdAt)}
        </span>
      </div>

      <div className="grid gap-4 border-t border-border/70 px-3.5 py-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{decision.summary}</p>
          {!compact && (
            <div>
              <MicroLabel className="mb-1 block">ANALYSIS</MicroLabel>
              <ul className="space-y-1">
                {decision.analysis.map((a, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="text-signal-cyan">▸</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {conflict && (
            <div>
              <MicroLabel className="mb-1.5 block">
                ENGINE SCENARIOS ({conflict.options.length}) — RISK SCORE / FULFILLMENT / SLA
              </MicroLabel>
              <div className="space-y-1.5">
                {conflict.options.map((o) => (
                  <div
                    key={o.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-[3px] border px-2.5 py-1.5",
                      o.id === conflict.recommendedOptionId
                        ? "border-signal-cyan/50 bg-signal-cyan/[0.07]"
                        : "border-border/70 bg-muted/30",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="wf-mono text-[10px] text-signal-cyan">SCENARIO {o.id}</span>
                        <span className="text-[11px] font-medium text-foreground">{o.label}</span>
                        {o.id === conflict.recommendedOptionId && (
                          <GenericTag tone="cyan">RECOMMENDED</GenericTag>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{o.summary}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <RiskBadge level={o.slaRisk} />
                      <span className="wf-mono text-[11px] text-muted-foreground">
                        {o.fulfillmentAfter}% · {o.riskScore}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <MicroLabel className="mb-1 block">RECOMMENDED ACTION</MicroLabel>
            <p className="text-xs font-medium leading-relaxed text-foreground">
              {recommended ? (
                <>
                  <span className="wf-mono text-signal-cyan">SCENARIO {recommended.id}</span>
                  {" — "}
                </>
              ) : null}
              {decision.recommendation}
            </p>
          </div>
          <div>
            <MicroLabel className="mb-1 block">WHY</MicroLabel>
            <ul className="space-y-1">
              {decision.why.map((w, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="text-signal-amber">▸</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <MicroLabel className="mb-1 block">PREDICTED IMPACT</MicroLabel>
            <ul className="space-y-1">
              {decision.impact.map((imp, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="text-signal-green">▸</span>
                  <span>{imp}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {decision.status === "open" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-3.5 py-2.5">
          {onApply && (
            <Button
              size="sm"
              className="h-7 gap-1.5 rounded-[3px] bg-signal-cyan px-3 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-signal-cyan/90"
              onClick={() => onApply(recommended?.id)}
            >
              Apply decision
            </Button>
          )}
          {onSimulate && (
            <Button size="sm" variant="outline" className="h-7 rounded-[3px] px-3 text-[11px] uppercase tracking-wider" onClick={onSimulate}>
              Simulate alternatives
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" className="h-7 rounded-[3px] px-3 text-[11px] text-muted-foreground" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
          {conflict && conflict.options.length > 1 && (
            <span className="ml-auto wf-mono text-[10px] text-muted-foreground">
              composite risk: {recommended?.riskScore ?? "—"}/100 · lowest of {conflict.options.length}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
