import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { WarehouseActions } from "@/lib/state/store";

/**
 * QC action pair with an inline failure reason — no browser prompts,
 * works inside sandboxed iframes.
 */
export function QcControls({
  orderId,
  actions,
}: {
  orderId: string;
  actions: WarehouseActions;
}) {
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("Label misprint");

  if (failing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Failure reason…"
          className="h-6 w-36 rounded-[3px] border border-signal-red/50 bg-muted/40 px-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-signal-red focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") actions.qcFail(orderId, reason.trim() || "QC inspection failed");
            if (e.key === "Escape") setFailing(false);
          }}
        />
        <Button
          size="sm"
          className="h-6 rounded-[3px] bg-signal-red px-2 text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-signal-red/90"
          onClick={() => actions.qcFail(orderId, reason.trim() || "QC inspection failed")}
        >
          Fail
        </Button>
        <Button size="sm" variant="ghost" className="h-6 rounded-[3px] px-2 text-[10px] text-muted-foreground" onClick={() => setFailing(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <Button
        size="sm"
        className="h-6 flex-1 rounded-[3px] bg-signal-green px-2 text-[10px] font-semibold uppercase tracking-wider text-[#04120c] hover:bg-signal-green/90"
        onClick={() => actions.qcPass(orderId)}
      >
        Pass
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-6 flex-1 rounded-[3px] border-signal-red/40 bg-signal-red/10 px-2 text-[10px] font-semibold uppercase tracking-wider text-signal-red hover:bg-signal-red/20"
        onClick={() => setFailing(true)}
      >
        Fail
      </Button>
    </div>
  );
}
