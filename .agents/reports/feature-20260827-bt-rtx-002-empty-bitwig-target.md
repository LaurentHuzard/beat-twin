# BT-RTX-002 — Empty Bitwig Launcher Target Binding

Date: 2026-08-27
Branch: `agent/bt-rtx-001-qwen-tool-loop`
Base: published `main` at `035e82d`
State: controller slice complete and live read-only validated; publication authorized separately by the user

## Product Outcome

Beat Twin can now identify a human-selected empty launcher slot. The real
controller exposes an available binding for project `New 2`, instrument track
`Inst 1` at position 0, and scene slot 0 without creating a clip or changing
Bitwig state.

## Changes

- observed the 8 by 8 bank tracks, slots, positions, scene indices, names, and
  selection state;
- made the uniquely selected bank slot the primary target identity, including
  when it has no clip;
- retained the launcher cursor as a fallback and as the bounded note/readback
  surface only after a clip exists;
- rejected ambiguous bank selection;
- routed target rename and clip creation through the bound bank objects while
  preserving binding checks and authentication;
- added focused controller security coverage for empty selection, ambiguity,
  cursor fallback, and bounded note matching.

## Verification

- `node --check bitwig-controller/BeatTwin/BeatTwin.control.js`: passed;
- focused controller and protocol tests: 13 passed;
- `pnpm test`: 187 passed, 0 failed;
- `pnpm typecheck`: passed;
- `git diff --check`: passed;
- installed controller checksum matched the repo file after installation;
- Bitwig automatically reloaded the controller with a new instance ID;
- real `target.inspect`: available empty target at track 0, scene 0;
- two real Gateway-to-Qwen runs: HTTP 201, two isolated tool-call steps, valid
  SongPatch and preview, zero authentication calls, and zero mutation calls.

Node 26.4.0 emitted the known unsupported-engine warning. The repository Node
22/24 contract was not changed.

## Live Safety Evidence

The previous installed controller was preserved as
`BeatTwin.control.js.~1~`. The live target was selected by the human. Every
validation port replaced `authenticate` and `mutate` with failing sentinels and
recorded zero calls. No confirmation token was consumed and no plan execution
route was called.

## Evidence Boundary

Both real Qwen proposals omitted the explicit 132 BPM request. Gateway therefore
compiled `CreateSong` without a BPM and displayed its honest 120 BPM default.
Those previews were rejected and are not candidates for execution.

No live clip creation, track rename, tempo change, note write, readback, sound,
publication, commit, or merge is claimed.

## Adversarial Review

- an empty cursor clip no longer destroys target identity;
- two selected bank slots produce no available target;
- target generation still changes when selection identity changes;
- note access requires the bounded cursor to match the selected track and scene;
- clip creation uses the exact bound slot and still rejects existing content;
- the semantic tempo failure was not hidden by silently inserting 132 BPM into
  the model output.

## Next Activation Signal

`Orbit Ready BT-RTX-003` authorizes the smallest deterministic explicit-BPM
constraint at the model-facing schema boundary, followed by a fresh real
Gateway preview. Live execution remains a separate gate.
