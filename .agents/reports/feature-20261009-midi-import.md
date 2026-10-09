# BT-MIDI-IMPORT-001 — Local inspectable MIDI handoff

Base: 1775b363531a5ea5c2cf16470eac3a9e6230d464, fresh fetch repeated before
candidate commit without drift. Branch feat/midi-import-20261009-v2 in dedicated
lolOS/.worktrees/beat-twin-midi-import-20261009-v2. Prior export PR110 is integrated;
open PR89 Duo remains untouched. User authorized reviewed publication; no merge,
deployment, provider/device call or real-media processing under this mission.

Delivered: Settings local file → immutable preview → expandable note tables →
explicit Add MIDI tracks or Discard. SMF Type0/1 PPQ constant tempo only. New tracks
append through a revision-bound atomic batch; current song and tempo retained.
Missing song created with source tempo. One revision/undo/autosave attempt. Undo
and redo tested. Stale preview fails and offers reselection. Preview/drop do not
mutate or save musical state. Names/notes are treated as data.

A pinned MIT midi-file1.2.4 parser with bundled types and no runtime dependencies
handles MIDI interpretation. Strict framing/count checks run before it, musical
pairing/count/timing checks after it. One dependency and eight lockfile lines;
existing Tone peer was restored through full frozen offline install after the
initial filtered add. Browser bundle/build confirms compatibility. Unsupported
sustain/controllers/pitch/pressure/SysEx, tempo changes and ambiguous notes fail
explicitly; benign program/metadata omissions are disclosed. See import guide.

Validation:
- packages build passed;
- full NanoDAW suite: 23 files / 200 tests passed;
- final note-inspection UI delta: component tests 2/2 passed;
- final production TypeScript/Vite build passed;
- independent handwritten SMF bytes exercise Type0, running status, PPQ, channels,
  note data, omission warning; export roundtrip exercises Type1/tempo/absolute
  placement/UTF8 without parser-generated source fixtures;
- invalid framing/VLQ/chunks/trailing bytes, Type2/SMPTE, counts, excessive notes,
  malformed bounded synthetic input, controllers/tempo/unpaired/overlap rejected;
- store verifies one revision/undo/save, current tempo/identity/tracks preserved,
  undo/redo, absent song source tempo and stale acceptance with zero writes;
- UI verifies read-only preview/drop, stale disable, malformed recovery;
- Chrome Playwright: 2/2 passed, local file preview/discard, keyboard note-table
  review, Add, focus restoration and Undo; source120 vs current124 BPM visible;
- screenshots inspected at390×844 /768×1024 /1440×900, expanded note table fits;
  control labels and focus visible; reduced-motion mode exercised; no new motion;
- browser page errors: none. Terminal color/Node localStorage warnings are runners;
- git diff --check passed.

Audio Instruments identity retained, existing settings primitives/tokens reused;
small note table uses semantic border/focus tokens. A focused axe-core 4.11.1 scan
reused the installed Callistocto dependency from a temporary script: zero violations
and zero incomplete checks, 16 passes at each of the three viewports. No package
or cross-repository runtime coupling was added. These checks are scoped to the
expanded MIDI panel, not a complete app audit or WCAG qualification. No live DAW,
listening or real media accepted. No claim that all MIDI files are supported.
Screenshots/logs remain in /tmp, not versioned. Canonical stays clean main@base.

Independent review identified a PPQ3 floating-point boundary failure (note from
 tick7 to tick20). Clip bounds now include actual computed start+duration endpoints,
without changing note values. Regression checks preview→command batch→accept/undo;
focused parser/store suite 9/9 passed after correction. Final build passed;
Chrome2/2 passed again with chooser/summary target heights>=44px asserted. Framing
review found no further issue. Await final exact-head delta review before draft PR.
