import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, FlaskConical, X } from "lucide-react";
import { useWarehouse } from "@/lib/state/store";
import { findActiveConflicts } from "@/lib/decision-engine/allocation-engine";
import { PageHeader, Panel, MicroLabel, MiniBar, EmptyState } from "@/components/shared/ui";
import { GenericTag, RiskBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtShort } from "@/lib/format";

export default function Simulator() {
  const { state, dispatch } = useWarehouse();
  const sim = state.sim;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const conflicts = useMemo(() => findActiveConflicts(state), [state]);

  if (!sim) {
    return (
      <div>
        <PageHeader
          code="SIM-01 · WHAT-IF ENGINE"
          title="What-If Simulator"
          meta="Simulate decisions against a copy of the live state. Nothing changes until you explicitly apply a scenario."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Active conflicts to simulate" accent="amber" bodyClassName="p-3">
            {conflicts.length === 0 ? (
              <EmptyState>
                No active allocation conflicts right now. Trigger Chaos Mode or resolve the SKU-104 shortage to
                create new pressure points.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {conflicts.map((c) => {
                  const primary = state.orders.find((o) => o.id === c.orderId);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "START_SIM", orderId: c.orderId, sku: c.sku })}
                        className="group w-full rounded-[3px] border border-border/70 bg-muted/30 p-3 text-left transition-colors hover:border-signal-amber/50 hover:bg-signal-amber/[0.07]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <FlaskConical className="size-4 text-signal-amber" />
                            <span className="wf-mono text-xs text-signal-cyan">
                              #{c.orderId} · {c.sku}
                            </span>
                            <GenericTag tone={c.shortfall > 0 ? "red" : "amber"}>
                              shortfall {c.shortfall}
                            </GenericTag>
                          </div>
                          <span className="wf-mono text-[10px] text-muted-foreground">
                            {c.options.length} scenarios · risk{" "}
                            {c.options[0]?.riskScore ?? "—"}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          {c.description} {primary ? `(priority ${primary.priority}, score ${primary.score})` : ""}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="How it works" accent="cyan" bodyClassName="p-3">
            <ol className="space-y-2.5">
              {[
                ["SIMULATE", "The engine generates every plausible allocation for the conflict."],
                ["COMPARE", "Each scenario is scored on fulfillment, SLA risk, delay and movement."],
                ["RECOMMEND", "The lowest composite-risk scenario is recommended with an explanation."],
                ["EXECUTE", "Applying a scenario rewrites live inventory, orders and the activity log."],
              ].map(([k, v]) => (
                <li key={k} className="flex gap-3">
                  <span className="wf-mono w-24 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-cyan">
                    {k}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{v}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 rounded-[3px] border border-border/70 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              Tip: open the simulator from the Control Tower’s “Decision Required” banner for the star demo —
              order #1042 needs 10 × SKU-104 with only 7 available.
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  const selected = sim.scenarios.find((s) => s.id === (selectedId ?? sim.recommendedScenarioId));
  const recommended = sim.scenarios.find((s) => s.id === sim.recommendedScenarioId);
  const applied = sim.appliedScenarioId ? sim.scenarios.find((s) => s.id === sim.appliedScenarioId) : null;

  return (
    <div>
      <PageHeader
        code="SIM-01 · WHAT-IF ENGINE"
        title={sim.title}
        meta={`Conflict ${sim.conflictId} · compared at ${fmtShort(sim.comparedAt)} into the shift`}
        right={
          <Button size="sm" variant="outline" className="h-7 rounded-[3px] text-[11px]" onClick={() => dispatch({ type: "CLEAR_SIM" })}>
            <X className="size-3.5" /> Close simulation
          </Button>
        }
      />

      {applied ? (
        <div className="wf-ribbon mb-4 flex flex-wrap items-center gap-3 rounded-md border border-signal-green/40 bg-signal-green/[0.06] px-3.5 py-3">
          <CheckCircle2 className="size-5 text-signal-green" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-signal-green">
              SCENARIO {applied.id} APPLIED — SIMULATION BECAME REALITY
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Inventory, orders, picking queue and the activity log were updated. Check the{" "}
              <Link to="/" className="text-signal-cyan hover:underline">
                Control Tower
              </Link>{" "}
              or the{" "}
              <Link to="/fulfillment" className="text-signal-cyan hover:underline">
                Fulfillment board
              </Link>{" "}
              to see the new state.
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 rounded-[3px] border border-signal-cyan/40 bg-signal-cyan/[0.06] px-3.5 py-2 text-[11px] text-muted-foreground">
          <FlaskConical className="size-3.5 shrink-0 text-signal-cyan" />
          <span>
            <span className="wf-label-accent">READ-ONLY MODE</span> — live state is untouched until you apply a
            scenario.
          </span>
        </div>
      )}

      {/* Situation */}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Current situation" accent="amber" className="lg:col-span-2" bodyClassName="p-3">
          <ul className="space-y-1.5">
            {sim.situation.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <span className="text-signal-amber">▸</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recommended scenario" accent="cyan" bodyClassName="p-3">
          <div className="flex items-center gap-2">
            <span className="wf-mono text-sm font-semibold text-signal-cyan">SCENARIO {recommended?.id}</span>
            <GenericTag tone="cyan">RECOMMENDED</GenericTag>
          </div>
          <p className="mt-2 text-xs font-medium text-foreground">{recommended?.label}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{recommended?.summary}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Metric label="Risk score" value={`${recommended?.riskScore}`} />
            <Metric label="Fulfillment" value={`${recommended?.fulfillmentAfter}%`} />
            <Metric label="Delay" value={fmtShort(recommended?.expectedDelayMin ?? 0)} />
          </div>
        </Panel>
      </div>

      {/* Comparison table */}
      <Panel
        title="Scenario comparison — all metrics computed on simulated state"
        accent="cyan"
        bodyClassName="p-0"
        right={
          <span className="wf-mono text-[10px] text-muted-foreground">
            lower risk score = better outcome
          </span>
        }
      >
        <table className="wf-table w-full text-xs">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Fulfillment</th>
              <th>SLA risk</th>
              <th>Expected delay</th>
              <th>Movement</th>
              <th>Orders affected</th>
              <th>Risk score</th>
              <th className="w-28">Select</th>
            </tr>
          </thead>
          <tbody>
            {sim.scenarios.map((s) => {
              const isSelected = selected?.id === s.id;
              const isRecommended = s.id === sim.recommendedScenarioId;
              return (
                <tr
                  key={s.id}
                  className={cn("cursor-pointer", isSelected && "bg-signal-cyan/[0.07]", isRecommended && !isSelected && "bg-signal-cyan/[0.03]")}
                  onClick={() => setSelectedId(s.id)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="wf-mono text-signal-cyan">SCENARIO {s.id}</span>
                      <span className="text-[11px] font-medium text-foreground">{s.label}</span>
                      {isRecommended && <GenericTag tone="cyan">REC</GenericTag>}
                      {applied && s.id === applied.id && <GenericTag tone="green">APPLIED</GenericTag>}
                    </div>
                    <p className="mt-0.5 max-w-[420px] truncate text-[10px] text-muted-foreground">{s.summary}</p>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <MiniBar value={s.fulfillmentAfter} tone={s.fulfillmentAfter >= 100 ? "green" : "amber"} className="w-16" />
                      <span className="wf-mono">{s.fulfillmentAfter}%</span>
                    </div>
                  </td>
                  <td>
                    <RiskBadge level={s.slaRisk} />
                  </td>
                  <td className="wf-mono">{fmtShort(s.expectedDelayMin)}</td>
                  <td className="wf-mono">{s.movement} ops</td>
                  <td className="wf-mono">
                    {s.ordersAffected.length}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({s.ordersAffected.map((o) => `#${o}`).join(", ")})
                    </span>
                  </td>
                  <td className={cn("wf-mono font-semibold", s.riskScore === Math.min(...sim.scenarios.map((x) => x.riskScore)) ? "text-signal-green" : "text-foreground")}>
                    {s.riskScore}
                  </td>
                  <td>
                    {!applied && (
                      <Button
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        className={cn(
                          "h-6 w-full rounded-[3px] px-2 text-[10px] font-semibold uppercase tracking-wider",
                          isSelected && "bg-signal-cyan text-primary-foreground hover:bg-signal-cyan/90",
                        )}
                        onClick={() => setSelectedId(s.id)}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* Selected scenario detail */}
      {selected && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title={`Scenario ${selected.id} — impact analysis`} accent="cyan" bodyClassName="p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Risk score" value={`${selected.riskScore}`} />
              <Metric label="Fulfillment" value={`${selected.fulfillmentAfter}%`} />
              <Metric label="SLA risk" value={selected.slaRisk.toUpperCase()} />
              <Metric label="Delay" value={fmtShort(selected.expectedDelayMin)} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <MicroLabel className="mb-1.5 block text-signal-green">ADVANTAGES</MicroLabel>
                <ul className="space-y-1">
                  {selected.pros.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="text-signal-green">▸</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <MicroLabel className="mb-1.5 block text-signal-red">TRADEOFFS</MicroLabel>
                <ul className="space-y-1">
                  {selected.cons.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="text-signal-red">▸</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4">
              <MicroLabel className="mb-1.5 block">EXECUTION LINES</MicroLabel>
              <div className="space-y-1">
                {selected.releases.map((r, i) => (
                  <div key={i} className="flex gap-2 rounded-[3px] border border-signal-amber/30 bg-signal-amber/[0.05] px-2 py-1 text-[11px] text-signal-amber">
                    <span className="wf-mono">RELEASE</span> #{r.orderId} −{r.qty} × {r.sku} (recall reservation)
                  </div>
                ))}
                {selected.allocations.map((a, i) => (
                  <div key={i} className="flex gap-2 rounded-[3px] border border-signal-cyan/30 bg-signal-cyan/[0.05] px-2 py-1 text-[11px] text-signal-cyan">
                    <span className="wf-mono">ALLOCATE</span> #{a.orderId} +{a.qty} × {a.sku} ({a.source})
                  </div>
                ))}
                {selected.replenishQty > 0 && (
                  <div className="flex gap-2 rounded-[3px] border border-signal-green/30 bg-signal-green/[0.05] px-2 py-1 text-[11px] text-signal-green">
                    <span className="wf-mono">REPLENISH</span> +{selected.replenishQty} units drafted (ETA 40m)
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Why the engine recommends this" accent="amber" bodyClassName="p-3">
              <ul className="space-y-1.5">
                {sim.explanation.map((e, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="text-signal-amber">▸</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            {!applied && (
              <div className="wf-ribbon wf-accent-top-amber rounded-md border border-signal-amber/40 bg-panel p-4">
                <MicroLabel className="mb-1 block text-signal-amber">EXECUTE — MAKE IT REAL</MicroLabel>
                <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                  Applying Scenario {selected.id} permanently updates inventory, order state, the picking queue and
                  the activity log. This is the SIMULATE → COMPARE → RECOMMEND → EXECUTE moment.
                </p>
                <Button
                  className="h-8 rounded-[3px] bg-signal-cyan px-4 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-signal-cyan/90"
                  onClick={() =>
                    dispatch({
                      type: "APPLY_ALLOCATION",
                      orderId: sim.orderId,
                      sku: sim.sku,
                      optionId: selected.id,
                      source: "simulator",
                    })
                  }
                >
                  Apply decision — Scenario {selected.id}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[3px] border border-border/70 bg-muted/30 px-2 py-1.5">
      <div className="wf-label">{label}</div>
      <div className="wf-mono mt-0.5 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
