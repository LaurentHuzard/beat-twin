# Architecture Hardening Report — GitHub #46, #47, #49, And #48

Date: 2026-07-20
Branch: `agent/architecture-boundaries-retention`
Base: draft PR #50 at `f1c8fd8`

## Loop

Implement BT-ARCH-101 through BT-ARCH-104 as one dependency-ordered Orbit
loop: enforce package direction, extract typed Gateway delivery, give NanoDAW
MCP an explicit application owner, and bound every process-lifetime safety
registry.

## Product Outcome

Beat Twin keeps the same routes, MCP tools, browser-owned song model, explicit
confirmation, and adapter behavior, but its runtime ownership is now
executable and long-session memory behavior is explicit. Capacity pressure
fails before mutation, while active and uncertain execution evidence remains
pinned and is never retried automatically.

## Generic Contract

- Applications compose processes; reusable packages never import apps.
- Domain packages cannot depend on adapter or delivery layers.
- Runtime imports must be declared and the workspace graph must remain acyclic.
- Transport delivery exposes typed provider, pairing, plan, adapter, and
  lifecycle ports.
- Every in-memory safety registry declares capacity, expiry, cleanup, and safe
  eviction rules.
- Idempotency claims precede mutation. A possible post-dispatch storage or
  readback failure is partial/uncertain, not a retry signal.
- Current registries are process-lifetime only. Restart loses their evidence
  and never authorizes automatic replay.

## Project-Specific Boundary

- The browser remains the sole owner of NanoDAW `Song` state.
- `@beat-twin/nanodaw-mcp` still exposes only catalog, inspection, and plan
  preparation; no model-visible confirmation or execution tool was added.
- `apps/nanodaw-mcp` owns pairing, plans, HTTP, WebSocket, adapter, MCP stdio,
  startup, and shutdown.
- `apps/gateway` remains a compatibility facade over
  `@beat-twin/gateway-http`.
- Historical Bitwig MCP behavior and its 57-tool snapshot remain unchanged.

## Changes

### #46 — Executable dependency direction

- Added `architecture-policy.json` and a zero-dependency workspace/import graph
  validator.
- Added six allowed/forbidden graph fixtures and an actionable cycle path.
- Wired `pnpm check:architecture` into CI.
- Removed the temporary package-to-app exception after #49.

### #47 — Typed Gateway delivery

- Added `@beat-twin/gateway-http` with package-scoped declarations for HTTP and
  browser WebSocket ports.
- Moved existing delivery implementations without route or protocol changes.
- Kept `apps/gateway` exports as compatibility re-exports.
- Removed the MCP package's ambient Gateway declaration and app dependency.

### #49 — NanoDAW MCP composition root

- Added `apps/nanodaw-mcp` and moved runtime/CLI composition into it.
- Kept schemas, service behavior, tool metadata, and MCP server construction in
  `packages/mcp`.
- Preserved `pnpm nanodaw:mcp` and the documented CLI path.
- Added an integration test for startup, pairing, browser WebSocket CAS,
  review, confirmation, single execution, idempotent close, and shutdown.

### #48 — Retention and restart contract

- Added `@beat-twin/retention` with injected clocks/stores, lazy cleanup,
  capacity errors, and caller-defined safe eviction.
- Bounded command IDs, NanoDAW/Bitwig executions, Bitwig observations,
  pairings/quota locks, plans/status, confirmations, MCP reviews, and browser
  performance transition IDs.
- Reserved idempotency before mutation and pinned pending, consumed, partial,
  and uncertain states where replay would be unsafe.
- Added stable HTTP 503 mapping for Gateway capacity exhaustion.
- Recorded exact default capacities, retention windows, cleanup, recovery, and
  no-replay restart behavior in ADR-003.

## Verification

- `pnpm check:architecture`: 16 workspaces, 36 internal runtime edges, no
  violations.
- Focused architecture/Gateway/MCP/adapter/retention tests: 88/88 passed.
- `pnpm test`: 202/202 passed.
- `pnpm typecheck`: passed.
- `pnpm test:playground`: 15 files, 142/142 passed.
- `pnpm build`: passed; Playground production build transformed 2,569 modules.
- `pnpm smoke:packages`: passed for 11 compiled public package surfaces,
  including retention and Gateway HTTP.
- `npm pack --dry-run --json`: passed; 7 root package entries.
- Local Markdown-link check: 85 Markdown files, all local targets resolved.
- `git diff --check`: passed.

## Adversarial Review

- A global confirmation cleanup initially left a stale hash on its owning plan;
  the plan now accepts a replacement only after the prior record is absent or
  expired, with a capacity regression test.
- Playground aliases initially relied on a prebuilt retention package; source
  aliases and a direct workspace dependency now preserve clean-install dev and
  test behavior.
- Bitwig request reservation occurs before authentication or mutation. If
  readback retention fails after dispatch, the report becomes partial and the
  request remains pinned.
- NanoDAW proxy disconnect after dispatch remains partial/uncertain and is
  coalesced rather than retried.
- Consumed and uncertain Gateway plans have no automatic eviction boundary.
  Exhaustion is an intentional fail-closed operator condition.
- No cache, map, or cleanup path owns a second browser song snapshot.

## Evidence Boundary

All validation was deterministic and offline. No S25 provider, browser session,
Gateway process outside test fixtures, Bitwig controller, Bitwig Studio, live
DAW mutation, listening session, or restart-durable backend was exercised.
Offline success does not prove those external surfaces.

## Documentation

Added ADR-003 and aligned README, status, project summary, roadmap,
Playground architecture, audit snapshot notes, docs index, Orbit plan, and
queue. Process-only execution status is no longer described as durable.

## Provider State

No provider or external runtime was contacted. The existing sanitized S25
fixture passed within `pnpm test`; it is not new live provider evidence.

## Git

- Local dependency guard commit: `d704023`.
- Local typed delivery commit: `4bbb1e5`.
- Local NanoDAW MCP app commit: `a2341ce`.
- Retention/docs/report commit follows this report.
- Publication target: one draft PR stacked on draft audit PR #50.
- Merge, deployment, force-push, branch deletion, and live writes remain
  unauthorized.

## Remaining Risks

- Restart loses all process-memory pairing, plan, review, idempotency, and
  execution-status evidence; safe recovery requires re-inspection and a newly
  confirmed plan, never blind replay.
- Enough pinned uncertain outcomes can exhaust a registry until operator
  inspection and process restart.
- Cleanup is lazy, so expired entries remain allocated until registry access.
- Gateway delivery remains JavaScript with package-owned declarations; app
  typechecking protects consumers, but a future TypeScript implementation
  could reduce declaration/implementation drift further.
- The package build order remains manual until BT-ARCH-108.
- Live dual-target proof and installable packaging remain separate human gates.

## Metrics

- Issues implemented: 4.
- Workspaces checked: 16.
- Architecture fixtures: 6.
- Default bounded registries classified: 9, plus bounded transient operation
  sets and the existing WebSocket in-flight limit.
- Long-session retention operations: 10,000.
- Automated tests: 344 total across Node and Playground.
- New model confirmation/execution tools: 0.
- Live external mutations: 0.

## Next Activation Signal

Human review of the stacked implementation draft PR after both draft PRs pass
CI. Merge and any live dual-target proof require separate approval.
