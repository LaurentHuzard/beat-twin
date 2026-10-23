# BT-RJ-002: NanoDAW can perform received MIDI without Bitwig

**Status:** first local sink and Tone.js audio seam; unverified end-to-end network jam. Tracks [issue #118](https://github.com/LaurentHuzard/beat-twin/issues/118). Remote Jam #24 transports and authenticates network sessions; this project owns musical interpretation.

## Implemented boundaries

- `apps/playground/src/remoteJamMidiSink.ts`: `NanoDawRemoteJamMidiSink` consumes strictly validated `midi-delivery-v1` JSON objects, a `NanoJamNotePort`, a **human arming** callback and an independent **trusted peer authorization** callback. No network code, MCP, transport mutation or model inference.
- `apps/playground/src/remoteJamTonePort.ts`: browser Tone.js polyphonic synth supports held `note_on`, targeted `note_off` and global `releaseAll` panic. The gain is capped locally; the synth has its own lifecycle and never starts or resets the shared NanoDAW musical transport.
- Browser audio lease owner `remote-jam` is exclusive with preview, song playback and the existing LiveLauncher. `acquireNanoDawRemoteJamAudio` must be called from an explicit user gesture to unlock Web Audio before arming.
- `RemoteJamLocalAudition`, visible only in **JAM > Developer Mode**, provides an acoustic *local-only* test: enable synth, hear C4, release and stop. It is **not** a Remote Jam peer, never calls the network and never fakes an authenticated partner.

## Supported protocol and safety

| Remote Jam event | Initial NanoDAW behavior |
| --- | --- |
| `note_on` channel 1, nonzero velocity | polyphonic local Tone.js note attack |
| `note_off` channel 1 or `note_on` velocity 0 | matching local note release |
| `stop` | release all notes; **not** equivalent to stopping the NanoDAW transport |
| `tempo`, `clock`, `start`, `continue`, `control_change` | explicitly unsupported; no invented clock sync |
| channel 2..16 | unsupported; not silently merged |

Every incoming event rechecks authentication and operator arming, strict identity, unique ordered sequence and a bounded event rate. A missed sequence, malformed frame, foreign peer, authorization revocation, or sound-dispatch error triggers a latched fault and best-effort panic. A clean disarm is required before rearming. Note leases release held pitches after **10 seconds** if note-off does not arrive; a network-close callback must still disarm immediately rather than waiting for this timeout. Up to 32 simultaneous pitches and 128 packets/s are admitted. No unbounded async MIDI queue exists.

The 4 KiB size check on parsed objects is defense in depth; an eventual WebRTC bridge **must limit UTF-8 bytes before JSON.parse**, validate the authenticated session, cap socket/message queue and call `sink.disarm()` on close/error/revocation. Do not use the `session_id` and `source_peer_id` strings of an incoming frame as proof of cryptographic identity.

Clock domains: RJ `sent_ns`, `play_ns`, and `deadline_ns` are sender-local monotonic offsets and are **not compared** to browser-local time. The result is `dispatched_unverified`, not synchronized or heard.

## Composition root that the future WebRTC integration must implement

```ts
// Only after a human click AND after a trusted WebRTC/HMAC identity handshake:
const audio = await acquireNanoDawRemoteJamAudio();
const sink = new NanoDawRemoteJamMidiSink({
  port: audio,
  isOperatorArmed: () => localOperatorArmStillValid(),
  isAuthenticatedPeer: (session) => trustedSessionCapabilityMatches(session),
});
sink.arm(authenticatedSession);

// On a message from the authenticated and already size-limited datachannel:
sink.accept(parsedMidiDeliveryFrame);

// Synchronously on disconnect / user stop / authorization revocation:
sink.disarm();
audio.dispose();
```

`trustedSessionCapabilityMatches` and the connection itself **do not exist yet** in this slice. They must be provided by the follow-up browser WebRTC bridge after the remote cryptographic handshake; never substitute `() => true` in a production composition root.

## Verification commands

From the actual Beat Twin checkout, using Node **26**, pnpm **11.10.0** and installed workspace packages:

```sh
pnpm --filter @beat-twin/playground exec vitest run \
  src/remoteJamMidiSink.test.ts \
  src/remoteJamTonePort.test.ts \
  src/RemoteJamLocalAudition.test.tsx

pnpm --filter @beat-twin/playground build
pnpm test
```

For a human-approved local audible smoke, start NanoDAW using `pnpm --filter @beat-twin/playground dev`, open its localhost Vite page, enter the JAM workspace, enable Developer Mode, click **Enable local synth**, then **Play C4 (300 ms)**. You should hear a brief note. No DAW, microphone, second machine, network session or Remote Jam authentication is touched. Sound must be reported only from a real human listening test, never from a synthetic-unit-test result.

## Remaining before a playable remote jam

1. Browser WebRTC room joining (or a trusted local relay) with explicit human approval, TLS/origin strategy, limited datachannel, HMAC/peer identity and lifecycle callbacks. Remote Jam hub currently does not offer browser CORS or peer-specific identity, so this cannot safely be assumed.
2. Actual sender/receiver peer implementation and end-to-end witness in two browsers, no Bitwig required.
3. Instrument selection and human-facing join/leave controls.
4. Qualify browser timing/scheduling and remote tempo/clock before quantized loop jams.
5. Manual note-lease, disconnect, audio tails, stutter, host failure and audible tests.

This tranche does **not** complete live Remote Jam participation; it prepares its NanoDAW sound consumer and local acceptance harness.
