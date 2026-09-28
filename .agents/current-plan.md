# BT-MCP-PORT-001 — Recover Bitwig inspection and navigation

Authorized by user on 2026-09-27: start the capability port plan with parallel sub-agents.
Base: freshly fetched origin/main 8a6f9bdef9958caccbb421cdcd65f5062e1598b6.
Branch: agent/bitwig-capability-port-20260927.

## Active outcome

Build an exhaustive historical/current capability inventory and deliver the first coherent port: clip grid and occupancy, track/project inspection, bank navigation, names/colors, and real bounded note readback where supported by the current controller contract. Restore useful composition primitives without weakening the existing local relay, Agent-mode target binding or write-policy defaults.

## Ownership

- Controller agent: controller TypeScript and focused controller port tests.
- MCP agent: index.ts registry/dispatch and focused registry port tests.
- Inventory agent: historical parity documentation and independent API compatibility review.
- Coordinator: integration, generated bridge outputs, compatibility checks, documentation and final evidence.

## Validation and boundaries

Run focused tests, bridge generation, repository unit suite/typecheck and distribution checks as relevant. Review policy gating, bounds, stale/unavailable state and unsupported APIs. Source references may use the historical archived branch; no runtime claims from historical declarations alone.

Implementation authority is explicit in this session. Publication, merge and installation of the new controller remain separate from this development tranche. Do not touch the user's live musical session during port validation. Report unported domains, stubs and external services in the inventory, not as restored features.

## Outcome — 2026-09-27

Locally implemented and offline-validated; review pending. Registry is 70 tools
(20 read-only by default), with the historical 57-tool schema/policy prefix intact.
Navigation revokes old target bindings before moving and rejects bank-dependent
calls until the observed position settles. Final full suite: 294 passed; typecheck,
architecture, distribution and diff checks passed.

Evidence: `.agents/reports/feature-20260927-bitwig-capability-port.md`.
Historical matrix: `docs/BITWIG_MCP_PARITY.md`.
No runtime install, live validation, commit, publication or merge. Further port
tranches and live acceptance remain outstanding; this is not full historical parity.

## Publication authorization — 2026-09-28

User explicitly authorized commit/push/merge of this tranche and continuation of
remaining tool ports with parallel agents. Live Bitwig tests are deferred by the
user. Publish the verified implementation, then start the next bounded tranche
from the freshly fetched merged main in a separate worktree.
