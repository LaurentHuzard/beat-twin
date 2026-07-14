# Current Plan

## Status

Governance adoption only. No Beat Twin product item is Orbit-ready.

## Target Outcome

Adopt the Orbit Program Kit lifecycle without changing NanoDAW, Gateway, MCP,
Bitwig, or live S25 behavior and without treating legacy `Ready` backlog rows as
implementation authorization.

## Planned Files

- `AGENTS.md`
- `orbit.config.json`
- `docs/product-constitution.md`
- `docs/ORBIT_PROGRAM.md`
- `.agents/current-plan.md`
- `.agents/queue.md`
- `.agents/branch-classification.json`
- `.agents/reports/template.md`
- `.agents/reports/feature-20260714-1528-adopt-orbit-program.md`

## Verification

- parse `orbit.config.json` and `.agents/branch-classification.json`;
- prove the queue contains zero or one entries under `Orbit Ready`;
- verify required paths and Markdown links;
- run `git diff --check`;
- confirm no runtime or product file changed.

## Human Gates

- a human must move exactly one bounded ticket into `Orbit Ready` before product
  implementation starts;
- live Bitwig or S25 checks, DAW writes, merge, publication, and branch deletion
  remain separately authorized actions.

## Next Activation Signal

A maintainer selects one bounded Beat Twin ticket, removes any ambiguity with
legacy candidate statuses, and lists only that ticket under `Orbit Ready`.
