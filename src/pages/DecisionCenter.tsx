import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useWarehouse } from "@/lib/state/store";
import { getAllocationConflict } from "@/lib/decision-engine/allocation-engine";
import { PageHeader, Panel, MicroLabel, EmptyState } from "@/components/shared/ui";
import { DecisionCard } from "@/components/shared/DecisionCard";
import { GenericTag } from "@/components/shared/badges";
import { fmtClock } from "@/lib/format";

export default function DecisionCenter() {
  const { state, actions } = useWarehouse();
  const [params] = useSearchParams();
  const focusDecision = params.get("decision");

  const open = state.decisions.filter((d) => d.status === "open");
  const history = state.decisions.filter((d) => d.status !== "open");

  const conflicts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getAllocationConflict>>();
    for (const d of open) {
      if (d.type === "allocation" && d.orderId && d.sku) {
        map.set(d.id, getAllocationConflict(state, d.orderId, d.sku));
      }
    }
    return map;
  }, [open, state]);

  return (
    <div>
      <PageHeader
        code="DEC-01 · DECISION ENGINE"
        title="Decision Center"
        meta="Every recommendation is deterministic, explainable and executable. Apply a decision to see the warehouse state change."
        right={
          <Link
            to="/simulator"
            className="rounded-[3px] border border-signal-cyan/40 bg-signal-cyan/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-signal-cyan transition-colors hover:bg-signal-cyan/20"
          >
            Open What-If Simulator →
          </Link>
        }
      />

      {open.length === 0 ? (
        <Panel bodyClassName="p-6">
          <EmptyState>
            No open decisions. The engine evaluates conflicts automatically — open the What-If Simulator to
            stress-test a scenario, or trigger Chaos Mode to generate a recovery decision.
          </EmptyState>
        </Panel>
      ) : (
        <div className="space-y-4">
          {open.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              conflict={conflicts.get(d.id) ?? null}
              className={focusDecision === d.id ? "outline outline-1 outline-signal-cyan/70" : undefined}
              onApply={(optionId) => actions.applyDecision(d.id, optionId)}
              onDismiss={() => actions.dismissDecision(d.id)}
              onSimulate={() => {
                if (d.orderId && d.sku) {
                  actions.startSim(d.orderId, d.sku);
                }
              }}
            />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <MicroLabel className="mb-2 block">DECISION LOG</MicroLabel>
          <Panel bodyClassName="p-0">
            <table className="wf-table w-full text-xs">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Opened</th>
                  <th>Status</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr key={d.id}>
                    <td className="wf-mono text-signal-cyan">{d.id}</td>
                    <td className="text-foreground">{d.title}</td>
                    <td>
                      <GenericTag tone="cyan">{d.type.toUpperCase()}</GenericTag>
                    </td>
                    <td className="wf-mono text-muted-foreground">{fmtClock(d.createdAt)}</td>
                    <td>
                      <GenericTag tone={d.status === "applied" ? "green" : "steel"}>
                        {d.status.toUpperCase()}
                      </GenericTag>
                    </td>
                    <td className="max-w-md truncate text-muted-foreground">{d.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  );
}
