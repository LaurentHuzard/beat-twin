# BT-MIDI-IMPORT-001 — Inspect and accept a local MIDI sketch

User Armada mandate authorizes bounded parallel killer features and reviewed PRs.
Fresh base: 1775b363531a5ea5c2cf16470eac3a9e6230d464; branch
feat/midi-import-20261009-v2, dedicated task worktree. Parent approved contract.

SMF Type 0/1 with PPQ and constant tempo, parsed with pinned MIT midi-file library
behind bounded byte framing and event validation. File <=1MiB, <=64 source tracks,
<=20000 events, <=4096 notes. Explicitly reject malformed/truncated bytes, SMPTE,
Type2, changed tempo, sustain, pitch/modulation controls and ambiguous notes.
Preview source notes/tracks/tempo and benign omissions; no musical mutation.
Explicit Add MIDI tracks appends through one revision-bound atomic command batch,
one undo checkpoint and autosave. Current song and tempo retained; missing song
created at source tempo. Stale previews fail; discard is read-only.

Acceptance: independent handcrafted bytes + export roundtrip, format/invalid/bound
checks; store preview/drop/drift/atomic acceptance/undo; browser keyboard import,
accept and undo at mobile/desktop, screenshot tablet. Fixtures only. No live DAW,
provider/media processing, merge or deployment. Parent exact-SHA review before PR.

## Result

Implementation,200NanoDAW tests,finalbuild and2Chrome keyboard/reduced-motion
flows passed. See feature-20261009-midi-import.md report. Await independent
exact-SHA review before draft PR; no merge/live qualification.
