# BT-MCP-PORT-003 — Advanced transport and bounded cue-marker operations

Date: 2026-09-28. Branch: `agent/bitwig-transport-port-20260928`.
Freshly fetched and remote-confirmed base: `9bd2ec9c6c4bf5de15b2b97eafec78f9ad4a4b07`.
Prior tranche: [PR #95](https://github.com/LaurentHuzard/beat-twin/pull/95), merged
2026-09-28 at the tested head `e4eaf9430039386eaee7fe35db4c37f1f2e9c35c`.

User authorized continued parallel porting and publication. Live Bitwig tests
are explicitly deferred. Main checkout and installed controller are preserved.

## Scope

Twenty-one additive historical tools for advanced transport, arranger panel state
and bounded cue list/playback launch. Catalog target: 104 tools, 26 default reads.
Original 57-tool schema/policy prefix and both previous port tranches preserved.

Historical call corrections: time signature setter receives a string; return to
zero uses `setPosition(0)`; API-10 marker labels use `getName()`; cue launch changes
playback and is not a read-only seek. Cue creation/rename require API 15 and remain
excluded. Arranger zoom compatibility with API 10 was not established, so excluded.

Three parallel agents implement controller/tests, MCP/tests and documentation/API
review. Coordinator integrates package counts, diagnostics, generated JavaScript,
compatibility checks and exact-head publication.

Contract: [BITWIG_MCP_TRANSPORT.md](../../docs/BITWIG_MCP_TRANSPORT.md).
Remaining historical coverage: [BITWIG_MCP_PARITY.md](../../docs/BITWIG_MCP_PARITY.md).

## Validation

Full offline suite: **338 passed, zero failed/skipped**. Focused MCP integration:
65 tests passed. New controller tests: 11, included in the full suite.
`pnpm typecheck` passed. Architecture: 16 workspaces, 44 internal runtime edges,
no violations. Distribution smoke: 20 artifacts, 26 default read tools, zero DAW
calls. Generated runtime syntax and `git diff --check` passed.
Dependencies installed offline with a frozen lockfile (Node 26.4.0 / pnpm 11.10.0);
no dependency changes.

Temporary logs: `/tmp/beat-twin-transport-test-20260928.log` and
`/tmp/beat-twin-transport-typecheck-20260928.log`. Logs are not committed.

## Adversarial review

Confirmed strict argument counts/types, denominator and panel enums, observed
marker existence and metadata, bounded cue bank/count consistency, rejected
negative nudge destinations and authenticated writes. Toggle/set/panel handlers
invalidate their observation synchronously before host mutation: a second toggle
or read cannot use cached pre-mutation state. Known unchanged setters are no-ops;
changed flags require a real observer event and two stable flush cycles before
reuse. A failed host action is not retried automatically.

Independent review found no remaining concrete blocker. Marker reads include
explicit coverage and never launch or scroll. Cue launch requires transport
permission and is documented as starting quantized playback. Existing bank and
construction barriers remain in place.

## Limits

No controller installation/reload, real transport action, marker launch, DAW
edit, audio test or model inference. Offline API inspection and mocks are not
live proof. GitHub Actions are disabled; remote CI is not claimed. Marker readback
is bounded; dispatch acknowledgements are not observed musical outcomes.
