# BT-MIDI-084 — Local MIDI export

Base: 802e4a400d4018e44dea39d08920125d4d2441ae, fetched again before candidate
commit with no base drift. Worktree: lolOS/.worktrees/beat-twin-midi-export-20261009;
branch feat/midi-export-20261009. User Armada mandate authorizes bounded feature
selection and reviewed PR publication, never merge, deployment or live DAW work.

Delivered: Settings → Export MIDI downloads browser-owned Song through the pure
validated core SMF Type 1 API. 480 PPQ, conductor tempo, instrument tracks and
absolute notes, explicit channel/resolution/overlap failures; no song-state,
autosave, undo, playback or JSON draft change. Documentation explains omissions
and percussion mapping limits. All source songs in checks were generated fixtures.

Checks:
- core test files, including independent structural MIDI decoder: passed;
- build:packages: passed;
- full pnpm test offline suite: 514 passed (no live acceptance);
- Playground: 20 files, 190 tests passed;
- Playground production TypeScript/Vite build: passed;
- Playwright export flow: 2 passed with installed Chrome, local MIDI download,
  keyboard activation/focus preservation and unchanged localStorage;
- screenshots inspected at 390×844, 768×1024 and 1440×900: control and result
  visible, native style/focus retained, no added clipping;
- runtime page errors: none during export flow;
- git diff --check: passed.

Repository Playwright used for browser validation. Default bundled Chromium
revision was absent; installed Google Chrome worked via PLAYWRIGHT_CHANNEL=chrome. Node localStorage and terminal color
warnings are runner warnings, not browser errors. No new dependency/framework.
Private screenshots and raw logs stay under /tmp, outside versioned artifacts.

Adversarial review: input is normalized through Song validation before encoding.
No paths, secrets, providers or device writes. Labels remain data in MIDI meta
bytes and never become filesystem paths. Download filename is fixed. No program
change/device mapping. Zero-velocity notes are omitted; same-pitch overlap fails
rather than truncating voices silently. Output is not audio/rendered DAW proof.

Next: independent parent review at exact candidate SHA, then authorized draft PR.
PR89 Duo remains separate and untouched; governance edits overlap editorially.
Canonical checkout remains clean main at the verified base. No merge performed.
