import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useWarehouse } from "@/lib/state/store";
import { computeMetrics, computeTimeline } from "@/lib/analytics/metrics";
import { detectBottlenecks } from "@/lib/decision-engine/bottleneck-engine";
import { PageHeader, Panel, Kpi, MiniBar } from "@/components/shared/ui";
import { fmtShort } from "@/lib/format";

export default function Analytics() {
  const { state } = useWarehouse();
  const m = useMemo(() => computeMetrics(state), [state]);
  const timeline = useMemo(() => computeTimeline(state), [state]);
  const bottlenecks = useMemo(() => detectBottlenecks(state), [state]);

  const byStage = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bottlenecks) map.set(b.stage, (map.get(b.stage) ?? 0) + 1);
    return [...map.entries()].map(([stage, count]) => ({ stage: stage.toUpperCase(), count }));
  }, [bottlenecks]);

  return (
    <div>
      <PageHeader
        code="ANA-01 · OPERATIONAL ANALYTICS"
        title="Analytics"
        meta="All metrics are computed live from state. Analytics exists to support decisions — the engines remain the product."
        right={
          <span className="wf-mono text-[10px] text-muted-foreground">
            {m.ordersDispatched} orders shipped · {m.totalUnitsShipped} units out
          </span>
        }
      />

      {/* KPI grid */}
      <div className="wf-panel wf-accent-top mb-4 grid grid-cols-2 gap-x-4 gap-y-4 px-3.5 py-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Fulfillment rate" value={`${Math.round(m.fulfillmentRate)}%`} sub={`${m.totalUnitsAllocated} units allocated`} tone={m.fulfillmentRate > 70 ? "green" : "amber"} />
        <Kpi label="On-time delivery" value={`${Math.round(m.onTimeRate)}%`} sub={`of ${m.ordersDispatched} dispatched`} tone={m.onTimeRate > 80 ? "green" : "amber"} />
        <Kpi label="Avg fulfillment time" value={fmtShort(m.avgFulfillmentMin)} sub="dispatched orders" />
        <Kpi label="Inventory utilization" value={`${Math.round(m.inventoryUtilization)}%`} sub={`${m.lowStockCount} low · ${m.outStockCount} out`} tone={m.outStockCount > 0 ? "red" : m.lowStockCount > 0 ? "amber" : "default"} />
        <Kpi label="Orders at risk" value={m.atRiskCount} sub="engine risk score" tone={m.atRiskCount > 0 ? "red" : "green"} />
        <Kpi label="Decision impact" value={`${m.decisionImpact}`} sub="composite ops score" tone={m.decisionImpact > 60 ? "green" : "amber"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Timeline chart */}
        <Panel
          title="Operational load — last 60 minutes"
          accent="cyan"
          className="lg:col-span-2"
          bodyClassName="p-3"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="gOpen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gPick" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffb020" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#ffb020" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#232b37" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8b95a7", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#232b37" }} interval={8} />
                <YAxis tick={{ fill: "#8b95a7", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#141922",
                    border: "1px solid #2a3341",
                    borderRadius: 4,
                    fontSize: 11,
                    color: "#e6eaf1",
                  }}
                  labelStyle={{ color: "#8b95a7" }}
                />
                <Area type="monotone" dataKey="openOrders" name="open orders" stroke="#22d3ee" strokeWidth={1.5} fill="url(#gOpen)" />
                <Area type="monotone" dataKey="picks" name="in pipeline (pick→qc)" stroke="#ffb020" strokeWidth={1.5} fill="url(#gPick)" />
                <Area type="monotone" dataKey="dispatched" name="dispatched" stroke="#34d399" strokeWidth={1.5} fill="url(#gOut)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-4 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-signal-cyan" /> open orders
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-signal-amber" /> in pipeline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-signal-green" /> dispatched
            </span>
          </div>
        </Panel>

        {/* Performance stack */}
        <div className="space-y-4">
          <Panel title="Stage performance" accent="amber" bodyClassName="p-3">
            <div className="space-y-3">
              <Bar label="Picking efficiency" value={m.pickingEfficiency} tone="cyan" />
              <Bar label="Packing utilization" value={m.packingUtilization} tone={m.packingUtilization > 75 ? "amber" : "cyan"} />
              <Bar label="Dispatch performance" value={m.dispatchPerformance} tone={m.dispatchPerformance < 60 ? "red" : "green"} />
              <Bar label="Fulfillment rate" value={m.fulfillmentRate} tone="green" />
            </div>
          </Panel>
          <Panel title="Bottleneck frequency" accent="red" bodyClassName="p-3">
            {byStage.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No bottlenecks currently detected.</p>
            ) : (
              <div className="space-y-2">
                {byStage.map((b) => (
                  <div key={b.stage} className="flex items-center justify-between text-[11px]">
                    <span className="wf-mono uppercase tracking-wider text-muted-foreground">{b.stage}</span>
                    <span className="wf-mono text-signal-red">{b.count}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 border-t border-border/60 pt-2.5 text-[10px] text-muted-foreground">
              {m.exceptionsResolved} exceptions resolved · {m.exceptionsOpen} still open ·{" "}
              {state.decisions.filter((d) => d.status === "applied").length} decisions applied
            </div>
          </Panel>
        </div>
      </div>

      {/* Decision impact strip */}
      <Panel title="How the decision engine is performing" accent="cyan" className="mt-4" bodyClassName="p-3">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[3px] border border-border/70 bg-muted/30 p-3">
            <MicroLabel block>DECISIONS APPLIED</MicroLabel>
            <div className="wf-mono mt-1 text-2xl font-bold text-signal-cyan">
              {state.decisions.filter((d) => d.status === "applied").length}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Every applied decision rewrote real state — inventory, orders and queues.
            </p>
          </div>
          <div className="rounded-[3px] border border-border/70 bg-muted/30 p-3">
            <MicroLabel block>EXCEPTIONS HANDLED</MicroLabel>
            <div className="wf-mono mt-1 text-2xl font-bold text-signal-green">
              {m.exceptionsResolved}/{m.exceptionsResolved + m.exceptionsOpen}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Resolved through the DETECT → ANALYZE → OPTIONS → RECOMMEND → ACTION loop.
            </p>
          </div>
          <div className="rounded-[3px] border border-border/70 bg-muted/30 p-3">
            <MicroLabel block>ORDERS AT RISK</MicroLabel>
            <div className="wf-mono mt-1 text-2xl font-bold text-signal-red">{m.atRiskCount}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Risk engine prediction — the number the recovery engine targets.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: "cyan" | "amber" | "red" | "green" }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="wf-mono text-foreground">{Math.round(value)}%</span>
      </div>
      <MiniBar value={value} tone={tone} />
    </div>
  );
}

function MicroLabel({ children, block }: { children: React.ReactNode; block?: boolean }) {
  return <span className={block ? "wf-label block" : "wf-label"}>{children}</span>;
}
