# BT-DEMO-MAIN-001 — demonstration refreshed on main

User request, 2026-09-10: use current main and the new NanoDAW design for the demo.

## Git result

- Fetched `origin` successfully. Fresh base and initial clean worktree HEAD:
  `dd6164352da3916045c28563015114e1b7273d28`, PR #66 instrument-first JAM workspace.
- Branch `demo/main-nanodaw-mue`, worktree
  `/home/lolo/Workspace/lolOS/.worktrees/beat-twin-demo-main`.
- Previous demo checkout: `orbit/orbit-domain-routing`, `097bb9e`, with four
  modified files. `git cherry origin/main HEAD` marks its sole commit equivalent
  to a patch already on main. No unique committed demo feature required replay.
- Transplanted only the existing README and three gateway authentication edits
  onto the clean fresh main base. Patch applied without conflict. The original
  branch, HEAD, worktree and four uncommitted files remain unchanged.
- No literal rebase of the dirty original checkout, stash, reset, commit, push,
  branch deletion or merge. This new demo branch uses main plus the preserved
  uncommitted MUE authentication patch.

## Runtime and validation

- The existing demo UI service now serves this worktree on
  `http://127.0.0.1:5174`; title `NanoDAW`, JAM / EDIT / TWIN visible.
- Root demo `services.ts` and `start-beat-preview.ts` point at this worktree for
  both UI and gateway; manual restart retains the new base.
- Dependencies installed with `pnpm install --offline --frozen-lockfile`:
  256 reused, zero downloaded, lockfile unchanged.
- `pnpm test:unit`: 189 passed. `pnpm --filter @beat-twin/playground test`:
  159 passed. Playground TypeScript / production build passed.
- Ten existing browser E2E tests passed on desktop 1440x900 and mobile 390x844,
  using installed Chrome via a temporary `/tmp/beat-main-playwright.config.ts`.
  The original invocation could not find the pinned Chromium headless shell;
  no browser was downloaded and no project test configuration was changed.
- Actual demo browser: 1440x960, meaningful page, no framework overlay, zero
  console errors or warnings. In-app Browser discovery returned no sessions;
  the existing Playwright recording workflow was reused.
- Flow: Start Jam -> JAM -> EDIT -> JAM -> TWIN -> local gateway pairing ->
  Generate preview. HTTP 201, `qwen`, run
  `request-63a70048-5f0c-49bc-acac-6165c2b2bb88`, one `propose_song_patch` call.
  Proposal: 110 BPM, Lead Sketch track, Restrained Lead clip, four notes.
  UI explicitly states the jam has not changed. No confirm/apply call made.
- Existing MUE key inherited in memory; operator pairing via private FIFO with
  secret output suppressed. Bitwig explicitly disconnected. No benchmark run.
- Node 26.4.0 was used, outside the package's declared Node 22/24 engines; all
  reported checks passed with engine/experimental warnings noted.
- `git diff --check` passed. Adversarial review: gateway patch only forwards the
  existing API key to the provider, does not expose it to the browser, does not
  alter allowlists or confirmation gates, and adds no execution capability.

## Visible follow-up

The new TWIN preview has a layout overflow: at 1440px viewport, preview panel
width 550px vs scrollWidth 566px, and the right-side generation/confirmation
controls appear clipped. JAM renders correctly. Record as `BT-UX-TWIN-OVERFLOW`:
stack the preview and actions inside the narrow drawer and add a real-preview
desktop/mobile regression check. This pre-existing main UI issue was not edited
as part of synchronizing the demo branch.

Local screenshots: `/tmp/nanodaw-main-jam.png`, `/tmp/nanodaw-main-twin.png`.
Updated recording is linked by the existing local demo recording page.
