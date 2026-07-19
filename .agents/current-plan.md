# Active Beat Twin Orbit

## Loop

BT-LIVE-103 / GitHub #28 — deliver the first product-facing 2 x 2 quantized
launcher vertical slice on an isolated branch based on BT-LIVE-102.

## Target Outcome

NanoDAW presents two tracks with two clip slots each. A performer can start the
shared browser audio runtime, launch or replace a clip on a quantized boundary,
stop one track independently, and always see the distinction between queued and
active state without interrupting the other track.

## Planned Changes

- project a bounded two-track/two-slot launcher from the browser-owned Song;
- route every launch and stop through the existing performance store and exact
  BT-LIVE-102 controller handshake;
- expose transport and launch quantization without introducing another clock;
- show honest idle, queued, active, stopping, unavailable, and failure states;
- keep the detailed editor and existing Preview path available;
- add focused interaction tests, real-browser evidence, Orbit report, and an
  adversarial review.

## Product Contract

- The launcher is a projection and command surface, never a second Song owner.
- UI and future agent actions share the same bounded performance actions.
- A slot becomes active only after the audio engine observes its exact
  transition; a click alone cannot paint a false playing state.
- Replacing or stopping one track never resets the shared transport or affects
  the other track.
- The slice stays 2 x 2. Scaling, step variations, MIDI recording, audio/sample
  payloads, Capture Jam, Bitwig, Gateway, MCP, and S25 changes are out of scope.

## Verification Plan

- focused launcher/store/controller interaction tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- `pnpm smoke:packages`;
- `git diff --check`;
- desktop real-browser launch, replacement, independent stop, console, and
  responsive-layout checks;
- adversarial review for false UI state, duplicate gestures, unavailable
  material, stale transitions, and cross-track interruption.

## Current State

The bounded implementation, deterministic suite, production build, package
smoke, responsive browser pass, real Tone timing trace, and adversarial review
are complete. The reviewer findings around a controller factory resolving after
unmount and accessible state names were fixed with regressions. The branch is
ready for the parent publication loop; it is not yet pushed, opened as a PR, or
merged.

## Human Gates

- The user cleared the BT-LIVE-102 listening gate on 2026-07-19 and explicitly
  authorized push, PR creation, and merge for the dependency-ordered sequence.
- Only one implementation branch and one `Orbit Ready` item may exist at once.
- Browser-local audio playback is in scope; external DAW writes remain out of
  scope.

## Exit Condition

The 2 x 2 surface passes deterministic and real-browser gates, its report
records the evidence and residual risks, and the implementation PR is merged
without bypassing required checks.

## Next Activation Signal

After #28 merges, activate only GitHub #30 for the playable 16-step editor and
variations. Keep #31 and the indispensable BT-AUDIO-200 audio/sample tranche
dependency-ordered behind it.
