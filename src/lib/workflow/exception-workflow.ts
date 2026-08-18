import type {
  ExceptionRecord,
  ExceptionType,
  RiskLevel,
  WarehouseState,
} from "@/types";

/**
 * EXCEPTION WORKFLOW
 * Every exception follows: DETECT → ANALYZE → OPTIONS → RECOMMEND → ACT → RESOLVE.
 * This module generates exception records for dynamic events (chaos mode,
 * QC failures) so they always carry an analysis and executable options.
 */

let seq = 0;

function opt(
  id: string,
  label: string,
  summary: string,
  effect: string[],
  risk: RiskLevel,
  action?: ExceptionRecord["options"][number]["action"],
) {
  return { id, label, summary, effect, risk, action };
}

export function createExceptionRecord(
  state: WarehouseState,
  type: ExceptionType,
  orderId: string,
  sku: string | undefined,
  detail: string,
  severity: RiskLevel,
): ExceptionRecord {
  seq += 1;
  const id = `EX-${String(state.nextExceptionNum + seq - 1).padStart(2, "0")}`;
  const order = state.orders.find((o) => o.id === orderId);

  switch (type) {
    case "picker-unavailable": {
      const current = order?.pickerId ? state.pickers.find((p) => p.id === order.pickerId) : undefined;
      const sameZone = state.pickers.find((p) => p.status === "available" && p.zone === order?.zone);
      const anyFree = state.pickers.find((p) => p.status === "available");
      return {
        id,
        type,
        severity,
        orderId,
        detail,
        status: "open",
        createdAt: state.clock,
        analysis: [
          `${current?.name ?? "Assigned picker"} (${current?.id}) is unavailable.`,
          `Order #${orderId} is stalled with ${order?.items.reduce((a, i) => a + i.qty, 0) ?? 0} units to pick.`,
          sameZone ? `Picker ${sameZone.id} is available in the same zone.` : `No same-zone picker free — cross-zone reassignment required.`,
        ],
        options: [
          opt(
            "OPT-1",
            `Reassign ${sameZone?.id ?? "available picker"}`,
            `Reassign to ${sameZone?.name ?? anyFree?.name ?? "an available picker"} and resume the pick`,
            ["Pick resumes immediately", "No SLA impact"],
            "low",
            sameZone
              ? { type: "reassign-picker", id: `RS-${id}-1`, title: "Reassign", detail: "Same-zone reassignment", payload: { orderId, pickerId: sameZone.id } }
              : anyFree
                ? { type: "reassign-picker", id: `RS-${id}-1`, title: "Reassign", detail: "Cross-zone reassignment", payload: { orderId, pickerId: anyFree.id } }
                : undefined,
          ),
          opt(
            "OPT-2",
            "Hold order",
            "Queue the order until a picker frees up",
            ["Possible SLA pressure", "No extra travel"],
            "high",
          ),
        ],
        recommendedOptionId: "OPT-1",
        recommendation: `Reassign order #${orderId} to an available picker.`,
        why: ["Any idle picker resumes the task immediately — holding the order risks its SLA."],
      };
    }

    case "damaged": {
      const product = sku ? state.products.find((p) => p.sku === sku) : undefined;
      return {
        id,
        type,
        severity,
        orderId,
        sku,
        detail,
        status: "open",
        createdAt: state.clock,
        analysis: [
          `Damaged stock detected on ${sku ?? "line"} for order #${orderId}.`,
          product
            ? `${product.available} healthy units of ${sku} remain available — replacement is feasible.`
            : "No healthy stock recorded for this SKU.",
        ],
        options: [
          opt(
            "OPT-1",
            "Replace from stock",
            "Swap in healthy units and requeue QC",
            ["Full order ships", "1 extra pick"],
            "low",
            { type: "requeue", id: `RS-${id}-1`, title: "Requeue QC", detail: "Replacement picked", payload: { orderId, stage: "quality-check" } },
          ),
          opt(
            "OPT-2",
            "Split order",
            "Ship healthy units now; remainder after replenishment",
            ["Split shipment", "Extra carrier cost"],
            "medium",
            { type: "requeue", id: `RS-${id}-2`, title: "Partial release", detail: "Healthy units to dock", payload: { orderId, stage: "ready" } },
          ),
          opt(
            "OPT-3",
            "Delay order",
            "Hold the order until replenishment arrives",
            ["Order delayed", "SLA at risk"],
            "high",
          ),
        ],
        recommendedOptionId: "OPT-1",
        recommendation: "Replace the damaged units from healthy stock and requeue QC.",
        why: ["Replacement is instant when healthy stock exists — it protects the SLA with minimal movement."],
      };
    }

    case "dispatch-delay": {
      const readyTruck = state.vehicles.find((v) => v.status === "ready");
      const orderTruck = order?.vehicleId ? state.vehicles.find((v) => v.id === order?.vehicleId) : undefined;
      return {
        id,
        type,
        severity,
        orderId,
        detail,
        status: "open",
        createdAt: state.clock,
        analysis: [
          orderTruck
            ? `${orderTruck.name} (${orderTruck.route}) is delayed — order #${orderId} is affected.`
            : "A dispatch lane is delayed.",
          readyTruck
            ? `${readyTruck.name} is ready with ${Math.max(0, readyTruck.capacity - readyTruck.assigned)} free slots.`
            : "No ready truck currently available.",
        ],
        options: [
          opt(
            "OPT-1",
            readyTruck ? `Rebook to ${readyTruck.name}` : "Rebook to next truck",
            readyTruck ? `Move order #${orderId} to ${readyTruck.name} (ready)` : "Queue for the next ready truck",
            ["On-time dispatch", "Dock rebooking only"],
            "low",
            readyTruck
              ? { type: "rebook-vehicle", id: `RS-${id}-1`, title: "Rebook", detail: "Moved to ready truck", payload: { orderId, vehicleId: readyTruck.id } }
              : undefined,
          ),
          opt(
            "OPT-2",
            "Wait for the lane",
            "Accept the delay on the assigned truck",
            ["SLA breach risk", "No extra handling"],
            "high",
            { type: "requeue", id: `RS-${id}-2`, title: "Hold", detail: "Stays on current lane", payload: { orderId, stage: "ready" } },
          ),
        ],
        recommendedOptionId: "OPT-1",
        recommendation: readyTruck
          ? `Rebook order #${orderId} onto ${readyTruck.name} to protect the SLA.`
          : "Hold the order until the next truck is ready.",
        why: ["A ready truck absorbs the order with zero waiting — the cheapest way to hold the dispatch SLA."],
      };
    }

    case "insufficient-stock": {
      const product = sku ? state.products.find((p) => p.sku === sku) : undefined;
      return {
        id,
        type,
        severity,
        orderId,
        sku,
        detail,
        status: "open",
        createdAt: state.clock,
        analysis: [
          `Insufficient stock of ${sku ?? "line"} to cover order #${orderId}.`,
          product
            ? `${product.available} available (safety stock ${product.safetyStock}).`
            : "Stock position unknown.",
        ],
        options: [
          opt(
            "OPT-1",
            "Express replenishment",
            "Draft an express PO and hold the order for allocation",
            ["Restores stock", "Order delayed ~90m"],
            "medium",
            { type: "requeue", id: `RS-${id}-1`, title: "Requeue", detail: "Awaiting replenishment", payload: { orderId, stage: "prioritized" } },
          ),
          opt(
            "OPT-2",
            "Backorder line",
            "Keep the order open with a backorder note",
            ["No partial delivery", "Customer notified"],
            "high",
            { type: "requeue", id: `RS-${id}-2`, title: "Backorder", detail: "Line backordered", payload: { orderId, stage: "prioritized" } },
          ),
        ],
        recommendedOptionId: "OPT-1",
        recommendation: "Draft an express replenishment and requeue the order for allocation.",
        why: ["Replenishment is the only durable fix — requeueing keeps the order live for when stock lands."],
      };
    }

    case "qc-failure": {
      return {
        id,
        type,
        severity,
        orderId,
        detail,
        status: "open",
        createdAt: state.clock,
        analysis: [`QC failed on order #${orderId}.`, "Rework is estimated at 15–20 minutes."],
        options: [
          opt(
            "OPT-1",
            "Rework + requeue QC",
            "Correct the defect and requeue the order for QC",
            ["Order ships on time", "15m bench work"],
            "low",
            { type: "requeue", id: `RS-${id}-1`, title: "Requeue QC", detail: "Rework complete", payload: { orderId, stage: "quality-check" } },
          ),
          opt(
            "OPT-2",
            "Partial release",
            "Ship conforming units, rework the rest",
            ["Split shipment", "Extra cost"],
            "medium",
            { type: "requeue", id: `RS-${id}-2`, title: "Partial release", detail: "Good units to dock", payload: { orderId, stage: "ready" } },
          ),
        ],
        recommendedOptionId: "OPT-1",
        recommendation: "Rework the defect and requeue QC.",
        why: ["Rework is faster than splitting the shipment and keeps the SLA intact."],
      };
    }

    default: {
      return {
        id,
        type,
        severity,
        orderId,
        sku,
        detail,
        status: "open",
        createdAt: state.clock,
        analysis: ["Exception detected.", "Recovery options generated."],
        options: [opt("OPT-1", "Resolve", "Acknowledge and continue", ["Logged"], "low")],
        recommendedOptionId: "OPT-1",
        recommendation: "Acknowledge the exception.",
        why: ["No further action required."],
      };
    }
  }
}
