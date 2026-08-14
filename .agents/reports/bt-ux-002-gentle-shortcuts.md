# BT-UX-002 — Gentle Shortcut Learning

Date: 2026-08-14
Branch: `agent/bt-ux-002-gentle-shortcuts`
Base: `origin/main` at `1c25cb5`
State: implementation and independent review complete; publication pending

## Product Outcome

NanoDAW now teaches keyboard gestures only when a musician asks. After explicit
entry into the full workspace, Shortcuts or `?` opens a compact inline guide.
Escape closes it and returns focus to the trigger. The BT-UX-001 first run stays
unchanged and never mounts an automatic coach mark, dialog, or overlay.

The Inspector also offers a visible Compact control. It changes spacing only:
song revision, preview playback, live state, persistence, and external adapters
remain untouched.

## Product And Safety Contract

- browser-owned `Song` remains the only NanoDAW document;
- help visibility and density are ephemeral React presentation state;
- command palette, Undo/Redo, note editing, and recording ownership remain intact;
- an armed recorder keeps priority over unmodified note keys;
- an already-open guide can still be dismissed with Escape;
- no Bitwig, Gateway, MCP, S25, controller, or DAW write path was changed.

## Changes

- added the advanced-transport Shortcuts trigger and non-modal inline guide;
- exposed the existing local gesture map without adding a second action path;
- supported both reported `?` key values and physical `Shift+/` layouts;
- added Escape dismissal, close-button autofocus, and trigger focus recovery;
- added the presentation-only Compact Inspector control and responsive styling;
- covered first-run absence, voluntary invocation, keyboard dismissal, focus,
  density, song revision, preview continuity, mobile layout, and console health;
- updated queue, current plan, README, status, roadmap, keyboard docs, and the
  Playground architecture boundary.

## Verification

- focused `App.test.tsx`: 31 tests passed;
- full NanoDAW Vitest suite: 15 files and 145 tests passed;
- Playground TypeScript build and Vite production build passed; 2,568 modules;
- Playwright: 6 tests passed across Chromium 1440 x 900 and 390 x 844;
- page identity: `Beat Twin Playground` at `http://127.0.0.1:5522/`;
- first run contained meaningful local-first content and no Shortcuts trigger or
  shortcut dialog;
- explicit Shortcuts click and `Shift+/` both opened the guide;
- Escape removed the guide and restored focus to Shortcuts;
- Escape also closed the guide after focus moved into the command draft field;
- Shortcuts and Compact measured at least 44 pixels high in both viewports;
- Compact changed Inspector `data-density` from `comfortable` to `compact`;
- active preview label remained `Auditioning Kick Ladder`, deterministic unit
  evidence recorded zero audio `stop()` calls, and song revision stayed fixed;
- desktop and mobile documents had no horizontal overflow;
- browser console: zero errors and zero warnings;
- four screenshots were captured outside the repository and inspected at
  original detail:
  `/tmp/bt-ux-002-help-reviewed-desktop-chromium.png`,
  `/tmp/bt-ux-002-help-reviewed-mobile-chromium.png`,
  `/tmp/bt-ux-002-compact-reviewed-desktop-chromium.png`, and
  `/tmp/bt-ux-002-compact-reviewed-mobile-chromium.png`;
- visual mismatch ledger: no clipping, overlap, unreadable text, scroll trap,
  framework overlay, or mobile horizontal overflow observed;
- `git diff --check`: passed.

The Browser plugin was not available in the session, so repository Playwright
was used as the declared fallback. The first package-manager attempt hit the
known `unable to open database file` pnpm store failure; repository-local
Vitest, TypeScript, Vite, and Playwright binaries then ran the unchanged checks.
Node 26.4.0 is outside the declared Node 22/24 range and emitted the expected
engine warning without changing results.

## Adversarial Review

- the guide is inline and non-modal, so it does not cover or disable the studio;
- it is not mounted on first run and cannot be triggered there by `?`;
- opening one learning surface closes the command palette to avoid stacked UI;
- help cannot create or mutate a song and the density control receives no store
  action, audio function, or adapter callback;
- density hides no Inspector control and remains usable at 390 pixels;
- recording-key ownership is checked before `?` invocation, while Escape close
  remains available before that guard;
- the worktree contains no new dependency or generated committed artifact.

## Evidence Boundary

Rendered structure, browser interaction, focus, responsive behavior, console
health, deterministic preview continuity, and local builds/tests are proven.
No physical audio output, listening quality, MIDI device, Bitwig, Gateway, MCP,
S25, deployment, push, PR, merge, or remote branch deletion was attempted.

## Remaining Risks

- Safari and Firefox rendering remain untested;
- the compact preference is intentionally session-local rather than persisted;
- device audio continuity still needs a separate human listening gate if desired.

## Next Gate

Independent review approved the corrected diff. The root operator may commit,
publish, open the single implementation PR, wait for exact-head CI, and merge.
Deployment and branch deletion remain separate.
