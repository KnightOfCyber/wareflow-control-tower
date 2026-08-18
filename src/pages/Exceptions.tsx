import { Link } from "react-router";
import { useWarehouse } from "@/lib/state/store";
import { PageHeader, Panel, MicroLabel, EmptyState } from "@/components/shared/ui";
import { GenericTag, RiskBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtAgo, fmtClock } from "@/lib/format";
import type { ExceptionType } from "@/types";

const TYPE_LABEL: Record<ExceptionType, string> = {
  "insufficient-stock": "INSUFFICIENT STOCK",
  damaged: "DAMAGED ITEM",
  missing: "MISSING ITEM",
  "picker-unavailable": "PICKER UNAVAILABLE",
  "packing-bottleneck": "PACKING BOTTLENECK",
  "dispatch-delay": "DISPATCH DELAY",
  "qc-failure": "QC FAILURE",
};

export default function Exceptions() {
  const { state, dispatch } = useWarehouse();
  const open = state.exceptions.filter((e) => e.status === "open");
  const resolved = state.exceptions
    .filter((e) => e.status === "resolved")
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));

  return (
    <div>
      <PageHeader
        code="EXC-01 · EXCEPTION CENTER"
        title="Exceptions"
        meta="Every exception follows DETECT → ANALYZE → OPTIONS → RECOMMEND → ACTION → RESOLUTION. Choose an option to execute it."
        right={
          <span className="wf-mono text-[10px] text-muted-foreground">
            {open.length} open · {resolved.length} resolved
          </span>
        }
      />

      {open.length === 0 ? (
        <Panel bodyClassName="p-6">
          <EmptyState>
            No open exceptions. The engine watches for stock shortages, damaged units, stalled picks, QC failures
            and dispatch delays automatically.
          </EmptyState>
        </Panel>
      ) : (
        <div className="space-y-4">
          {open.map((ex) => (
            <article key={ex.id} className="wf-panel overflow-hidden">
              <header className="wf-panel-header bg-muted/30">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="wf-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-signal-red">
                    {ex.id}
                  </span>
                  <GenericTag tone="red">{TYPE_LABEL[ex.type]}</GenericTag>
                  <RiskBadge level={ex.severity} />
                  {ex.orderId && (
                    <Link to="/orders" className="wf-mono text-[11px] text-signal-cyan hover:underline">
                      order #{ex.orderId}
                    </Link>
                  )}
                  {ex.sku && <span className="wf-mono text-[11px] text-muted-foreground">{ex.sku}</span>}
                </div>
                <span className="wf-mono text-[10px] text-muted-foreground">
                  {fmtClock(ex.createdAt)} · {fmtAgo(state.clock, ex.createdAt)}
                </span>
              </header>

              <div className="grid gap-5 px-3.5 py-3 lg:grid-cols-3">
                {/* Analysis */}
                <div>
                  <MicroLabel className="mb-1.5 block text-signal-red">DETECTED</MicroLabel>
                  <p className="text-xs leading-relaxed text-muted-foreground">{ex.detail}</p>
                  <MicroLabel className="mb-1.5 mt-3 block">ANALYSIS</MicroLabel>
                  <ul className="space-y-1">
                    {ex.analysis.map((a, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <span className="text-signal-cyan">▸</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Options */}
                <div>
                  <MicroLabel className="mb-1.5 block">OPTIONS — SELECT TO EXECUTE</MicroLabel>
                  <div className="space-y-2">
                    {ex.options.map((o) => {
                      const recommended = o.id === ex.recommendedOptionId;
                      return (
                        <div
                          key={o.id}
                          className={cn(
                            "rounded-[3px] border p-2.5",
                            recommended
                              ? "border-signal-cyan/50 bg-signal-cyan/[0.06]"
                              : "border-border/70 bg-muted/30",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="wf-mono text-[10px] text-signal-cyan">{o.id}</span>
                                <span className="text-xs font-medium text-foreground">{o.label}</span>
                                {recommended && <GenericTag tone="cyan">RECOMMENDED</GenericTag>}
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{o.summary}</p>
                              <ul className="mt-1.5 space-y-0.5">
                                {o.effect.map((e, i) => (
                                  <li key={i} className="flex gap-1.5 text-[11px] text-muted-foreground/80">
                                    <span className="text-muted-foreground/50">·</span>
                                    <span>{e}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-2">
                              <RiskBadge level={o.risk} />
                              <Button
                                size="sm"
                                className={cn(
                                  "h-6 rounded-[3px] px-2 text-[10px] font-semibold uppercase tracking-wider",
                                  recommended
                                    ? "bg-signal-cyan text-primary-foreground hover:bg-signal-cyan/90"
                                    : "border border-border bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground",
                                )}
                                onClick={() => dispatch({ type: "RESOLVE_EXCEPTION", exceptionId: ex.id, optionId: o.id })}
                              >
                                Execute
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Recommendation */}
                <div>
                  <MicroLabel className="mb-1.5 block text-signal-cyan">RECOMMENDATION</MicroLabel>
                  <p className="text-xs font-medium leading-relaxed text-foreground">{ex.recommendation}</p>
                  <MicroLabel className="mb-1.5 mt-3 block">WHY</MicroLabel>
                  <ul className="space-y-1">
                    {ex.why.map((w, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <span className="text-signal-amber">▸</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="mt-6">
          <MicroLabel className="mb-2 block">RESOLVED EXCEPTIONS</MicroLabel>
          <Panel bodyClassName="p-0">
            <table className="wf-table w-full text-xs">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Order</th>
                  <th>Opened</th>
                  <th>Resolved</th>
                  <th>Resolution</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((ex) => (
                  <tr key={ex.id}>
                    <td className="wf-mono text-signal-cyan">{ex.id}</td>
                    <td>
                      <GenericTag tone="steel">{TYPE_LABEL[ex.type]}</GenericTag>
                    </td>
                    <td className="wf-mono text-muted-foreground">{ex.orderId ? `#${ex.orderId}` : "—"}</td>
                    <td className="wf-mono text-muted-foreground">{fmtClock(ex.createdAt)}</td>
                    <td className="wf-mono text-signal-green">{fmtClock(ex.resolvedAt ?? 0)}</td>
                    <td className="max-w-lg text-muted-foreground">{ex.resolution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  );
}
