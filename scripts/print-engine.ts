/* Print the engine's real detection + recovery output for the response. */
import { buildSeed } from "../src/lib/data/seed";
import { refreshDerived } from "../src/lib/state/derived";
import { triggerDisruption, triggerFullChaos } from "../src/lib/simulation/chaos-engine";
import { buildRecoveryPlan } from "../src/lib/decision-engine/recovery-engine";

function fresh() {
  const s = buildSeed();
  refreshDerived(s);
  return s;
}

function describeDisruption(s: any) {
  for (const d of s.chaos.disruptions) {
    console.log(`  ${d.id} [${d.kind}] ${d.title}`);
    console.log(`    detail: ${d.detail}`);
    console.log(`    affectedOrders: ${d.affectedOrders.length ? d.affectedOrders.join(", ") : "none"}`);
    console.log(`    affectedSkus: ${d.affectedSkus.length ? d.affectedSkus.join(", ") : "none"}`);
  }
}

console.log("=== SINGLE: Picker unavailable ===");
{
  const s = fresh();
  const before = s.orders.find((o) => o.status === "picking" && o.pickerId === "P-02");
  console.log(`precondition: P-02 pick = order #${before?.id} (${before?.status}), P-02 status=${s.pickers.find((p) => p.id === "P-02")?.status}`);
  triggerDisruption(s, "picker-out");
  describeDisruption(s);
  const plan = buildRecoveryPlan(s);
  console.log("RECOVERY STEPS:");
  for (const st of plan.steps) console.log(`  [${st.type}] ${st.title} — ${st.detail} → ${JSON.stringify(st.payload)}`);
  console.log(`PREDICTED: risk ${plan.riskBefore} → ${plan.riskAfter} | SLA failures ${plan.slaFailuresBefore} → ${plan.slaFailuresAfter}`);
  console.log(`improvement: ${plan.predictedImprovement.join(" | ")}`);
  console.log(`replenish steps in picker plan: ${plan.steps.filter((x: any) => x.type === "replenish").length} (only from independent inventory shortage)`);
}

console.log("\n=== SINGLE: Stock damage SKU-106 ===");
{
  const s = fresh();
  triggerDisruption(s, "damage-stock");
  describeDisruption(s);
  const plan = buildRecoveryPlan(s);
  for (const st of plan.steps) console.log(`  [${st.type}] ${st.title} — ${st.detail} → ${JSON.stringify(st.payload)}`);
  console.log(`PREDICTED: risk ${plan.riskBefore} → ${plan.riskAfter} | SLA failures ${plan.slaFailuresBefore} → ${plan.slaFailuresAfter}`);
}

console.log("\n=== SINGLE: Truck delay TRK-2 ===");
{
  const s = fresh();
  triggerDisruption(s, "truck-delay");
  describeDisruption(s);
  const plan = buildRecoveryPlan(s);
  for (const st of plan.steps) console.log(`  [${st.type}] ${st.title} — ${st.detail} → ${JSON.stringify(st.payload)}`);
}

console.log("\n=== SINGLE: Order surge ===");
{
  const s = fresh();
  triggerDisruption(s, "order-surge");
  describeDisruption(s);
  const plan = buildRecoveryPlan(s);
  for (const st of plan.steps) console.log(`  [${st.type}] ${st.title} — ${st.detail} → ${JSON.stringify(st.payload)}`);
}

console.log("\n=== FULL CHAOS: all 4 disruptions ===");
{
  const s = fresh();
  triggerFullChaos(s);
  console.log(`detected: ${s.chaos.disruptions.length}`);
  describeDisruption(s);
  const plan = buildRecoveryPlan(s);
  console.log("RECOVERY PLAN (coordinated):");
  for (const st of plan.steps) console.log(`  ${st.id} [${st.type}] ${st.title} — ${st.detail}`);
  console.log(`PREDICTED: risk ${plan.riskBefore} → ${plan.riskAfter} | SLA failures ${plan.slaFailuresBefore} → ${plan.slaFailuresAfter}`);
  console.log(`improvement: ${plan.predictedImprovement.join(" | ")}`);
  const byKind: Record<string, number> = {};
  for (const st of plan.steps) byKind[st.type] = (byKind[st.type] ?? 0) + 1;
  console.log(`step mix: ${JSON.stringify(byKind)}`);
}
