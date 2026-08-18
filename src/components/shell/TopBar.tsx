import { Link } from "react-router";
import { useWarehouse } from "@/lib/state/store";
import { fmtClock } from "@/lib/format";
import { zoneActivity } from "@/lib/decision-engine/bottleneck-engine";
import { cn } from "@/lib/utils";
import { Dot } from "@/components/shared/ui";

export function TopBar() {
  const { state } = useWarehouse();
  const zones = zoneActivity(state);
  const openDecisions = state.decisions.filter((d) => d.status === "open").length;
  const openExceptions = state.exceptions.filter((e) => e.status === "open").length;
  const chaosActive = state.chaos.active && state.chaos.disruptions.length > 0;

  return (
    <header className="wf-scanlines sticky top-0 z-30 flex h-11 shrink-0 items-center gap-4 border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="wf-live-dot" />
        <span className="wf-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-signal-green">
          Live
        </span>
        <span className="wf-mono text-sm font-semibold text-foreground">{fmtClock(state.clock)}</span>
        <span className="hidden text-[10px] text-muted-foreground sm:inline">
          shift · warehouse W-7
        </span>
      </div>

      <div className="hidden items-center gap-2 md:flex">
        {zones.map((z) => (
          <div
            key={z.zone}
            className="flex items-center gap-1.5 rounded-[3px] border border-border/70 bg-muted/30 px-2 py-1"
            title={`${z.label} — ${z.orders} open orders, ${z.utilization}% picker utilization`}
          >
            <Dot tone={z.utilization >= 70 ? "amber" : z.picking > 0 ? "cyan" : "steel"} />
            <span className="wf-mono text-[10px] text-muted-foreground">{z.zone}</span>
          </div>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {chaosActive && (
          <span className="flex items-center gap-1.5 rounded-[3px] border border-signal-red/40 bg-signal-red/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-signal-red">
            <span className="wf-live-dot-red" />
            Disruption active
          </span>
        )}
        {openExceptions > 0 && (
          <Link
            to="/exceptions"
            className="rounded-[3px] border border-signal-amber/40 bg-signal-amber/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-signal-amber transition-colors hover:bg-signal-amber/20"
          >
            {openExceptions} exception{openExceptions > 1 ? "s" : ""}
          </Link>
        )}
        <Link
          to="/decisions"
          className={cn(
            "rounded-[3px] border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
            openDecisions > 0
              ? "wf-live-dot-amber border-signal-amber/50 bg-signal-amber/10 text-signal-amber hover:bg-signal-amber/20"
              : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
          )}
        >
          Decision required: {openDecisions}
        </Link>
      </div>
    </header>
  );
}
