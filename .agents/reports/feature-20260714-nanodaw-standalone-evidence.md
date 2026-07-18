# Feature Report - NanoDAW Standalone Evidence

Date: 2026-07-14
Branch: `dev/nanodaw-standalone`
Tickets: BT-202, BT-203, BT-204
Outcome: Passed after two bounded fixes

## Baseline

- `pnpm test`: 116/116 tests passed.
- `pnpm nanodaw:test`: 22/22 tests passed.
- `pnpm typecheck`: passed.
- `pnpm smoke:packages`: 8/8 package smoke checks passed.
- Runtime: Node 26.4.0 and pnpm 11.10.0. Node is newer than the declared
  supported 22/24 matrix, so the engine warning remains an environment note.

## Real-Browser Scenario

Chromium executed the existing UI without a browser plugin:

```text
load -> create demo -> edit pitch 36 to 37 -> audition -> stop
  -> undo to 36 -> redo to 37 -> save -> reload -> load -> observe 37
```

Observed result:

```json
{
  "title": "Beat Twin Playground",
  "editedPitch": 37,
  "previewStayedEphemeral": true,
  "undoPitch": 36,
  "redoPitch": 37,
  "loadedPitch": 37,
  "loadedTransportPlaying": false,
  "loadedSongVisible": true
}
```

Console ended with 0 errors and 0 warnings. Tone.js logged its normal startup
banner after the explicit audition gesture. The 48 recorded requests all
returned 200 and targeted only `127.0.0.1` or a local `blob:` URL.

Visual checks:

- desktop: 1440 x 1000, meaningful timeline, inspector, transport, and storage;
- mobile: 390 x 844, `document.body.scrollWidth === 390`, no horizontal overflow;
- no framework error overlay or blocked external-dependency state.

Screenshots were kept as transient QA artifacts outside the repository:
`/tmp/beat-twin-nanodaw-desktop.png` and
`/tmp/beat-twin-nanodaw-mobile.png`.

## Defects Found And Fixed

1. A missing favicon produced the only initial console error. The playground now
   uses an inline SVG favicon and no longer requests `/favicon.ico`.
2. Preview Start/Stop commands entered durable undo history. Undo after audition
   could therefore leave the audio engine stopped while the serialized song said
   `transport.isPlaying: true`. Preview state now stays at the audio/session
   boundary and does not mutate persistent song state or history. The focused
   browser-unit test locks this invariant.

## Evidence Boundary

This proves standalone browser ownership, local persistence, reversible editing,
and successful Web Audio startup in Chromium. It does not prove perceived sound
quality, scheduler latency, audible equivalence, or that either proposed live
interaction is enjoyable. Those remain the comparison quest.

## Next

Q1-A: implement the launcher-neutral clock and transition contract before any
Session Deck or Mutation Instrument interface.
