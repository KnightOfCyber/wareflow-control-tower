import type {
  ActivityEvent,
  DispatchVehicle,
  ExceptionOption,
  ExceptionRecord,
  Order,
  OrderItem,
  PackStation,
  Picker,
  Product,
  WarehouseState,
} from "@/types";

/**
 * WAREFLOW demo seed — a realistic mid-shift snapshot engineered for the
 * hackathon demo. t0 = shift start (08:00). clock = minutes since t0.
 *
 * The star conflict:
 *   Order #1042 (CRITICAL, enterprise) needs 10 × SKU-104.
 *   SKU-104 has 7 available + 3 reserved by low-priority order #1055.
 *   Order #1048 (MEDIUM) also needs 5 × SKU-104.
 *   Demand 15 vs supply 10 → the Decision Engine must act.
 */

const CLOCK0 = 58;

interface RawOrder {
  id: string;
  customer: string;
  tier: Order["customerTier"];
  base: Order["basePriority"];
  sla: number;
  created: number;
  items: Array<[string, number, number, number, number]>; // sku, qty, allocated, picked, packed
  status: Order["status"];
  pickerId?: string;
  stationId?: string;
  vehicleId?: string;
}

function products(): Product[] {
  const P = (
    sku: string,
    name: string,
    category: string,
    zone: Product["zone"],
    available: number,
    safetyStock: number,
    reorderThreshold: number,
    unitCost: number,
    damaged = 0,
  ): Product => ({
    sku,
    name,
    category,
    zone,
    available,
    reserved: 0,
    damaged,
    safetyStock,
    reorderThreshold,
    unitCost,
    stockStatus: "healthy",
  });

  return [
    P("SKU-101", "Parcel Carton 40x30x20", "Packaging", "ZB", 320, 120, 200, 1.4),
    P("SKU-102", "Kraft Tape 48mm x150m", "Packaging", "ZB", 410, 90, 150, 3.1),
    P("SKU-103", "RFID Asset Tag", "Electronics", "ZA", 260, 50, 90, 2.8),
    P("SKU-104", "Sensor Array Kit K-9", "Electronics", "ZA", 7, 10, 15, 42.0),
    P("SKU-105", "DC Motor 12V", "Industrial", "ZB", 88, 20, 35, 18.5),
    P("SKU-106", "LED Work Light 24W", "Electronics", "ZA", 54, 15, 25, 12.9),
    P("SKU-107", "Conveyor Roller 60mm", "Industrial", "ZB", 42, 12, 20, 9.4),
    P("SKU-108", "Bearing Set 6204", "Industrial", "ZB", 120, 30, 50, 5.2),
    P("SKU-109", "RF Scanner Handheld", "Electronics", "ZA", 22, 8, 14, 88.0),
    P("SKU-110", "ESD Mat 90x60", "Consumables", "ZC", 45, 10, 18, 15.2),
    P("SKU-111", "Nitrile Gloves M (100)", "Consumables", "ZC", 130, 40, 70, 6.8),
    P("SKU-112", "Logic Controller LC-2", "Electronics", "ZA", 4, 6, 10, 74.0),
    P("SKU-113", "Terminal Block 12P", "Industrial", "ZB", 150, 40, 70, 2.2),
    P("SKU-114", "Thermal Label Roll 4x6", "Consumables", "ZC", 60, 20, 35, 4.6),
    P("SKU-115", "Steel Pallet 1200x800", "Oversize", "ZD", 35, 8, 14, 32.0),
    P("SKU-116", "Fork Sleeve 1000kg", "Oversize", "ZD", 12, 4, 7, 56.0),
    P("SKU-117", "Coolant Fluid 5L", "Climate", "ZC", 28, 10, 16, 11.4),
    P("SKU-118", "Hydraulic Pump G-12", "Industrial", "ZB", 0, 5, 8, 145.0),
    P("SKU-119", "Gearbox 3:1", "Industrial", "ZB", 18, 6, 10, 96.0),
    P("SKU-120", "Poly Strapping 16mm", "Packaging", "ZB", 26, 10, 16, 7.2),
    P("SKU-121", "Poly Strapping 12mm", "Packaging", "ZB", 9, 12, 18, 5.8),
    P("SKU-122", "Food-grade Tote 60L", "Oversize", "ZD", 30, 8, 12, 21.0),
    P("SKU-123", "Refrigerant R-32 10kg", "Climate", "ZC", 16, 6, 10, 68.0),
    P("SKU-124", "Insulated Box 60L", "Climate", "ZC", 40, 10, 18, 14.2),
    P("SKU-125", "Cold Pack XL", "Climate", "ZC", 72, 20, 35, 4.9),
    P("SKU-126", "Frozen Goods Divider", "Climate", "ZC", 55, 15, 25, 6.3),
    P("SKU-127", "HMI Touch Panel 7in", "Electronics", "ZA", 18, 6, 10, 210.0, 4),
    P("SKU-128", "Cable Chain 1m", "Industrial", "ZB", 90, 25, 40, 8.1),
    P("SKU-129", "Vacuum Pump Head", "Industrial", "ZB", 14, 5, 8, 132.0),
    P("SKU-130", "Label Applicator", "Electronics", "ZA", 9, 4, 7, 54.0),
    P("SKU-131", "Lithium Cell Pack 48V", "Industrial", "ZB", 6, 8, 12, 189.0),
    P("SKU-132", "Elevating Cart 250kg", "Oversize", "ZD", 7, 3, 5, 240.0),
    P("SKU-133", "Pallet Wrap Film", "Packaging", "ZB", 200, 60, 100, 3.4),
    P("SKU-134", "Dock Seal 3m", "Oversize", "ZD", 5, 2, 4, 310.0),
    P("SKU-135", "Battery Charger 24V", "Electronics", "ZA", 24, 8, 14, 47.0),
    P("SKU-136", "Safety Cage Mesh", "Oversize", "ZD", 11, 4, 7, 88.0),
  ];
}

const RAW_ORDERS: RawOrder[] = [
  // ---- The demo conflict ----------------------------------------------
  {
    id: "1042",
    customer: "Northwind Medical",
    tier: "enterprise",
    base: "critical",
    sla: 82,
    created: 18,
    items: [["SKU-104", 10, 0, 0, 0]],
    status: "created",
  },
  {
    id: "1048",
    customer: "Apex Retail Group",
    tier: "retail",
    base: "medium",
    sla: 240,
    created: 90,
    items: [["SKU-104", 5, 0, 0, 0]],
    status: "created",
  },
  {
    id: "1055",
    customer: "BlueLeaf Trading",
    tier: "low",
    base: "low",
    sla: 480,
    created: 40,
    items: [["SKU-104", 3, 3, 0, 0]],
    status: "allocated",
  },
  // ---- Open pipeline ---------------------------------------------------
  {
    id: "1056",
    customer: "Harbor Freight Supply",
    tier: "standard",
    base: "medium",
    sla: 180,
    created: 25,
    items: [
      ["SKU-105", 4, 0, 0, 0],
      ["SKU-108", 6, 0, 0, 0],
    ],
    status: "created",
  },
  {
    id: "1057",
    customer: "Delta Foods Co",
    tier: "retail",
    base: "high",
    sla: 90,
    created: 30,
    items: [["SKU-122", 8, 0, 0, 0]],
    status: "created",
  },
  {
    id: "1060",
    customer: "Vertex Components",
    tier: "enterprise",
    base: "high",
    sla: 120,
    created: 45,
    items: [
      ["SKU-110", 4, 0, 0, 0],
      ["SKU-111", 3, 0, 0, 0],
    ],
    status: "prioritized",
  },
  {
    id: "1061",
    customer: "Mako Industrial",
    tier: "standard",
    base: "medium",
    sla: 200,
    created: 55,
    items: [
      ["SKU-115", 2, 0, 0, 0],
      ["SKU-116", 4, 0, 0, 0],
    ],
    status: "prioritized",
  },
  {
    id: "1062",
    customer: "Orion Manufacturing",
    tier: "enterprise",
    base: "high",
    sla: 100,
    created: 60,
    items: [["SKU-119", 3, 3, 0, 0]],
    status: "exception",
    pickerId: "P-04",
  },
  {
    id: "1063",
    customer: "Falcon Retail Chain",
    tier: "retail",
    base: "medium",
    sla: 150,
    created: 70,
    items: [["SKU-109", 6, 6, 5, 0]],
    status: "exception",
    pickerId: "P-05",
  },
  {
    id: "1064",
    customer: "Titan Logistics",
    tier: "standard",
    base: "medium",
    sla: 180,
    created: 80,
    items: [
      ["SKU-101", 12, 12, 12, 0],
      ["SKU-102", 8, 8, 4, 0],
    ],
    status: "picking",
    pickerId: "P-01",
  },
  {
    id: "1065",
    customer: "Apex Retail Group",
    tier: "retail",
    base: "high",
    sla: 110,
    created: 65,
    items: [["SKU-106", 10, 10, 6, 0]],
    status: "picking",
    pickerId: "P-02",
  },
  {
    id: "1066",
    customer: "Northwind Medical",
    tier: "enterprise",
    base: "high",
    sla: 75,
    created: 50,
    items: [["SKU-118", 2, 0, 0, 0]],
    status: "exception",
  },
  {
    id: "1067",
    customer: "Meridian Pharma",
    tier: "enterprise",
    base: "high",
    sla: 90,
    created: 72,
    items: [
      ["SKU-123", 5, 5, 5, 3],
      ["SKU-124", 3, 3, 3, 3],
    ],
    status: "packing",
    stationId: "ST-1",
  },
  {
    id: "1068",
    customer: "Grove Foods",
    tier: "retail",
    base: "medium",
    sla: 140,
    created: 85,
    items: [["SKU-125", 8, 8, 8, 5]],
    status: "packing",
    stationId: "ST-3",
  },
  {
    id: "1058",
    customer: "Northwind Medical",
    tier: "enterprise",
    base: "critical",
    sla: 60,
    created: 20,
    items: [["SKU-127", 4, 4, 4, 4]],
    status: "exception",
    stationId: "ST-2",
  },
  {
    id: "1069",
    customer: "Mako Industrial",
    tier: "standard",
    base: "medium",
    sla: 130,
    created: 78,
    items: [["SKU-113", 6, 6, 6, 6]],
    status: "exception",
    stationId: "ST-2",
  },
  {
    id: "1070",
    customer: "Vertex Components",
    tier: "enterprise",
    base: "high",
    sla: 95,
    created: 66,
    items: [
      ["SKU-107", 8, 8, 8, 8],
      ["SKU-108", 4, 4, 4, 4],
    ],
    status: "quality-check",
    stationId: "ST-4",
  },
  {
    id: "1071",
    customer: "Delta Foods Co",
    tier: "retail",
    base: "medium",
    sla: 120,
    created: 74,
    items: [["SKU-126", 10, 10, 10, 10]],
    status: "exception",
    stationId: "ST-1",
    vehicleId: "TRK-2",
  },
  // ---- Delayed ---------------------------------------------------------
  {
    id: "1031",
    customer: "Sunbeam Retail",
    tier: "standard",
    base: "medium",
    sla: 240,
    created: 260,
    items: [["SKU-120", 6, 6, 6, 0]],
    status: "delayed",
    pickerId: "P-08",
  },
  // ---- Dispatched (yesterday's lane, keeps pipeline full) -------------
  {
    id: "1072",
    customer: "Orion Manufacturing",
    tier: "enterprise",
    base: "high",
    sla: 120,
    created: 20,
    items: [["SKU-103", 4, 4, 4, 4]],
    status: "dispatched",
    vehicleId: "TRK-1",
  },
  {
    id: "1073",
    customer: "Grove Foods",
    tier: "retail",
    base: "medium",
    sla: 150,
    created: 28,
    items: [["SKU-129", 12, 12, 12, 12]],
    status: "dispatched",
    vehicleId: "TRK-3",
  },
  {
    id: "1074",
    customer: "Falcon Retail Chain",
    tier: "retail",
    base: "medium",
    sla: 180,
    created: 32,
    items: [["SKU-130", 8, 8, 8, 8]],
    status: "dispatched",
    vehicleId: "TRK-4",
  },
  {
    id: "1075",
    customer: "Vertex Components",
    tier: "enterprise",
    base: "high",
    sla: 100,
    created: 24,
    items: [["SKU-132", 3, 3, 3, 3]],
    status: "dispatched",
    vehicleId: "TRK-5",
  },
  {
    id: "1076",
    customer: "Delta Foods Co",
    tier: "retail",
    base: "medium",
    sla: 140,
    created: 35,
    items: [["SKU-133", 9, 9, 9, 9]],
    status: "dispatched",
    vehicleId: "TRK-6",
  },
  {
    id: "1077",
    customer: "Mako Industrial",
    tier: "standard",
    base: "medium",
    sla: 160,
    created: 38,
    items: [["SKU-134", 2, 2, 2, 2]],
    status: "dispatched",
    vehicleId: "TRK-1",
  },
  {
    id: "1078",
    customer: "Titan Logistics",
    tier: "standard",
    base: "low",
    sla: 300,
    created: 42,
    items: [["SKU-135", 4, 4, 4, 4]],
    status: "dispatched",
    vehicleId: "TRK-3",
  },
  {
    id: "1079",
    customer: "Apex Retail Group",
    tier: "retail",
    base: "medium",
    sla: 130,
    created: 30,
    items: [["SKU-136", 6, 6, 6, 6]],
    status: "dispatched",
    vehicleId: "TRK-4",
  },
];

function pickers(): Picker[] {
  return [
    { id: "P-01", name: "A. Novak", zone: "ZA", status: "busy", workload: 2, capacity: 5, unitsPerHour: 95 },
    { id: "P-02", name: "M. Reyes", zone: "ZA", status: "busy", workload: 1, capacity: 5, unitsPerHour: 88 },
    { id: "P-03", name: "D. Chen", zone: "ZB", status: "available", workload: 0, capacity: 5, unitsPerHour: 92 },
    { id: "P-04", name: "S. Okoye", zone: "ZB", status: "unavailable", workload: 1, capacity: 5, unitsPerHour: 84 },
    { id: "P-05", name: "L. Fischer", zone: "ZC", status: "busy", workload: 1, capacity: 5, unitsPerHour: 90 },
    { id: "P-06", name: "T. Voss", zone: "ZC", status: "available", workload: 0, capacity: 5, unitsPerHour: 86 },
    { id: "P-07", name: "K. Almeida", zone: "ZD", status: "available", workload: 0, capacity: 4, unitsPerHour: 80 },
    { id: "P-08", name: "R. Ito", zone: "ZD", status: "available", workload: 0, capacity: 4, unitsPerHour: 82 },
  ];
}

function stations(): PackStation[] {
  return [
    { id: "ST-1", name: "Pack Line 1", status: "packing", queue: 2, throughputPerHour: 60 },
    { id: "ST-2", name: "Pack Line 2", status: "packing", queue: 3, throughputPerHour: 48 },
    { id: "ST-3", name: "Pack Line 3", status: "idle", queue: 0, throughputPerHour: 55 },
    { id: "ST-4", name: "Pack Line 4", status: "idle", queue: 1, throughputPerHour: 58 },
  ];
}

function vehicles(): DispatchVehicle[] {
  return [
    { id: "TRK-1", name: "Truck 1", status: "enroute", capacity: 30, assigned: 7, route: "R1 North" },
    { id: "TRK-2", name: "Truck 2", status: "delayed", capacity: 30, assigned: 10, route: "R2 South" },
    { id: "TRK-3", name: "Truck 3", status: "enroute", capacity: 30, assigned: 16, route: "R3 East" },
    { id: "TRK-4", name: "Truck 4", status: "enroute", capacity: 30, assigned: 14, route: "R4 West" },
    { id: "TRK-5", name: "Truck 5", status: "ready", capacity: 30, assigned: 3, route: "R5 Central" },
    { id: "TRK-6", name: "Truck 6", status: "ready", capacity: 30, assigned: 9, route: "R6 Metro" },
  ];
}

function events(): ActivityEvent[] {
  const e = (
    time: number,
    severity: ActivityEvent["severity"],
    message: string,
    id: number,
  ): ActivityEvent => ({ id: `EV-${id}`, time, severity, message });
  return [
    e(12, "info", "Shift start — zone checks complete, all bays online", 1),
    e(18, "critical", "Order #1042 received (Critical SLA 60m) — Northwind Medical", 2),
    e(21, "decision", "Priority Engine scored #1042 at 94 — CRITICAL", 3),
    e(25, "warning", "SKU-104 available (7) below safety stock (10)", 4),
    e(28, "warning", "Shortage risk detected: SKU-104 demand 15 vs supply 10", 5),
    e(30, "decision", "Decision D-001 opened — allocation conflict on SKU-104", 6),
    e(34, "info", "Order #1048 received (Medium, SLA 240m) — Apex Retail Group", 7),
    e(40, "info", "Reservation placed: SKU-104 ×3 for order #1055", 8),
    e(44, "warning", "SKU-118 OUT OF STOCK — order #1066 blocked at allocation", 9),
    e(48, "warning", "Damaged unit detected on SKU-127 — order #1058 in QC", 10),
    e(52, "warning", "Picker P-04 marked unavailable — order #1062 stalled", 11),
    e(55, "critical", "Truck TRK-2 delayed 30m — order #1071 dispatch at risk", 12),
    e(57, "success", "Order #1072 dispatched on TRK-1 (R1 North)", 13),
  ];
}

function orderItems(nameOf: (sku: string) => string, raw: RawOrder): OrderItem[] {
  return raw.items.map(([sku, qty, allocated, picked, packed]) => ({
    sku,
    name: nameOf(sku),
    qty,
    allocated,
    picked,
    packed,
  }));
}

function exceptionOptions(
  id: string,
  label: string,
  summary: string,
  effect: string[],
  risk: ExceptionOption["risk"],
  action?: ExceptionOption["action"],
): ExceptionOption {
  return { id, label, summary, effect, risk, action };
}

export function buildSeed(): WarehouseState {
  const prods = products();
  const nameOf = (sku: string) => prods.find((p) => p.sku === sku)?.name ?? sku;

  const orders: Order[] = RAW_ORDERS.map((r) => ({
    id: r.id,
    customer: r.customer,
    customerTier: r.tier,
    basePriority: r.base,
    priority: r.base,
    score: 50,
    createdAt: r.created,
    slaMinutes: r.sla,
    items: orderItems(nameOf, r),
    status: r.status,
    zone: prods.find((p) => p.sku === r.items[0][0])?.zone ?? "ZA",
    risk: "low",
    riskScore: 0,
    pickerId: r.pickerId,
    stationId: r.stationId,
    vehicleId: r.vehicleId,
  }));

  // Reserved stock = sum of allocations on non-dispatched orders.
  for (const o of orders) {
    if (o.status === "dispatched") continue;
    for (const it of o.items) {
      const p = prods.find((x) => x.sku === it.sku);
      if (p) p.reserved += it.allocated;
    }
  }

  // ---- Exceptions --------------------------------------------------------
  const exceptions: ExceptionRecord[] = [
    {
      id: "EX-01",
      type: "insufficient-stock",
      severity: "critical",
      orderId: "1066",
      sku: "SKU-118",
      detail: "Order #1066 requires 2 × SKU-118 (Hydraulic Pump G-12). Available stock: 0. Reorder threshold: 8.",
      status: "open",
      createdAt: 44,
      analysis: [
        "SKU-118 is OUT OF STOCK — available = 0, safety stock = 5.",
        "Order #1066 is HIGH priority (enterprise) with 27m left on its SLA.",
        "No substitute variant exists in the catalog for this item.",
        "Express replenishment ETA is ~90 minutes from an approved PO.",
      ],
      options: [
        exceptionOptions(
          "OPT-1",
          "Express replenish + delay",
          "Place express PO for 8 units (ETA 90m) and delay #1066 by ~90m",
          ["Order delayed ~90m — SLA breach likely (-27m)", "Stock restored above threshold", "No inventory risk to other orders"],
          "high",
          { type: "requeue", id: "RS-EX1-1", title: "Requeue", detail: "Wait for replenishment", payload: { orderId: "1066", stage: "prioritized" } },
        ),
        exceptionOptions(
          "OPT-2",
          "Backorder line",
          "Keep the order open and backorder the 2 units until replenishment",
          ["No dispatch today", "Customer notified of split shipment"],
          "critical",
          { type: "requeue", id: "RS-EX1-2", title: "Backorder", detail: "Line backordered", payload: { orderId: "1066", stage: "prioritized" } },
        ),
        exceptionOptions(
          "OPT-3",
          "Vendor substitution",
          "Ask supplier to ship alternative model G-14 (customer approval needed)",
          ["Requires customer approval — 2-4h", "Possible unit-cost variance"],
          "medium",
          { type: "requeue", id: "RS-EX1-3", title: "Substitute supply", detail: "Await vendor approval", payload: { orderId: "1066", stage: "prioritized" } },
        ),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Place an express replenishment PO for 8 units and delay order #1066.",
      why: [
        "Express replenishment is the only path that restores stock AND keeps the order alive.",
        "The 90m delay breaches the SLA, but a full backorder or substitution risks customer churn and has no inventory upside.",
      ],
    },
    {
      id: "EX-02",
      type: "damaged",
      severity: "high",
      orderId: "1058",
      sku: "SKU-127",
      detail: "QC found 1 of 4 units of SKU-127 (HMI Touch Panel 7in) damaged on order #1058.",
      status: "open",
      createdAt: 48,
      analysis: [
        "SKU-127 has 18 healthy units available in Zone A — replacement is possible.",
        "Order #1058 is CRITICAL (enterprise) with 32m left on its SLA.",
        "Damaged unit is quarantined; no further units affected.",
      ],
      options: [
        exceptionOptions(
          "OPT-1",
          "Replace from Zone A",
          "Pick 1 fresh unit from Zone A and requeue QC (~10m)",
          ["Full order ships on time", "1 extra pick movement", "Damaged unit sent to vendor return"],
          "low",
          { type: "requeue", id: "RS-EX2-1", title: "Requeue QC", detail: "Replacement picked, back in QC", payload: { orderId: "1058", stage: "quality-check" } },
        ),
        exceptionOptions(
          "OPT-2",
          "Split order",
          "Ship 3 good units now; 1 unit follows after replenishment",
          ["Partial delivery — extra carrier cost", "Second dispatch tomorrow"],
          "medium",
          { type: "requeue", id: "RS-EX2-2", title: "Split shipment", detail: "3 units released to dock", payload: { orderId: "1058", stage: "ready" } },
        ),
        exceptionOptions(
          "OPT-3",
          "Substitute SKU-128",
          "Ship Cable Chain 1m instead (not a functional match)",
          ["Unacceptable substitution", "High customer-return risk"],
          "critical",
          { type: "requeue", id: "RS-EX2-3", title: "Substitute", detail: "Non-matching variant shipped", payload: { orderId: "1058", stage: "quality-check" } },
        ),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Replace the damaged unit from Zone A stock and requeue QC.",
      why: [
        "Healthy stock is available in the same zone — replacement costs ~10m and one pick.",
        "Keeps the critical SLA intact and avoids a split shipment.",
      ],
    },
    {
      id: "EX-03",
      type: "missing",
      severity: "medium",
      orderId: "1063",
      sku: "SKU-109",
      detail: "Picker P-05 reports 1 unit of SKU-109 missing from bin ZA-12 during pick of order #1063.",
      status: "open",
      createdAt: 71,
      analysis: [
        "Bin ZA-12 was last cycled 26 minutes ago with a count of 23.",
        "A mis-slot within Zone A is the most probable cause (no theft anomaly).",
        "Order #1063 has 79m left on SLA — time to search is available.",
      ],
      options: [
        exceptionOptions(
          "OPT-1",
          "Bin search + re-pick",
          "Trigger a 10-minute directed search of Zone A bays, then re-pick",
          ["+10m pick time", "No customer impact", "Resolves the stock count discrepancy"],
          "low",
          { type: "requeue", id: "RS-EX3-1", title: "Re-pick complete", detail: "Search resolved, moving to packing", payload: { orderId: "1063", stage: "packing" } },
        ),
        exceptionOptions(
          "OPT-2",
          "Partial fulfill + backorder",
          "Ship 5 of 6 units; backorder the missing unit",
          ["Split shipment cost", "Backorder line created"],
          "medium",
          { type: "requeue", id: "RS-EX3-2", title: "Partial release", detail: "5 units move to packing", payload: { orderId: "1063", stage: "packing" } },
        ),
        exceptionOptions(
          "OPT-3",
          "Substitute from Zone C",
          "Fulfill from the climate-controlled scanner stock",
          ["Different variant — may not match spec", "Breaks cold-chain stock balance"],
          "high",
          { type: "requeue", id: "RS-EX3-3", title: "Substitute", detail: "Variant shipped", payload: { orderId: "1063", stage: "packing" } },
        ),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Run a directed bin search and re-pick the missing unit.",
      why: [
        "The SLA has slack (79m) — a 10m search is the cheapest resolution.",
        "Splitting the shipment adds cost and the substitute variant is not spec-compliant.",
      ],
    },
    {
      id: "EX-04",
      type: "picker-unavailable",
      severity: "high",
      orderId: "1062",
      detail: "Picker P-04 (S. Okoye) is unavailable. Order #1062 has 3 allocated units of SKU-119 and is stalled.",
      status: "open",
      createdAt: 52,
      analysis: [
        "P-04 is the only picker assigned to order #1062 in Zone B.",
        "P-03 (D. Chen) is AVAILABLE in Zone B with zero workload.",
        "Order #1062 has 38m left on its SLA.",
      ],
      options: [
        exceptionOptions(
          "OPT-1",
          "Reassign P-03",
          "Reassign Picker P-03 (Zone B, available) to order #1062",
          ["Pick starts immediately", "No SLA impact", "P-03 workload 0 → 1"],
          "low",
          { type: "reassign-picker", id: "RS-EX4-1", title: "Reassign", detail: "P-03 takes the task", payload: { orderId: "1062", pickerId: "P-03" } },
        ),
        exceptionOptions(
          "OPT-2",
          "Reassign P-07",
          "Pull P-07 from Zone D (Oversize) to complete the pick",
          ["Zone-D queue is empty", "Cross-zone travel ~8m"],
          "medium",
          { type: "reassign-picker", id: "RS-EX4-2", title: "Reassign", detail: "P-07 crosses zones", payload: { orderId: "1062", pickerId: "P-07" } },
        ),
        exceptionOptions(
          "OPT-3",
          "Hold order",
          "Keep order #1062 queued until P-04 returns",
          ["SLA breach near-certain", "Order stalls 20m+"],
          "critical",
        ),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Reassign Picker P-03 to order #1062 immediately.",
      why: [
        "P-03 is available in the same zone with zero workload — zero travel time.",
        "Any wait risks the 38m SLA window.",
      ],
    },
    {
      id: "EX-05",
      type: "dispatch-delay",
      severity: "high",
      orderId: "1071",
      detail: "Truck TRK-2 (R2 South) is delayed 30 minutes. Order #1071 is packed, QC-passed and waiting on the dock.",
      status: "open",
      createdAt: 55,
      analysis: [
        "TRK-2 is delayed 30m — order #1071 (10 units) would leave 20m late vs SLA.",
        "TRK-5 (R5 Central) is READY with 27 free slots and departs in 15m.",
        "TRK-6 (R6 Metro) is READY with 21 free slots and departs in 25m.",
      ],
      options: [
        exceptionOptions(
          "OPT-1",
          "Rebook to TRK-5",
          "Move order #1071 to TRK-5 (ready, departs in 15m)",
          ["On-time dispatch", "TRK-5 still 17 slots free", "R5 Central route adds 10m transit"],
          "low",
          { type: "rebook-vehicle", id: "RS-EX5-1", title: "Rebook", detail: "Moved to TRK-5 dock", payload: { orderId: "1071", vehicleId: "TRK-5" } },
        ),
        exceptionOptions(
          "OPT-2",
          "Wait for TRK-2",
          "Keep the order on TRK-2 and accept the 30m delay",
          ["SLA breach likely (-10m)", "No extra handling"],
          "high",
          { type: "requeue", id: "RS-EX5-2", title: "Hold", detail: "Stays on TRK-2", payload: { orderId: "1071", stage: "ready" } },
        ),
        exceptionOptions(
          "OPT-3",
          "Rebook to TRK-6",
          "Move order #1071 to TRK-6 (departs in 25m)",
          ["Near-on-time dispatch", "R6 Metro route fits destination"],
          "medium",
          { type: "rebook-vehicle", id: "RS-EX5-3", title: "Rebook", detail: "Moved to TRK-6 dock", payload: { orderId: "1071", vehicleId: "TRK-6" } },
        ),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Rebook order #1071 onto TRK-5 and depart on schedule.",
      why: [
        "TRK-5 departs in 15m with spare capacity — the only option that holds the SLA.",
        "Rebooking is a dock move only: ~5 minutes of operator work.",
      ],
    },
    {
      id: "EX-06",
      type: "qc-failure",
      severity: "medium",
      orderId: "1069",
      detail: "QC failed order #1069: label misprint on 2 of 6 units of SKU-113.",
      status: "open",
      createdAt: 80,
      analysis: [
        "Failure is cosmetic (label misprint) — product integrity unaffected.",
        "Reprint + re-label takes ~15 minutes at the QC bench.",
        "Order #1069 has 48m left on its SLA.",
      ],
      options: [
        exceptionOptions(
          "OPT-1",
          "Reprint + requeue QC",
          "Reprint labels, re-label 2 units, requeue QC (~15m)",
          ["Order ships on time", "Minor bench work"],
          "low",
          { type: "requeue", id: "RS-EX6-1", title: "Requeue QC", detail: "Labels reprinted", payload: { orderId: "1069", stage: "quality-check" } },
        ),
        exceptionOptions(
          "OPT-2",
          "Split and ship",
          "Ship the 4 clean units now; 2 reworked units on next dispatch",
          ["Two dispatches", "Extra carrier cost"],
          "medium",
          { type: "requeue", id: "RS-EX6-2", title: "Partial release", detail: "4 units to dock", payload: { orderId: "1069", stage: "ready" } },
        ),
        exceptionOptions(
          "OPT-3",
          "Full rework",
          "Unpack, re-label all 6 units and re-run packing",
          ["+40m — SLA breach risk", "Highest quality guarantee"],
          "medium",
          { type: "requeue", id: "RS-EX6-3", title: "Full rework", detail: "Returns to packing", payload: { orderId: "1069", stage: "packing" } },
        ),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Reprint the labels and requeue QC on the affected units.",
      why: [
        "A 15m label fix keeps the SLA intact — full rework and splitting are both slower and costlier.",
      ],
    },
    // ---- Resolved history -------------------------------------------------
    {
      id: "EX-07",
      type: "insufficient-stock",
      severity: "medium",
      orderId: "1073",
      sku: "SKU-121",
      detail: "SKU-121 dropped below safety stock (9 < 12).",
      status: "resolved",
      createdAt: 33,
      resolvedAt: 40,
      analysis: ["SKU-121 below safety stock.", "Standard vendor ETA 25m."],
      options: [
        exceptionOptions("OPT-1", "Replenish +12", "Standard PO for 12 units (ETA 25m)", ["Stock restored"], "low"),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Place standard replenishment PO for 12 units.",
      why: ["Standard ETA is well within the consumption window."],
      resolution: "Replenishment received at 08:40 — stock restored to 21 units.",
    },
    {
      id: "EX-08",
      type: "qc-failure",
      severity: "low",
      orderId: "1070",
      detail: "QC hold on order #1070 — barcode read error on 1 unit.",
      status: "resolved",
      createdAt: 68,
      resolvedAt: 74,
      analysis: ["Scanner misread — manual verification required."],
      options: [
        exceptionOptions("OPT-1", "Manual verify", "Operator re-scanned and verified the unit", ["Requeued to QC"], "low"),
      ],
      recommendedOptionId: "OPT-1",
      recommendation: "Manual verification and requeue.",
      why: ["Single-unit misread — cheapest fix with no SLA impact."],
      resolution: "Unit verified — order #1070 requeued to QC at 08:14.",
    },
  ];

  // Attach exception ids back to orders.
  for (const ex of exceptions) {
    if (ex.orderId) {
      const o = orders.find((x) => x.id === ex.orderId);
      if (o && ex.status === "open") o.exceptionId = ex.id;
    }
  }

  // Close the loop on the picker-unavailable order: picker actually unavailable.
  const p04 = pickers().find((p) => p.id === "P-04");
  if (p04) p04.status = "unavailable";

  return {
    version: 1,
    clock: CLOCK0,
    orders,
    products: prods,
    pickers: pickers(),
    stations: stations(),
    vehicles: vehicles(),
    events: events(),
    exceptions,
    decisions: [
      {
        id: "D-001",
        type: "allocation",
        title: "Allocate SKU-104 under shortage",
        severity: "critical",
        summary:
          "Order #1042 (CRITICAL) requires 10 units of SKU-104 — only 7 are available. 3 units are reserved by low-priority order #1055. Order #1048 also needs 5 units.",
        analysis: [
          "SKU-104 available stock: 7 units (safety stock 10 — already breached).",
          "Order #1042: critical priority, 42m SLA remaining, enterprise tier.",
          "Order #1048: medium priority, 150m SLA remaining, retail tier.",
          "Order #1055 holds a 3-unit reservation on SKU-104 with 440m of SLA slack.",
        ],
        recommendation:
          "Allocate all 7 available units to #1042 now, and recall the 3 reserved units from low-priority #1055 to fully cover the critical order. #1048 enters the replenishment queue.",
        why: [
          "Critical SLA (42m) + enterprise tier outweighs any other claim on the stock.",
          "Recalling from #1055 costs 3 units of low-priority reservation with 440m of slack — near-zero SLA risk.",
          "Splitting stock leaves the critical order partially fulfilled and both SLAs at risk.",
        ],
        impact: [
          "#1042 fulfilled 10/10 → picks scheduled, SLA protected.",
          "#1055 reduced to 0/3 → re-prioritized after replenishment.",
          "#1048 deferred to replenishment queue (ETA ~40m).",
          "SKU-104 reserved stock rises to 10/10 — stock status moves to CRITICAL until replenished.",
        ],
        status: "open",
        createdAt: 30,
        orderId: "1042",
        sku: "SKU-104",
        conflictId: "C-1042-SKU-104",
      },
    ],
    sim: null,
    chaos: { active: false, disruptions: [] },
    nextOrderNum: 1080,
    nextEventId: 14,
    nextDecisionNum: 2,
    nextExceptionNum: 9,
  };
}
