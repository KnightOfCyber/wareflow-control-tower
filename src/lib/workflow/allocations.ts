import type { AllocationEntry, Order, WarehouseState } from "@/types";

/**
 * Pure application of allocation entries onto a state copy.
 * Used by the allocation engine (for what-if drafts) and by the
 * warehouse store (for real execution) — one source of truth.
 */

function applyEntry(state: WarehouseState, entry: AllocationEntry): void {
  const product = state.products.find((p) => p.sku === entry.sku);
  if (!product) return;

  if (entry.source === "recall") {
    // Release an existing reservation back into available stock.
    const holder = state.orders.find((o) => o.id === entry.orderId);
    const item = holder?.items.find((i) => i.sku === entry.sku);
    if (!holder || !item) return;
    const release = Math.min(item.allocated, entry.qty);
    item.allocated -= release;
    product.reserved = Math.max(0, product.reserved - release);
    product.available += release;
    // A fully-released order returns to the prioritized queue.
    if (item.allocated === 0 && holder.status === "allocated") holder.status = "prioritized";
    if (holder.items.every((i) => i.allocated === 0) && holder.status === "picking") {
      holder.status = "prioritized";
      holder.pickerId = undefined;
    }
    return;
  }

  // source "available" | "substitute"
  const receiver = state.orders.find((o) => o.id === entry.orderId);
  const item = receiver?.items.find((i) => i.sku === entry.sku);
  if (!receiver || !item) return;
  const give = Math.min(entry.qty, product.available);
  item.allocated += give;
  product.available -= give;
  product.reserved += give;
  if (receiver.status === "created" || receiver.status === "prioritized") {
    receiver.status = "allocated";
  }
}

/** Clone-free application (mutates the passed state) — callers must pass a draft. */
export function applyAllocationsToState(
  state: WarehouseState,
  releases: AllocationEntry[],
  allocations: AllocationEntry[],
): void {
  for (const r of releases) applyEntry(state, r);
  for (const a of allocations) applyEntry(state, a);
}

/** Units actually coverable for an order line, given a draft state. */
export function coverableQty(order: Order, sku: string, state: WarehouseState): number {
  const p = state.products.find((x) => x.sku === sku);
  const item = order.items.find((i) => i.sku === sku);
  if (!p || !item) return 0;
  return Math.min(item.qty - item.allocated, p.available);
}
