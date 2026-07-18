# Feature Report — Issue #36 Built-in Instrument Slice

Date: 2026-07-18
Branch: `agent/nanodaw-instrument-slice`
Base: `origin/dev/nanodaw-standalone`

## Outcome

The NanoDAW document now persists one bounded built-in instrument ID and routes
preview notes through the corresponding Tone.js voice. An explicit
`SongPatchV2` instrument survives strict validation, preview, materialized
commands, one browser-owned CAS batch, adapter readback, autosave, undo/redo,
reload migration, and playback selection.

## Delivered

- Added the `drums`, `bass`, `chords`, and `lead` catalog in core.
- Added Song schema v2 and deterministic Song v1 migration to `lead`.
- Extended `CreateTrack`, events, strict command validation, normalized
  snapshots, and NanoDAW capability versioning with instrument identity.
- Added `SetTrackInstrument` and a compact Playground inspector selector.
- Kept the exact S25 `SongPatchV1` tool projection frozen; V1 compiles through
  the deterministic `lead` default.
- Added strict `SongPatchV2` validation/JSON schema and version-aware compile and
  preview functions. Gateway planning accepts either validated patch version.
- Added per-track Tone voice ownership, bounded voice construction, drum-note
  mapping, stable rescheduling, release, and disposal.
- Made explicit built-in instruments fail closed for Bitwig until a bounded
  preset/device mapping exists.
- Documented the contract, demo recipe, compatibility path, and limitations in
  `docs/NANODAW_BUILT_IN_INSTRUMENTS.md`.

## Atomicity And Safety Review

- Unknown instrument IDs fail in patch/command validation before the adapter's
  mutating port call.
- Instrument configuration on a non-instrument track fails in core and strict
  command validation.
- Successful remote application still calls `executeCommandBatch` once and
  produces one revision, one autosave, and one undo checkpoint.
- Readback compares the full snapshot, including `instrumentId`, to the
  deterministic projection.
- V1 provider fixture and historical 57-tool Bitwig MCP snapshot are unchanged.
- Bitwig rejects explicit NanoDAW instruments before authentication or mutation.
- Tone receives only catalog-owned configurations; no plugin, path, graph, or
  arbitrary synthesis payload crosses the agent boundary.

## Validation

- `pnpm test`: 155/155 passed.
- `pnpm typecheck`: passed.
- `pnpm nanodaw:test`: 40/40 passed.
- `pnpm --filter @beat-twin/playground build`: passed.
- `pnpm smoke:packages`: passed for nine packages.
- `git diff --check`: passed.

Focused evidence covers legacy migration, strict V2 validation, V1 defaulting,
command/event propagation, invalid preflight, one CAS mutation, adapter
readback, autosave, undo/redo, Gateway materialization, manual selector state,
per-track voice routing, stable ownership, drum mapping, and node disposal.

## Rendered Evidence Boundary

The Browser plugin was unavailable and the checkout has no Playwright binary or
configured browser workflow. No browser dependency was added solely for this
run. Component tests and the production build passed, but no screenshot,
console capture, or human listening claim is recorded.

## Remaining Limitations

- The live LiteRT/S25 tool schema still emits V1 and therefore selects the
  deterministic `lead` default. A reviewed fresh real-provider fixture is
  required before exposing V2 to the model.
- Audible distinction is proven structurally and through scheduled voice calls;
  a human browser listening pass is still required.
- The selected-clip preview is not the persistent multi-track clock/audio graph
  planned by BT-LIVE-102/#27.
- Bitwig device/preset insertion remains unsupported.
- The drum voice is deliberately small and deterministic, not a sampled kit or
  full General MIDI implementation.
