import React from "react";
import { cn } from "@/lib/utils";

/** Compact mission-control panel */
export function Panel({
  title,
  accent,
  right,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  accent?: "cyan" | "amber" | "red" | "green" | "steel";
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("wf-panel overflow-hidden", className)}>
      {(title || right) && (
        <header className="wf-panel-header">
          <div className="flex min-w-0 items-center gap-2">
            {accent && <Dot tone={accent} />}
            <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/90">
              {title}
            </h3>
          </div>
          {right}
        </header>
      )}
      <div className={cn("wf-panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Blinking status dot */
export function Dot({ tone, className }: { tone: "cyan" | "amber" | "red" | "green" | "steel"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "cyan" && "bg-signal-cyan shadow-[0_0_5px_rgba(34,211,238,0.8)]",
        tone === "amber" && "bg-signal-amber shadow-[0_0_5px_rgba(255,176,32,0.8)]",
        tone === "red" && "bg-signal-red shadow-[0_0_5px_rgba(248,113,113,0.8)]",
        tone === "green" && "bg-signal-green shadow-[0_0_5px_rgba(52,211,153,0.8)]",
        tone === "steel" && "bg-steel",
        className,
      )}
    />
  );
}

/** Uppercase micro label */
export function MicroLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("wf-label", className)}>{children}</span>;
}

/** Dense KPI readout cell */
export function Kpi({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "cyan" | "amber" | "red" | "green";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <MicroLabel className="block truncate">{label}</MicroLabel>
      <div
        className={cn(
          "wf-mono mt-1 truncate text-lg font-semibold leading-tight",
          tone === "cyan" && "text-signal-cyan",
          tone === "amber" && "text-signal-amber",
          tone === "red" && "text-signal-red",
          tone === "green" && "text-signal-green",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Thin tone bar */
export function MiniBar({
  value,
  tone = "cyan",
  className,
}: {
  value: number;
  tone?: "cyan" | "amber" | "red" | "green" | "steel";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-[2px] bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-[2px] transition-all duration-500",
          tone === "cyan" && "bg-signal-cyan",
          tone === "amber" && "bg-signal-amber",
          tone === "red" && "bg-signal-red",
          tone === "green" && "bg-signal-green",
          tone === "steel" && "bg-steel",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Page header with breadcrumb-style meta */
export function PageHeader({
  title,
  code,
  meta,
  right,
}: {
  title: string;
  code: string;
  meta?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="wf-mono mb-1 text-[10px] uppercase tracking-[0.2em] text-signal-cyan/80">
          {code}
        </div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="wf-label">NO DATA</span>
      <div className="max-w-xs text-xs text-muted-foreground">{children}</div>
    </div>
  );
}
