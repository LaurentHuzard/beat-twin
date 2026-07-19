# Loop Report

## Loop

BT-LIVE-106 / GitHub #31 — quantized MIDI loop recording and overdub on the
browser-owned NanoDAW launcher.

## Product Outcome

A player can queue a 1, 2, 4, or 8 bar MIDI take from the computer keyboard,
accessible on-screen pads, or optional Web MIDI. Empty-slot recording begins at
the next bar; overdub begins at the selected active clip's next exact loop
boundary. Visible queued, recording, committed, discarded, and cancelled states
keep the capture lifecycle explicit.

## Command And Persistence Boundary

The capture buffer is ephemeral. A completed empty-slot take materializes one
`CreateClip` plus its `AddNote` commands in one atomic batch; an overdub
materializes only `AddNote` commands in one atomic batch. That yields exactly
one document revision, autosave, and undo checkpoint. Cancellation, transport
stop, target replacement, focus loss, hidden document, device disconnect, and
unmount discard the uncommitted take without changing the persistent `Song`.

## Input, Timing, And Ownership

Note ownership is keyed by source, MIDI channel, and pitch. Note-on velocity
zero is normalized to note-off, retriggers close prior notes, held notes close
at the take boundary, and all committed notes are sixteenth-quantized and
bounded inside the loop. The live controller exposes the active clip's exact
start and length for off-global-bar overdub boundaries. `StartOverdub` requires
the matching armed track and cannot hijack another recording owner.

Web MIDI is optional and permission/device failure leaves keyboard and pads
usable. Blur, visibility, disconnect, stop, and unmount release held inputs.
Global shortcuts are suspended while a take is armed or active, including the
`D` pad collision. Pads support pointer, Enter, and Space interactions.

## Verification

- `pnpm test`: 178 passed;
- `pnpm typecheck`: passed;
- `pnpm nanodaw:test`: 141 passed;
- `pnpm --filter @beat-twin/playground build`: passed, 2,568 modules;
- `pnpm smoke:packages`: passed for all nine packages;
- focused final recorder/runtime suite: 32 passed;
- `git diff --check`: passed.

Node 26 emitted the repository's expected engine warning because the supported
range is Node 22 or 24; no test or build failed.

## Browser QA

Regular Playwright was used because no Browser plugin was available. A real
Chromium session created an empty browser-owned clip, started the live clock,
queued an 8-bar take, captured three keyboard notes, and committed one new clip
with three notes and one undo step. `Undo last take` returned the document to
one clip and zero notes.

At 390 x 844, the document and viewport widths were both 390 pixels, with no
horizontal overflow. The recorder remained legible and operable. The console
reported 0 errors and 0 warnings. The browser and Vite server were stopped and
all generated Playwright artifacts were removed.

## Adversarial Review

The review covered clock drift, non-global loop starts, boundary rounding,
late note-off, retrigger ownership, stuck input, interrupted commit, duplicate
identity, undo granularity, StrictMode cleanup, shortcut collisions, and
transport/runtime ownership. All P0 and P1 findings are resolved; accessible
keyboard pads and overdub ownership hardening were also applied.

## External And Human Gates

Browser-local MIDI capture and playback of the committed clip are proven. Live
input monitoring, microphone/audio recording, sample import, Gateway/MCP/S25,
Bitwig, external DAW writes, and deployment remain out of scope. The human
explicitly authorized push, PR creation, CI-gated squash merge, and issue
closure for this bounded loop.

## Next Activation Signal

After merge, open a separate bounded Orbit plan for BT-AUDIO-200: browser-owned
audio clips and samples, including asset references, import/decode lifecycle,
prepared-buffer playback, looping, UI, persistence, cleanup, and listening
gates.
