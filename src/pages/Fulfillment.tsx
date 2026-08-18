import { useMemo } from "react";
import { useWarehouse } from "@/lib/state/store";
import { PageHeader, Panel, MiniBar, Dot, EmptyState } from "@/components/shared/ui";
import { PriorityBadge, GenericTag } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtSla } from "@/lib/format";
import { remainingSla } from "@/lib/decision-engine/priority-engine";

export default function Fulfillment() {
  const { state, dispatch } = useWarehouse();

  const pickingQueue = useMemo(
    () =>
      state.orders
        .filter((o) => o.status === "allocated" || o.status === "picking")
        .sort((a, b) => b.score - a.score),
    [state],
  );
  const packingQueue = state.orders.filter((o) => o.status === "packing");
  const qcQueue = state.orders.filter((o) => o.status === "quality-check");
  const readyQueue = state.orders.filter((o) => o.status === "ready");

  const availablePickers = state.pickers.filter((p) => p.status === "available");
  const busyPickers = state.pickers.filter((p) => p.status === "busy");

  return (
    <div>
      <PageHeader
        code="FUL-01 · OPERATIONS"
        title="Fulfillment"
        meta="Every transition mutates real state: inventory, queues, activity log and risk are updated together."
      />

      {/* Picking */}
      <Panel
        title="Picking queue"
        accent="cyan"
        className="mb-4"
        right={
          <span className="wf-mono text-[10px] text-muted-foreground">
            {pickingQueue.length} task{pickingQueue.length === 1 ? "" : "s"} · {availablePickers.length} picker(s) free
          </span>
        }
        bodyClassName="p-0"
      >
        {pickingQueue.length === 0 ? (
          <EmptyState>No orders waiting to be picked.</EmptyState>
        ) : (
          <table className="wf-table w-full text-xs">
            <thead>
              <tr>
                <th>Order</th>
                <th>Priority</th>
                <th>SLA</th>
                <th>Zone</th>
                <th>Items</th>
                <th>Picker</th>
                <th className="w-44">Action</th>
              </tr>
            </thead>
            <tbody>
              {pickingQueue.map((o) => {
                const units = o.items.reduce((a, i) => a + (i.qty - i.picked), 0);
                const picker = o.pickerId ? state.pickers.find((p) => p.id === o.pickerId) : undefined;
                const stuck = picker && picker.status === "unavailable";
                const remaining = remainingSla(o, state.clock);
                return (
                  <tr key={o.id}>
                    <td>
                      <span className="wf-mono text-signal-cyan">#{o.id}</span>
                      <div className="max-w-[140px] truncate text-[10px] text-muted-foreground">{o.customer}</div>
                    </td>
                    <td>
                      <PriorityBadge level={o.priority} />
                    </td>
                    <td className={cn("wf-mono", remaining <= 30 ? "text-signal-red" : remaining <= 60 ? "text-signal-amber" : "text-muted-foreground")}>
                      {fmtSla(Math.max(0, remaining))}
                    </td>
                    <td className="wf-mono text-muted-foreground">{o.zone}</td>
                    <td>
                      <span className="wf-mono">{units} u</span>
                      <div className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                        {o.items.map((i) => i.sku).join(", ")}
                      </div>
                    </td>
                    <td>
                      {o.status === "picking" && picker ? (
                        <div className="flex items-center gap-1.5">
                          <span className={cn("wf-mono text-[11px]", stuck ? "text-signal-red" : "text-foreground")}>
                            {picker.id}
                          </span>
                          {stuck && <GenericTag tone="red">UNAVAILABLE</GenericTag>}
                        </div>
                      ) : (
                        <select
                          className="h-6 w-20 rounded-[3px] border border-input bg-muted/40 px-1 text-[11px] text-foreground focus:border-signal-cyan focus:outline-none"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              dispatch({ type: "START_PICKING", orderId: o.id, pickerId: e.target.value });
                            }
                          }}
                        >
                          <option value="" disabled>
                            picker…
                          </option>
                          {state.pickers
                            .filter((p) => p.status === "available" || p.id === o.pickerId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.id} · {p.zone}
                              </option>
                            ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {o.status === "allocated" ? (
                        <Button
                          size="sm"
                          className="h-6 w-full rounded-[3px] bg-signal-cyan px-2 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-signal-cyan/90"
                          onClick={() => {
                            const p = availablePickers.find((x) => x.zone === o.zone) ?? availablePickers[0];
                            if (p) dispatch({ type: "START_PICKING", orderId: o.id, pickerId: p.id });
                          }}
                          disabled={availablePickers.length === 0}
                        >
                          Start picking
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 w-full rounded-[3px] px-2 text-[10px] font-semibold uppercase tracking-wider"
                          onClick={() => dispatch({ type: "COMPLETE_PICKING", orderId: o.id })}
                        >
                          Complete pick
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Packing */}
        <Panel
          title="Packing stations"
          accent="amber"
          right={
            <span className="wf-mono text-[10px] text-muted-foreground">
              {packingQueue.length} packing · {state.stations.filter((s) => s.queue >= 3).length} backed up
            </span>
          }
          bodyClassName="p-0"
        >
          {packingQueue.length === 0 ? (
            <EmptyState>Nothing on the packing lines.</EmptyState>
          ) : (
            <table className="wf-table w-full text-xs">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Station</th>
                  <th>Units</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {packingQueue.map((o) => {
                  const units = o.items.reduce((a, i) => a + (i.allocated - i.packed), 0);
                  return (
                    <tr key={o.id}>
                      <td>
                        <span className="wf-mono text-signal-cyan">#{o.id}</span>
                        <div className="max-w-[130px] truncate text-[10px] text-muted-foreground">{o.customer}</div>
                      </td>
                      <td>
                        <select
                          className="h-6 w-24 rounded-[3px] border border-input bg-muted/40 px-1 text-[11px] text-foreground focus:border-signal-cyan focus:outline-none"
                          value={o.stationId ?? ""}
                          onChange={(e) => dispatch({ type: "START_PACKING", orderId: o.id, stationId: e.target.value })}
                        >
                          {state.stations.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id} (q{s.queue})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="wf-mono">{units} u</td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 w-full rounded-[3px] px-2 text-[10px] font-semibold uppercase tracking-wider"
                          onClick={() => dispatch({ type: "COMPLETE_PACKING", orderId: o.id })}
                        >
                          Packed → QC
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-border/50 p-3 sm:grid-cols-4">
            {state.stations.map((s) => (
              <div key={s.id} className="rounded-[3px] border border-border/70 bg-muted/30 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="wf-mono text-[10px] text-foreground">{s.id}</span>
                  <Dot tone={s.queue >= 3 ? "amber" : s.queue > 0 ? "cyan" : "steel"} />
                </div>
                <div className="wf-mono mt-0.5 text-[10px] text-muted-foreground">
                  q{s.queue} · {s.throughputPerHour}/h
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* QC + Dispatch */}
        <div className="space-y-4">
          <Panel
            title="Quality check"
            accent="amber"
            right={<span className="wf-mono text-[10px] text-muted-foreground">{qcQueue.length} in check</span>}
            bodyClassName="p-0"
          >
            {qcQueue.length === 0 ? (
              <EmptyState>QC bench clear.</EmptyState>
            ) : (
              <table className="wf-table w-full text-xs">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Units</th>
                    <th className="w-56">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {qcQueue.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <span className="wf-mono text-signal-cyan">#{o.id}</span>
                        <div className="max-w-[130px] truncate text-[10px] text-muted-foreground">{o.customer}</div>
                      </td>
                      <td className="wf-mono">{o.items.reduce((a, i) => a + i.qty, 0)} u</td>
                      <td>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            className="h-6 flex-1 rounded-[3px] bg-signal-green px-2 text-[10px] font-semibold uppercase tracking-wider text-[#04120c] hover:bg-signal-green/90"
                            onClick={() => dispatch({ type: "QC_PASS", orderId: o.id })}
                          >
                            Pass
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 flex-1 rounded-[3px] border-signal-red/40 bg-signal-red/10 px-2 text-[10px] font-semibold uppercase tracking-wider text-signal-red hover:bg-signal-red/20"
                            onClick={() => {
                              const reason =
                                window.prompt("QC failure reason:", "Label misprint") ??
                                "QC inspection failed";
                              dispatch({ type: "QC_FAIL", orderId: o.id, reason });
                            }}
                          >
                            Fail
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel
            title="Dispatch bay"
            accent="green"
            right={
              <span className="wf-mono text-[10px] text-muted-foreground">
                {readyQueue.length} ready · {state.vehicles.filter((v) => v.status === "delayed").length} delayed
              </span>
            }
            bodyClassName="p-0"
          >
            {readyQueue.length === 0 ? (
              <EmptyState>No orders waiting at the dock.</EmptyState>
            ) : (
              <table className="wf-table w-full text-xs">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Vehicle</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {readyQueue.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <span className="wf-mono text-signal-cyan">#{o.id}</span>
                        <div className="max-w-[130px] truncate text-[10px] text-muted-foreground">{o.customer}</div>
                      </td>
                      <td>
                        <select
                          className="h-6 w-28 rounded-[3px] border border-input bg-muted/40 px-1 text-[11px] text-foreground focus:border-signal-cyan focus:outline-none"
                          value={o.vehicleId ?? ""}
                          onChange={(e) =>
                            dispatch({ type: "DISPATCH", orderId: o.id, vehicleId: e.target.value })
                          }
                        >
                          <option value="" disabled>
                            truck…
                          </option>
                          {state.vehicles
                            .filter((v) => v.status !== "delayed")
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.id} · {v.route} ({v.capacity - v.assigned} free)
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          className="h-6 w-full rounded-[3px] bg-signal-green px-2 text-[10px] font-semibold uppercase tracking-wider text-[#04120c] hover:bg-signal-green/90"
                          onClick={() => {
                            const v = state.vehicles.find((x) => x.status !== "delayed" && x.status !== "enroute");
                            if (v) dispatch({ type: "DISPATCH", orderId: o.id, vehicleId: v.id });
                          }}
                          disabled={!state.vehicles.some((v) => v.status !== "delayed" && v.status !== "enroute")}
                        >
                          Dispatch
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="grid grid-cols-2 gap-2 border-t border-border/50 p-3 sm:grid-cols-3">
              {state.vehicles.map((v) => (
                <div key={v.id} className="rounded-[3px] border border-border/70 bg-muted/30 px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="wf-mono text-[10px] text-foreground">{v.id}</span>
                    <Dot tone={v.status === "delayed" ? "red" : v.status === "enroute" ? "cyan" : "green"} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {v.route} · <span className="wf-mono">{v.status}</span>
                  </div>
                  <MiniBar value={(v.assigned / v.capacity) * 100} tone={v.status === "delayed" ? "red" : "cyan"} className="mt-1" />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Pickers */}
      <div className="mt-4">
        <Panel
          title="Picker board"
          accent="cyan"
          right={
            <span className="wf-mono text-[10px] text-muted-foreground">
              {busyPickers.length} busy · {availablePickers.length} free
            </span>
          }
          bodyClassName="p-3"
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {state.pickers.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "rounded-[3px] border px-2 py-2",
                  p.status === "unavailable"
                    ? "border-signal-red/40 bg-signal-red/[0.06]"
                    : p.status === "busy"
                      ? "border-signal-cyan/40 bg-signal-cyan/[0.05]"
                      : "border-border/70 bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="wf-mono text-[11px] font-semibold text-foreground">{p.id}</span>
                  <Dot
                    tone={p.status === "unavailable" ? "red" : p.status === "busy" ? "cyan" : "green"}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">{p.name}</div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{p.zone}</span>
                  <span className="wf-mono">
                    {p.status === "busy" ? `${p.workload} queued` : p.status}
                  </span>
                </div>
                <MiniBar value={p.workload * 20} tone={p.status === "unavailable" ? "red" : "cyan"} className="mt-1" />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
