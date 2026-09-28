# BT-MCP-PORT-003 — Advanced transport and bounded cue-marker operations

User authorization 2026-09-28: publish/merge verified capability tranches and
continue the port with parallel agents. Live Bitwig tests are deferred.
Tranche 2 merged through PR #95 as 9bd2ec9c6c4bf5de15b2b97eafec78f9ad4a4b07.
That freshly fetched, remote-confirmed main is this worktree's base.
Branch: agent/bitwig-transport-port-20260928.

## Scope and ownership

Add 21 API-10-compatible historical tools: metronome, time signature, tap tempo,
punch controls/status, overdub controls/status, playback/navigation controls,
arranger panel status/visibility, bounded cue list and cue playback launch.
Catalog target: 104 tools, 26 default reads. Preserve earlier tool contracts.

Correct historical API mistakes: timeSignature().set takes a string; return to
zero uses setPosition(0); marker labels use getName() under API 10; cue launch
starts playback and is not a read-only cursor move. Exclude cue creation/rename
(API 15 required) and arranger zoom (API 10 compatibility not established).

- controller_port: controller TypeScript + tests/bitwig-controller-transport.test.ts.
- mcp_port: index.ts + tests/mcp-transport-port.test.ts.
- parity_audit: docs/BITWIG_MCP_PARITY.md + docs/BITWIG_MCP_TRANSPORT.md;
  independent API and adversarial review.
- Coordinator: generated JavaScript, package/tests/counts integration, validation,
  report and authorized exact-head publication.

## Validation

Strict schemas, integer bounds, enum panel choices, settled/known observed read
state, authenticated writes and retained policies. Marker bank coverage explicit;
no complete-song or complete-marker-list claim. Non-idempotent actions never retry
automatically; acknowledgements describe dispatch, not observed effects.

Run focused and full offline suites, typecheck, architecture, packaging, syntax
and diff checks. No controller installation/reload or musical action. GitHub
Actions currently disabled; report local evidence separately from CI and live.

## Outcome

Implemented and offline-validated: 104 tools / 26 default reads. Full suite:
338 passed; focused MCP integration: 65 passed. Typecheck, architecture,
distribution, generated syntax and diff checks passed. Independent review found
no remaining concrete blocker. Evidence: `.agents/reports/feature-20260928-bitwig-transport-port.md`.
Publication is authorized; live acceptance remains deferred.
