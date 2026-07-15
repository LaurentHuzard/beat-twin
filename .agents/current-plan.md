# Current Beat Twin Orbit

## Loop

BT-212 — complete. The Bitwig controller and adapter now expose an authenticated,
target-bound, bounded launcher-slot execution path with exact readback.

## Target Outcome

Enable BT-213 to prove the same portable patch through separately previewed and
confirmed NanoDAW and Bitwig plans without conflating their mutation semantics.

## Product Contract

- Bitwig reads remain available before write authentication.
- Every Agent-mode write requires the configured bridge secret.
- Preview binds controller, project, track/scene positions, and target generation.
- One empty launcher target accepts only the `bitwig-launcher-v1` bounds.
- Clip creation is dispatched once; readiness polling is read-only.
- A success requires exact tempo, track, clip, and note readback.
- Any uncertain dispatch or readback is `partial` and never retried.

## Validation

- Root tests passed 145/145, including the historical 57-tool snapshot.
- NanoDAW tests passed 39/39.
- Repository typecheck and production build passed.
- Package smoke passed for nine packages.
- Full evidence is recorded in the BT-212 feature report.

## Evidence Boundary

- Auth, target races, clip-readiness delay, post-dispatch failure, divergent
  readback, and no-retry behavior use deterministic fixtures.
- No live Bitwig write was executed. That remains BT-213's disposable-project
  human gate, separately from NanoDAW confirmation.

## Exit Condition

- Met on 2026-07-15: authentication, strict bounds, target identity, exact note
  readback, and honest partial execution are proven deterministically.
- BT-213 is Ready and must begin with a disposable Bitwig project.
