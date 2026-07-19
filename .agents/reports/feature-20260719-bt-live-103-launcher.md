# BT-LIVE-103 — 2 x 2 quantized launcher

Date: 2026-07-19
GitHub: #28
Branch: `agent/bt-live-103-launcher`
Worktree: `/tmp/beat-twin-orbit-28`
State: implementation and gates complete locally; push, PR, and merge pending

## Delivered

- Product-facing 2 x 2 launcher projected from the first two tracks and first
  two clips of the browser-owned Song; missing tracks and slots stay explicit.
- One shared BT-LIVE-102 audio controller and clock for individual clip launch,
  replacement, track-local stop, atomic scene launch, and quantized transport
  stop. No second Song owner or UI-owned timing loop was introduced.
- Next-bar launch by default with immediate, next-beat, and next-bar controls.
- Literal empty, unavailable, idle, queued, playing, stop-queued, and error
  labels in the DOM. Scene and slot accessible names include the exact current
  state instead of masking their visible state.
- The detailed editor remains below the launcher, and Preview/live audio remain
  mutually exclusive.
- Demo material now provides two instrument tracks and four clips so the
  standalone launcher is useful without Bitwig, Gateway, MCP, or S25.

## Exact runtime guarantees exercised

- A launch paints `queued` first and only paints `playing` after the matching
  engine observation.
- Replacing or stopping Drums leaves Bass active on the shared clock.
- A two-track scene uses one group identity and one target beat.
- A quantized transport stop retains the controller until the matching stop
  observation.
- React StrictMode replay remains startable, late async sync failures do not
  update an unmounted component, and a controller factory resolving after
  unmount is disposed before `start()` can acquire or unlock audio.
- Live performance actions do not mutate the Song, undo stack, or local Song
  persistence.

## Tone callback-time correction

The first real-browser global-stop run reproduced one Tone warning:
`Events scheduled inside of scheduled callbacks should use the passed in scheduling time.`
The scheduled transport-stop callback released sources and stopped Tone without
forwarding the callback's audio time. The live port now accepts an optional
stop time, and the engine forwards the exact scheduled callback time through
source release, disposal, and `transport.stop(time)`. The engine regression
asserts `4` seconds at beat `8` and the fresh Chromium rerun completed with zero
warnings and zero errors.

## Deterministic evidence

- Focused launcher/App suite: 35/35 passed.
- Focused audio-tone live-engine and instrument-routing files: passed.
- `pnpm test`: 176/176 passed. The first sandboxed attempt could not bind the
  gateway test loopback sockets (`listen EPERM`); the same suite passed outside
  that filesystem/network sandbox.
- `pnpm nanodaw:test`: 9 files, 88/88 passed.
- `pnpm typecheck`: passed.
- `pnpm --filter @beat-twin/playground build`: passed; 2,562 modules transformed.
- `pnpm smoke:packages`: passed for 9 packages.
- `git diff --check`: passed.

## Browser evidence

- Real Chromium and Tone.js in standalone mode: Create Demo, start live, atomic
  Scene 1 launch, replacement, track-local queued stop, observation, and global
  quantized stop all completed.
- Timing trace on next-bar launch: queued at bar 72, observed playing at bar 73
  after 1,854 ms; both tracks shared the boundary.
- Fresh final stop run: 4 console messages, 0 errors, 0 warnings.
- Desktop and 390 x 844 narrow-touch layouts were inspected. At 390 px the body
  and launcher stayed within the viewport with no horizontal overflow; controls
  use pointer/touch-safe buttons with no hover-only dependency.
- Browser snapshots and screenshots were temporary QA artifacts and are not
  part of the commit.

## Adversarial review

The review checked false active state, duplicate gestures, unavailable
material, stale transitions, cross-track interruption, StrictMode ownership,
late async lifecycle boundaries, and accessible status. Two findings were
fixed before commit:

1. a late controller factory result is ownership-checked and disposed before
   `start()` when its component has unmounted;
2. scene and slot accessible names carry their live state, including queued,
   playing, and stop-queued.

## Scope guard and residual risk

- No 4 x 4 scaling, step variations, MIDI recording, mixer, Capture Jam,
  audio/sample payloads, Bitwig, Gateway, MCP, or S25 behavior was added.
- The indispensable audio-clip/sample tranche remains parked behind #31.
- Automated playback proves scheduling and runtime state, not subjective sound
  quality. The earlier listening gate was already cleared by the user.
- Browser QA covered Chromium, not Firefox or Safari.
- The local runtime is Node 26.4.0 while the repository declares Node 22 or 24;
  all gates passed, but pnpm emitted the expected unsupported-engine warning.
- This worktree is ready for publication but has not pushed, opened a PR, or
  merged. The parent loop owns those actions and the activation of #30.
