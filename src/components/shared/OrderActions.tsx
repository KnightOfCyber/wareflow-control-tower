import { Link } from "react-router";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWarehouse } from "@/lib/state/store";
import type { AllocationConflict } from "@/types";
import { QcControls } from "./QcControls";

/**
 * Inline workflow actions for one order, driven by its live status:
 * simulate → allocate → pick → pack → QC → dispatch → requeue.
 */
export function OrderActions({ orderId, conflict }: { orderId: string; conflict?: AllocationConflict | null }) {
  const { state, actions } = useWarehouse();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;

  const picker =
    state.pickers.find((p) => p.status === "available" && p.zone === order.zone) ??
    state.pickers.find((p) => p.status === "available");
  const vehicle = state.vehicles.find((v) => v.status === "ready" || v.status === "loading");

  const btn = "h-6 rounded-[3px] px-2.5 text-[10px] font-semibold uppercase tracking-wider";

  switch (order.status) {
    case "created":
    case "prioritized":
      if (conflict) {
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              className={`${btn} bg-signal-amber text-[#1a1204] hover:bg-signal-amber/90`}
              onClick={() => actions.startSim(order.id, conflict.sku)}
            >
              <FlaskConical className="size-3" /> Simulate allocation
            </Button>
            <Link
              to="/decisions"
              className="rounded-[3px] border border-signal-amber/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-signal-amber transition-colors hover:bg-signal-amber/15"
            >
              Review in Decision Center
            </Link>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            awaiting allocation — stock is sufficient, engine will score on SLA urgency
          </span>
        </div>
      );

    case "allocated":
      return (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className={`${btn} bg-signal-cyan text-primary-foreground hover:bg-signal-cyan/90`}
            disabled={!picker}
            onClick={() => picker && actions.startPicking(order.id, picker.id)}
          >
            Start picking{picker ? ` · ${picker.id}` : ""}
          </Button>
          {!picker && <span className="text-[10px] text-signal-amber">no picker free</span>}
        </div>
      );

    case "picking":
      return (
        <Button
          size="sm"
          variant="outline"
          className={`${btn} text-foreground`}
          onClick={() => actions.completePicking(order.id)}
        >
          Complete pick
        </Button>
      );

    case "packing":
      return (
        <Button
          size="sm"
          variant="outline"
          className={`${btn} text-foreground`}
          onClick={() => actions.completePacking(order.id)}
        >
          Packed → QC
        </Button>
      );

    case "quality-check":
      return <QcControls orderId={order.id} actions={actions} />;

    case "ready":
      return (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className={`${btn} bg-signal-green text-[#04120c] hover:bg-signal-green/90`}
            disabled={!vehicle}
            onClick={() => vehicle && actions.dispatch(order.id, vehicle.id)}
          >
            Dispatch{vehicle ? ` · ${vehicle.id}` : ""}
          </Button>
          {!vehicle && <span className="text-[10px] text-signal-amber">no truck available</span>}
        </div>
      );

    case "delayed":
      return (
        <Button
          size="sm"
          variant="outline"
          className={`${btn} border-signal-amber/40 text-signal-amber hover:bg-signal-amber/15`}
          onClick={() => actions.requeueOrder(order.id)}
        >
          Requeue for next wave
        </Button>
      );

    default:
      return <span className="text-[10px] uppercase tracking-wider text-muted-foreground">see exception center</span>;
  }
}
