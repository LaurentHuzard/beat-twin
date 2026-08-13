# BT-UX-001 — NanoDAW First-Run Progressive Disclosure

Date: 2026-08-12
Branch: `agent/bt-ux-001-first-run`
Base: `origin/main` at `3d1448d`
State: PR #55 merged at `9944ff8`; focus-recovery follow-up PR #56 merged at `2a59406`

## Product Outcome

An empty NanoDAW now opens on one centered, local-first decision surface. The
musician can Create Demo, Add Track, load an existing browser-local song, or
explicitly reveal advanced tools. Live, step-editor, Agent, timeline,
inspector, command, and storage surfaces appear only after a song exists or the
musician asks for them.

## Generic Contract

Progressive disclosure is derived from the canonical song plus one ephemeral
presentation choice. It does not create a second document owner, mutate a
song, connect an external runtime, or silently change an execution policy.

The primary first-run actions have 48-pixel targets, the advanced escape hatch
has a 44-pixel target, and keyboard focus receives a visible high-contrast ring.

## Project-Specific Boundary

The browser remains NanoDAW's only song owner. Standalone mode is still useful
without Bitwig, Gateway, MCP, or S25. Existing command, live, Agent, storage,
undo, and audio paths are unchanged and return after an explicit user action.

## Changes

- added the focused first-run rendering and responsive layout in `App.tsx` and
  `styles.css`;
- latched explicit entry actions so undoing the initial song keeps history and
  advanced controls reachable;
- blocked the command-palette shortcut before entry and exposed the unavailable
  Load reason as visible, described text in a labelled action group;
- covered empty, explicit-reveal, and song-created behavior in component tests;
- added the first repository-owned Playwright smoke for desktop and 390-pixel
  mobile viewports;
- isolated Playwright specs from Vitest discovery and added a dedicated CI job;
- documented the new E2E command and Chromium bootstrap in `README.md`.

## Verification

- `corepack pnpm nanodaw:test`: 15 test files passed, 143 tests passed;
- `corepack pnpm --filter @beat-twin/playground build`: passed, 2,568 modules;
- `corepack pnpm --filter @beat-twin/playground test:e2e`: 4 passed across
  desktop Chromium 1440 x 900 and mobile Chromium 390 x 844;
- regular Playwright CLI page identity: `Beat Twin Playground` at
  `http://127.0.0.1:5521/`;
- initial DOM contained the meaningful first-run heading and exactly the three
  product entry actions plus the explicit advanced reveal;
- Create Demo revealed the populated full workspace; Show advanced tools
  revealed the empty full workspace without creating a song;
- Create Demo, Undo to an empty song, and Redo completed in both E2E viewports
  without returning to or trapping the user in first run;
- Ctrl/Cmd+K stayed closed on first run and opened after explicit reveal;
- browser console: 0 errors, 0 warnings;
- mobile document width: 390 pixels at a 390-pixel viewport;
- `git diff --check`: passed.

Screenshots were kept outside the repository under
`/tmp/lolos-ui-audit/beat_twin_btux/`.

## Adversarial Review

- no second copy of `Song` or derived persistent state was introduced;
- hidden surfaces are not mounted on first run, avoiding implicit Agent/live
  setup; the command palette shortcut is gated by the same disclosure boundary;
- Load is visibly disabled when no browser-local save exists, and the reason is
  visible plus associated through `aria-describedby`;
- the first-run action container has an explicit labelled group role;
- a first E2E run correctly failed because the matching Chromium binary was
  absent; Chromium 151 for Playwright 1.62.1 was installed and the unchanged
  tests then passed;
- Vitest initially discovered the new Playwright spec; `vite.config.ts` now
  scopes Vitest to `src/**/*.test.{ts,tsx}`, after which both suites pass;
- Node 26.4.0 emitted the expected repository engine warning because the
  supported range is Node 22 or 24; no build or test failed from it.

## Evidence Boundary

No Bitwig, Gateway, MCP, S25, external DAW write, browser audio listening,
deployment, push, PR, or merge was attempted. Browser rendering, DOM state,
interaction, console health, and deterministic tests are proven; subjective
musical quality and external runtime behavior are not.

## Git

The implementation was committed as `6aa021d`, passed exact-head CI, and
squash-merged as PR #55 at `9944ff8`. No deployment, remote branch deletion, or
cleanup of other Beat Twin worktrees occurred.

## Remaining Risks

- the E2E job adds a Chromium download to CI;
- Safari and Firefox rendering remain untested;
- the full post-entry workspace remains intentionally dense and belongs to
  later progressive-disclosure slices.

## Next Activation Signal

Choose one bounded post-entry density problem before placing another item under
Orbit Ready.
