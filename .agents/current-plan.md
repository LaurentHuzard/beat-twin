# Current Beat Twin Orbit

## Loop

Issue #36 — deterministic slice complete. Deliver the smallest complete explicit-instrument
NanoDAW slice on top of `dev/nanodaw-standalone`.

## Target Outcome

An explicit bounded instrument selected in a versioned agent patch is previewed,
compiled into one materialized command batch, applied once by the browser-owned
NanoDAW runtime, read back with the same identity, persisted, and routed to a
distinct browser voice for playback.

## Product Contract

- The catalog is limited to `drums`, `bass`, `chords`, and `lead`.
- Existing Song v1 and SongPatchV1 payloads remain readable with `lead` as the
  documented deterministic migration/default instrument.
- The frozen S25 SongPatchV1 tool projection is not changed without a fresh
  real-provider capture; explicit selection uses SongPatchV2 internally.
- Unknown instruments and instruments on non-instrument tracks fail before
  mutation.
- One accepted agent plan remains one CAS batch, one revision, one autosave,
  and one undo checkpoint.
- The browser remains the sole owner of NanoDAW state.

## Validation

- Focused core, commands, agent-contract, adapter, audio, and Playground tests.
- Root test, typecheck, NanoDAW test, Playground build, package smoke, and
  `git diff --check` when the focused slice is green.
- No live Bitwig or S25 claim will be made from deterministic evidence.

## Evidence Boundary

- Deterministic tests will prove schema migration, validation, compilation,
  atomic execution, readback, persistence, undo/redo, voice routing, and node
  disposal.
- Real audible character still requires a human browser listening check.
- Live model-selected V2 output remains gated on a new reviewed S25 fixture.

## Exit Condition

- Met on 2026-07-18: implementation, deterministic tests, documentation, and
  adversarial review are complete. Draft PR publication remains the final
  repository operation.
