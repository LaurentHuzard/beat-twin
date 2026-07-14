# Current Beat Twin Orbit

## Loop

Q1-A — shared headless clock and transition contract for the live-interaction
comparison quest.

## Target Outcome

Prove that one launcher-neutral kernel can resolve player intent to a concrete
next-bar beat, track one pending transition per track, distinguish planned from
observed state, and stop one track without stopping the shared clock.

## Product Contract

- The kernel is ephemeral and must not mutate the persistent `Song` schema.
- Clock position is derived rather than stored as ordinary reducer state.
- Every transition has one identity, one exact target beat, and one lifecycle.
- Engine observation alone may claim an active audible source.
- Replacing a pending request cancels the prior transition explicitly.
- The contract must remain neutral enough for both launch and mutation actions.

## Files To Create Or Modify

- `.agents/current-plan.md`
- `.agents/queue.md`
- `docs/live-contract.md`
- one pure TypeScript transition module at the current audio/session boundary
- headless tests for boundary resolution, replacement, cancellation, execution,
  failure, and independent stop

## Commands To Run

```bash
pnpm test
pnpm typecheck
git diff --check
git status --short --branch
```

## Validation Steps

- resolve any request strictly to the next 4/4 bar;
- replace or cancel one pending request per track deterministically;
- execute two tracks at the same boundary without conflating their observations;
- fail one transition without falsely claiming active audio;
- stop one track while another remains observed active and the clock remains free;
- keep launcher and mutation payloads outside the persistent song document.

## Evidence Boundary

- Pure tests prove transition semantics, not audible timing or musical joy.
- The first engine adapter may still report late execution in a later slice.
- No persistent slot, scene, recording, macro, or capture model is introduced.

## Exit Condition

- the contract and tests cover the shared Council scenario at the state-machine
  level;
- Q1-B and Q1-C can consume the same public API without changing `Song`;
- no disposable interface is polished beyond what the comparison requires.
