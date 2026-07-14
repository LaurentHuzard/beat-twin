# Feature Report - Live Transition Contract

Date: 2026-07-14
Quest step: Q1-A
Outcome: Passed

## Delivered

- a derived musical clock with no mutable beat tick in reducer state;
- strictly future next-bar quantization;
- generic action and observation payloads;
- one open transition per track;
- explicit pending, scheduled, executed, failed, and cancelled records;
- local replacement and cancellation before engine scheduling;
- engine observation as the only path to audible track state;
- independent track stop without stopping the clock;
- `docs/live-contract.md` as the mechanism-neutral contract.

## Evidence

The focused NanoDAW suite now runs 31/31 tests across two files. Nine pure tests
cover the live kernel, including simultaneous target beats, replacement,
cancellation, optimistic-state rejection, scheduling failure, independent stop,
and both activation and transformation payloads. Typecheck passes.

## Important Boundary

A pending transition may fail before its target boundary if the engine rejects
scheduling. A successful execution may never be observed before the target beat.
Once scheduling is acknowledged, local replacement is rejected until a future
engine-cancellation acknowledgement exists.

## Non-Evidence

The kernel has not yet scheduled Tone.js audio and does not establish human
preference between the two interfaces. It deliberately does not touch `Song`.

## Next

Q1-B and Q1-C consume the same API in one isolated comparison surface.
