# BT-RTX-004 — First Confirmed Bitwig Write and Reconciliation

Date: 2026-08-27
Branch: `agent/bt-rtx-004-first-bitwig-write`
Base: merged `main` at `d840644`
State: complete and validated; commit and push authorized separately by the user

## Product Outcome

Beat Twin completed its first human-confirmed, authenticated write against one
disposable human-selected Bitwig launcher slot. The exact immutable plan was
consumed once. The immediate execution report failed closed as `partial` when
note observers lagged, and a later read-only inspection reconciled the complete
expected state without retrying any mutation.

## Confirmed Target and Plan

- disposable project, with its local name omitted from this public report;
- track position 0, initially named `Inst 1`;
- scene slot 0, initially empty;
- controller instance matched throughout the plan, with its local identifier
  omitted from this public report;
- target generation 8;
- plan `plan-bt-rtx-004-final-2`;
- request `request-bt-rtx-004-final-1`;
- base revision 0;
- digest `f52a18ff4fef1914941995fc8fa32a2e2b4c53d6a86abcbd7f252dfa268ac325`.

The user supplied the exact plan ID and digest before execution.

## Materialized Write

The adapter dispatched exactly once:

1. tempo 132 BPM;
2. target track name `Electronic Loop`;
3. one four-beat launcher clip;
4. C4 at step 2, velocity 100, duration 0.5 beat;
5. C4 at step 6, velocity 100, duration 0.5 beat;
6. C4 at step 10, velocity 100, duration 0.5 beat;
7. C4 at step 14, velocity 100, duration 0.5 beat.

Authentication was per connection. The secret came from a user-owned mode 600
temporary file and its value was never printed, logged, committed, or sent to
the model.

## Execution and Readback Evidence

The Gateway returned HTTP 200 with a stored adapter report:

- `ok: false`;
- `status: partial`;
- error `Bitwig note readback does not match the confirmed plan`;
- immediate readback: correct tempo, name, clip length, and notes at steps 2 and
  6 only.

No retry followed. A new unauthenticated read-only connection then observed:

- tempo 132 BPM;
- track `Electronic Loop`;
- clip exists with length 4;
- exact notes at steps 2, 6, 10, and 14 with pitch 60, velocity 100, and
  duration 0.5 beat.

The stored partial report remains immutable and is not rewritten as success.

## Minimal Corrective Change

The adapter previously performed one immediate final readback. It now polls
only `target.inspect` for at most 80 attempts separated by 25 ms after all
mutations were dispatched. Target identity replacement still fails immediately.
The polling never authenticates again and never repeats a mutation.

The change has deterministic coverage showing delayed note observers converge
while the number of mutation calls remains unchanged. It has not been validated
with a second live write.

## Verification

- focused Bitwig adapter build/test: passed;
- `pnpm test`: 192 passed, 0 failed;
- `pnpm typecheck`: passed;
- controller syntax check: passed;
- `git diff --check`: passed;
- live preview: passed;
- one exact live confirmation and execution: performed once;
- independent live read-only reconciliation: exact expected state;
- second live write: not performed.

Node 26.4.0 emitted the known unsupported-engine warning. The Node 22/24
contract was not changed.

## Adversarial Review

- model tools remained read/propose-only;
- plan ID, digest, binding, revision, scope, and expiry were fixed before
  confirmation;
- authentication occurred only after confirmation consumption;
- no mutation was retried after the partial report;
- the stored partial outcome was preserved despite later successful readback;
- the corrective change retries reads only and stays bounded to two seconds;
- PR creation, merge, deployment, branch deletion, and secret cleanup remain
  separate gates.
