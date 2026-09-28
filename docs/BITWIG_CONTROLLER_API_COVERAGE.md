# Controller API coverage and musical opportunities

Audit: 2026-09-28. Read-only source/API inspection; no controller reload or live
DAW operation. The installed `bitwig-studio` package reports **6.1.1** through
`dpkg-query`. The official reference inspected belongs to that installation:
`/opt/bitwig-studio/resources/doc/control-surface/api/com/bitwig/extension/controller/api/`.
This document records signatures and implementation conclusions, not a copy of
the reference corpus. It does not infer the earliest compatible Bitwig release
from an API number.

The controller selected API 10 through tranche 4; tranche 5 explicitly selects
**API 15**. Higher APIs below are opportunities, not callable promises. Class and
method availability, wiring, observed responses and successful live operations
are separate kinds of evidence. The [historical matrix](BITWIG_MCP_PARITY.md)
counts names; this inventory compares musical capabilities. One MCP tool need
not correspond to one API method.

## Tranche 6 implementation update

[Musical extensions](BITWIG_MCP_MUSICAL.md) now implement bounded note-expression
read/update, observed browser filter-item selection/paging, remote-page read/select
and arranger-loop read/write. Historical MIDI uses an optional input profile with
actual scheduled release; Ear has an optional external HTTP adapter. The missing
capability column below records the remaining API opportunities after that slice.
Cue position stays deferred because bank reordering needs a stronger identity.

## Coverage by musical domain

| Domain | Current source coverage | Useful missing capability | API evidence / boundary |
| --- | --- | --- | --- |
| Notes and expressions | Selected launcher cursor, channel 0, 64 steps at 0.25 beats; bounded note insertion/removal/readback and snapshot-guarded expressions | Duration edits, wider channels/windows | `Clip.getStep` and `NoteStep` API 10. Existing observation is not a full MIDI export. |
| Generative variation | Explicit note patterns | Chance, occurrence, recurrence, repeat, mute, velocity spread | `NoteStep` API 14; eligible under API 15, with ranges and observed note identity. |
| Clip transformations | Name/color, duplication into an observed empty slot, loop extension | Transpose, quantize, duplicate content, play bounds, loop toggle/start, shuffle/accent | `Clip.transpose(int)`, `quantize(double)`, `duplicateContent()` and value proxies API 1. Whole-clip operations exceed the current read window. |
| Launch behavior | Launch/stop/record, scenes and transport | Per-clip quantization/mode, legato reference; launcher post-record action/time | `Clip.launchQuantization()` API 8, `launchMode()` API 9; transport post-record values API 1/2. |
| Sound loading | Observed browser sessions, filter columns/items/paging and result selection/commit/cancel | Content-type selection, audition state, direct known-device/file insertion | `PopupBrowser` API 2; `InsertionPoint` class API 7. Opening/dispatch is not proof of insertion. |
| Device controls | Bypass/delete/navigation, eight remote controls, page names/count/index read and selection | Reset/touch/restore automation, direct parameter discovery | `CursorRemoteControlsPage` API 2/7; `Parameter` API 1/2; direct parameter observers/setters on `Device` API 1. |
| Nested instruments | Selected-device drum-pad bank in tranche 5 | Layers, slots, parent navigation, explicit child chain/device selection | `Device.createLayerBank/createDrumPadBank` and `CursorDevice` selection API 1. Different chains need distinct observed identity. |
| Mixing and routing | Bounded track/send/return/master values and native project resets | Cue mix/volume, crossfader, activation, monitor state, broader banks | `Project.cueMix/cueVolume` API 10; `Channel.isActivated` API 1; `Track.monitorMode` API 14. Input routing is not implied by monitor control. |
| Groove | Enabled/shuffle amount read/write | Shuffle rate, accent amount/rate/phase | `Groove` Parameter getters API 1; normalized parameter values are not automatically musical divisions. |
| Arrangement | Transport, panels, cue list/launch/create/name, zoom and arranger loop range | Cue position, follow/height controls, selected arranger-clip edits | `CueMarker.position` API 10; loop range API 15; `createArrangerCursorClip` API 1. No arbitrary region bank identified. |
| Automation | Remote parameter values and transport overdub | Write mode/enable, reset overrides, parameter touch lifecycle | `Transport` write-state values API 2 and override operations API 1; not arbitrary envelope-point editing. |
| Audio observation | Optional external Ear adapter; no capture/DSP result claimed | VU meters and currently playing notes from controller | `Channel.addVuMeterObserver` API 1, `playingNotes` API 2. These do not replace capture/listening/analysis by Ear. |
| Notes played live | Optional NoteInput MIDI profile with leases/release cleanup | Explicit-track `playNote/startNote/stopNote` route | `Track` API 1. Default duration of `playNote` is unspecified; sustained notes need guaranteed release and voice tracking. |

## Further opportunities after tranche 6

1. **Expression-aware notes.** Tranche 6 implements a bounded expression reader
   and batch update for existing `NoteOn` steps, with stale-snapshot rejection,
   whole-batch validation and partial setter evidence. Extend coverage and duration
   editing only with explicit overlap/sustain rules. API 10 ranges: velocity/release/pressure 0–1, pan/timbre
   -1–1, gain 0–1 (0.5 means 0 dB), transpose -96–96 semitones, duration in beats.
   Probability and repeats can follow under API 14 once their specific limits
   and enable flags are modeled.
2. **Deterministic sound selection.** Filter columns and bounded item selection
   are now implemented. Establish their real-session result/commit behavior and
   add explicit content-type/audition control. Add direct insertion only with a
   verified device ID or explicit file path and post-insertion identity. API
   insertion methods can silently do nothing; command return is insufficient.
3. **Useful parameter targeting.** Page names/count/index and explicit selection
   are implemented. Add reset and direct parameter IDs tied
   to the selected device. A parameter ID from one plugin/device must never
   silently target another. Separate gesture/touch lifecycle from value writes.
4. **Clip and song form.** Add explicit whole-clip transpose/quantize/duplicate
   content, launcher settings and cue position. Arranger-loop range is implemented. Mark the
   effect scope honestly when readback covers only part of a clip. Selected
   arranger-cursor editing requires its own target contract.
5. **Performance and evidence.** Add cue bus controls, native VU/playing-note
   snapshots, tracked live note voices and automation-write status. Recording
   musical automation and raw MIDI need explicit routing/recording semantics
   before a large real-session test pass.

## Versions beyond API 15

| Minimum API in installed reference | Candidate |
| --- | --- |
| 16 | `Clip.moveStep`, launch options, remote preset-page creation |
| 18 | CLAP insertion, track remote controls, alternate/release launch, project modified flag |
| 19 | `Parameter.hasAutomation`, `deleteAllAutomation` |
| 20 | `Channel.channelId` for stronger channel identity |
| 21 / 22 | Timeline scrollbar model / channel index |
| 25 | Configurable filtered track-bank constructors |

These require a deliberate version change and compatibility review. The source
must not call them merely because the local 6.1.1 installation documents them.
Some methods have no individual `Since` annotation. Such omissions do not prove
availability in every earlier API; use class provenance or conservative version
requirements and record remaining uncertainty.

## Unsupported assumptions and alternative contracts

- **Text search:** no writable browser search-text API was found in
  `PopupBrowser`, `BrowserFilterColumn` or `BrowserItem`. The wildcard is an item
  that clears a column filter, not a text-search setter. Supported alternatives
  are column/item selection and local filtering of explicitly bounded results;
  neither should claim global text search.
- **Cue color:** `CueMarker.getColor()` remains read-only. Cue rename/create does
  not imply a color setter. A future explicit UI workflow could be evaluated;
  no automatic UI fallback or successful color mutation is claimed here.
- **Timeline regions:** `Arranger`/`TimelineEditor` expose views, markers and
  zoom. An arranger cursor can edit a selected clip, but no arbitrary timeline
  clip-region enumeration/placement API was identified in the inspected surface.
  No envelope-point read/write surface was identified either. Recording launcher
  performance or parameter automation is a distinct supported direction.
- **Raw MIDI:** `Track.sendMidi` exists (API 2), but its documentation describes
  hardware-device delivery. It is not established as an interchangeable route
  for `NoteInput.sendRawMidiEvent`. NoteInput mapping/MPE requires an instantiated
  MIDI input, configured ports, routing and release cleanup. Track note methods
  offer a separate explicitly targeted musical contract. Tranche 6 supplies an
  optional NoteInput profile; raw injection still ignores channels and translations.
- **Ear:** six historical tools belong to a separate service. VU meters can
  provide controller-native levels; device selection, capture, listening and
  DSP analysis still require that service. The tranche-6 client adapts fixed local
  endpoints without starting a service or inventing an unverified payload schema.

## What should not become one MCP tool per API symbol

Hardware bindings, knobs/buttons/LED/display graphics, USB discovery and MIDI
port setup primarily configure a physical controller. Callback registration and
value proxy infrastructure support implementation rather than musical intent.
Deprecated aliases duplicate existing APIs. Generic Application actions are
global UI commands and cannot establish a selected track, clipboard content or
undo target. Those surfaces can be useful integrations, but inflating the musical
catalogue with every symbol would not measure functional completeness.

## Evidence anchors and later real-session gate

Local files inspected include `NoteStep.html`, `Clip.html`, `ClipLauncherSlot.html`,
`Device.html`, `CursorDevice.html`, `InsertionPoint.html`, `PopupBrowser.html`,
`BrowserFilterColumn.html`, `BrowserItem.html`, `CursorRemoteControlsPage.html`,
`Parameter.html`, `Channel.html`, `Track.html`, `Groove.html`, `Project.html`,
`Transport.html`, `CueMarker.html`, `ControllerHost.html`, `Arranger.html` and
`TimelineEditor.html`. Class/method names above identify the evidence without
redistributing the proprietary documentation corpus.

The later live pass must cover observer startup and delayed settlement, actual
target identities, browser no-op outcomes, note/expression readback, sound
loading, audio levels/listening, structural edits and partial failures. Offline
coverage establishes contracts and defensive behavior; it does not establish
that a complete musical arrangement has been produced or heard.
