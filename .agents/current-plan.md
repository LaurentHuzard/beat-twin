# Active Beat Twin Orbit

## Loop

No item is Orbit Ready. BT-UX-002 completed implementation, independent review,
exact-head CI, and squash merge as PR #58 at `a3dba85` on 2026-08-14.

## Target Outcome

After entering the full NanoDAW workspace, a musician can voluntarily reveal a
compact keyboard reference, close it with Escape, and switch the Inspector to a
denser presentation without interrupting preview or live audio state. The calm
first run remains unchanged and shows no help overlay.

## Planned Changes

- add one visible Shortcuts action only inside the advanced transport;
- expose the existing local shortcuts in a non-modal, keyboard-dismissable guide;
- return focus to the invocation control when the guide closes;
- add a presentation-only Compact control to the Inspector;
- preserve BT-UX-001, Undo/Redo, recording-key ownership, and all audio/external boundaries;
- cover voluntary invocation, Escape dismissal, first-run absence, density changes,
  and unchanged preview playback with focused and browser tests.

## Product Contract

- The browser remains the only owner of NanoDAW song state.
- Help visibility and Inspector density are ephemeral React presentation state.
- Neither control may start, stop, replace, save, load, or mutate musical state.
- Standalone NanoDAW remains useful with no Bitwig, Gateway, MCP, or S25.
- Bitwig writes remain hidden and blocked by default.
- The first-run surface remains the BT-UX-001 decision surface with no automatic
  help, coach mark, dialog, or overlay.

## Verification Plan

- focused NanoDAW component tests;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- Playwright desktop and 390px mobile help, focus, density, and first-run proof;
- screenshot inspection and console checks;
- `git diff --check`;
- adversarial review for shortcut conflicts, inaccessible dismissal, accidental
  audio interruption, duplicate song ownership, and external activation.

## Current State

BT-UX-002 is complete on `main` through PR #58 (`a3dba85`). The remote commit
was published through the GitHub connector after SSH approval timed out; its Git
tree exactly matched the independently reviewed local commit.

## Human Gates

- The user activated parallel frontend improvements and delegated the Orbit gate
  on 2026-08-14; BT-UX-002 is the selected Beat Twin slice.
- This is a small extension of the current visual system, not a redesign,
  framework migration, or audio-engine change.
- No live Bitwig write, Gateway/MCP/S25 connection, deployment, or branch
  deletion is part of this delegated implementation.

## Exit Condition

Met locally. The help is absent on first run, voluntary after entry, dismissable
with Escape with focus recovery, and useful on desktop/mobile. Inspector density
changes while preview remains active, with no song revision or audio stop call.
The focused tests, 145-test NanoDAW suite, build, six Playwright cases, four
inspected screenshots, console health, diff check, and adversarial review pass.

## Next Activation Signal

Orbit Ready is empty. Deployment, branch deletion, and any successor Orbit
remain separate gates.
