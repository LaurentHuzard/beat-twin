# BT-MCP-PORT-004 — Sound, mix and bounded track/device operations

Status: implemented and locally verified; authorized publication in progress.
363 offline tests, typecheck, architecture and distribution passed. Independent
review complete. Live Bitwig acceptance remains deferred. See
`.agents/reports/feature-20260928-bitwig-mix-port.md` for evidence and limits.

User authorization 2026-09-28: continue capability ports with parallel agents and
publish/merge verified tranches. Live Bitwig tests are deferred.
Freshly fetched and remote-confirmed base: 02f992bd4741a86caeedc3d975d73590598a7202,
merged PR #96. Branch: agent/bitwig-mix-port-20260928.

## Scope

Add 22 historical tools: targeted track delete/duplicate; cursor track/device/clip
inspection; effect-track creation; device bypass/delete, cursor navigation and
browser insertion/replacement; master, send and return levels. Target catalog:
126 tools / 32 default reads. Preserve prior 104 tools and original schema prefix.

API 10 constraints: main track bank reserves eight sends; effect bank uses the
legacy two-argument constructor; track duplication uses Channel.duplicate, not
API-19 duplicateObject; no API-18 Send.isEnabled. Values are normalized 0–1,
including pan, with 0.5 centered; no dB claim.

Track structure mutations require an adapted observation barrier, not the
construction guard that assumes unchanged bank positions. Revoke bindings before
mutation, retain project scope, observe expected count/selection/content changes,
and wait for stable data before reusing targets. Unknown state fails closed.
Device browsing requires an existing selected device; no implicit replacement
fallback. Acknowledgements describe dispatch, not observed result.

## Ownership

- controller_port: controller TypeScript + tests/bitwig-controller-mix.test.ts.
- mcp_port: index.ts + tests/mcp-mix-port.test.ts.
- parity_audit: docs/BITWIG_MCP_PARITY.md + docs/BITWIG_MCP_MIX.md;
  independent API and adversarial review.
- Coordinator: generated JS, package/counts/tests integration, validation, report,
  publication and final reconciliation of the capability inventory.

## Boundaries and verification

Fourteen global focus-dependent application commands and four API/search/zoom
candidates remain distinct follow-up work; do not claim full historical parity.
External services, historical stubs and unwired declarations remain documented.

Run focused/full offline tests, typecheck, architecture, distribution, syntax and
diff checks. No installation/reload, DAW write, listening or model run. Publish
verified source under existing user authorization; GitHub Actions are disabled,
so local evidence and deferred live acceptance remain separate.
