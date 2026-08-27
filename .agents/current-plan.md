# Active Beat Twin Orbit

## Loop

`BT-RTX-004` is complete locally on `agent/bt-rtx-004-first-bitwig-write` from
merged `main` at `d840644`. Orbit Ready is empty.

## Target Outcome

Prepare the first real Bitwig write from a fresh Gateway-to-Qwen proposal,
display the exact stable target and materialized commands, and stop for a
second explicit human confirmation. Only after that confirmation may the
existing Gateway and `BitwigAdapter` execute the plan once and verify exact
readback.

## Product Contract

- use a disposable Bitwig project and one human-selected empty instrument slot;
- inspect and bind the target before proposal generation;
- keep the model limited to `list_daw_targets`, `inspect_session`, and
  `propose_song_patch`;
- keep confirmation, authentication, execution, policy, audit, and readback
  outside the model;
- never replace the target or commands after confirmation;
- dispatch execution at most once and never retry an uncertain mutation;
- report any partial or uncertain outcome honestly.

## Current State

The exact confirmed plan `plan-bt-rtx-004-final-2`, digest
`f52a18ff4fef1914941995fc8fa32a2e2b4c53d6a86abcbd7f252dfa268ac325`, was
consumed once. Bitwig accepted authentication and materialized tempo 132 BPM,
track name `Electronic Loop`, a four-beat clip, and four C4 notes at steps 2,
6, 10, and 14.

The adapter's immediate readback observed only two notes and correctly stored
a terminal `partial` report. A later independent read-only reconciliation saw
all four exact notes. No mutation was retried. The adapter now polls readback
for at most two seconds after dispatch so delayed controller observers can
converge; this corrective behavior is deterministically tested but was not
validated through a second live write.

## Verification

- live Gateway preview and exact confirmation: passed;
- one authenticated live execution: consumed once;
- durable execution report: `partial`, note readback mismatch;
- later read-only reconciliation: exact four-note state present;
- focused Bitwig adapter build/test: passed;
- `pnpm test`: 192 passed, 0 failed;
- `pnpm typecheck`: passed;
- controller syntax and `git diff --check`: passed;
- no second live write or mutation retry occurred.

All local commands ran on Node 26.4.0 with the known unsupported-engine warning;
the supported Node range remains unchanged.

## Human Gates

- The user explicitly supplied `Orbit Ready BT-RTX-004` on 2026-08-27.
- The user approved the musical preview and securely provisioned the bridge
  secret without exposing it in the conversation.
- The user supplied the exact final plan ID and digest confirmation before the
  one live execution.
- The user explicitly authorized commit and push on 2026-08-27.
- No PR creation, merge, deployment, branch deletion, or second live write was
  authorized or performed.

## Exit Condition

The loop is complete through its honest partial branch: one exact plan was
confirmed and dispatched once, its immediate mismatch was stored durably, and
read-only reconciliation established the eventual real Bitwig state without
retrying any mutation.

## Next Activation Signal

A future disposable-slot write may validate the new bounded readback polling,
but requires a new Orbit Ready item and a new exact confirmation. BT-213 can now
be reconciled against the existing NanoDAW execution evidence and this Bitwig
execution evidence before deciding whether BT-214 packaging is ready.
