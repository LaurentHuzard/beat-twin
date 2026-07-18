# NanoDAW Live Contract

Status: architecture spike
Date: 2026-07-14
Scope: shared kernel for the Session Deck and Mutation Instrument comparison

This contract preserves the expensive semantics while keeping both interaction
skins disposable. It does not add scenes, slots, recording, macros, capture, or
any live-session field to the persistent `Song` document.

## Four Meanings

```text
player intent
  -> pending transition with an exact target beat
  -> engine scheduling acknowledgement
  -> engine execution or failure observation
  -> optional durable promotion (out of scope)
```

These meanings may share one TypeScript module, but they cannot share one truth.
The UI may say “pending” or “scheduled” from the transition ledger. It may say
“active” only from an engine observation carrying the same transition identity.

## Clock

- Fixed BPM and 4/4 for this quest.
- The clock stores an origin, not a continuously mutated `currentBeat` field.
- Beat position is derived from monotonic time.
- `next-bar` is strictly future: a request at beat 3.9 targets beat 4, while a
  request exactly at beat 4 targets beat 8.
- Stopping one track never stops or rewinds the global clock.

## Transition Ledger

Every record contains:

- stable transition ID;
- track ID;
- replaceable action payload;
- request beat;
- resolved target beat;
- one lifecycle status.

Lifecycle:

```text
pending -> scheduled -> executed
   |           |
   +-> failed <-+
   |
   +-> cancelled
```

Only one pending or scheduled transition may be open per track. A new player
gesture may replace a still-pending transition and records the old one as
cancelled. Once the engine has acknowledged scheduling, local replacement is
rejected; a future engine cancellation protocol must acknowledge that case.

## Observation

- `scheduled` means the engine accepted work; it does not mean the player heard
  it.
- `executed` requires an engine observation at or after the target beat.
- A successful observation updates the observed track state.
- A failed observation keeps the previous observed track state.
- A cancelled or resolved transition cannot later be observed a second time.

The observation payload is generic. The Session Deck may report an active clip.
The Mutation Instrument may report an anchor plus a variation. The kernel does
not interpret either model and therefore does not hard-code launcher semantics.

## Persistent Authority

The live session is ephemeral. It may refer to immutable song material, but it
does not become a second persistent song owner. Preview, pending transitions,
engine observations, and future recovery journals stay outside `Song`, undo, and
redo until a separately designed human promotion boundary exists.

## Headless Gate

The pure test scenario proves:

1. two tracks resolve requests to one shared bar boundary;
2. one pending request can be replaced or cancelled;
3. scheduling does not optimistically update audible state;
4. successful and failed observations diverge correctly;
5. stopping one track leaves another active and the clock advancing;
6. both activation and transformation payloads use the same kernel.

This proves deterministic state semantics only. Browser timer jitter, Tone.js
scheduling, late observations, sound quality, gesture clarity, and the desire to
play another run remain evidence for later quest steps.

## Prototype Adapter Boundary

The Q1-B/Q1-C comparison uses one Tone.js Transport, two fixed synth voices, and
a short JavaScript lookahead to apply observed states near the resolved bar.
Editor preview and live-lab playback are mutually exclusive because both use the
same global Tone transport. This adapter is enough to hear and compare the two
costumes; it is not the production scheduler and does not prove sample-accurate
execution or late-event recovery.
