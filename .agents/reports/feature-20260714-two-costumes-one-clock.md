# Feature Report - Two Costumes, One Clock

Date: 2026-07-14
Quest steps: Q1-B, Q1-C, Q1-D
Outcome: Technical comparison complete; human listening gate remains

## Delivered

- one isolated `Live comparison lab` inside the existing playground;
- Session Deck with two tracks, two prepared sources per track, replace, cancel,
  and independent stop;
- Mutation Instrument with two anchored tracks, transpose, rotate, restore,
  cancel, and independent stop;
- identical Pulse and Glass voices, 112 BPM, 4/4, and next-bar quantization;
- dynamic Tone.js loading only after `Start clock`;
- explicit pending, scheduled, and observed UI states;
- no writes to `Song`, undo/redo, or local persistence;
- mutual exclusion between editor preview and the lab's global Tone transport.

## Deterministic Evidence

The NanoDAW suite passes 34/34 tests across three files. The two component
scenarios cover:

- Session Deck replacement before scheduling;
- two-track execution at one bar;
- stopping Pulse while Glass remains active;
- Mutation transpose and cancelled rotate at one bar;
- restore to anchor;
- stopping Glass while Pulse remains active;
- no browser song persistence;
- refusal to compete with an active editor preview.

Typecheck and `git diff --check` pass.

Final repository validation also passed 116/116 root tests and a production Vite
build (2,557 modules transformed). The supported-runtime warning remains because
this workstation is on Node 26.4.0 while the repository declares Node 22/24.

## Real-Browser Evidence

Chromium with real Tone.js returned:

```json
{
  "deckAfterChange": { "pulse": "Lift", "glass": "Anchor" },
  "deckAfterStop": { "pulse": "Stopped", "glass": "Anchor" },
  "mutationAfterChange": { "pulse": "+5", "glass": "Anchor" },
  "mutationFinal": { "pulse": "Anchor", "glass": "Stopped" }
}
```

Console ended with 0 errors and 0 warnings. All 29 captured requests returned
200 and stayed on `127.0.0.1` or a local `blob:` URL. The mobile check reported
`innerWidth === body.scrollWidth === 390`.

Transient screenshots:

- `/tmp/beat-twin-session-deck.png`
- `/tmp/beat-twin-mutation-instrument.png`
- `/tmp/beat-twin-live-lab-mobile.png`

Short visual performance captures, without browser audio:

- `/tmp/beat-twin-session-deck.webm` (612 KB)
- `/tmp/beat-twin-mutation-instrument.webm` (797 KB)

## Visual Fidelity Ledger

The pre-change NanoDAW screenshot served as the existing-design reference; no
new ImageGen concept was created for this disposable in-system spike.

| Check | Reference | Render | Result |
| --- | --- | --- | --- |
| Palette | White surfaces, dark green, muted green, amber focus | Same tokens reused | Match |
| Geometry | 8 px radii and one-pixel borders | Lab, clock, tracks, and controls use the same geometry | Match |
| Typography | Compact editor chrome with strong labels | Lab labels and controls preserve the hierarchy | Match |
| Icons | Lucide outline family | Activity, play, step, rotate, stop, cancel use Lucide | Match |
| Container model | Open editor panels, not decorative cards | One bounded lab with two functional track rails | Match |
| Responsive | Single-column mobile editor | Tracks and actions collapse with no horizontal overflow | Match |

No material mismatch remains. The intentional deviation is that the lab is a
temporary section rather than a product navigation mode.

## Architecture Pressure

The prototype engine applies track state from a JavaScript lookahead near the
Tone bar. It proves lifecycle semantics and produces real sound, but it does not
prove sample-accurate transition execution. Tone's transport is global, so the
editor preview and live lab are explicitly exclusive.

## Provisional Verdict

- **Promote the shared kernel.** It served both action grammars without touching
  `Song`.
- **Promote Session Deck as the listening control.** With two musical choices
  plus Stop per track, the next visible gesture is clearer.
- **Pause Mutation as the R&D challenger, not a rejection.** Its explicit anchor
  and reversible transforms carry more NanoDAW identity, but five controls per
  track create more visual choice before musical appeal has been judged.
- **Keep the 4 x 4 launcher, scenes, slots, recording, macros, and capture frozen.**

Automated evidence cannot determine which experience invites another run. Q2-L
is the one remaining listening gate before a product direction is promoted.
