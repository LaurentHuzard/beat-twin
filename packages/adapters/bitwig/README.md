# Bitwig Adapter

`@beat-twin/bitwig-adapter` translates one confirmed portable Beat Twin plan into
a deliberately small Bitwig launcher-slot write surface.

## Boundary

- One selected, empty launcher slot is inspected before planning.
- The binding includes controller instance, project, track/scene positions, and
  a controller-maintained target generation.
- Only one instrument track, one 1-16 beat clip, 1-16 grid-aligned notes, and a
  40-240 BPM tempo are accepted.
- Every mutation carries the confirmed binding. The adapter stops at the first
  failure and never retries a mutation.
- Clip creation readiness is polled through read-only inspection before notes
  are dispatched.
- Success requires exact target, track, clip length, tempo, and note readback.
  Clip naming remains an explicit controller-API limitation.

## Authentication

Set the same high-entropy value in both places:

1. Bitwig Settings -> Controllers -> Beat Twin -> `Beat Twin Security` ->
   `Bridge secret`;
2. the process composing the adapter: `BITWIG_BRIDGE_SECRET`.

`createRpcBitwigBridgePort` passes that secret only to the protocol client's
authentication primitive. It is not returned by inspection or included in an
execution report. Read-only identity, health, and target inspection remain
available before authentication.

## Live Safety

The deterministic suite does not launch Bitwig. For the first live execution,
open a disposable project, stop transport, select an empty launcher slot, and
confirm the Bitwig plan separately from any NanoDAW plan. If a report is
`partial`, inspect the target and create a fresh plan; do not replay it.
