import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CopilotDrawer } from "@/components/copilot/CopilotDrawer";

export function AppShell() {
  return (
    <div className="wf-grid-bg min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-h-screen flex-col pl-52">
        <TopBar />
        <main className="flex-1 px-4 py-4">
          <Outlet />
        </main>
        <footer className="border-t border-border/60 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          WAREFLOW · decision-first warehouse operations · simulated shift data · deterministic engine
        </footer>
      </div>
      <CopilotDrawer />
    </div>
  );
}
