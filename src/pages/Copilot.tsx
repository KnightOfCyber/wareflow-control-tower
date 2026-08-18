import { PageHeader, Panel } from "@/components/shared/ui";
import { CopilotChat } from "@/components/copilot/CopilotChat";
import { useCopilot } from "@/lib/copilot/provider";

export default function Copilot() {
  const { context } = useCopilot();
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader
        code="COP-01 · OPERATIONAL ASSISTANT"
        title="Wareflow Copilot"
        meta="AI operational assistant — understand risk, investigate exceptions, simulate decisions, and act. Every answer is computed from the live warehouse state through the same engines the UI uses."
        right={
          <span className="wf-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            live at {context.clock} · deterministic engine
          </span>
        }
      />
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden" bodyClassName="flex min-h-0 flex-1 overflow-hidden p-0">
        <CopilotChat variant="page" />
      </Panel>
    </div>
  );
}
