import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useWarehouse } from "@/lib/state/store";
import { computePriority, remainingSla } from "@/lib/decision-engine/priority-engine";
import { computeOrderRisk } from "@/lib/decision-engine/risk-engine";
import { PageHeader, Panel, MicroLabel, MiniBar, EmptyState } from "@/components/shared/ui";
import { OrderStatusBadge, PriorityBadge, RiskBadge, GenericTag } from "@/components/shared/badges";
import { fmtClock, fmtSla } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAllocationConflict } from "@/lib/decision-engine/allocation-engine";
import { OrderActions } from "@/components/shared/OrderActions";
import type { OrderStatus } from "@/types";

const STATUS_FILTERS: Array<{ key: OrderStatus | "all"; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "created", label: "CREATED" },
  { key: "prioritized", label: "PRIORITIZED" },
  { key: "allocated", label: "ALLOCATED" },
  { key: "picking", label: "PICKING" },
  { key: "packing", label: "PACKING" },
  { key: "quality-check", label: "QC" },
  { key: "ready", label: "READY" },
  { key: "dispatched", label: "DISPATCHED" },
  { key: "delayed", label: "DELAYED" },
  { key: "exception", label: "EXCEPTION" },
];

export default function Orders() {
  const { state } = useWarehouse();
  const [params] = useSearchParams();
  const focusOrder = params.get("order");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(focusOrder ?? "1042");

  const rows = useMemo(() => {
    let list = state.orders;
    if (status !== "all") list = list.filter((o) => o.status === status);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.id.includes(q) ||
          o.customer.toLowerCase().includes(q) ||
          o.items.some((i) => i.sku.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }, [state, status, query]);

  const openOrder = openId ? state.orders.find((o) => o.id === openId) : undefined;

  return (
    <div>
      <PageHeader
        code="ORD-01 · ORDER MANAGEMENT"
        title="Orders"
        meta="Priority, SLA and risk are computed live by the engine — never manually assigned."
        right={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="orders-search" className="sr-only">
              Search orders
            </label>
            <input
              id="orders-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search orders by order number, customer, or SKU"
              placeholder="Search order, customer, SKU…"
              className="h-8 w-56 rounded-[3px] border border-input bg-muted/40 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-signal-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1" aria-label="Order status filters">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-label={`Filter orders by ${f.label.toLowerCase()} status`}
            onClick={() => setStatus(f.key)}
            className={cn(
              "rounded-[3px] border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              status === f.key
                ? "border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan"
                : "border-border/70 bg-muted/30 text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            <span className="wf-mono ml-1.5 opacity-70">
              {f.key === "all"
                ? state.orders.length
                : state.orders.filter((o) => o.status === f.key).length}
            </span>
          </button>
        ))}
      </div>

      <Panel bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState>No orders match the current filters.</EmptyState>
        ) : (
          <table className="wf-table w-full text-xs">
            <thead>
              <tr>
                <th className="w-8" />
                <th>Order</th>
                <th>Priority</th>
                <th>SLA / deadline</th>
                <th>Items</th>
                <th>Status</th>
                <th>Fulfillment</th>
                <th>Risk</th>
                <th>Zone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const remaining = remainingSla(o, state.clock);
                const risk = computeOrderRisk(o, state);
                const totalQty = o.items.reduce((a, i) => a + i.qty, 0);
                const doneQty = o.status === "dispatched" ? totalQty : o.items.reduce((a, i) => a + i.allocated, 0);
                const fulfillment = totalQty ? Math.round((doneQty / totalQty) * 100) : 0;
                const isOpen = openId === o.id;
                const slaTone =
                  remaining <= 15 ? "text-signal-red" : remaining <= 45 ? "text-signal-amber" : "text-muted-foreground";
                return (
                  <Fragment key={o.id}>
                    <tr
                      tabIndex={0}
                      role="button"
                      aria-expanded={isOpen}
                      aria-label={`Toggle details for order ${o.id}`}
                      className={cn(
                        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        isOpen && "bg-accent/60",
                        focusOrder === o.id && "outline outline-1 outline-signal-cyan/70",
                      )}
                      onClick={() => setOpenId(isOpen ? null : o.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setOpenId(isOpen ? null : o.id);
                        }
                      }}
                    >
                      <td>
                        {isOpen ? (
                          <ChevronDown className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3.5 text-muted-foreground" />
                        )}
                      </td>
                      <td>
                        <div className="font-medium text-foreground">
                          <span className="wf-mono text-signal-cyan">#{o.id}</span>
                        </div>
                        <div className="max-w-[180px] truncate text-[11px] text-muted-foreground">{o.customer}</div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <PriorityBadge level={o.priority} />
                          <span className="wf-mono text-[10px] text-muted-foreground">{o.score}</span>
                        </div>
                      </td>
                      <td>
                        <span className={cn("wf-mono text-[11px]", slaTone)}>{fmtSla(Math.max(0, remaining))}</span>
                        <div className="text-[10px] text-muted-foreground">
                          by {fmtClock(o.createdAt + o.slaMinutes)}
                        </div>
                      </td>
                      <td>
                        <span className="wf-mono text-[11px]">{totalQty} u</span>
                        <div className="max-w-[130px] truncate text-[10px] text-muted-foreground">
                          {o.items.map((i) => i.sku).join(", ")}
                        </div>
                      </td>
                      <td>
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className="w-32">
                        <div className="flex items-center gap-2">
                          <MiniBar
                            value={fulfillment}
                            tone={fulfillment >= 100 ? "green" : fulfillment >= 50 ? "cyan" : "amber"}
                            className="flex-1"
                          />
                          <span className="wf-mono w-9 text-right text-[11px] text-muted-foreground">
                            {fulfillment}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <RiskBadge level={risk.level} />
                      </td>
                      <td>
                        <span className="wf-mono text-[11px] text-muted-foreground">{o.zone}</span>
                      </td>
                    </tr>
                    {isOpen && openOrder && o.id === openOrder.id && (
                      <tr>
                        <td colSpan={9} className="border-b border-border/50 bg-muted/20 px-4 py-3">
                          <OrderDetail orderId={o.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function OrderDetail({ orderId }: { orderId: string }) {
  const { state } = useWarehouse();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;

  const shortfallLine = order.items.find((i) => {
    const p = state.products.find((x) => x.sku === i.sku);
    return p && i.qty - i.allocated > 0 && p.available < i.qty - i.allocated;
  });
  const shortfallConflict = shortfallLine ? getAllocationConflict(state, order.id, shortfallLine.sku) : null;

  const priority = computePriority(order, state);
  const risk = computeOrderRisk(order, state);
  const exception = order.exceptionId ? state.exceptions.find((e) => e.id === order.exceptionId) : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <MicroLabel className="mb-2 block">ORDER LINES</MicroLabel>
        <table className="wf-table w-full text-xs">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Allocated</th>
              <th>Picked</th>
              <th>Packed</th>
              <th>Line status</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => {
              const lineDone = i.packed >= i.qty || order.status === "dispatched";
              const linePartial = i.allocated > 0 && !lineDone;
              return (
                <tr key={i.sku}>
                  <td className="wf-mono text-signal-cyan">{i.sku}</td>
                  <td>{i.name}</td>
                  <td className="wf-mono">{i.qty}</td>
                  <td className="wf-mono">{i.allocated}</td>
                  <td className="wf-mono">{i.picked}</td>
                  <td className="wf-mono">{i.packed}</td>
                  <td>
                    {lineDone ? (
                      <GenericTag tone="green">DONE</GenericTag>
                    ) : linePartial ? (
                      <GenericTag tone="cyan">PARTIAL</GenericTag>
                    ) : (
                      <GenericTag tone="steel">OPEN</GenericTag>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Available stock per line is shown on the inventory screen; allocations move stock from available →
          reserved when decisions are applied.
        </p>
      </div>

      <div className="space-y-3">
        <div className="rounded-[3px] border border-border/70 bg-muted/30 p-2.5">
          <MicroLabel className="mb-2 block">OPERATOR ACTIONS — LIVE</MicroLabel>
          <OrderActions orderId={order.id} conflict={shortfallConflict} />
        </div>
        <div>
          <MicroLabel className="mb-1 block">PRIORITY ENGINE — SCORE {priority.score}/100</MicroLabel>
          <ul className="space-y-1">
            {priority.explanation.map((e, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="text-signal-cyan">▸</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <MicroLabel className="mb-1 block">RISK ENGINE — {risk.level.toUpperCase()} ({risk.score})</MicroLabel>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-signal-amber">Cause:</span> {risk.reason}
            <br />
            <span className="text-signal-amber">Prediction:</span> {risk.predictedIssue}
          </p>
        </div>
        {exception && (
          <div>
            <MicroLabel className="mb-1 block">OPEN EXCEPTION</MicroLabel>
            <Link
              to="/exceptions"
              className="block rounded-[3px] border border-signal-red/40 bg-signal-red/[0.06] px-2.5 py-2 text-[11px] text-signal-red transition-colors hover:bg-signal-red/15"
            >
              {exception.id} — {exception.type.replace(/-/g, " ")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
