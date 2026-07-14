# Current Beat Twin Orbit

## Loop

Q2-L — one separate human listening and play session. Q1-B through Q1-D are
technically complete.

## Target Outcome

Decide whether the Session Deck's lower cognitive load or the Mutation
Instrument's stronger identity creates more desire for another run while
listening, not merely while reading the interface.

## Product Contract

- Use the same Pulse and Glass voices at 112 BPM.
- Give each costume one uninterrupted run before switching.
- Judge while listening rather than staring at transition labels.
- Record which next gesture felt obvious and whether return-to-anchor felt safe.
- Do not add controls or polish during the listening session.

## Files To Create Or Modify

- `.agents/current-plan.md`
- `.agents/queue.md`
- `docs/NANODAW_TWO_COSTUMES_DECISION_2026-07-14.md`
- one short listening note appended after the human session

## Commands To Run

```bash
pnpm nanodaw:dev
```

## Validation Steps

- play Session Deck through start, replace, and independent stop;
- play Mutation through start, transpose, rotate or cancel, restore, and stop;
- answer which interface invited the next gesture without visual search;
- answer which result made another run feel worthwhile.

## Evidence Boundary

- The current browser videos are visual only and contain no audio.
- The prototype adapter observes JS-time transitions near Tone boundaries; it is
  not evidence of sample-accurate scheduling.
- No product winner is declared from automated evidence alone.

## Exit Condition

- one costume is promoted for the next implementation quest, or both are paused
  with one exact invalidating signal;
- the decision does not migrate scenes, slots, or mutations into `Song`.
