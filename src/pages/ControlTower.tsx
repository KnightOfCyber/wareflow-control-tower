import { useMemo } from "react";
import { Link } from "react-router";
import { useWarehouse } from "@/lib/state/store";
import { useCopilot } from "@/lib/copilot/provider";
import { getAllocationConflict } from "@/lib/decision-engine/allocation-engine";
import { detectBottlenecks, zoneActivity } from "@/lib/decision-engine/bottleneck-engine";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";
import { Panel, Kpi, MicroLabel, MiniBar, Dot } from "@/components/shared/ui";
import { ChangeRows, DecisionCard } from "@/components/shared/DecisionCard";
import { ActivityFeed } from "@/components/shared/ActivityFeed";
import { GenericTag, RiskBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { fmtClock } from "@/lib/format";
import { ArrowRight, Bot, FlaskConical, ShieldAlert } from "lucide-react";

const STAGES = [
  { key: "queue", label: "QUEUE", statuses: ["created", "prioritized"] },
  { key: "allocated", label: "ALLOC", statuses: ["allocated"] },
  { key: "picking", label: "PICK", statuses: ["picking"] },
  { key: "packing", label: "PACK", statuses: ["packing"] },
  { key: "qc", label: "QC", statuses: ["quality-check"] },
  { key: "ready", label: "READY", statuses: ["ready"] },
  { key: "out", label: "OUT", statuses: ["dispatched"] },
] as const;

export default function ControlTower() {
  const { state, actions } = useWarehouse();
  const { setDrawerOpen } = useCopilot();

  const openDecision = state.decisions.find((d) => d.status === "open" && d.type === "allocation");
  const conflict = openDecision
    ? getAllocationConflict(state, openDecision.orderId ?? "", openDecision.sku ?? "")
    : null;

  // Most recent applied decision — shown briefly with its before/after diff.
  const lastApplied = state.decisions
    .filter((d) => d.status === "applied" && d.appliedAt !== undefined)
    .sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0))[0];
  const showLastApplied = lastApplied && state.clock - (lastApplied.appliedAt ?? 0) < 10;

  const data = useMemo(() => {
    const open = state.orders.filter((o) => o.status !== "dispatched");
    const active = open.filter((o) => o.status !== "delayed");
    const atRisk = open.filter((o) => {
      const r = computeOrderRisk(o, state);
      return r.level === "high" || r.level === "critical";
    });
    const critical = open.filter((o) => o.priority === "critical");
    const lowStock = state.products.filter((p) => p.stockStatus === "low" || p.stockStatus === "critical");
    const outStock = state.products.filter((p) => p.stockStatus === "out");
    const picking = open.filter((o) => o.status === "picking" || o.status === "allocated");
    const packing = open.filter((o) => o.status === "packing");
    const ready = open.filter((o) => o.status === "ready");
    const delayedVehicles = state.vehicles.filter((v) => v.status === "delayed");
    const bottlenecks = detectBottlenecks(state);
    const zones = zoneActivity(state);

    const pipeline = STAGES.map((s) => ({
      ...s,
      count: state.orders.filter((o) => (s.statuses as readonly string[]).includes(o.status)).length,
    }));

    return {
      open,
      active,
      atRisk,
      critical,
      lowStock,
      outStock,
      picking,
      packing,
      ready,
      delayedVehicles,
      bottlenecks,
      zones,
      pipeline,
    };
  }, [state]);

  const maxPipeline = Math.max(1, ...data.pipeline.map((s) => s.count));

  return (
    <div className="space-y-4">
      {/* ---------- Decision Required ---------- */}
      {openDecision && conflict && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="wf-live-dot-amber" />
            <MicroLabel className="text-signal-amber">DECISION REQUIRED — OPERATOR REVIEW</MicroLabel>
          </div>
          <DecisionCard
            decision={openDecision}
            conflict={conflict}
            onApply={(optionId) =>
              actions.applyAllocation(
                conflict.orderId,
                conflict.sku,
                optionId ?? conflict.recommendedOptionId,
                "decision",
              )
            }
            onDismiss={() => actions.dismissDecision(openDecision.id)}
            onSimulate={() => actions.startSim(conflict.orderId, conflict.sku)}
          />
        </div>
      )}

      {/* ---------- Last applied decision (before/after) ---------- */}
      {showLastApplied && lastApplied && (
        <div className="wf-accent-top rounded-md border border-signal-green/40 bg-signal-green/[0.05] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="wf-mono text-[10px] uppercase tracking-[0.2em] text-signal-green">
                DECISION APPLIED
              </span>
              <span className="text-xs font-medium text-foreground">{lastApplied.title}</span>
              <span className="wf-mono text-[10px] text-muted-foreground">
                {fmtClock(lastApplied.appliedAt ?? 0)}
              </span>
            </div>
            <Link to="/decisions" className="text-[10px] font-semibold uppercase tracking-wider text-signal-cyan hover:underline">
              Decision log →
            </Link>
          </div>
          {lastApplied.changes && lastApplied.changes.length > 0 && (
            <div className="mt-2 rounded-[3px] border border-signal-green/20 bg-muted/20 px-3 py-2">
              <ChangeRows changes={lastApplied.changes} />
            </div>
          )}
        </div>
      )}

      {/* ---------- Chaos banner ---------- */}
      {state.chaos.active && state.chaos.disruptions.length > 0 && (
        <div className="wf-ribbon wf-accent-top-red flex flex-wrap items-center gap-3 rounded-md border border-signal-red/40 bg-signal-red/[0.07] px-3.5 py-2.5">
          <ShieldAlert className="size-4 shrink-0 text-signal-red" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-signal-red">
              DISRUPTION DETECTED — {state.chaos.disruptions.length} ACTIVE
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {state.chaos.disruptions.map((d) => d.title).join(" · ")}
            </div>
          </div>
          <Button asChild size="sm" className="h-7 rounded-[3px] bg-signal-red px-3 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-signal-red/90">
            <Link to="/chaos">
              View recovery plan <ArrowRight className="size-3" />
            </Link>
          </Button>
        </div>
      )}

      {/* ---------- KPI strip ---------- */}
      <div className="wf-panel wf-accent-top grid grid-cols-2 gap-x-4 gap-y-4 px-3.5 py-3 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Warehouse health" value={`${Math.max(0, 100 - data.atRisk.length * 9 - data.bottlenecks.filter((b) => b.severity === "critical").length * 12)}%`} sub={`${data.bottlenecks.length} bottleneck${data.bottlenecks.length === 1 ? "" : "s"}`} tone={data.atRisk.length > 0 ? "amber" : "green"} />
        <Kpi label="Active orders" value={data.active.length} sub={`${data.open.length} open total`} />
        <Kpi label="Orders at risk" value={data.atRisk.length} sub="high + critical risk" tone={data.atRisk.length > 0 ? "red" : "green"} />
        <Kpi label="Critical orders" value={data.critical.length} sub="engine priority" tone={data.critical.length > 0 ? "amber" : "default"} />
        <Kpi label="Low-stock SKUs" value={data.lowStock.length} sub={`${data.outStock.length} out of stock`} tone={data.lowStock.length > 0 ? "amber" : "green"} />
        <Kpi label="Picking workload" value={data.picking.length} sub="allocated + picking" tone={data.picking.length >= 3 ? "cyan" : "default"} />
        <Kpi label="Packing workload" value={data.packing.length} sub={`${data.ready.length} ready`} tone={data.packing.length >= 2 ? "amber" : "default"} />
        <Kpi label="Dispatch status" value={state.vehicles.filter((v) => v.status === "enroute" || v.status === "loading").length + " on road"} sub={data.delayedVehicles.length > 0 ? `${data.delayedVehicles.length} truck(s) delayed` : "lanes clear"} tone={data.delayedVehicles.length > 0 ? "red" : "green"} />
      </div>

      {/* ---------- Pipeline + zone load ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Order pipeline"
          accent="cyan"
          className="lg:col-span-2"
          right={
            <span className="wf-mono text-[10px] text-muted-foreground">
              {data.pipeline.reduce((a, s) => a + s.count, 0)} orders in flow
            </span>
          }
          bodyClassName="p-3.5"
        >
          <div className="flex h-9 w-full items-end gap-px">
            {data.pipeline.map((s) => (
              <div key={s.key} className="group relative flex h-full flex-1 flex-col justify-end" title={`${s.label}: ${s.count}`}>
                <div
                  className={
                    "w-full rounded-[2px] " +
                    (s.key === "qc" ? "bg-signal-amber" : s.key === "ready" || s.key === "out" ? "bg-signal-green" : s.key === "picking" || s.key === "packing" ? "bg-signal-cyan" : "bg-steel-2")
                  }
                  style={{ height: `${Math.max(4, (s.count / maxPipeline) * 100)}%`, opacity: s.count === 0 ? 0.25 : 1 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-px">
            {data.pipeline.map((s) => (
              <div key={s.key} className="flex-1 text-center">
                <div className="wf-mono text-[10px] text-foreground">{s.count}</div>
                <div className="text-[8px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.zones.map((z) => (
              <div key={z.zone} className="rounded-[3px] border border-border/70 bg-muted/30 px-2.5 py-2">
                <div className="flex items-center justify-between">
                  <span className="wf-mono text-[10px] text-signal-cyan">{z.zone}</span>
                  <Dot tone={z.utilization >= 70 ? "amber" : z.picking > 0 ? "cyan" : "steel"} />
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{z.label}</div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="wf-mono text-[11px] text-foreground">{z.orders} orders</span>
                  <span className="wf-mono text-[11px] text-muted-foreground">{z.utilization}% util</span>
                </div>
                <MiniBar value={z.utilization} tone={z.utilization >= 70 ? "amber" : "cyan"} className="mt-1" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent operational events" accent="steel" bodyClassName="p-3">
          <ActivityFeed events={state.events} limit={11} />
        </Panel>
      </div>

      {/* ---------- Bottlenecks + actions ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Bottlenecks & exceptions"
          accent={data.bottlenecks.some((b) => b.severity === "critical" || b.severity === "high") ? "red" : "green"}
          className="lg:col-span-2"
          right={
            <Link to="/exceptions" className="text-[10px] font-semibold uppercase tracking-wider text-signal-cyan hover:underline">
              Exception center →
            </Link>
          }
          bodyClassName="p-0"
        >
          {data.bottlenecks.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">
              No bottlenecks detected — all stages within capacity.
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {data.bottlenecks.slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <RiskBadge level={b.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground">{b.title}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {b.detail} <span className="text-muted-foreground/60">({b.evidence})</span>
                    </div>
                    <div className="mt-1 flex items-start gap-1.5 text-[11px] text-signal-cyan/90">
                      <span className="mt-px">→</span>
                      <span>{b.recommendation}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recommended next actions" accent="cyan" bodyClassName="p-3">
          <ul className="space-y-2.5">
            <li>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="group flex w-full items-start gap-2 rounded-[3px] border border-signal-cyan/50 bg-signal-cyan/[0.08] p-2.5 text-left transition-colors hover:bg-signal-cyan/15"
              >
                <Bot className="mt-0.5 size-3.5 shrink-0 text-signal-cyan" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Ask Copilot
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Ask in plain language — Copilot reads live risk, stock and decisions, then proposes actions.
                  </p>
                </div>
                <ArrowRight className="size-3.5 shrink-0 text-signal-cyan transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
            {openDecision && conflict && (
              <li>
                <Link to="/decisions" className="group block rounded-[3px] border border-signal-amber/40 bg-signal-amber/[0.07] p-2.5 transition-colors hover:bg-signal-amber/15">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-signal-amber">
                      Review allocation decision
                    </span>
                    <ArrowRight className="size-3.5 text-signal-amber transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {conflict.sku} shortage — {conflict.options.length} scenarios scored. Recommended: {conflict.options.find((o) => o.id === conflict.recommendedOptionId)?.label}.
                  </p>
                </Link>
              </li>
            )}
            <li>
              <Link to="/simulator" className="group flex items-start gap-2 rounded-[3px] border border-border/70 bg-muted/30 p-2.5 transition-colors hover:bg-accent">
                <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-signal-cyan" />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Simulate alternatives
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Compare allocation scenarios without changing live state.
                  </p>
                </div>
              </Link>
            </li>
            {data.outStock.length > 0 && (
              <li>
                <Link to="/inventory" className="group flex items-start gap-2 rounded-[3px] border border-signal-red/40 bg-signal-red/[0.06] p-2.5 transition-colors hover:bg-signal-red/15">
                  <span className="wf-live-dot-red mt-1.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-signal-red">
                      {data.outStock.length} SKU(s) out of stock
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {data.outStock.map((p) => p.sku).join(", ")} — replenishment recommended.
                    </p>
                  </div>
                </Link>
              </li>
            )}
            {state.chaos.active && state.chaos.recoveryPlan && (
              <li>
                <Link to="/chaos" className="group flex items-start gap-2 rounded-[3px] border border-signal-red/40 bg-signal-red/[0.06] p-2.5 transition-colors hover:bg-signal-red/15">
                  <GenericTag tone="red">RECOVERY</GenericTag>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                      {state.chaos.recoveryPlan.steps.length}-step recovery plan ready
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {state.chaos.recoveryPlan.predictedImprovement[0]}
                    </p>
                  </div>
                </Link>
              </li>
            )}
          </ul>
        </Panel>
      </div>

      {/* Ask Copilot — floating launch pad */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="wf-scanlines fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-[3px] border border-signal-cyan/50 bg-background/95 px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-cyan shadow-[0_0_18px_rgba(34,211,238,0.25)] backdrop-blur transition-all hover:border-signal-cyan hover:bg-signal-cyan/10 hover:shadow-[0_0_26px_rgba(34,211,238,0.4)]"
      >
        <Bot className="size-4" />
        Ask Copilot
        <span className="wf-live-dot" />
      </button>
    </div>
  );
}
