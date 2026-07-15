# Feature Report - BT-212 Authenticated Bitwig Adapter

Date: 2026-07-15
Branch: `dev/nanodaw-standalone`
Ticket: BT-212
Outcome: Passed locally

## Product Outcome

Beat Twin now has a dedicated `bitwig-launcher-v1` adapter that can translate
one confirmed portable plan into a small authenticated launcher-slot operation
set and only report success after exact readback.

## Evidence Boundary

Controller contracts, TCP authentication, target races, delayed clip readiness,
mutation failures, divergent readback, and idempotent no-retry behavior are
covered deterministically. No Bitwig process or live project was mutated. The
first live write remains BT-213's explicit disposable-project human gate.

## Changes

- Added `@beat-twin/bitwig-adapter` and its build/package smoke wiring.
- Added per-connection controller authentication through a Bitwig preference
  secret matching `BITWIG_BRIDGE_SECRET`.
- Kept all historical reads available and the 57-tool MCP schema unchanged.
- Added controller identity, target inspection, generation-aware binding, and
  exact 64-step note readback.
- Isolated Agent-mode note access from the historical MCP cursor viewport.
- Added bounded tempo, track-name, clip, pitch, velocity, duration, and note
  count validation before authentication.
- Added read-only clip-readiness polling after one create dispatch.
- Added stop-first-failure reports with conservative `unknown` results and no
  automatic mutation retry.

## Verification

- Root Node suite: 145/145 passed.
- Historical MCP snapshot: exactly 57 tools passed unchanged.
- Bitwig protocol suite: 9/9 passed, including shared one-auth composition.
- NanoDAW Vitest: 4 files, 39/39 tests passed.
- Repository typecheck: passed.
- Production build: passed (2,559 modules transformed).
- Package smoke: nine packages passed.
- Controller and Node syntax checks: passed.
- `git diff --check`: passed.

## Adversarial Review

- Missing or invalid secrets fail before the first mutation.
- A target changed before or during authentication fails before mutation.
- Target replacement generation participates in every bounded mutation.
- Legacy cursor scrolling cannot shift the dedicated Agent-mode grid.
- A delayed clip observer is polled read-only; clip creation is never replayed.
- Notes outside the actual clip and names over 64 characters fail preflight.
- A post-dispatch exception stops immediately and marks the exact boundary
  unknown; later commands are not attempted.
- Divergent final readback marks all dispatched effects unknown and returns the
  best observed snapshot instead of claiming completion.

## Git

- No PR was opened.
- Publication state is recorded after the final validation commit and SSH push.

## Remaining Risks

- Bitwig API observer timing and audible result still need one live disposable
  project proof.
- Clip naming is not part of verified readback because the bounded controller
  surface does not set it.
- BT-213 must preserve separate target previews and human confirmations.

## Next Activation Signal

Open a disposable Bitwig project, configure the bridge secret, select one empty
launcher slot, and run BT-213 with separate NanoDAW and Bitwig confirmations.
