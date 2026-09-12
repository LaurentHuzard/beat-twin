# Beat Twin Orbit — BT-AGENT-001

User authorization: 2026-09-12, "go pour le prochain chantier, je valide !"
Base: `dd6164352da3916045c28563015114e1b7273d28`.
Branch: `agent/nanodaw-agent-v2`.

Status: local implementation and deterministic verification complete; human gate.
Rendered-browser verification is blocked by the Cloud Browser URL policy.
No live provider/DAW proof and no publication. Report:
`.agents/reports/feature-20260912-bt-agent-001.md`.

## Bounded outcome

Run NanoDAW agent proposals without Bitwig configuration. Use explicit built-in
instruments through SongPatchV2 in the model-facing path. Make external MCP
proposals discoverable in TWIN without Developer Mode or mandatory plan-ID copy.
Preserve browser ownership, exact preview, explicit human confirmation, revision
checks, one-shot execution and fail-closed uncertain outcomes.

## Steps

1. Inspect current composition, contract, browser handoff and offline baseline.
2. Add opt-in V2 provider behavior without changing legacy Bitwig/V1 contracts.
3. Compose a NanoDAW-only agent entrypoint and authenticated MCP review discovery.
4. Wire TWIN proposal discovery and test state/lifecycle/safety boundaries.
5. Run focused/full offline checks, typecheck, diff check and adversarial review;
   write an honest report and return the queue to a human gate.

## Boundaries

No live model/provider request, Bitwig/S25 access, autonomous confirmation,
deployment, publication, merge or branch deletion. Historical PR #51 is untouched;
no additional implementation PR. Existing MCP CLI remains compatible. Do not
bundle the pending architecture extraction (#49) into this product slice.
Variation/slot placement, audition, multi-clip generation and MIDI export remain
subsequent slices, not claims of this delivery.

## Previous handoff

Issue #65 remains open; its earlier evidence and authorization are recorded in
`.agents/reports/feature-20260910-bt-ux-065-instrument-shell.md`, not transferred
to this implementation.
