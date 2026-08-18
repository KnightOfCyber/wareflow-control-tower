import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  EventSeverity,
  OrderStatus,
  PriorityLevel,
  RiskLevel,
  StockStatus,
} from "@/types";

const TONES = {
  red: "border-signal-red/40 bg-signal-red/10 text-signal-red",
  amber: "border-signal-amber/40 bg-signal-amber/10 text-signal-amber",
  cyan: "border-signal-cyan/40 bg-signal-cyan/10 text-signal-cyan",
  green: "border-signal-green/40 bg-signal-green/10 text-signal-green",
  steel: "border-border bg-muted/60 text-muted-foreground",
} as const;

type ToneKey = keyof typeof TONES;

function Tag({
  tone,
  children,
  className,
}: {
  tone: ToneKey;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-[3px] border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-[0.08em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </Badge>
  );
}

export function PriorityBadge({ level }: { level: PriorityLevel }) {
  const map: Record<PriorityLevel, ToneKey> = {
    critical: "red",
    high: "amber",
    medium: "cyan",
    low: "steel",
  };
  return <Tag tone={map[level]}>{level}</Tag>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const map: Record<RiskLevel, ToneKey> = {
    critical: "red",
    high: "amber",
    medium: "cyan",
    low: "steel",
  };
  return <Tag tone={map[level]}>{level === "critical" ? "CRIT RISK" : level.toUpperCase()}</Tag>;
}

export function StockBadge({ status }: { status: StockStatus }) {
  const map: Record<StockStatus, ToneKey> = {
    healthy: "green",
    low: "cyan",
    critical: "amber",
    out: "red",
    damaged: "red",
  };
  return <Tag tone={map[status]}>{status}</Tag>;
}

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  created: "CREATED",
  prioritized: "PRIORITIZED",
  allocated: "ALLOCATED",
  picking: "PICKING",
  packing: "PACKING",
  "quality-check": "QC",
  ready: "READY",
  dispatched: "DISPATCHED",
  delayed: "DELAYED",
  exception: "EXCEPTION",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const map: Record<OrderStatus, ToneKey> = {
    created: "steel",
    prioritized: "cyan",
    allocated: "cyan",
    picking: "cyan",
    packing: "cyan",
    "quality-check": "amber",
    ready: "green",
    dispatched: "green",
    delayed: "amber",
    exception: "red",
  };
  return (
    <Tag tone={map[status]} className={className}>
      {ORDER_STATUS_LABEL[status]}
    </Tag>
  );
}

export function SeverityTag({ severity }: { severity: EventSeverity }) {
  const map: Record<EventSeverity, ToneKey> = {
    info: "steel",
    success: "green",
    warning: "amber",
    critical: "red",
    decision: "cyan",
  };
  return <Tag tone={map[severity]}>{severity === "decision" ? "DECISION" : severity.toUpperCase()}</Tag>;
}

export function GenericTag({
  tone,
  children,
  className,
}: {
  tone: "red" | "amber" | "cyan" | "green" | "steel";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tag tone={tone} className={className}>
      {children}
    </Tag>
  );
}
