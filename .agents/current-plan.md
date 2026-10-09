# BT-MIDI-084 — Local deterministic MIDI export

User authorized the Armada to choose useful product work and publish reviewed PRs.
Fresh origin/main base: 802e4a400d4018e44dea39d08920125d4d2441ae.
Dedicated worktree: beat-twin-midi-export-20261009; branch feat/midi-export-20261009.

One bounded outcome: download the browser-owned Song as SMF Type 1 without
changing revisions, undo, autosave or audio playback. Pure validated core API;
480 ticks per quarter note; tempo, absolute clip/note placement and names;
empty instrument tracks included; noninstrument tracks omitted. Explicit MIDI
channel/timing limits fail rather than silently collide. No external device,
provider, sound-bank mapping or network is needed.

Acceptance: structured MIDI parser checks header, tempo, tracks, positions,
velocities, durations and deterministic bytes. Invalid inputs and unsupported
limits fail. Store/UI checks prove local download and readonly musical state.
Build and focused/full playground tests plus browser keyboard/responsive checks.
Independent review at exact commit before authorized publication. No merge,
deployment, live DAW, media processing or provider calls authorized by this plan.

PR89 Duo spike is separate: scripts/duo*, scenarios and spike tests. Governance
files and README overlap only editorially; do not resume or alter that experiment.

## Result

Implementation and offline/browser checks passed. See
`.agents/reports/feature-20261009-midi-export.md`. Await exact candidate review
before authorized PR publication; no merge or live acceptance.
