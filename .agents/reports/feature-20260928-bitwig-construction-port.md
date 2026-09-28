# BT-MCP-PORT-002 — Launcher construction and note batches

Date: 2026-09-28. Branch: `agent/bitwig-construction-port-20260928`.
Freshly fetched and confirmed base: `0f9318ea25a231e09aba1e20dc56a5e8a5b40cf8`.
Prior tranche: [PR #94](https://github.com/LaurentHuzard/beat-twin/pull/94), merged
2026-09-28, exact reviewed head `5f7e48a0aa0a1228fca5ed20c1e036a28cda2fd2`.

User authorized publication/merge and continued parallel porting. Live Bitwig
acceptance is explicitly deferred. The main checkout remains untouched.

## Scope

Thirteen additive tools: clip color/name/delete/copy/browser opening, scene
selection/deletion/capture, bounded note insertion and clearing, loop extension,
and arranger recording state. Registry target: 83 tools, 22 default reads.
Original 57 schemas/policies and the first 13 ported tools retain their contracts.

Three parallel agents own controller implementation/tests, MCP implementation/tests,
and parity/contracts/API review. Coordinator integrates package/diagnostics counts,
generated JavaScript, compatibility tests, validation and publication.

Construction contract: [BITWIG_MCP_CONSTRUCTION.md](../../docs/BITWIG_MCP_CONSTRUCTION.md).
Historical backlog: [BITWIG_MCP_PARITY.md](../../docs/BITWIG_MCP_PARITY.md).

## Verification

Final offline validation: **318 tests passed, zero failed/skipped** with `pnpm test`.
Focused MCP integration: 56 tests passed. Controller construction: 16 tests included
in the full suite. `pnpm typecheck` passed. Architecture: 16 workspaces, 44 internal
runtime edges, no violations. Distribution smoke: 19 artifacts, 22 default read
tools, zero DAW calls. Generated bridge syntax and `git diff --check` passed.
Node 26.4.0 / pnpm 11.10.0. Dependencies installed from local cache with
`pnpm install --offline --frozen-lockfile`; no dependency or lockfile changes.

Temporary full suite log: `/tmp/beat-twin-construction-test-20260928.log`.
Typecheck log: `/tmp/beat-twin-construction-typecheck-20260928.log`.
Logs are not committed. Implementation is ready for the authorized publication.

## Adversarial review

Independent review found and corrected a partial-batch deadlock: waiting for the
unissued suffix prevented diagnostic readback. A failed batch now permits stable
read-only inspection of the unchanged target identity while blocking bank/cursor
mutations until controller reload. Returned recovery instruction is
`readback_then_reload_controller`; counts describe issued host calls, not proof
of applied state. Callback predicate failures remain closed without escaping into
the host; host errors are bounded and control characters removed.

Other covered cases: final invalid batch entry leaves zero host writes; unknown
or occupied destination and self-copy refused; note-start/sustain collisions and
within-batch overlap refused; selected cursor mismatch refused; stale bindings
revoked before structural calls; changed identity blocks partial readback; browser
opening does not reserve destination or prove subsequent insertion.

A host no-op with no confirming observation deliberately retains the guard; a
reload may be needed. Two stable flush cycles are an offline-tested heuristic,
not live synchronization proof. Clip naming uses `Clip.setName`, because slot
`name()` is readonly. Loop shortening is refused due incomplete MIDI coverage.

## Limits

Offline tests and source/API inspection do not prove runtime synchronization,
actual edits, musical quality, provider behavior or live Bitwig success. No
controller installed/reloaded, no MCP runtime repointed and no musical action
performed. GitHub Actions are disabled; local evidence must be reported separately.
