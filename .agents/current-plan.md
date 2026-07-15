# Current Beat Twin Orbit

## Loop

BT-211 — complete. Explicit connected Agent mode now composes the BT-210
browser proxy with the existing guarded Gateway plan flow.

## Target Outcome

Let a player opt into a local Agent connection, inspect a proposal, and confirm
one fixed NanoDAW plan without weakening standalone editing or creating another
owner of browser song state.

## Product Contract

- Agent mode starts Off and never connects automatically.
- Pairing accepts only a loopback Gateway origin and clears the visible secret.
- Gemma can inspect and propose; it cannot confirm or execute.
- A preview causes no browser mutation or autosave.
- One confirmation dispatches one CAS command batch.
- A successful batch creates one revision, autosave, and undo checkpoint.
- A post-confirmation error retires the plan and is never offered for retry.

## Validation

- Playground typecheck passed.
- NanoDAW tests passed 39/39.
- Desktop and 390 px mobile headless-Chrome renders passed without clipping.
- Full repository validation is recorded in the BT-211 feature report.

## Evidence Boundary

- Browser UI and transport behavior use deterministic Gateway/session fixtures.
- No live S25 model, Gateway daemon, Bitwig process, or MCP server was started.
- BT-212 still owns authenticated bounded Bitwig execution and live readback.

## Exit Condition

- Met on 2026-07-15: standalone remains the default, proposal and confirmation
  are distinct, and the browser remains the sole NanoDAW state owner.
- BT-212 is Ready; BT-213 stays Blocked on its Bitwig adapter dependency.
