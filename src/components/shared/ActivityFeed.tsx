import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/types";
import { fmtClock } from "@/lib/format";
import { Dot } from "./ui";

const TONE: Record<ActivityEvent["severity"], "cyan" | "amber" | "red" | "green" | "steel"> = {
  info: "steel",
  success: "green",
  warning: "amber",
  critical: "red",
  decision: "cyan",
};

export function ActivityFeed({
  events,
  limit,
  className,
}: {
  events: ActivityEvent[];
  limit?: number;
  className?: string;
}) {
  const list = (limit ? events.slice(0, limit) : events).sort((a, b) => b.time - a.time);
  if (list.length === 0) {
    return <div className="py-6 text-center text-xs text-muted-foreground">No events recorded.</div>;
  }
  return (
    <ol className={cn("space-y-0", className)}>
      {list.map((e) => (
        <li key={e.id} className="group flex gap-3 py-1.5">
          <div className="flex w-12 shrink-0 justify-end pt-0.5">
            <span className="wf-mono text-[10px] text-muted-foreground">{fmtClock(e.time)}</span>
          </div>
          <div className="flex w-3 shrink-0 justify-center pt-1">
            <Dot tone={TONE[e.severity]} />
          </div>
          <p
            className={cn(
              "min-w-0 text-xs leading-relaxed",
              e.severity === "critical" && "text-signal-red/90",
              e.severity === "warning" && "text-signal-amber/90",
              e.severity === "decision" && "text-signal-cyan/90",
              (e.severity === "info" || e.severity === "success") && "text-muted-foreground",
            )}
          >
            {e.message}
          </p>
        </li>
      ))}
    </ol>
  );
}
