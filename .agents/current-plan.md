# Completed Beat Twin Orbit

## Loop

BT-UX-001 — add first-run progressive disclosure to NanoDAW.

## Target Outcome

On an empty first run, NanoDAW presents one calm decision surface: the centered
transport plus Create Demo, Add Track, and Load. Advanced composition, live,
agent, inspection, command, and storage tools remain available after a song
exists or after one explicit reveal.

## Planned Changes

- derive the first-run state from the browser-owned song instead of duplicating it;
- keep transport identity and the three entry actions in the first viewport;
- add an explicit Advanced tools reveal that works with keyboard and touch;
- reveal the full current workspace automatically once a song exists;
- preserve every existing command, live, agent, persistence, undo, and safety path;
- cover empty, explicit-reveal, and song-created states with focused tests.

## Product Contract

- The browser remains the only owner of NanoDAW song state.
- Progressive disclosure is presentation state only; it must not create,
  replace, save, load, or mutate a song implicitly.
- Standalone NanoDAW remains useful with no Bitwig, Gateway, MCP, or S25.
- Bitwig writes remain hidden and blocked by default.
- Existing advanced tools remain reachable, with a visible keyboard- and
  touch-operable reveal on the empty state.

## Verification Plan

- focused NanoDAW component tests;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- Playwright desktop and 390px mobile first-run interaction proof when available;
- `git diff --check`;
- adversarial review for hidden escape paths, inaccessible controls, duplicate
  song ownership, accidental external activation, and misleading live evidence.

## Current State

Implementation passed exact-head CI and squash-merged as PR #55 at `9944ff8`.
The post-merge focus-recovery follow-up also passed exact-head CI and
squash-merged as PR #56 at `2a59406`. The Orbit Ready gate is closed.

## Human Gates

- The user activated BT-UX-001 and delegated the Orbit gate on 2026-08-12.
- This is a targeted disclosure fix inside the current visual system, not a
  redesign, framework migration, or audio-engine change.
- No live Bitwig write, Gateway/MCP/S25 connection, deployment, or branch
  deletion is part of this delegated implementation.

## Exit Condition

Met. An empty first run exposes only the local runtime identity, three useful
entry actions, a visible unavailable-Load reason, and an explicit advanced
reveal. Creating material latches that user intent, so Undo can return to an
empty song without hiding Redo; Ctrl/Cmd+K stays inactive before entry. Vitest
passes 143 tests in 15 files, the production build passes, and four Playwright
checks pass on 1440 x 900 and 390 x 844. The mobile first run has no horizontal
overflow, and console QA reports no errors or warnings.

## Next Activation Signal

Keep Orbit Ready empty until the next smallest UX slice is explicitly selected.
