# Feature Report — BT-LIVE-101 Performance Runtime

Date: 2026-07-19
Ticket: GitHub #26
Branch: `agent/bt-live-101-performance-runtime`
Base: `main` at `16dade9`
Worktree: `/tmp/beat-twin-orbit-26`

## Loop

Separate NanoDAW's high-frequency live gestures from persistent song commands
with one pure, browser-owned performance state machine.

## Product Outcome

NanoDAW can now represent transport intent, quantized clip and scene requests,
track stops, recording and overdub state, mixer state, and four performance
macros without creating a `Song` revision, autosave, or undo/redo checkpoint.
This is a headless runtime contract; no launcher or real audio scheduling was
added.

## Generic Contract

- Immediate, next-beat, and next-bar requests resolve once to an exact beat.
- A track has at most one active clip reference and one pending transition.
- Transition IDs are caller-provided, globally reserved until runtime reset,
  and shared across request, scheduling acknowledgement, and observation.
- Scene parents reserve a `groupId`; scheduling, cancellation, and failure are
  atomic across the group's still-open child transitions.
- Clock movement never claims queued audio became active.
- Transport stop has its own reserved ID and pending/scheduled/observed
  handshake; start and clock actions cannot clear it.
- Only an executed engine observation carrying the scheduled transition ID may
  change `activeClipId`.
- Only an exact same-ID retry is idempotent; a distinct ID replaces unscheduled
  work, while scheduled work requires an engine cancellation observation first.
- Runtime reset clears ephemeral state without touching the document.
- A source-neutral material version reconciles incremental document changes and
  resets the runtime on full `Song` replacement.

## Project-Specific Boundary

- `CommandState` still contains the only `Song`.
- `PerformanceState` contains opaque `trackId` and `clipId` references, not
  tracks, clips, notes, samples, or another document graph.
- Zustand owns both reducers in the browser, but `dispatchPerformance()` calls
  no command, persistence, preview audio, adapter, Gateway, MCP, or Bitwig path.
- Capture Jam remains a future explicit atomic document-command boundary.

## Evidence Boundary

The reducer and store integration are proven offline. No Tone.js scheduling,
browser clock accuracy, audible loop, human listening, launcher interaction,
MIDI device, audio clip, sample playback, or external runtime was exercised.

## Changes

- Added `apps/playground/src/performanceRuntime.ts` with the pure state, action,
  quantization, transition, recording, mix, macro, and reset contracts.
- Added pure reducer tests and a separate store-boundary regression test.
- Added `performanceState`, `dispatchPerformance()`, and `resetPerformance()` to
  the existing Playground store without adding a second song owner.
- Added fail-closed material reconciliation for command batches and runtime
  reset on load, import, undo, redo, and full remote-song replacement.
- Added a dedicated runtime architecture note and linked it from the Playground
  architecture and documentation index.

## Verification

- Focused reducer and store tests: 25/25 passed.
- `pnpm nanodaw:test`: 66/66 passed after adversarial fixes.
- `pnpm test`: 160/160 passed outside the filesystem sandbox so the existing
  Gateway and protocol tests could bind loopback ports.
- `pnpm typecheck`: passed.
- `pnpm smoke:packages`: passed with all nine package smoke entries.
- `git diff --check`: passed.

All commands emitted the existing Node engine warning because validation ran on
Node 26.4.0 while the repository declares Node 22 or 24.

## Musical Evidence

None. This loop proves state and safety semantics only; it makes no sound and
supports no listening-quality claim.

## Adversarial Review

- Revision flooding: store tests retain the exact `CommandState`, history,
  persistence object, and localStorage payload across performance actions.
- Optimistic audible state: `AdvanceClock` does not apply a queued transition;
  execution before scheduling or before the target beat is rejected.
- Optimistic transport stop: only a matching scheduled stop observation enters
  idle; pending and engine-confirmed cancellation use separate actions.
- Transition rebinding: a claimed ID cannot be reused for another track or
  request until an explicit runtime reset.
- Replacement ambiguity: only exact same-ID retries coalesce, a distinct pending
  request records deterministic replacement, and scheduled work cannot be
  cancelled through the pending-only API.
- Scene partial mutation: all slots and child IDs are prevalidated, the parent
  group ID is reserved, and schedule/cancel/fail acknowledgements are atomic.
- Stale document references: store reconciliation removes orphaned track/clip
  IDs and full document replacement resets the runtime at a new material version.
- Recording ambiguity: one global `{trackId, slotId, clipId|null}` target exists;
  overdub requires a playing transport and the exact active clip.
- Cross-track leakage: track updates preserve the unrelated track object and a
  stop observation leaves the other active clip intact.
- Untrusted numeric state: beats must be finite/non-negative; levels and macros
  are bounded to 0..1; quantization and macro names are runtime-validated.

## Documentation

Added `docs/NANODAW_LIVE_RUNTIME_ARCHITECTURE.md`; updated the Playground
architecture, documentation index, current plan, queue, and this report.

## Provider State

No provider, device, controller, Gateway, MCP, Bitwig, or other external DAW was
contacted.

## Git

The loop is local and uncommitted on
`agent/bt-live-101-performance-runtime` in its isolated worktree. Nothing was
pushed, no PR was opened, and no merge, deployment, live DAW write, or branch
deletion occurred.

## Remaining Risks

- The execution handshake is not yet connected to a persistent clock or audio
  engine; BT-LIVE-102 must prove event cleanup, timing, failure, and disposal.
- #27 must dispatch `ObserveTransitionCancelled` or `ObserveSceneCancelled`
  only after the audio owner confirms removal of scheduled work.
- The state stores only the last resolved transition per track plus the global
  claimed-ID set; a detailed performance event history belongs to a later
  bounded capture design.
- `clipId` is intentionally source-neutral. #27 must avoid assuming MIDI-only
  content so future audio clips and samples reuse the same lifecycle.
- Human listening and real-browser timing evidence remain absent.

## Metrics

- New bounded actions: 30 action variants across transport, transition,
  recording, mix, macro, and reset domains.
- Launch quantization modes: 3.
- Performance macros: 4.
- Automated evidence: 25 focused tests, 66 Playground tests, 160 root tests.
- Persistent document mutations caused by focused performance actions: 0.

## Next Activation Signal

After human review, move only GitHub #27 / BT-LIVE-102 into `Orbit Ready` and
connect one long-lived browser clock/audio engine to the identified transition
handshake. Keep playable sources generic by `clipId`; after the dependency chain
#27 -> #28 -> #30 -> #31, plan the indispensable audio-clip and sample tranche
without creating a second performance reducer.
