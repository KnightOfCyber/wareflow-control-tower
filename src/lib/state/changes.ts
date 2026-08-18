import type {
  AllocationConflict,
  AllocationOption,
  ChangeItem,
  WarehouseState,
} from "@/types";

/**
 * Before → after change reports. Captured at application time by comparing
 * the pre-action state against the post-action draft, so judges can see
 * exactly what a decision did to the warehouse.
 */

export function buildAllocationChanges(
  before: WarehouseState,
  after: WarehouseState,
  conflict: AllocationConflict,
  option: AllocationOption,
): ChangeItem[] {
  const changes: ChangeItem[] = [];
  const sku = conflict.sku;

  const beforeProduct = before.products.find((p) => p.sku === sku);
  const afterProduct = after.products.find((p) => p.sku === sku);

  const primaryBefore = before.orders.find((o) => o.id === conflict.orderId);
  const primaryAfter = after.orders.find((o) => o.id === conflict.orderId);
  if (primaryBefore && primaryAfter) {
    const qty = primaryAfter.items.find((i) => i.sku === sku)?.qty ?? 0;
    const beforeAlloc = primaryBefore.items.find((i) => i.sku === sku)?.allocated ?? 0;
    const afterAlloc = primaryAfter.items.find((i) => i.sku === sku)?.allocated ?? 0;
    changes.push({
      label: `Order #${conflict.orderId} · ${sku}`,
      before: `${beforeAlloc}/${qty} allocated`,
      after: `${afterAlloc}/${qty} allocated`,
      tone: afterAlloc >= qty ? "green" : "amber",
    });
    if (primaryBefore.status !== primaryAfter.status) {
      changes.push({
        label: `Order #${conflict.orderId} status`,
        before: primaryBefore.status.toUpperCase(),
        after: primaryAfter.status.toUpperCase(),
        tone: "cyan",
      });
    }
  }

  for (const r of option.releases) {
    const holderBefore = before.orders.find((o) => o.id === r.orderId);
    const holderAfter = after.orders.find((o) => o.id === r.orderId);
    const beforeRes = holderBefore?.items.find((i) => i.sku === r.sku)?.allocated ?? 0;
    const afterRes = holderAfter?.items.find((i) => i.sku === r.sku)?.allocated ?? 0;
    if (beforeRes !== afterRes) {
      changes.push({
        label: `Order #${r.orderId} reservation (${r.sku})`,
        before: `${beforeRes} reserved`,
        after: `${afterRes} reserved`,
        tone: "amber",
      });
    }
    if (holderBefore?.status !== holderAfter?.status) {
      changes.push({
        label: `Order #${r.orderId} status`,
        before: (holderBefore?.status ?? "—").toUpperCase(),
        after: (holderAfter?.status ?? "—").toUpperCase(),
        tone: "cyan",
      });
    }
  }

  if (beforeProduct && afterProduct) {
    if (beforeProduct.available !== afterProduct.available) {
      changes.push({
        label: `${sku} available stock`,
        before: String(beforeProduct.available),
        after: String(afterProduct.available),
        tone: afterProduct.available < beforeProduct.available ? "amber" : "green",
      });
    }
    if (beforeProduct.reserved !== afterProduct.reserved) {
      changes.push({
        label: `${sku} reserved`,
        before: String(beforeProduct.reserved),
        after: String(afterProduct.reserved),
        tone: "cyan",
      });
    }
    if (beforeProduct.stockStatus !== afterProduct.stockStatus) {
      changes.push({
        label: `${sku} stock status`,
        before: beforeProduct.stockStatus.toUpperCase(),
        after: afterProduct.stockStatus.toUpperCase(),
        tone:
          afterProduct.stockStatus === "out"
            ? "red"
            : afterProduct.stockStatus === "critical"
              ? "amber"
              : "green",
      });
    }
  }

  if (option.replenishQty > 0) {
    changes.push({
      label: `Replenishment PO (${sku})`,
      before: "none",
      after: `+${option.replenishQty} drafted`,
      tone: "green",
    });
  }

  return changes;
}

export function buildResolutionChanges(
  before: WarehouseState,
  after: WarehouseState,
  exceptionId: string,
): ChangeItem[] {
  const ex = before.exceptions.find((e) => e.id === exceptionId);
  if (!ex) return [];
  const changes: ChangeItem[] = [];
  changes.push({ label: `${ex.id} status`, before: "OPEN", after: "RESOLVED", tone: "green" });

  const beforeOrder = ex.orderId ? before.orders.find((o) => o.id === ex.orderId) : undefined;
  const afterOrder = ex.orderId ? after.orders.find((o) => o.id === ex.orderId) : undefined;
  if (beforeOrder && afterOrder) {
    if (beforeOrder.status !== afterOrder.status) {
      changes.push({
        label: `Order #${beforeOrder.id} status`,
        before: beforeOrder.status.toUpperCase(),
        after: afterOrder.status.toUpperCase(),
        tone: "cyan",
      });
    }
    if (beforeOrder.pickerId !== afterOrder.pickerId) {
      changes.push({
        label: `Order #${beforeOrder.id} picker`,
        before: beforeOrder.pickerId ?? "—",
        after: afterOrder.pickerId ?? "—",
        tone: "cyan",
      });
    }
    if (beforeOrder.vehicleId !== afterOrder.vehicleId) {
      changes.push({
        label: `Order #${beforeOrder.id} vehicle`,
        before: beforeOrder.vehicleId ?? "—",
        after: afterOrder.vehicleId ?? "—",
        tone: "cyan",
      });
    }
  }
  return changes;
}

export function buildRecoveryChanges(before: WarehouseState): ChangeItem[] {
  const beforePlan = before.chaos.recoveryPlan;
  const changes: ChangeItem[] = [];
  if (beforePlan) {
    if (beforePlan.riskBefore !== beforePlan.riskAfter) {
      changes.push({
        label: "Orders at risk",
        before: String(beforePlan.riskBefore),
        after: String(beforePlan.riskAfter),
        tone: "green",
      });
    }
    if (beforePlan.slaFailuresBefore !== beforePlan.slaFailuresAfter) {
      changes.push({
        label: "Predicted SLA failures",
        before: String(beforePlan.slaFailuresBefore),
        after: String(beforePlan.slaFailuresAfter),
        tone: "green",
      });
    }
  }
  for (const s of beforePlan?.steps ?? []) {
    changes.push({ label: s.title, before: "pending", after: "applied", tone: "cyan" });
  }
  return changes;
}
