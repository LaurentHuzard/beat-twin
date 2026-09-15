# BT-UX-CONNECTION: TWIN gateway reconfiguration

Date: 2026-09-14. Base: 07eb274 (PR #73).
User explicitly authorized the connection-settings fix.

## User-visible flow

Open TWIN, choose **Edit connection**, change the loopback Gateway URL and
optional operator secret, then choose **Connect Gateway**. The edit button is
outside the collapsible settings so a connected or pairing user can find it.
Editing keeps Agent mode enabled, opens the settings, disconnects the old
session and suspends retries until the explicit Connect action.

Automatic connection at startup remains available. Explicit Enable Agent mode
still connects immediately, preserving the current UI/integration contract.
The new edit path works with autoConnect both true and false.

This is browser-to-Beat-Twin-gateway configuration, not gateway-to-model
configuration. Loopback validation and all backend authentication stay unchanged.
The URL stays in component memory; there is no new cross-reload persistence.
Secrets are cleared on edit, URL changes and disable and are never persisted.

## Implementation and safety review

- Invalidate the session ref before closing it, so late pairing, inbox, model
  and connection callbacks cannot revive the old UI or disconnect a new session.
- Retire previous previews, inbox entries and MCP plan IDs on session replacement.
- Track an in-flight pairing separately. The transport's initial disconnect
  callback must not unlock fields or schedule a competing retry during pairing.
- Block edit, disable and reconnect during confirmed execution, including when
  the socket drops. An uncertain result still requires a fresh human decision.
- Only stop MCP-owned audio during connection cleanup, not unrelated transport.
- Do not add confirmation, automatic execution, endpoint persistence or any
  change to NanoDAW song ownership, gateway policy, MUE routing or Bitwig writes.

## Tests authored

AgentModePanel.connection.test.tsx adds 12 cases covering both auto-connect modes,
explicit edited reconnection, slow and cancelled pairings (late success/failure),
queued retry cancellation/resumption, late proposal/inbox/callback isolation,
reviewed-plan retirement, secret isolation, execution locking and cleanup after
disable/unmount. Existing component and App integration tests are unchanged.
These are authored regression/non-regression cases, not a claim they passed.

## Evidence actually collected

- The reconstructed local source exactly matches base Git blob d2921d2 before
  editing. Source and test blobs were compared to their local Git hashes.
- TypeScript syntax/transpilation diagnostics for both TSX files: zero errors.
  This is not a project typecheck, runtime test or production build.
- git diff --check on the local source/test patch: passed.
- Static review of the session lifecycle and human-confirmation guards completed.

## Pending validation

The container has Node 22, no pnpm or project dependencies, and cannot resolve
GitHub for cloning. No full dependency install, Vitest, project typecheck, build
or browser run was possible here. Browser plugin not available; no Playwright
fallback was executed because the application dependencies are unavailable.
No page identity, console, desktop/mobile layout or screenshot claim is made.

The existing PR CI declares Node 26 checks and a NanoDAW Playwright job. Its
actual result must be checked on the PR; workflow configuration is not proof.
With the repository toolchain available, run:

```sh
pnpm --filter @beat-twin/playground test -- src/AgentModePanel.connection.test.tsx
pnpm test:playground
pnpm typecheck
pnpm build
pnpm test
pnpm check:architecture
pnpm --filter @beat-twin/playground test:e2e
git diff --check
```

For red/green evidence, run the new test file against AgentModePanel.tsx at
07eb274, then against this branch. The edit-path/overlapping-pairing regressions
should fail before and pass after; the existing suite must remain green.
Neither result has been asserted without execution.

## Human gate

Keep the PR unmerged until tests and the real browser flow are reviewed.
No deployment, runtime restart, real model call, live musical write, branch
removal or issue #72 closure was performed.
