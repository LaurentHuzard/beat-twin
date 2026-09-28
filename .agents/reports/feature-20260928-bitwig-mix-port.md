# BT-MCP-PORT-004 — Sound, mix and targeted track/device operations

Date: 2026-09-28. Branch: `agent/bitwig-mix-port-20260928`.
Freshly fetched and confirmed base: `02f992bd4741a86caeedc3d975d73590598a7202`.
Prior tranche: [PR #96](https://github.com/LaurentHuzard/beat-twin/pull/96), merged
at tested head `67ff13c775c0da532fbf3865a30b2e6457cea8d6`.
User authorized publication/merge and continued parallel porting; live tests deferred.

## Scope

Twenty-two historical tools: targeted track deletion/duplication, cursor track /
device / clip inspection, effect-track creation, device bypass/deletion/navigation
and insertion-browser opening, master/send/return levels. Catalog target: 126
names / 32 default reads. Original 57 schema/policy prefix remains protected;
previous 47 additions retain their contracts.

Three agents cover controller/tests, MCP/tests and docs/API/adversarial review;
coordinator integrates package counts, generated code, offline evidence and
publication. The primary checkout and installed controller are preserved.

API 10 retained: effect-track bank uses two arguments, track duplication uses
Channel.duplicate, eight sends are reserved in the main track bank, and API-18
Send.isEnabled is excluded. Mixer values are normalized 0–1, not decibels; pan
uses 0.5 as center. Device browsing never falls back to another insertion point
when the selected device is absent.

Contract: [BITWIG_MCP_MIX.md](../../docs/BITWIG_MCP_MIX.md).
Complete historical inventory: [BITWIG_MCP_PARITY.md](../../docs/BITWIG_MCP_PARITY.md).

## Verification

Full offline suite: **363 passed, zero failed/skipped**, including 16 new
controller tests and nine new MCP groups. Focused MCP regression integration:
74 passed. TypeScript checks passed. Architecture: 16 workspaces, 44 runtime
edges, no violations. Distribution smoke: 21 artifacts, 32 default reads,
zero DAW calls. Generated runtime syntax checks and `git diff --check` passed.
Dependencies installed from cache using `pnpm install --offline --frozen-lockfile`;
lockfile unchanged. Node 26.4.0 / pnpm 11.10.0.

Temporary evidence: `/tmp/beat-twin-mix-test-20260928.log`,
`/tmp/beat-twin-mix-typecheck-20260928.log` and
`/tmp/beat-twin-mix-mcp-20260928.log`. Logs are not committed.

## Adversarial review

Three parallel agents implemented controller, MCP and API/documentation review.
Independent review found and corrected stale cross-proxy readback: host equality
values (API 3) identify matching cursor/master/return/device proxies, and setters
invalidate affected observations before dispatch. Legacy setters affecting the
new reads follow the same rule. Numeric automation remains readable without
restarting identity settling for every level update.

Track/device structure requires an actual expected count callback, revoked old
bindings and settled observations. Track structure permits intended bank
renumbering while preserving project scope. Transport stopped, recording off
and browser closed are explicitly observed where required. Failed structural
operations permit the six new guarded diagnostic reads after stable identity;
writes stay locked until controller reload. Host calls are never blindly retried.
The final independent review reported no remaining concrete blocker.

Source is locally verified and ready for the authorized push/merge. The exact
published head and remote merge result are checked during publication. Actions
were queried live and remain disabled; remote main still matched the base above
immediately before publication.

## Deferred work and evidence boundaries

Fourteen global application editing/navigation commands still need a clear
focus/selection/clipboard contract. Their APIs exist; they are not declared
impossible. Other remaining candidates concern browser filtering semantics,
arranger zoom compatibility, and cue creation/rename requiring newer APIs.
External audio services, historical stubs and unwired declarations are separate.

No DAW installation/reload, musical edit, live sync test, listening, model call,
export or finished-track claim. Local tests and source/API review do not establish
live operation. GitHub Actions are disabled, so remote CI success is not claimed.
