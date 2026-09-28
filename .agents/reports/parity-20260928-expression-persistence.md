# BT-MCP-PARITY-008 — Expression evidence and project persistence

Date: 2026-09-28. Fresh confirmed base:
`f6f0a447b51759c43b05e26a8c905930241fc70b` (PR101).
User authorized continuation, parallel agents, disposable-project mutations,
audio capture, push and merge. Root alone operated the live DAW. The native
Wayland input-control permission was explicitly approved by the user.

## Delivered

- `application_list_actions`: bounded, read-only action catalogue.
- `project_save` and `project_save_as`: dedicated exact host actions behind
  `application_write`, matching observed project name and stopped transport.
- Catalogue: 190 direct tools, 43 default reads; optional discovery adds four
  wrappers. The live host exposed 782 application actions.
- Save responses report dispatch, `saved: null`, and unverified persistence.
  No arbitrary action ID or file path is accepted. Name collisions remain
  possible; the name guard is explicitly not a persistent project identity.
- API 15 retained. `Action.invoke()` supplies no completion result; dirty-state
  API 18 and native open/path selection are outside this tool contract.
- Maintained persistence documentation is included in the distribution.

## Real persistence witness — passed within measured coverage

On Bitwig 6.1.1, MIDI profile, a temporary instrument track and four-beat clip
contained three known notes. The original project file was not overwritten.

1. Wrong expected project name failed before dispatch.
2. Save As opened a native dialog; completing it created a private project copy.
3. Renaming the clip and requesting Save changed the copy's file hash.
4. A fourth note was added without saving; readback showed four notes and the
   file hash remained unchanged.
5. The project was closed, selecting No to discard the known unsaved note.
6. The saved file was reopened. An initial typed path was corrupted by GTK
   completion and failed visibly; exact clipboard entry then reopened the file.
7. The saved and reopened musical manifests had zero differences (absolute
   numeric tolerance 1e-6, exact comparison otherwise). The unsaved note was gone.
8. Post-reopen playback produced captured audio: RMS -33.0867 dBFS,
   peak -18.2245 dBFS across 48,000 frames.

Coverage: first bank of eight tracks and scenes, total track count, tempo,
clip identity/length, channel-0 64-step grid across pitches 0–127, three notes
and supported expressions, device inventory, first page of eight remote controls.
Pressure was explicitly unavailable. This does not verify the full arranger,
all banks/channels/macros, external asset collection or portable export.

The witness file was retained privately. The temporary track was removed from
the working copy, which was saved again; its file hash changed. Final live state:
11 tracks, transport and recording stopped, original selected instrument
unarmed/unmuted, injected-note tracker empty, sustain false, no cleanup error.
The first final capture contained a one-LSB residual; a later one-second capture
measured exact zero PCM on both channels. This only describes those captures.

## Incoming poly-aftertouch — unresolved, more precisely bounded

Seven real captures covered NONE, PAN_LEFT, GAIN_DOWN, PITCH_UP, cross-channel,
same-channel-1 pressure, and a two-voice MPE positive control. Offline analysis
identified 39 active windows and seven final silence windows. Pressure sent
before and during notes produced no meaningful mapped pan/gain/pitch effect.
Baseline-corrected gain difference was -0.015729 dB; maximum channel imbalance
was 3.210e-5 dB. The MPE positive control moved one fundamental by 5.999987
semitones while the other remained stable. All seven final seconds were zero PCM.

An initial ALSA subscriber log contained only headers and proves no MIDI
receipt. A separate isolated receiver subsequently observed the exact A0/A1
fixture messages emitted by aplaymidi. That proves fixture output, not receipt
inside Bitwig's native engine. The temporary receiver was stopped afterward.
Installed API/Java forwarding inspection did not justify a product patch or a
claim that Bitwig's native engine is faulty. D0/channel-15/wrong-pitch cases were
prepared but not run. NoteInput mappings and MPE settings were restored.

## Validation and review

- 507 tests passed, zero failed/skipped.
- Full typecheck passed.
- Architecture: 16 workspaces, 44 internal runtime edges, no violations.
- Final distribution smoke passed: 34 packed artifacts, 43 default reads,
  zero DAW calls.
- Independent code review checked exact action IDs, name/state guards, raw
  authentication, MCP direct/discovery policy and truthful dispatch semantics.
- Generated controller files match both installed profiles byte-for-byte.
- Raw project files, PCM, desktop screenshots and runtime logs remain ignored
  under `output/`; no private evidence is included in the commit.

Full historical/API parity is not claimed. Remaining limitations include incoming
poly-aftertouch effect, pressure readback, native project-path/open automation,
and musical content beyond the inspected persistence window.
