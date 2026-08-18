import { X } from "lucide-react";
import { useCopilot } from "@/lib/copilot/provider";
import { CopilotChat } from "./CopilotChat";
import { cn } from "@/lib/utils";

/** Slide-in Copilot panel — opened from the Control Tower "Ask Copilot" button. */
export function CopilotDrawer() {
  const { drawerOpen, setDrawerOpen } = useCopilot();
  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-200",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-drawer-title"
        aria-describedby="copilot-drawer-description"
        className={cn(
          "no-print fixed inset-y-0 right-0 z-50 flex w-full max-w-[26rem] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!drawerOpen}
      >
        <header className="wf-scanlines flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3.5">
          <span className="wf-live-dot" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="copilot-drawer-title" className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">
                Wareflow Copilot
              </h2>
              <span className="wf-mono text-[9px] text-muted-foreground/60">COP-01</span>
            </div>
            <p id="copilot-drawer-description" className="truncate text-[10px] text-muted-foreground">
              AI operational assistant — risk · exceptions · decisions
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Copilot panel"
            onClick={() => setDrawerOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-border/70 bg-muted/30 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <CopilotChat variant="drawer" />
        </div>
      </aside>
    </>
  );
}
