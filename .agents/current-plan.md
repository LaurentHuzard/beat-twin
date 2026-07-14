# Current Beat Twin Orbit

## Loop

Q1-B and Q1-C — two disposable interaction costumes over the validated Q1-A
clock and transition contract.

## Target Outcome

Run the same two-track performance scenario through a minimal Session Deck and
a minimal Mutation Instrument, with identical timing, voices, and approximate
musical material, then capture evidence without finishing either product.

## Product Contract

- Both prototypes consume the same `liveSession` API.
- Two tracks, fixed BPM, fixed 4/4, and next-bar quantization only.
- Session Deck: two prepared sources per track; start, replace, cancel, stop.
- Mutation Instrument: one anchor per track; transpose, rotate, restore, cancel,
  stop.
- Identical voices and comparable musical material prevent sound-quality bias.
- No prototype state enters `Song`, persistence, undo, or redo.

## Files To Create Or Modify

- `.agents/current-plan.md`
- `.agents/queue.md`
- one deliberately isolated comparison component and styles
- focused interaction tests for both costumes
- a real-browser comparison capture for each costume
- one decision report promoting, pausing, or killing each path

## Commands To Run

```bash
pnpm nanodaw:test
pnpm typecheck
pnpm nanodaw:dev
git diff --check
git status --short --branch
```

## Validation Steps

- start both tracks;
- queue two changes for one shared next-bar boundary;
- replace or cancel one pending request;
- execute and distinguish pending from observed state;
- stop one track while the other and the clock continue;
- return to a known musical state without opening the detailed editor.

## Evidence Boundary

- Browser automation proves clarity and deterministic state changes, not desire.
- Human listening remains the final preference signal.
- No scenes, slots, recording, macros, capture, or production mobile campaign.

## Exit Condition

- both costumes complete the shared scenario in tests and a real browser;
- one meaningful preference, rejection, or exact unresolved question is written;
- the shared kernel stays, while neither skin becomes persistent product schema.
