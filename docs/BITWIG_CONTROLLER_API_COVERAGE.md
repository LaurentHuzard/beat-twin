# Controller API coverage and musical opportunities

Audit: 2026-09-28. The API inventory comes from source/reference inspection;
bounded earlier acceptance and the latest installed-controller live outcomes are
identified below. They establish selected functional paths, not every catalogue
tool or complete musical parity. The installed `bitwig-studio`
package reports **6.1.1** through
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

Current source catalogue: **190 tools / 43 default reads**, plus four optional
discovery wrappers (**194 total**). Catalogue coverage is separate from the live
evidence below. A [bounded project save/reopen witness](BITWIG_MCP_PERSISTENCE.md)
now compares actual persisted content; action dispatch alone remains insufficient.

## Tranche 6 implementation update

[Musical extensions](BITWIG_MCP_MUSICAL.md) now implement bounded note-expression
read/update, observed browser filter-item selection/paging, remote-page read/select
and arranger-loop read/write. Historical MIDI uses an optional input profile with
actual scheduled release; Ear has an optional external HTTP adapter and an
included, explicitly operated [local capture provider](EAR_LOCAL_PROVIDER.md). The missing
capability column below records the remaining API opportunities after that slice.
Cue position stays deferred because bank reordering needs a stronger identity.

The current candidate distinguishes interested host-cache reads from mutation
confirmation. Browser/remote unchanged values can remain readable after their
current binding is observed and settled; changed-field callbacks still confirm
writes, with explicit provenance and binding/query/result epochs. Mixer/groove
initial zero reads may use the host cache after a nonempty display callback and
settled identity. Nonzero reads and changed writes retain numeric-callback
requirements; display callbacks do not stand in for numeric confirmation.

Pressure is explicitly unsupported on the inspected Bitwig 6.1.1 host: NoteStep
hydration/equality omit pressure. The candidate returns `pressure:null`, advertises
unreadable/unwritable pressure capability, and rejects any pressure-containing
batch before every expression setter. This release-specific guard is not a
claim about all API 15 hosts. Live replay rejected a mixed pressure/velocity batch
and confirmed the original velocity remained unchanged.

### Latest installed-controller live outcomes

- **Groove/send:** all six groove values were read, including zero values.
  Baseline was enabled false, shuffle amount `0.5`, shuffle rate `1`, accent
  amount `1`, accent rate `0`, accent phase `0.5`. Enabled true/shuffle `0.6`
  were confirmed, then restored to false/`0.5`. Send 0 completed `0 → 0.1 → 0`
  with readback at each step.
- **Remote pages:** Polysynth pages completed `0 → 1 → 0`, with unchanged/zero
  macros available; `Osc 2 Pitch` completed `0.5 → 0.2 → 0.5` with readbacks.
- **Browser/device:** the device inventory changed from empty to Polysynth after
  selecting that observed browser result and committing. Selecting the Analysis
  filter produced three results. A live replay of corrected filter coverage also
  confirmed wildcard reset, bank offsets `0 → 16 → 0`, and cancellation. In that
  case the column reported 27 entries while its bank contained 28 items.
- **Clip/audio:** a four-beat clip with five notes was created and read back.
  Playback produced a three-second, 144000-frame Ear WAV, peak −18.2917 dBFS,
  RMS −33.2474 dBFS. Digital silence was measured before playback and in a
  three-second capture after stop. This verifies the bounded workflow, not a
  complete arrangement or musical quality.
- **MIDI exit/reload:** reload before the ten-second lease returned an empty
  injected-note tracker and sustain false. Audio still had a tail around
  −40 dBFS at nine seconds, so immediate silence/release timing is not proven.
  Incoming physical notes are not covered by that injected-note tracker.
- **Incoming MPE pitch:** two simultaneous member-channel voices were captured
  with Polysynth. Member 1 measured `130.812 → 184.991 → 130.812 Hz`, consistent
  with a six-semitone bend and return; member 2 stayed near `195.997 Hz`. The
  final second was digital silence. This verifies the tested member-pitch
  independence, not all MPE dimensions, zones, ranges or instruments.
- **Polyphonic aftertouch:** `NONE` versus `PITCH_UP` with range 12 produced the
  same approximately `130.812 Hz` fundamental throughout the event; no octave
  shift was observed. A later seven-capture matrix added PAN_LEFT, GAIN_DOWN,
  same/cross-channel cases and pressure before/during a second note. Across 39
  active windows (six ordinary probes × six windows, MPE control × three), no
  mapped pan/gain/pitch response was demonstrated. Maximum ordinary left/right
  RMS imbalance was `0.0000321 dB`; GAIN_DOWN's envelope-corrected change against
  NONE was `−0.01573 dB`. Fundamentals stayed near `130.812 Hz`. The MPE positive
  control independently repeated `130.812 → 184.996 → 130.812 Hz`, with a second
  voice near `195.997 Hz` unchanged. All seven final seconds were digital silence.
- **Aftertouch event generation:** an isolated direct ALSA receiver observed
  note-on channel 0 and polyphonic aftertouch on channels 0/1, note 48, value 127,
  from replay of the same SMF files. This validates `aplaymidi` event production
  for that witness, not Bitwig native-engine receipt during the audio probes.
  The earlier virtual-port subscriber log contained headers only. Musical
  mapping remains unvalidated and its cause open; Java-path argument forwarding
  neither establishes native delivery nor identifies a host bug. D0, channel 15
  and wrong-pitch controls were prepared but not executed in this matrix.
- **Project persistence:** Save As and Save persisted three notes; a fourth was
  added without saving. Closing with No to the save prompt and reopening the
  exact saved file restored three notes. The bounded manifest matched with zero
  differences at numeric tolerance `1e-6`. Scope: eight visible tracks, scenes,
  one four-beat clip inspected across 64 steps and pitches 0–127 on channel 0,
  note expressions excluding pressure, device inventory and page 0 macros.
  This is not a full-arranger, all-track/channel, all-device-state or all-page
  persistence claim. [Witness and boundaries](BITWIG_MCP_PERSISTENCE.md).

The exact publication-head replay is recorded separately in the campaign report;
the bounded observations above must not be expanded to untested target contexts.

Browser filter coverage now reports the column's `entryCount` alongside
`bankItemCount`, with `countSource:"bank.itemCount"`. Offset/item bounds and
completeness use the bank total, not the column count or an inferred plus-one
wildcard adjustment. Filter/folder layouts need not share the same counts.

## Coverage by musical domain

| Domain | Current source coverage | Useful missing capability | API evidence / boundary |
| --- | --- | --- | --- |
| Notes and expressions | Selected launcher cursor, channel 0, 64 steps at 0.25 beats; bounded note insertion/removal/readback and snapshot-guarded expressions; pressure unavailable on host 6.1.1 | Duration edits, wider channels/windows; reliable host pressure contract | `Clip.getStep` and `NoteStep` API 10. Existing observation is not a full MIDI export. |
| Generative variation | Explicit note patterns | Chance, occurrence, recurrence, repeat, mute, velocity spread | `NoteStep` API 14; eligible under API 15, with ranges and observed note identity. |
| Clip transformations | Name/color, duplication into an observed empty slot, loop extension | Transpose, quantize, duplicate content, play bounds, loop toggle/start, shuffle/accent | `Clip.transpose(int)`, `quantize(double)`, `duplicateContent()` and value proxies API 1. Whole-clip operations exceed the current read window. |
| Launch behavior | Launch/stop/record, scenes and transport | Per-clip quantization/mode, legato reference; launcher post-record action/time | `Clip.launchQuantization()` API 8, `launchMode()` API 9; transport post-record values API 1/2. |
| Sound loading | Observed browser sessions, filter columns/items/paging and result selection/commit/cancel | Content-type selection, audition state, direct known-device/file insertion | `PopupBrowser` API 2; `InsertionPoint` class API 7. Opening/dispatch is not proof of insertion. |
| Device controls | Bypass/delete/navigation, eight remote controls, page names/count/index read and selection | Reset/touch/restore automation, direct parameter discovery | `CursorRemoteControlsPage` API 2/7; `Parameter` API 1/2; direct parameter observers/setters on `Device` API 1. |
| Nested instruments | Selected-device drum-pad bank in tranche 5 | Layers, slots, parent navigation, explicit child chain/device selection | `Device.createLayerBank/createDrumPadBank` and `CursorDevice` selection API 1. Different chains need distinct observed identity. |
| Mixing and routing | Bounded track/send/return/master values and native project resets | Cue mix/volume, crossfader, activation, monitor state, broader banks | `Project.cueMix/cueVolume` API 10; `Channel.isActivated` API 1; `Track.monitorMode` API 14. Input routing is not implied by monitor control. |
| Groove | All six normalized parameter reads; enabled/shuffle amount writes | Writes for shuffle rate, accent amount/rate/phase | `Groove` Parameter getters API 1; normalized parameter values are not automatically musical divisions. Initial-zero cache provenance differs from numeric write confirmation. |
| Arrangement | Transport, panels, cue list/launch/create/name, zoom and arranger loop range | Cue position, follow/height controls, selected arranger-clip edits | `CueMarker.position` API 10; loop range API 15; `createArrangerCursorClip` API 1. No arbitrary region bank identified. |
| Automation | Remote parameter values and transport overdub | Write mode/enable, reset overrides, parameter touch lifecycle | `Transport` write-state values API 2 and override operations API 1; not arbitrary envelope-point editing. |
| Audio observation | Optional Ear adapter and explicitly started local monitor provider; bounded live PCM/WAV capture and RMS/peak evidence | VU meters and currently playing notes from controller; musical audio analysis | `Channel.addVuMeterObserver` API 1, `playingNotes` API 2. These do not replace capture/listening/analysis by Ear. No BPM/key or musical-quality claim. |
| Notes played live | Optional NoteInput MIDI profile with leases/release cleanup | Explicit-track `playNote/startNote/stopNote` route | `Track` API 1. Default duration of `playNote` is unspecified; sustained notes need guaranteed release and voice tracking. |

## Further opportunities after tranche 6

1. **Expression-aware notes.** Tranche 6 implements a bounded expression reader
   and batch update for existing `NoteOn` steps, with stale-snapshot rejection,
   whole-batch validation and partial setter evidence. Extend coverage and duration
   editing only with explicit overlap/sustain rules. API 10 ranges: velocity/release/pressure 0–1, pan/timbre
   -1–1, gain 0–1 (0.5 means 0 dB), transpose -96–96 semitones, duration in beats.
   These API ranges do not override the explicit pressure unavailability on
   Bitwig 6.1.1 described above.
   Probability and repeats can follow under API 14 once their specific limits
   and enable flags are modeled.
2. **Deterministic sound selection.** Filter columns and bounded item selection
   are now implemented, with a Polysynth insertion confirmed by device readback
   and subsequent captured clip playback. Extend coverage to other result/commit
   contexts and add explicit content-type/audition control. Add direct insertion only with a
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
- **Ear:** six historical tools use a separately operated service. VU meters can
  provide controller-native levels; device selection, capture, listening and
  DSP analysis still require that service. The tranche-6 client adapts fixed local
  endpoints without starting a service or inventing an unverified payload schema.
  The repository now includes an opt-in local provider with explicit output-monitor
  routing, signed 16-bit stereo PCM/WAV and RMS/peak measurements. A live pass
  exercised all six tools: a 3-second WAV contained 144000 frames, with RMS
  −12.2881 dBFS and peak −5.1315 dBFS; ffmpeg measured −12.3/−5.1 dBFS. This establishes
  bounded capture/measurement, not BPM/key or musical quality. The separate
  Polysynth clip workflow above adds installed-controller evidence. The generic
  client keeps its opaque `external-unverified`
  envelope. [Provider details and evidence](EAR_LOCAL_PROVIDER.md).

## What should not become one MCP tool per API symbol

Hardware bindings, knobs/buttons/LED/display graphics, USB discovery and MIDI
port setup primarily configure a physical controller. Callback registration and
value proxy infrastructure support implementation rather than musical intent.
Deprecated aliases duplicate existing APIs. Generic Application actions are
global UI commands and cannot establish a selected track, clipboard content or
undo target. Those surfaces can be useful integrations, but inflating the musical
catalogue with every symbol would not measure functional completeness.

## Evidence anchors and remaining real-session coverage

Local files inspected include `NoteStep.html`, `Clip.html`, `ClipLauncherSlot.html`,
`Device.html`, `CursorDevice.html`, `InsertionPoint.html`, `PopupBrowser.html`,
`BrowserFilterColumn.html`, `BrowserItem.html`, `CursorRemoteControlsPage.html`,
`Parameter.html`, `Channel.html`, `Track.html`, `Groove.html`, `Project.html`,
`Transport.html`, `CueMarker.html`, `ControllerHost.html`, `Arranger.html` and
`TimelineEditor.html`. Class/method names above identify the evidence without
redistributing the proprietary documentation corpus.

The latest pass covers the specific observer/readback, insertion, pressure guard,
filter navigation, member-pitch MPE and sound path recorded above. Polyphonic
aftertouch remains unvalidated; additional target contexts, other MPE dimensions,
exit/reload cleanup timing and partial failures still need their own outcomes.
Ear's bounded capture cannot substitute for unrelated host state evidence.
Offline coverage establishes contracts and defensive behavior; neither it nor
the selected live cases establishes a complete musical arrangement.
