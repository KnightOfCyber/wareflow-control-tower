/**
 * WAREFLOW — Domain model
 * Everything is deterministic and typed. No external APIs.
 */

export type PriorityLevel = "critical" | "high" | "medium" | "low";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type StockStatus = "healthy" | "low" | "critical" | "out" | "damaged";

export type OrderStatus =
  | "created"
  | "prioritized"
  | "allocated"
  | "picking"
  | "packing"
  | "quality-check"
  | "ready"
  | "dispatched"
  | "delayed"
  | "exception";

export type ZoneId = "ZA" | "ZB" | "ZC" | "ZD";

export type CustomerTier = "enterprise" | "retail" | "standard" | "low";

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  allocated: number;
  picked: number;
  packed: number;
}

export interface Order {
  id: string;
  customer: string;
  customerTier: CustomerTier;
  /** Business-declared priority (customer tier / order class) */
  basePriority: PriorityLevel;
  /** Engine-computed priority — refreshed on every state change */
  priority: PriorityLevel;
  /** Engine-computed priority score 0..100 */
  score: number;
  /** Created at, minutes after shift start (t0) */
  createdAt: number;
  /** Total SLA budget in minutes */
  slaMinutes: number;
  items: OrderItem[];
  status: OrderStatus;
  zone: ZoneId;
  /** Engine-computed risk */
  risk: RiskLevel;
  riskScore: number;
  riskReason?: string;
  pickerId?: string;
  stationId?: string;
  vehicleId?: string;
  /** True when a QC failure put the order here */
  qcFailed?: boolean;
  exceptionId?: string;
}

export interface Product {
  sku: string;
  name: string;
  category: string;
  zone: ZoneId;
  available: number;
  reserved: number;
  damaged: number;
  safetyStock: number;
  reorderThreshold: number;
  unitCost: number;
  /** Last computed stock status */
  stockStatus: StockStatus;
  /** Replenishment draft qty, if the engine proposed one */
  replenishQty?: number;
}

export type PickerStatus = "available" | "busy" | "unavailable";
export interface Picker {
  id: string;
  name: string;
  zone: ZoneId;
  status: PickerStatus;
  /** tasks in queue */
  workload: number;
  capacity: number;
  /** avg units picked per hour */
  unitsPerHour: number;
}

export type StationStatus = "idle" | "packing" | "blocked";
export interface PackStation {
  id: string;
  name: string;
  status: StationStatus;
  queue: number;
  throughputPerHour: number;
}

export type VehicleStatus = "ready" | "loading" | "enroute" | "delayed";
export interface DispatchVehicle {
  id: string;
  name: string;
  status: VehicleStatus;
  capacity: number;
  assigned: number;
  route: string;
}

export type EventSeverity = "info" | "success" | "warning" | "critical" | "decision";
export interface ActivityEvent {
  id: string;
  time: number;
  severity: EventSeverity;
  message: string;
}

export type ExceptionType =
  | "insufficient-stock"
  | "damaged"
  | "missing"
  | "picker-unavailable"
  | "packing-bottleneck"
  | "dispatch-delay"
  | "qc-failure";

export type ExceptionStatus = "open" | "resolved";

export interface ExceptionOption {
  id: string;
  label: string;
  summary: string;
  effect: string[];
  risk: RiskLevel;
  /** Executable payload applied on resolution (optional) */
  action?: RecoveryStep;
}

export interface ExceptionRecord {
  id: string;
  type: ExceptionType;
  severity: RiskLevel;
  orderId?: string;
  sku?: string;
  detail: string;
  status: ExceptionStatus;
  createdAt: number;
  resolvedAt?: number;
  /** before → after report captured when this exception was resolved */
  resolvedChanges?: ChangeItem[];
  analysis: string[];
  options: ExceptionOption[];
  recommendedOptionId: string;
  recommendation: string;
  why: string[];
  resolution?: string;
}

export type DecisionType =
  | "allocation"
  | "exception"
  | "recovery"
  | "replenishment"
  | "dispatch";

export type DecisionStatus = "open" | "applied" | "dismissed";

export interface AllocationEntry {
  orderId: string;
  sku: string;
  qty: number;
  source: "available" | "recall" | "substitute";
}

/** One allocation option produced by the allocation engine */
export interface ScenarioBreakdown {
  sla: number;
  fulfillment: number;
  delay: number;
  movement: number;
}

export interface AllocationOption {
  id: string;
  label: string;
  summary: string;
  releases: AllocationEntry[];
  allocations: AllocationEntry[];
  /** simulate replenishment draft alongside */
  replenishQty: number;
  expectedDelayMin: number;
  slaRisk: "low" | "medium" | "high" | "critical";
  fulfillmentAfter: number;
  ordersAffected: string[];
  movement: number;
  riskScore: number;
  /** weighted components that produced riskScore (sla 40% · fulfillment 30% · delay 20% · movement 10%) */
  breakdown: ScenarioBreakdown;
  pros: string[];
  cons: string[];
}

/** One before → after change, shown after a decision/action is applied. */
export interface ChangeItem {
  label: string;
  before: string;
  after: string;
  tone?: "green" | "amber" | "red" | "cyan" | "steel";
}

export interface AllocationConflict {
  id: string;
  orderId: string;
  sku: string;
  requiredQty: number;
  availableQty: number;
  reservedRecoverable: number;
  shortfall: number;
  description: string;
  options: AllocationOption[];
  recommendedOptionId: string;
  explanation: string[];
  impact: string[];
}

export interface DecisionRecord {
  id: string;
  type: DecisionType;
  title: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  analysis: string[];
  recommendation: string;
  why: string[];
  impact: string[];
  status: DecisionStatus;
  createdAt: number;
  /** when the operator applied the decision */
  appliedAt?: number;
  /** before → after report captured at application time */
  changes?: ChangeItem[];
  orderId?: string;
  sku?: string;
  conflictId?: string;
  planId?: string;
}

export type BottleneckStage = "picking" | "packing" | "qc" | "dispatch" | "replenishment";
export interface Bottleneck {
  id: string;
  stage: BottleneckStage;
  zone: ZoneId | "ALL";
  severity: RiskLevel;
  title: string;
  detail: string;
  evidence: string;
  recommendation: string;
}

export type DisruptionKind =
  | "picker-out"
  | "damage-stock"
  | "truck-delay"
  | "order-surge";

export interface ChaosState {
  active: boolean;
  disruptions: Disruption[];
  recoveryPlan?: RecoveryPlan;
  appliedAt?: number;
}

export interface Disruption {
  id: string;
  kind: DisruptionKind;
  title: string;
  detail: string;
  detectedAt: number;
  affectedOrders: string[];
  affectedSkus: string[];
}

export type RecoveryStepType =
  | "reassign-picker"
  | "release-reservation"
  | "reallocate"
  | "rebook-vehicle"
  | "replenish"
  | "resequence"
  | "substitute"
  | "requeue";

export interface RecoveryStep {
  id: string;
  type: RecoveryStepType;
  title: string;
  detail: string;
  /** structured application payload for the reducer */
  payload: Record<string, string | number | boolean>;
}

export interface RecoveryPlan {
  id: string;
  title: string;
  steps: RecoveryStep[];
  riskBefore: number;
  riskAfter: number;
  slaFailuresBefore: number;
  slaFailuresAfter: number;
  predictedImprovement: string[];
}

/** What-if simulation session (never mutates real state until applied) */
export interface SimSession {
  id: string;
  conflictId: string;
  orderId: string;
  sku: string;
  title: string;
  situation: string[];
  scenarios: AllocationOption[];
  recommendedScenarioId: string;
  comparedAt: number;
  appliedScenarioId?: string;
  /** before → after report captured when a scenario was applied */
  appliedChanges?: ChangeItem[];
  appliedAt?: number;
  explanation: string[];
}

export interface WarehouseState {
  version: number;
  clock: number;
  orders: Order[];
  products: Product[];
  pickers: Picker[];
  stations: PackStation[];
  vehicles: DispatchVehicle[];
  events: ActivityEvent[];
  exceptions: ExceptionRecord[];
  decisions: DecisionRecord[];
  sim: SimSession | null;
  chaos: ChaosState;
  nextOrderNum: number;
  nextEventId: number;
  nextDecisionNum: number;
  nextExceptionNum: number;
}
