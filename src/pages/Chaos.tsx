import { Link } from "react-router";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Package,
  Truck,
  UserX,
  Zap,
} from "lucide-react";
import { useWarehouse } from "@/lib/state/store";
import { PageHeader, Panel, MicroLabel, EmptyState } from "@/components/shared/ui";
import { GenericTag, RiskBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { fmtClock } from "@/lib/format";
import type { DisruptionKind } from "@/types";

const DISRUPTIONS: Array<{
  kind: DisruptionKind;
  title: string;
  desc: string;
  icon: typeof Zap;
}> = [
  { kind: "picker-out", title: "Picker unavailable", desc: "P-02 goes down mid-shift — a pick stalls.", icon: UserX },
  { kind: "damage-stock", title: "Stock damage", desc: "5 units of SKU-106 found damaged in Zone A.", icon: Boxes },
  { kind: "truck-delay", title: "Dispatch delay", desc: "TRK-2 mechanical issue — lane blocked 45m.", icon: Truck },
  { kind: "order-surge", title: "Order surge", desc: "3 urgent orders hit the queue at once (incl. SKU-104).", icon: Package },
];

export default function Chaos() {
  const { state, dispatch } = useWarehouse();
  const chaos = state.chaos;
  const plan = chaos.recoveryPlan;
  const active = chaos.active && chaos.disruptions.length > 0;
  const applied = chaos.appliedAt !== undefined && !active && !plan;

  const affectedOrders = new Set<string>();
  const affectedSkus = new Set<string>();
  for (const d of chaos.disruptions) {
    d.affectedOrders.forEach((o) => affectedOrders.add(o));
    d.affectedSkus.forEach((s) => affectedSkus.add(s));
  }

  return (
    <div>
      <PageHeader
        code="CHA-01 · DISRUPTION TEST RIG"
        title="Chaos Mode"
        meta="Inject simultaneous warehouse disruptions and watch the Recovery Engine rebuild the operation."
        right={
          chaos.active && chaos.disruptions.length === 0 ? (
            <span className="wf-mono text-[10px] uppercase tracking-wider text-signal-green">
              chaos injected · recovery applied
            </span>
          ) : null
        }
      />

      {!active && !plan && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel title="Inject a disruption" accent="red" bodyClassName="p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {DISRUPTIONS.map((d) => (
                  <button
                    key={d.kind}
                    type="button"
                    onClick={() => dispatch({ type: "TRIGGER_CHAOS", kind: d.kind })}
                    className="group flex items-start gap-3 rounded-[3px] border border-border/70 bg-muted/30 p-3 text-left transition-colors hover:border-signal-red/50 hover:bg-signal-red/[0.06]"
                  >
                    <d.icon className="mt-0.5 size-4 shrink-0 text-signal-red" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground">{d.title}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{d.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <Button
                  className="h-9 w-full rounded-[3px] bg-signal-red px-4 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-signal-red/90"
                  onClick={() => dispatch({ type: "TRIGGER_CHAOS", kind: "full" })}
                >
                  <Zap className="size-4" />
                  Run full disruption scenario
                </Button>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  Picker down + stock damage + order surge + truck delay — the demo moment.
                </p>
              </div>
            </Panel>
          </div>

          <Panel title="Why chaos exists" accent="cyan" bodyClassName="p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              WAREFLOW is judged on how it behaves when everything breaks at once. Chaos Mode proves the pipeline
              detects disruptions, predicts SLA impact, and generates a coordinated recovery plan with a measurable
              before/after improvement.
            </p>
            <div className="mt-4 rounded-[3px] border border-border/70 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              Tip: resolve the SKU-104 allocation decision first, then run full chaos — you’ll see the surge order
              #1080 re-open pressure on the same SKU.
            </div>
          </Panel>
        </div>
      )}

      {active && (
        <div className="space-y-4">
          {/* Disruption banner */}
          <div className="wf-ribbon wf-accent-top-red flex flex-wrap items-center gap-3 rounded-md border border-signal-red/40 bg-signal-red/[0.08] px-3.5 py-3">
            <AlertTriangle className="size-5 shrink-0 text-signal-red" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold uppercase tracking-wider text-signal-red">
                Disruption detected
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {chaos.disruptions.length} simultaneous disruption(s) · detected {fmtClock(state.clock)}
              </div>
            </div>
            {plan && (
              <div className="wf-mono text-right text-[11px]">
                <div className="text-muted-foreground">orders at risk</div>
                <div className="text-signal-red">
                  {plan.riskBefore} <span className="text-muted-foreground">→</span>{" "}
                  <span className="text-signal-green">{plan.riskAfter}</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Disruptions */}
            <Panel title={`Disruptions (${chaos.disruptions.length})`} accent="red" bodyClassName="p-3">
              <ul className="space-y-2.5">
                {chaos.disruptions.map((d) => (
                  <li key={d.id} className="rounded-[3px] border border-signal-red/30 bg-signal-red/[0.04] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-signal-red">
                        {d.title}
                      </span>
                      <GenericTag tone="red">{d.kind.replace(/-/g, " ")}</GenericTag>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{d.detail}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {d.affectedOrders.map((o) => (
                        <span key={o} className="wf-mono rounded-[2px] bg-signal-red/10 px-1.5 py-px text-[10px] text-signal-red">
                          #{o}
                        </span>
                      ))}
                      {d.affectedSkus.map((s) => (
                        <span key={s} className="wf-mono rounded-[2px] bg-muted/60 px-1.5 py-px text-[10px] text-muted-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            {/* Impact */}
            <Panel title="Detected impact" accent="amber" bodyClassName="p-3">
              <div className="space-y-2.5">
                <ImpactRow label="Affected orders" value={affectedOrders.size} detail={[...affectedOrders].map((o) => `#${o}`).join(", ") || "none"} tone="red" />
                <ImpactRow label="Affected inventory" value={affectedSkus.size} detail={[...affectedSkus].join(", ") || "none"} tone="amber" />
                <ImpactRow
                  label="Predicted SLA failures"
                  value={plan?.slaFailuresBefore ?? 0}
                  detail={plan?.slaFailuresBefore ? "orders will breach their window without action" : "no immediate SLA breach"}
                  tone="amber"
                />
                <ImpactRow
                  label="Bottlenecks created"
                  value={chaos.disruptions.length}
                  detail="picking, packing, dispatch and replenishment lanes affected"
                  tone="cyan"
                />
                <div className="rounded-[3px] border border-border/70 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  New demand landed on <span className="wf-mono text-foreground">SKU-104</span>,{" "}
                  <span className="wf-mono text-foreground">SKU-112</span> and{" "}
                  <span className="wf-mono text-foreground">SKU-121</span> — all below safety stock.
                </div>
              </div>
            </Panel>

            {/* Recovery plan */}
            {plan && (
              <Panel
                title={`Recovery plan — ${plan.steps.length} steps`}
                accent="green"
                bodyClassName="p-3"
                right={<RiskBadge level={plan.riskBefore > plan.riskAfter ? "medium" : "critical"} />}
              >
                <ol className="space-y-2">
                  {plan.steps.map((s, i) => (
                    <li key={s.id} className="flex gap-2.5 rounded-[3px] border border-border/70 bg-muted/30 px-2.5 py-2">
                      <span className="wf-mono text-[10px] text-signal-cyan">{String(i + 1).padStart(2, "0")}</span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-foreground">{s.title}</div>
                        <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{s.detail}</div>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 rounded-[3px] border border-signal-green/30 bg-signal-green/[0.05] p-2.5">
                  <MicroLabel className="mb-1 block text-signal-green">PREDICTED IMPROVEMENT</MicroLabel>
                  <ul className="space-y-0.5">
                    {plan.predictedImprovement.map((p, i) => (
                      <li key={i} className="flex gap-1.5 text-[11px] text-muted-foreground">
                        <span className="text-signal-green">▸</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  className="mt-3 h-8 w-full rounded-[3px] bg-signal-green px-4 text-[11px] font-bold uppercase tracking-wider text-[#04120c] hover:bg-signal-green/90"
                  onClick={() => dispatch({ type: "APPLY_RECOVERY" })}
                >
                  Apply recovery plan
                </Button>
              </Panel>
            )}
          </div>
        </div>
      )}

      {applied && (
        <div className="space-y-4">
          <div className="wf-ribbon wf-accent-top flex flex-wrap items-center gap-3 rounded-md border border-signal-green/40 bg-signal-green/[0.07] px-3.5 py-3">
            <CheckCircle2 className="size-5 shrink-0 text-signal-green" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold uppercase tracking-wider text-signal-green">
                Recovery applied — operation stabilized
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                The coordinated plan moved pickers, rebooked trucks, drafted replenishments and fast-tracked surge
                orders. Check the{" "}
                <Link to="/" className="text-signal-cyan hover:underline">
                  Control Tower
                </Link>{" "}
                for the stabilized state.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-[3px] text-[11px]"
              onClick={() => dispatch({ type: "RESET" })}
            >
              Reset demo
            </Button>
          </div>
          <Panel title="What just happened" accent="cyan" bodyClassName="p-3">
            <EmptyState>
              The recovery engine applied every step in order, then refreshed priority, risk and stock status
              across the warehouse. The activity log on the Control Tower records each action with a timestamp.
            </EmptyState>
          </Panel>
        </div>
      )}
    </div>
  );
}

function ImpactRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "red" | "amber" | "cyan";
}) {
  return (
    <div className="rounded-[3px] border border-border/70 bg-muted/30 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="wf-label">{label}</span>
        <span
          className={
            "wf-mono text-sm font-bold " +
            (tone === "red" ? "text-signal-red" : tone === "amber" ? "text-signal-amber" : "text-signal-cyan")
          }
        >
          {value}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{detail}</div>
    </div>
  );
}
