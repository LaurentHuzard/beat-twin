# Beat Twin + Remote Jam: first MIDI musician boundary

**State:** opt-in library and fake-port tests only. This is *not* a real network jam, an automatic Bitwig setup or an audible proof.

## Ownership

**Remote Jam transports and synchronizes. Beat Twin makes music.** This adapter receives a validated, versioned Remote Jam frame and, only when an operator has separately armed an authenticated peer, may dispatch limited MIDI to Bitwig. No sockets, HTTP routes, model calls, WebRTC, audio devices, or MIDI clock code are introduced here.

Remote Jam's initial delivery envelope is `midi-delivery-v1` (draft [Remote Jam PR #23](https://github.com/LaurentHuzard/remote-jam/pull/23)). This type exists in Beat Twin for *structural interoperability only*; no runtime connection is established.

## Explicit trust requirements

`RemoteJamBitwigConsumer` is exposed from `@beat-twin/bitwig-adapter`. A future application composition root must provide:

- `RemoteJamMidiPort`, preferably backed by a **local** Bitwig controller protocol client;
- `isAuthenticatedPeer(session)` bound to a real authenticated Remote Jam session, not merely an untrusted peer ID;
- `isWriteAuthorized()` bound to a current **human** arming decision and a distinct `midi_write` policy.

The factory `createRemoteJamBitwigPort(call)` maps MIDI operations to the existing local Bitwig NoteInput RPC names. `requiresAuthentication: true` does **not** itself enforce the operator's `midi_write` policy. **Never expose this factory to raw incoming network packets**, or assume loopback proves peer authorization.

Both callbacks are rechecked before each event. The consumer is single-session/single-stream, serializes host calls, refuses foreign identities, drops duplicate sequences, and treats a sequence gap, malformed envelope, revoked authorization or dispatch uncertainty as a fault. Fault handling issues best-effort `all_notes_off`; rearming after a fault requires explicit disarm/cleanup and a new stream epoch. There is no automatic network reconnection.

## Supported musical operations

| Remote Jam event | Behavior in this tranche |
| --- | --- |
| `note_on`, `note_off`, remote channel **1** | Bitwig NoteInput channel **0**, using `note_input.send_note_on/off` |
| `note_on` velocity 0 | Releases a held note |
| `stop` | Sends MIDI all-notes-off for safety; does **not** stop the DAW transport |
| `clock`, `start`, `continue`, `tempo`, `control_change` | Explicitly unsupported; never falsely mapped to a realtime transport command |
| Remote MIDI channels 2–16 | Explicitly unsupported; never silently folded to channel 0 |

The optional `BeatTwinMidi.control.js` MIDI controller profile must be installed and explicitly routed to an instrument. `note_input.get_status` cannot prove audio routing or actual note playback. The controller currently uses bounded 10-second note leases and pitch-based tracking; this boundary supports up to 32 locally initiated held pitches. It does not yet observe lease expiration, qualify note-off latency or prove audio silence after instrument/effect tails.

## Timing limitations

`sent_ns`, `play_ns` and `deadline_ns` are validated for consistency but are **not used to schedule** Bitwig operations. Real peers have independent clock domains. A trustworthy deadline/playback schedule requires qualified offset estimates and an actual latency-aware host scheduler. The returned result is `dispatched_unverified`, never `played` or `synchronized`.

MUE and agentic arrangement proposals stay off the realtime note/clock path.

## Verification

For the real checkout (Node 26 and pnpm 11.10.0):

```sh
pnpm --filter @beat-twin/bitwig-adapter build
pnpm --filter @beat-twin/bitwig-adapter test
pnpm test
```

Focused test source: `packages/adapters/bitwig/test/remote-jam.test.ts`. The PR is draft until native build and full suite are confirmed.

## Further work

1. Review and merge the upstream Remote Jam frame contract; qualify peer transport/authentication through RJ-003B.
2. Create a separate, explicitly authorized local subscription + operator UI, with token/policy revocation and bounded input rate/queue.
3. Validate actual Bitwig MIDI profile, manual instrument routing, note on/off, panic on disconnect, acoustic tails and no stuck notes in a **disposable project**.
4. Implement and verify transport/clock/tempo separately, then a genuine two-computer playing and listening witness.
