import { useState } from "react";
import { NavLink } from "react-router";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  FlaskConical,
  Gauge,
  Package,
  RotateCcw,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWarehouse } from "@/lib/state/store";
import { Wordmark } from "./Logo";

const NAV = [
  { to: "/", label: "Control Tower", icon: Gauge, end: true },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/decisions", label: "Decision Center", icon: Workflow },
  { to: "/fulfillment", label: "Fulfillment", icon: ClipboardList },
  { to: "/exceptions", label: "Exception Center", icon: ShieldAlert },
  { to: "/simulator", label: "What-If Simulator", icon: FlaskConical },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar() {
  const { state, actions } = useWarehouse();
  const [confirming, setConfirming] = useState(false);

  const openDecisions = state.decisions.filter((d) => d.status === "open").length;
  const openExceptions = state.exceptions.filter((e) => e.status === "open").length;
  const chaosActive = state.chaos.active && state.chaos.disruptions.length > 0;

  return (
    <aside className="no-print fixed inset-y-0 left-0 z-40 flex w-52 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-3">
        <Wordmark />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const badge =
              item.to === "/decisions" && openDecisions > 0
                ? openDecisions
                : item.to === "/exceptions" && openExceptions > 0
                  ? openExceptions
                  : null;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-2.5 rounded-[3px] border-l-2 px-2.5 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "border-signal-cyan bg-sidebar-accent text-foreground"
                        : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                    )
                  }
                >
                  <item.icon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge !== null && (
                    <span className="wf-mono rounded-[3px] bg-signal-amber/15 px-1.5 py-px text-[10px] font-semibold text-signal-amber">
                      {badge}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 border-t border-sidebar-border pt-3">
          <NavLink
            to="/simulator"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-[3px] border-l-2 px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-signal-amber bg-sidebar-accent text-foreground"
                  : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/60",
              )
            }
          >
            <FlaskConical className="size-3.5 shrink-0 text-signal-amber" />
            <span>Simulate decisions</span>
          </NavLink>
          <NavLink
            to="/chaos"
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-2.5 rounded-[3px] border-l-2 px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-signal-red bg-sidebar-accent text-foreground"
                  : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/60",
                chaosActive && "text-signal-red",
              )
            }
          >
            <AlertTriangle className="size-3.5 shrink-0 text-signal-red" />
            <span>Chaos Mode</span>
            {chaosActive && <span className="wf-live-dot-red absolute right-2" />}
          </NavLink>
        </div>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2.5">
        {confirming ? (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Restore seeded snapshot?
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  actions.reset();
                  setConfirming(false);
                }}
                className="flex-1 rounded-[3px] border border-signal-red/40 bg-signal-red/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-signal-red transition-colors hover:bg-signal-red/20"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-[3px] border border-border bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex w-full items-center justify-center gap-2 rounded-[3px] border border-border bg-muted/30 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset demo
          </button>
        )}
      </div>
    </aside>
  );
}
