# Feature Report - Runtime Mode And Bitwig Health

Date: 2026-07-15
Branch: `dev/nanodaw-standalone`
Tickets: BT-205, BT-206, BT-207
Outcome: Passed locally; no push

## Product Outcome

- A fresh NanoDAW load now says `Standalone`, `NanoDAW ready`, and identifies
  Bitwig and S25 as optional and not enabled.
- The read-only smoke reports layered dependency health instead of collapsing
  process, controller TCP, controller protocol, MCP, and write policy into one
  connection claim.

## Evidence Boundary

- No Bitwig, MCP, gateway, or S25 process was started.
- The local machine currently proves `process_not_running`; ready states are
  fixture-tested and require a distinct injected MCP probe.
- Browser screenshots prove layout and text, while the existing rendered tests
  prove the interaction contract. Playwright CLI was unavailable and its
  temporary download was rejected by the execution environment.

## Changes

- `apps/playground/src/App.tsx`, `App.test.tsx`, and `styles.css`: explicit,
  presentation-only standalone runtime status.
- `scripts/read-only-smoke.js`: Linux process detection and layered schema v1
  health contract with additive legacy fields.
- `tests/read-only-smoke.test.js` and `package.json`: deterministic fixtures in
  the root test gates.

## Verification

- `pnpm test`: 128/128 passed outside the socket-restricted sandbox.
- `pnpm typecheck`: passed.
- `pnpm nanodaw:test`: 35/35 passed.
- `pnpm smoke:packages`: eight packages passed.
- `git diff --check`: passed.
- Real read-only smoke: `process_not_running`, exit 2, with a manual next action.
- Chrome headless screenshots: 1440x1000 and 390x844, stored under `/tmp`.
- Runtime: Node 26.4.0 and pnpm 11.10.0; Node remains outside the declared
  supported 22/24 matrix and emits the known engine warning.

## Adversarial Review

- `inspectBitwigSession` is treated only as controller-protocol evidence, never
  as MCP availability.
- MCP readiness requires a distinct probe and is unavailable by default.
- Unsupported platforms, permission failures, and malformed process tables
  resolve to `unknown`, never a false negative.
- The historical 57-tool registry and write-policy gates remain unchanged.
- The UI adds no connection effect, gateway import, or second `Song` owner.

## Git

- Worktree: `beat-twin-nanodaw-standalone` on `dev/nanodaw-standalone`.
- Gateway checkout was not modified.
- No commit, push, PR, branch deletion, or Bitwig write occurred.

## Remaining Risks

- Live controller and MCP readiness remain unverified while Bitwig is off.
- Playwright console and scripted-browser interaction evidence was not refreshed
  because the CLI was not locally available; component interaction tests passed.

## Next Activation Signal

BT-208 becomes actionable only with TwinPilot TP-202 context and an explicit
cross-project integration decision. Q2-L remains the separate human listening
gate in `.agents/current-plan.md`.
