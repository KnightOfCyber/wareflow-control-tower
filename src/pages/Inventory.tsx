import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useWarehouse } from "@/lib/state/store";
import { PageHeader, Panel, MiniBar, EmptyState } from "@/components/shared/ui";
import { StockBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StockStatus, ZoneId } from "@/types";

const STATUS_FILTERS: Array<{ key: StockStatus | "all"; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "critical", label: "CRITICAL" },
  { key: "low", label: "LOW" },
  { key: "out", label: "OUT" },
  { key: "damaged", label: "DAMAGED" },
  { key: "healthy", label: "HEALTHY" },
];

export default function Inventory() {
  const { state, actions } = useWarehouse();
  const [status, setStatus] = useState<StockStatus | "all">("all");
  const [zone, setZone] = useState<ZoneId | "all">("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    let list = state.products;
    if (status !== "all") list = list.filter((p) => p.stockStatus === status);
    if (zone !== "all") list = list.filter((p) => p.zone === zone);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => rank(a.stockStatus) - rank(b.stockStatus) || a.sku.localeCompare(b.sku));
  }, [state, status, zone, query]);

  const alerts = state.products.filter((p) => p.stockStatus === "critical" || p.stockStatus === "out" || p.stockStatus === "damaged");
  const drafted = state.products.filter((p) => p.replenishQty !== undefined);

  return (
    <div>
      <PageHeader
        code="INV-01 · STOCK MONITORING"
        title="Inventory"
        meta={`${state.products.length} SKUs · stock status is recomputed after every allocation, pick and dispatch`}
        right={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search SKU, product, category…"
              className="h-8 w-60 rounded-[3px] border border-input bg-muted/40 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-signal-cyan focus:outline-none"
            />
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatus(f.key)}
            className={cn(
              "rounded-[3px] border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              status === f.key
                ? "border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan"
                : "border-border/70 bg-muted/30 text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="mx-2 h-4 w-px bg-border" />
        {(["all", "ZA", "ZB", "ZC", "ZD"] as const).map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => setZone(z)}
            className={cn(
              "wf-mono rounded-[3px] border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              zone === z
                ? "border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan"
                : "border-border/70 bg-muted/30 text-muted-foreground hover:text-foreground",
            )}
          >
            {z === "all" ? "ZONES" : z}
          </button>
        ))}
      </div>

      {/* Alerts strip */}
      {alerts.length > 0 && (
        <div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {alerts.map((p) => {
            const shortfall = Math.max(0, p.safetyStock - p.available);
            const recommended = Math.max(p.reorderThreshold, p.safetyStock - p.available + 5);
            return (
              <div
                key={p.sku}
                className={cn(
                  "rounded-md border px-3 py-2",
                  p.stockStatus === "out" && "border-signal-red/40 bg-signal-red/[0.06]",
                  p.stockStatus === "damaged" && "border-signal-red/40 bg-signal-red/[0.06]",
                  p.stockStatus === "critical" && "border-signal-amber/40 bg-signal-amber/[0.06]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="wf-mono text-[11px] font-semibold text-foreground">{p.sku}</span>
                  <StockBadge status={p.stockStatus} />
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.name}</div>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    <span className="wf-mono text-foreground">{p.available}</span> avail · safety{" "}
                    <span className="wf-mono">{p.safetyStock}</span>
                    {p.stockStatus === "damaged" && (
                      <>
                        {" · "}
                        <span className="wf-mono text-signal-red">{p.damaged} damaged</span>
                      </>
                    )}
                  </span>
                  <span className="text-signal-cyan">
                    {p.stockStatus === "out" ? "out of stock" : `short ${shortfall}`} → replenish{" "}
                    <span className="wf-mono">{recommended}</span>
                  </span>
                </div>
                {p.replenishQty !== undefined && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-signal-cyan">
                      PO drafted: +{p.replenishQty}
                    </span>
                    <Button
                      size="sm"
                      className="h-6 rounded-[3px] bg-signal-cyan px-2 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-signal-cyan/90"
                      onClick={() => actions.confirmReplenishment(p.sku)}
                    >
                      Confirm receipt
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {drafted.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-[3px] border border-signal-cyan/40 bg-signal-cyan/[0.06] px-3 py-2 text-[11px] text-muted-foreground">
          <span className="wf-label-accent">REPLENISHMENT DRAFTS</span>
          <span className="wf-mono">{drafted.map((p) => `${p.sku} +${p.replenishQty}`).join(" · ")}</span>
          <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">
            Receipts must be confirmed before stock becomes available
          </span>
        </div>
      )}

      <Panel bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState>No SKUs match the current filters.</EmptyState>
        ) : (
          <table className="wf-table w-full text-xs">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                <th>Zone</th>
                <th>Available</th>
                <th>Reserved</th>
                <th>Damaged</th>
                <th>Safety</th>
                <th>Reorder</th>
                <th>Utilization</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const total = p.available + p.reserved + p.damaged;
                const coverRatio = total ? Math.min(100, (p.available / Math.max(1, p.safetyStock)) * 100) : 0;
                return (
                  <tr key={p.sku}>
                    <td className="wf-mono text-signal-cyan">{p.sku}</td>
                    <td>
                      <div className="font-medium text-foreground">{p.name}</div>
                    </td>
                    <td className="text-muted-foreground">{p.category}</td>
                    <td>
                      <span className="wf-mono text-[11px] text-muted-foreground">{p.zone}</span>
                    </td>
                    <td className="wf-mono">{p.available}</td>
                    <td className="wf-mono text-muted-foreground">{p.reserved}</td>
                    <td className={cn("wf-mono", p.damaged > 0 ? "text-signal-red" : "text-muted-foreground")}>
                      {p.damaged}
                    </td>
                    <td className="wf-mono text-muted-foreground">{p.safetyStock}</td>
                    <td className="wf-mono text-muted-foreground">{p.reorderThreshold}</td>
                    <td className="w-28">
                      <div className="flex items-center gap-2">
                        <MiniBar
                          value={coverRatio}
                          tone={p.stockStatus === "healthy" ? "green" : p.stockStatus === "low" ? "cyan" : "amber"}
                          className="flex-1"
                        />
                        <span className="wf-mono w-8 text-right text-[10px] text-muted-foreground">
                          {Math.round(coverRatio)}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <StockBadge status={p.stockStatus} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function rank(s: StockStatus): number {
  return s === "out" ? 0 : s === "critical" ? 1 : s === "damaged" ? 2 : s === "low" ? 3 : 4;
}
