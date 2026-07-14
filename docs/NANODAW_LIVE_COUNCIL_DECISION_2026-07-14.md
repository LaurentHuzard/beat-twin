# NanoDAW Live Council Decision

Date: 2026-07-14

This record challenges the launcher-first proposal in
`NANODAW_LIVE_PRODUCT_REFLECTION.md`. The proposal is useful design material,
not an implementation commitment.

## Decided Enough To Preserve

- continuous musical time;
- predictable quantized transitions;
- local standalone autonomy;
- one durable browser-owned song document;
- explicit human control over changes to audible material;
- separate meanings for player intent, resolved transition, engine observation,
  and optional durable promotion.

## Still Replaceable

- launcher versus pattern transformation as the primary grammar;
- 4 x 4 dimensions, scenes, slots, voices, and macros;
- recording and overdub;
- capture as snapshot, performance take, or materialized arrangement;
- active-clip edit semantics;
- crash recovery and rolling-buffer design.

## Frozen During The Evidence Quest

- persistent scene or slot migrations;
- recording, overdub, macros, and take materialization;
- agent execution in the live path;
- broad responsive redesign;
- activation of the full BT-LIVE ticket tree.

## Architecture Contract For The Spike

```text
player intent
  -> transition resolved to an exact musical beat
  -> engine execution and observation
  -> optional durable promotion
```

The UI must not claim that requested audio is already audible. One pending
transition per track avoids contradictory queued launch and stop flags. Global
clock position is derived from the clock, while active audible state comes from
engine observation.

## Minimal Next Quest - Two Costumes, One Clock

Build one shared headless kernel with two tracks, fixed 4/4, fixed BPM,
next-bar quantization, one pending transition per track, explicit transition
identity, independent track stop, and planned/executed/failed/cancelled states.

Compare two deliberately disposable interfaces over identical voices and
musical material:

1. **Session Deck:** two clips per track; launch, replace, cancel, and stop.
2. **Mutation Instrument:** one anchor pattern per track; transpose, rotate,
   restore anchor, cancel, and stop.

## Shared Scenario

1. Start both tracks.
2. Queue two changes for the same next-bar boundary.
3. Replace or cancel one pending request.
4. Observe execution without stopping the clock.
5. Stop one track while the other continues.
6. Return to a known musical state.

## Stop Condition

Stop after both prototypes complete the shared scenario and one meaningful
preference or rejection is visible. Keep the shared clock, transition contract,
and tests. Archive or delete the losing interface without migrating its domain
concepts into `Song`.

## Success Is Evidence, Not Completion

Timing correctness is a technical gate. Promotion requires a separate listening
and interaction judgment: the player can understand the next gesture while
listening, create a coherent short evolution, return to a known state, and wants
another run without first demanding more editor features.
