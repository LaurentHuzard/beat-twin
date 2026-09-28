# BT-MCP-PORT-001 — Bitwig capability port, tranche 1

Date: 2026-09-27. Branch: `agent/bitwig-capability-port-20260927`.
Confirmed fetched base: `8a6f9bdef9958caccbb421cdcd65f5062e1598b6`.
Worktree: `/home/lolo/Workspace/lolOS/.worktrees/beat-twin-capability-port-20260927`.
Status: locally implemented and offline-validated; ready for review. No publication or live acceptance.

## Delivered scope

Three delegated tasks covered controller implementation, MCP implementation and
historical parity audit. The coordinator integrated documentation, package/test
commands, generated bridge files and cross-layer validation.

- Thirteen additive tools: six inspection reads, six mixer-policy operations,
  one scene-policy operation. Registry: 70 total / 20 with default read-only policy.
- Existing 57 names, schema digest, order and policies retained as a tested prefix.
- Project/track inspection, launcher grid and slot occupancy, track-bank navigation,
  track visibility, track names/colors and scene names.
- Actual bounded note inspection through a separate fixed cursor: matching selected
  launcher clip, 64 sixteenth-note steps, pitches 0–127, channel 0. Explicit partial
  coverage; unavailable/mismatched state raises an error.
- Strict argument validation for all new tools, direct and discovery dispatch;
  detached finite JSON inputs; write policy rechecked after asynchronous validation.
- Generated JavaScript remains reproducible from TypeScript. Three touched legacy
  test scripts migrated to TypeScript with package/document references updated.
- Exhaustive 164-name historical matrix: 47 pre-existing, 13 ported, 3 equivalents,
  70 later candidates, 2 remaining stubs, 6 external-service tools, 23 unwired names.

Implementation contract: [BITWIG_MCP_PORT.md](../../docs/BITWIG_MCP_PORT.md).
Historical evidence and follow-up domains: [BITWIG_MCP_PARITY.md](../../docs/BITWIG_MCP_PARITY.md).

## Adversarial review

New writes remain hidden and blocked without their MCP policy, and require the
existing local relay authentication at the controller. Inputs reject missing or
extra fields, coerced/nonfinite numbers, invalid indices, unavailable targets,
control characters, empty/oversized names and out-of-range colors.

The final review identified a bank-navigation race: a host proxy could move before
cached position observers invalidated the old Agent-mode binding. Navigation now
revokes the generation synchronously before requesting the host movement. Until
the destination is observed and quiet update cycles finish, bank-dependent
operations fail, including legacy handlers. An unchanged absolute position is a
no-op, preventing a wait for an observer event that will never occur. No time-only
fallback accepts an unobserved movement.

Read handlers never select a clip or move its viewport. Note inspection uses its
own cursor, separate from the legacy editor and Agent-mode write cursor. Unknown
note states fail. Published MCP schema objects are detached from validation state.

## Executed verification

Runtime: Node 26.4.0; pnpm 11.10.0. Dependencies installed from local cache with
`--offline --frozen-lockfile`; lockfile unchanged.

- Initial focused suite: 60 tests passed.
- Final `pnpm test`, after navigation fix: **294 passed, 0 failed, 0 skipped**.
- `pnpm typecheck`: passed (package/app builds and playground TypeScript check).
- `pnpm check:architecture`: 16 workspaces, 44 internal runtime edges, no violations.
- `pnpm smoke:distribution`: passed; 18 packed artifacts, 20 default read-only
  tools, zero DAW calls. Both new documents are included in the package.
- Bridge generation and `node --check` for both generated JavaScript entrypoints:
  passed; generated files match their TypeScript sources.
- `git diff --check`: passed.

Full offline suite output: `/tmp/beat-twin-port-test-final-20260927.log`.
Typecheck output: `/tmp/beat-twin-port-typecheck-20260927.log`.
These temporary logs are not committed artifacts.

An initial sandboxed diagnostic CLI test run received empty subprocess stdout;
the same offline suite passed with ordinary subprocess permissions. This was
not resolved by weakening assertions. Test sockets and injected calls do not
contact the user's DAW.

## Remaining acceptance and limits

- Controller not installed/reloaded; MCP client not repointed to this worktree.
- No live Bitwig or MUE call, musical mutation, listening proof, export or song
  creation in this tranche. Offline mocks establish handler behavior only.
- Two quiet controller flush cycles are a settling heuristic; actual Bitwig
  observer delivery and bank navigation need validation in a scratch project.
- `notes: []` describes only channel 0 within the fixed window. It does not prove
  an empty MIDI clip or identify audio/MIDI type. `completeClip` is always false.
- Full-fidelity MIDI, duplication, device/browser coverage, scenes, arranger and
  external audio services remain in the parity inventory; no full-port claim.
- No commit, push, PR, merge, branch deletion or runtime installation performed.

Next live acceptance: install matching server/controller revisions, reload both,
read a known project/grid, compare bounded notes with a known selected MIDI clip,
and validate navigation plus stale-binding rejection in a scratch project. Then
exercise names/colors with explicit live-edit authorization. Publish/merge and
live installation remain separate gates under this repository's AGENTS.md.

## Publication follow-up — 2026-09-28

User authorized push and merge, then continued porting with parallel agents.
The preceding no-publication statement describes the original delivery on
2026-09-27. Live Bitwig acceptance is explicitly deferred. The publication uses
the offline evidence above; GitHub CI availability is queried separately.
