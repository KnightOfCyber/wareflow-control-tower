import type { Bottleneck, WarehouseState, ZoneId } from "@/types";

/**
 * BOTTLENECK ENGINE
 * Watches each stage of the pipeline (picking → packing → QC → dispatch →
 * replenishment) and flags where throughput is falling behind demand.
 */

export function detectBottlenecks(state: WarehouseState): Bottleneck[] {
  const out: Bottleneck[] = [];
  const { orders, pickers, stations, vehicles, products } = state;

  const open = orders.filter((o) => o.status !== "dispatched");

  // ---- Picking -----------------------------------------------------------
  const picking = open.filter((o) => o.status === "picking" || o.status === "allocated");
  const allocatedToPick = open.filter((o) => o.status === "allocated").length;
  const availablePickers = pickers.filter((p) => p.status === "available").length;
  const stalled = picking.filter((o) => {
    const picker = o.pickerId ? pickers.find((p) => p.id === o.pickerId) : undefined;
    return !picker || picker.status === "unavailable";
  });

  if (stalled.length > 0) {
    out.push({
      id: "BN-P1",
      stage: "picking",
      zone: "ALL",
      severity: "high",
      title: `${stalled.length} pick task${stalled.length > 1 ? "s" : ""} stalled — picker unavailable`,
      detail: `Orders ${stalled.map((o) => `#${o.id}`).join(", ")} are assigned to unavailable pickers.`,
      evidence: `Unavailable pickers: ${pickers.filter((p) => p.status === "unavailable").map((p) => p.id).join(", ") || "none"}`,
      recommendation: "Reassign the affected tasks to an available picker in the same zone.",
    });
  }

  if (allocatedToPick > 0 && availablePickers === 0) {
    out.push({
      id: "BN-P2",
      stage: "picking",
      zone: "ALL",
      severity: "medium",
      title: `${allocatedToPick} allocated order(s) waiting for a picker`,
      detail: "All pickers are busy or unavailable.",
      evidence: `${allocatedToPick} allocated, ${availablePickers} available pickers`,
      recommendation: "Prioritize urgent orders in the pick queue and reassign from low-load zones.",
    });
  }

  // ---- Packing -----------------------------------------------------------
  for (const st of stations) {
    if (st.queue >= 3) {
      out.push({
        id: `BN-K-${st.id}`,
        stage: "packing",
        zone: "ALL",
        severity: st.queue >= 4 ? "high" : "medium",
        title: `Packing backlog at ${st.name}`,
        detail: `${st.name} has ${st.queue} orders queued (throughput ${st.throughputPerHour}/h).`,
        evidence: `Queue ${st.queue} ≥ 3`,
        recommendation: `Rebook queued orders to ${stations.find((s) => s.queue < 2)?.name ?? "an idle station"} or add a packer.`,
      });
    }
  }

  const readyOrders = open.filter((o) => o.status === "ready").length;

  // ---- QC ----------------------------------------------------------------
  const inQc = open.filter((o) => o.status === "quality-check").length;
  if (inQc >= 2) {
    out.push({
      id: "BN-Q1",
      stage: "qc",
      zone: "ALL",
      severity: "medium",
      title: `QC bench busy (${inQc} orders in check)`,
      detail: "QC capacity is shared with exception rework — rechecks queue behind new inspections.",
      evidence: `${inQc} orders in quality-check`,
      recommendation: "Move exception rework to the off-peak QC window.",
    });
  }

  // ---- Dispatch ----------------------------------------------------------
  const delayedVehicles = vehicles.filter((v) => v.status === "delayed");
  for (const v of delayedVehicles) {
    const affected = orders
      .filter((o) => o.vehicleId === v.id && o.status !== "dispatched")
      .map((o) => `#${o.id}`);
    out.push({
      id: `BN-D-${v.id}`,
      stage: "dispatch",
      zone: "ALL",
      severity: "high",
      title: `${v.name} delayed — dispatch lane blocked`,
      detail: `${v.name} (${v.route}) is delayed.${affected.length ? ` Affects ${affected.join(", ")}.` : ""}`,
      evidence: `Status: delayed`,
      recommendation: `Rebook affected orders to ${vehicles.find((x) => x.status === "ready")?.name ?? "the next ready truck"}.`,
    });
  }

  if (readyOrders > 0 && delayedVehicles.length > 0) {
    out.push({
      id: "BN-D2",
      stage: "dispatch",
      zone: "ALL",
      severity: "medium",
      title: `${readyOrders} ready order(s) on a delayed dispatch lane`,
      detail: "Packed orders are ready but the dock lane is delayed.",
      evidence: `${readyOrders} ready, ${delayedVehicles.length} delayed truck(s)`,
      recommendation: "Rebook to a ready truck to protect SLAs.",
    });
  }

  // ---- Replenishment (collapsed into one backlog flag) ------------------
  const critical = products.filter((p) => p.stockStatus === "critical" || p.stockStatus === "out");
  if (critical.length > 0) {
    const hasOut = critical.some((p) => p.stockStatus === "out");
    out.push({
      id: "BN-R-SUM",
      stage: "replenishment",
      zone: "ALL",
      severity: hasOut ? "critical" : "high",
      title: `Replenishment backlog — ${critical.length} SKU${critical.length > 1 ? "s" : ""} below safety stock`,
      detail: `${critical.map((p) => `${p.sku} (${p.available}/${p.safetyStock})`).join(" · ")}`,
      evidence: `${critical.filter((p) => p.stockStatus === "out").length} out of stock, ${critical.filter((p) => p.stockStatus === "critical").length} critical`,
      recommendation: "Draft replenishment POs for all flagged SKUs — express for out-of-stock lines.",
    });
  }

  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: Bottleneck["severity"]): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}

/** Zone-level activity snapshot for the control tower. */
export function zoneActivity(state: WarehouseState): Array<{
  zone: ZoneId;
  label: string;
  orders: number;
  picking: number;
  utilization: number;
}> {
  const zones: ZoneId[] = ["ZA", "ZB", "ZC", "ZD"];
  const labels: Record<ZoneId, string> = {
    ZA: "Zone A · High Velocity",
    ZB: "Zone B · Bulk",
    ZC: "Zone C · Climate",
    ZD: "Zone D · Oversize",
  };
  return zones.map((zone) => {
    const zOrders = state.orders.filter(
      (o) => o.zone === zone && o.status !== "dispatched" && o.status !== "delayed",
    );
    const picking = zOrders.filter((o) => o.status === "picking" || o.status === "allocated").length;
    const pickers = state.pickers.filter((p) => p.zone === zone);
    const utilization = pickers.length
      ? Math.round(
          (pickers.filter((p) => p.status === "busy").length / pickers.length) * 100,
        )
      : 0;
    return { zone, label: labels[zone], orders: zOrders.length, picking, utilization };
  });
}
