# WAREFLOW

**See the problem. Simulate the future. Make the move.**

WAREFLOW is an intelligent warehouse operations and decision platform. It is not
another inventory dashboard — it tells the operator *what is happening*, *what is
likely to go wrong*, *which options exist*, *which action is recommended and why*,
and *what happens after the decision*.

```
EXCEPTION → DETECT → ANALYZE → GENERATE OPTIONS → SIMULATE → RECOMMEND → EXECUTE → RESOLUTION
```

Built as a hackathon entry for a **Smart Warehouse Operations & Order Fulfillment
System**: deterministic, explainable, fully offline decision engines running on a
seeded, realistic warehouse snapshot. No backend, no auth, no APIs — open the URL
and the control tower is live.

## Problem

Traditional warehouse software *displays* data. A shortage shows "out of stock";
an order shows "delayed". The operator is left to connect the dots.

WAREFLOW runs the workflow the organizers expect:

```
Order Created → Priority Determined → Inventory Checked → Stock Allocated →
Picking → Packing → Quality Check → Dispatch → Inventory Updated
```

…and on top of it a **Decision Engine** that converts operational problems into
analyzed, ranked, explainable decisions:

> Order #1042 needs 10 × SKU-104. Only 7 are available. The engine evaluates
> protecting the critical order, splitting stock, recalling a low-priority
> reservation, and waiting for replenishment — then recommends the lowest-risk
> scenario and explains why.

## Features

| Area | What it does |
| --- | --- |
| **Control Tower** | Warehouse health, at-risk/critical orders, stock alerts, picking/packing/dispatch load, bottlenecks, live event feed, and a prominent *Decision Required* banner |
| **Orders** | Every order carries engine-computed priority (score 0–100), SLA countdown, risk level, fulfillment %, line-level progress and an expandable engine explanation |
| **Inventory** | Available / reserved / damaged / safety stock / reorder threshold per SKU, auto-computed stock status, alerts with replenish recommendations and PO drafts |
| **Decision Center** | Open decisions with analysis → scenarios → recommendation → why → predicted impact. Apply rewrites live state |
| **Fulfillment** | Real state transitions: allocate → pick → pack → QC pass/fail → dispatch. Inventory, queues, risk and the activity log all update together |
| **Exception Center** | Insufficient stock, damaged, missing, picker unavailable, dispatch delay, QC failure — each with DETECT → ANALYZE → OPTIONS → RECOMMEND → ACTION → RESOLUTION |
| **What-If Simulator** | SIMULATE → COMPARE → RECOMMEND → EXECUTE. Scenarios are scored on fulfillment, SLA risk, delay, movement and composite risk — nothing mutates until you apply |
| **Chaos Mode** | Inject simultaneous disruptions (picker down, stock damage, truck delay, order surge) and apply the generated multi-step recovery plan with predicted before/after improvement |
| **Analytics** | Live fulfillment, on-time, utilization, bottleneck frequency, exception resolution and decision impact — computed from state, supporting decisions rather than replacing them |
| **Activity / Decision log** | Timestamped operational timeline recording every detection, decision and transition |

## Architecture

```
src/
├── types/                      domain model (orders, products, decisions, exceptions…)
├── lib/
│   ├── decision-engine/
│   │   ├── priority-engine.ts  SLA + business + tier + age + stock → score + explanation
│   │   ├── allocation-engine.ts competing-claim analysis → scored scenarios
│   │   ├── risk-engine.ts      predicted SLA failures with cause
│   │   ├── bottleneck-engine.ts picking/packing/QC/dispatch/replenishment detection
│   │   └── recovery-engine.ts  disruption → ordered recovery plan + simulated impact
│   ├── simulation/
│   │   ├── what-if-engine.ts   scenario sessions (read-only until applied)
│   │   └── chaos-engine.ts     multi-disruption injection
│   ├── workflow/
│   │   ├── fulfillment-workflow.ts  pipeline transitions
│   │   ├── exception-workflow.ts    exception lifecycle
│   │   └── allocations.ts           one source of truth for stock movement
│   ├── analytics/metrics.ts    live operational metrics
│   ├── data/seed.ts            deterministic demo snapshot
│   └── state/store.tsx         in-memory store (React reducer + persistence + live clock)
├── components/
│   ├── shell/                  sidebar, top bar, layout
│   └── shared/                 panels, badges, KPI cells, decision cards, activity feed
└── pages/                      ControlTower · Orders · Inventory · DecisionCenter ·
                                Fulfillment · Exceptions · Simulator · Chaos · Analytics
```

**Design rules**

- Business logic is pure TypeScript — engines never touch React.
- Engines are **deterministic and explainable**: the same state always yields the
  same score, and every score ships with its reasoning.
- One source of truth for inventory movement (`workflow/allocations.ts`) is shared
  by the what-if drafts and the live store, so a simulated scenario is identical
  to the real one.
- All state transitions funnel through a single reducer; derived fields
  (priority, risk, stock status) are recomputed after every change.

## The Decision Engine

**Priority** (`priority-engine.ts`) — 0–100 composite: SLA urgency (remaining
window), business class, customer tier, order age, stock shortage pressure, plus
tight-window bonuses. ≥78 critical, ≥58 high, ≥38 medium.

**Allocation** (`allocation-engine.ts`) — when demand for a SKU exceeds supply,
every competing claim is considered (priority, SLA, reservation holders). Options
(protect critical order, split proportionally, recall reservations, wait for
replenishment) are each **simulated on a copy of the state**, then scored on
SLA risk (40%) + fulfillment (30%) + delay (20%) + movement (10%).

**Risk** (`risk-engine.ts`) — SLA pressure + pipeline progress + stock availability
+ exception state → level, score, cause and a predicted issue per order.

**Bottleneck** (`bottleneck-engine.ts`) — watches each stage and zone, flags
stalled picks, packing backlogs, delayed lanes and below-safety stock.

**Recovery** (`recovery-engine.ts`) — turns active disruptions into an ordered
step plan (reassign picker, release reservation, rebook vehicle, replenish,
resequence) and **predicts the improvement by applying the plan to a draft**.

## Demo scenario (30-second pitch)

1. Open the app → the **Control Tower** shows a red *DECISION REQUIRED* banner.
2. Order **#1042** (critical, enterprise) needs **10 × SKU-104**; only **7** are
   available; 3 are reserved by low-priority **#1055**; order **#1048** also wants 5.
3. Open **What-If Simulator** → three scenarios scored and compared.
4. **Apply** the recommended scenario → inventory, orders, picking queue, risk and
   the activity log all change.
5. Open **Fulfillment** → run the order through pick → pack → QC → dispatch.
6. Open **Chaos Mode** → *Run full disruption scenario* → the system detects
   everything, predicts SLA failures, and offers a recovery plan
   (*orders at risk: N → M*). Apply it.
7. **Analytics** and the **Decision log** close the story.

## Stack

- Vite · React 19 · TypeScript · React Router v7
- Tailwind CSS v4 (dark graphite control-tower theme) · shadcn/ui · Lucide · Recharts
- No backend, no database, no external APIs — the demo runs fully in-memory
  (persisted to `localStorage`, reset anytime from the sidebar)

## Local setup

```bash
bun install
bun run dev        # local dev server
bun run lint       # eslint
bun tsc -b --noEmit
bun run build      # production build
```

## Deployment (Vercel)

```bash
bun run build      # outputs dist/
```

Deploy the repo to Vercel (framework: Vite; build `bun run build`; output `dist`).
No environment variables or server functions are required.

## Notes

- The live clock advances 1 simulated minute every 2.5 s so SLAs tick down and
  expired orders auto-transition to `DELAYED` — a real "system watching itself"
  moment.
- Everything resets via **Reset demo** in the sidebar (clears `localStorage`).
