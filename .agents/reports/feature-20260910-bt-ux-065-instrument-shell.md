# BT-UX-065 — NanoDAW instrument-first initial delivery

Date: 2026-09-10
Issue: https://github.com/LaurentHuzard/beat-twin/issues/65
Design: `DESIGN.md` at `7c6d6a3c5b8ec59ce906e5b184d962a801a286aa`.
Branch: `codex/issue-65-instrument-first`.
Worktree: `/home/lolo/Workspace/lolOS/.worktrees/beat-twin-issue-65`.

## Outcome and scope

Initial shell / skin / matrix delivery on the existing two-track, two-scene
runtime. The user activated issue #65 and parallel Armada work. This report does
not mark the ten-phase issue complete.

JAM is the default workspace after creating or opening a local song. EDIT owns
step/numeric editing and clip audition; its timeline is a disclosure. TWIN is a
contextual drawer that retains its session/proposal when closed. Command logs,
raw JSON, MCP plan IDs and technical plan detail require Developer Mode.
Settings retains local song operations and optional Bitwig access. Save Jam
persists the song and reports its status in the normal shell.

Launcher tracks form columns, scenes form rows, and each row's launch button
sits beside its pads. Real MIDI notes supply pattern silhouettes. Queued,
playing, stop-queued, recording and overdub have icons, colour and accessible
names. The theme uses DESIGN.md's nocturnal tokens and visible keyboard focus.
The 2x2 JAM fits 1440x900 without page scrolling; phone keeps both tracks in
spatial columns, with vertical scrolling for the lower controls.

## Invariants and review fixes

- Browser-owned song and ephemeral performance state stay separate.
- Quantized launch/stop engine, command contracts and audio ownership are reused.
- Live performance and editor audition remain mutually exclusive.
- Closing TWIN does not discard a pending proposal or create execution authority.
- Musical proposal descriptions derive from executable commands, including an
  explicit song-replacement warning; one-shot exact-plan confirmation remains.
- Hidden recording keyboard input is disabled; held keyboard notes are released
  while the take and optional MIDI connection retain independent lifetimes.
- Review fixed an empty-pad target mismatch: an explicit slot request now opens
  new recording, cannot retarget an active take, and preserves the original clip.
  A palette audition now opens EDIT before audio starts, keeping Stop visible.
  Dedicated integration tests cover both regressions.
- No external provider, live Bitwig, real MIDI device or publication was used.

## Verification

Supported runtime: locally installed Node 24.11.0, pnpm 11.10.0.

- `pnpm test`: 198 passed, zero failed. Earlier sandbox/Node26 attempt could not
  run socket-based fixtures; the supported Node24 run with localhost sockets passed.
- `pnpm typecheck`: passed.
- `pnpm --filter @beat-twin/playground build`: passed.
- `pnpm nanodaw:test`: **159 passed**, 17 files, zero failed (final complete run).
  Includes hidden recorder, empty-slot targeting, protected active takes and
  palette audition visibility regressions.
- Existing Playwright E2E: 10 passed across 1440x900 and 390x844. A temporary
  config uses the already installed Chromium executable and outputs to /tmp;
  the repository's pinned headless browser was absent. No dependencies changed.
- `git diff --check`: passed.

Browser plugin discovery returned `No browser is available`. Playwright CLI
with an isolated profile exercised the real local Vite app on
`http://127.0.0.1:5523/`. Page title is NanoDAW, page is nonblank, no framework
error overlay. E2E asserts absence of relevant console errors/warnings. An old
HMR dependency-list warning during edits disappeared on clean page load.

Manual automated browser path: open demo -> Play -> drums -> bass -> queue
variation -> change scene -> queue selected-loop overdub -> press on-screen MIDI
pad -> observe Undo last take enabled -> stop -> Save Jam -> reload -> Open Jam.
This proves browser state/audio scheduling and synthetic MIDI capture. It does
not prove human listening quality or physical MIDI input.

## Visual review

Authoritative spec: DESIGN.md. Generated concept is a supporting reference:
`/home/lolo/.codex/generated_images/01a08a4d-84d8-72b2-9275-1ddbe65dfd67/exec-d15bb62e-d330-48cd-99da-1f5e8e4d779a.png`.

Compared the reference and browser renders using view_image. Checked native
1586x992, laptop 1440x900 and phone 390x844. Final screenshot evidence remains
outside Git under `/tmp/bt65-native-final.png`, `/tmp/bt65-jam-final.png`,
`/tmp/bt65-mobile-final.png`, `/tmp/bt65-edit.png`, `/tmp/bt65-twin.png` and
`/tmp/bt65-record.png`.

| Comparison | Evidence and resolution |
| --- | --- |
| Hierarchy | One transport and matrix in JAM; EDIT/TWIN/developer content is disclosed separately. |
| Palette | Computed root background rgb(16,19,18), matching #101312; raised #171C1A and secondary #202622 tokens. |
| Track identity | Amber drums / cyan bass; actual song names and MIDI silhouettes replace the concept's invented names/art. |
| Typography | Strong clip names, tabular timing; fixed dark inspector/step text and low-contrast note chips. |
| Matrix | Two columns/two rows, row-attached scene buttons; no duplicate scene column or fabricated 4x4 capacity. |
| Controls | Native semantic buttons/ranges and Lucide status glyphs; explicit edit controls and reduced-motion rules. |
| Laptop fit | 1440x900 scrollWidth=1440 and scrollHeight=900; recorder disclosure remains in view. |
| Phone | Removed header overlap and accidental Save Jam wrap; preserved scene relationships and visible focus. |
| Copy | Above-fold has transport, existing song/clip names, navigation and save status; removed invented launcher slogans. |

Intentional differences from the generated mockup follow actual runtime
capabilities and DESIGN.md: real MIDI silhouettes, horizontal faders (permitted
by DESIGN.md), one scene control per row, Save Jam instead of non-existent
performance capture, disabled/unavailable mix and macros. This is faithful to
the bounded shell/matrix direction, not a claim of end-state visual or musical
acceptance for the whole issue.

## Explicit remaining issue work

1. Mixer and Tone/Space/Echo/Repeat values exist in performance state but are not
   wired to the live audio graph. Their visible controls are disabled and labelled
   coming next; do not claim audible macro operation.
2. Capture Jam has no existing implementation. Save Jam serializes the song;
   it does not capture a performance timeline or audio.
3. Runtime stays 2x2. Four-track/four-scene expansion is a separate delivery.
4. Start Jam creates the sketch; Play starts the clock, then a pad or scene
   produces material. Immediate first-gesture sound is not yet delivered.
5. TWIN proposal audition, put-in-slot/variation flows are not implemented here.
   Connection settings and one-shot confirmation remain reachable.
6. Further tactile macro primitives, touch context actions and the complete
   canonical human listening acceptance flow remain pending.

At initial implementation handoff, no commit or publication had been performed.
The user subsequently authorized commit and merge on 2026-09-10. Issue #65 stays
open; deployment and branch deletion are outside this authorization.
The original dirty root and beat-twin checkouts were preserved.

## Handoff

Initial bounded delivery is verified locally. Final UI suite: 159 passed; general
offline suite: 198 passed; browser E2E: 10 passed. Final frontend production build
(including TypeScript) and diff check pass. Issue #65 stays open for the explicitly
listed follow-ups. Preview server remains on 127.0.0.1:5523.
