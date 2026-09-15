# BT-UX-CONNECTION: editable TWIN gateway settings

User authorized the fix on 2026-09-14 after reviewing the regression diagnosis.
Base: 07eb274cf1da6174715d75ed98f0a1104aebf9a2 (PR #73 merged).
Branch: fix/nanodaw-gateway-connection-settings.
No other open implementation PR was returned by the repository search.

## Orbit Ready

BT-UX-CONNECTION is the sole authorized implementation item for this branch.
Restore an explicit edit-connection path without disabling local auto-connect,
changing provider configuration, or modifying any running service.

## Plan

1. Add Edit connection, keep settings visible and suspend automatic retries.
2. Disconnect and invalidate the previous session, pending proposals and secrets.
3. Reconnect explicitly using the edited values; guard overlapping pairings and
   late callbacks. Do not permit reconfiguration during confirmed execution.
4. Add component regression tests for both auto-connect modes, cancellation,
   retries, old responses, secret isolation and unchanged musical confirmation.
5. Run available offline checks and inspect GitHub CI. Record unexecuted checks
   honestly; do not claim local gateway, MUE, Bitwig or browser validation.
6. Open one PR for review. Do not merge, deploy, activate runtimes or delete branches.

## Scope and prior evidence

Only NanoDAW connection UI/lifecycle, tests and the bounded loop documentation.
Explicit Enable Agent mode keeps its current immediate-connect behavior.
Gateway URL remains a loopback origin; model/provider settings remain server-side.
No new persistence of endpoints, secrets, tokens or musical data is introduced.
The prior PR #73 integration plan and its historical live evidence remain in
this file at base commit 07eb274. Those results are not evidence for this fix.

## Validation environment

The current execution container has Node 22 but no pnpm or project dependencies.
A direct clone failed because github.com could not be resolved. Repository reads
and writes use the authorized GitHub connector. The existing PR CI defines
Node 26, frontend/backend checks and a NanoDAW Playwright job.
