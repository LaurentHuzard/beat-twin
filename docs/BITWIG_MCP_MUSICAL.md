# Musical extensions, MIDI profile and Ear adapter

Updated 2026-09-28. Source catalogue: 190 tools / 43 default reads. Opt-in
discovery adds four wrappers, for 194 total when all policies are enabled.
Controller API 15. This document describes the current source and bounded
installed-controller evidence from 2026-09-28: mixer/groove readbacks, remote pages, browser
insertion, pressure rejection and a five-note clip producing captured audio.
These outcomes do not establish every scenario or full musical parity.
[API inventory](BITWIG_CONTROLLER_API_COVERAGE.md) and
[historical matrix](BITWIG_MCP_PARITY.md) distinguish native, adapted and external
capabilities. [Live acceptance plan](BITWIG_LIVE_ACCEPTANCE.md) defines later checks.

## Profiles and policies

The normal generated `BeatTwin.control.js` retains its existing UUID and no MIDI
ports. The optional generated `BeatTwinMidi.control.js` has a distinct UUID/name
and one MIDI input, zero outputs. Both are built from the same maintained core,
`midi.ts` and `creative.ts`; only the explicit profile flag differs. Use only one
profile with the current relay. Both profiles were exercised in earlier acceptance;
the latest controller was installed before the live outcomes documented below.
MIDI input routing must be configured explicitly; it is excluded from All Inputs.

Original six write policies remain. Two additional policies are explicit:

- `midi_write`: raw channel messages, notes, input translation/MPE and panic.
- `audio_capture`: all six Ear operations, including status/device/level requests,
  because this bridge cannot establish the external service's capture semantics.

Writes remain hidden and rejected by default. `BITWIG_MCP_ENABLE_WRITES=1` enables
all eight policies, including MIDI/audio. Prefer selective policies during later
acceptance. A policy permits dispatch; it does not establish routing or service
readiness. `midi_get_status` is read-only and available on either profile.

## Historical MIDI with corrected contracts

| Tools | Contract |
| --- | --- |
| `midi_send_raw` | Channel-voice status bytes128,144,160,176,192,208,224; data0–127. Program/channel pressure require unused data2=0. No SysEx or realtime message support. |
| `note_on`, `note_off`, `note_play` | Channel0 only; pitch0–127; note-on velocity1–127, off velocity0–127. `note_play.duration` is1–10000ms; held notes have a bounded lease. |
| `note_input_assign_expression` | Real NoteExpression enum: NONE, PITCH_DOWN/UP, GAIN_DOWN/UP, PAN_LEFT/RIGHT, TIMBRE_DOWN/UP. Channel0–15, pitchRange1–24. |
| `note_input_set_mpe` | Explicit boolean, baseChannel0 or15, pitchBendRange1–96 (bridge bound). |
| `note_input_set_key_translation` | Exactly128 entries, each integer−1..127; −1 suppresses an incoming key. |
| `note_input_set_velocity_translation` | Exactly128 entries, each integer0..127. Negative values are rejected; velocity filtering with−1 is unsupported. |
| `midi_get_status`, `midi_all_notes_off` | Inspect profile/voice capability; explicit cleanup/panic under midi_write. |

NoteInput raw injection ignores the MIDI channel and bypasses key/velocity
translation. Raw/note schemas therefore reject nonzero channel claims. Translation
and MPE tools configure routed incoming MIDI; they do not transform raw injected
notes. This corrects unsupported historical assumptions rather than imitating them.

Bitwig 6.1.1 live tests with routed incoming MIDI confirmed key−1 filtering, but
velocity−1 did not suppress notes (including when all128 entries were−1). The
bridge therefore rejects negative velocity entries before any host setter, even
though the API documentation permits−1. Mapping to0 produced silence in that
test; it maps velocity to zero and does not promise to drop the MIDI event. No
automatic substitution of−1 with0 is performed. Identity tables restore normal
input translation. Raw injected notes continue to bypass both tables.

Note-offs are actually scheduled. Per-pitch generation tokens stop stale timers
from releasing a newer voice; duplicate held pitches are rejected. Cleanup runs on
disconnect/exit and is independent of subsequent policy revocation. Hold-controller
leases and panic bound sustained notes. Cleanup remains best effort if the host
throws or the process terminates abruptly; no audio silence is claimed offline.

The latest exit/reload probe completed before the ten-second lease: after reload,
the injected-note tracker was empty and sustain false. An audio tail remained
around −40 dBFS at nine seconds in that probe, so immediate audible silence is
not established. Tracker state alone does not prove the release timing of an
old controller's voice or the absence of an instrument/effect tail. Incoming
physical notes are not tracked by the injected-note tracker.

### Incoming MPE and polyphonic-aftertouch evidence

A live incoming-MIDI test on Polysynth played two simultaneous notes on distinct
MPE member channels. Offline analysis of the captured audio measured member 1
at approximately `130.812 → 184.991 → 130.812 Hz`, while member 2 stayed near
`195.997 Hz`. This matches the configured six-semitone bend on only member 1 and
its return. Separate harmonic families support the two simultaneous voices.
The final second of the capture was digital silence. This establishes the tested
member-pitch independence, not every MPE dimension, zone, range or instrument.

The same campaign compared incoming polyphonic aftertouch with assignment `NONE`
versus `PITCH_UP` and a twelve-semitone range. Both captures retained a fundamental
near `130.812 Hz` before, during and after the aftertouch event; no expected octave
shift was observed. Their final seconds were digital silence.

A subsequent seven-capture matrix extended the comparison to `PAN_LEFT`,
`GAIN_DOWN`, and `PITCH_UP`, including note/pressure channels `0/0`, `0/1` and
`1/1`, pressure sent before a second note, and pressure repeated during that note.
Analysis covered 39 active windows: six windows in each of six ordinary probes,
plus three in the MPE control. No mapped pan/gain/pitch effect was demonstrated:
the ordinary probes remained near `130.812 Hz`, maximum left/right RMS difference
was `0.0000321 dB`, and GAIN_DOWN's level change relative to NONE's corresponding
envelope change was only `−0.01573 dB`. These tiny differences do not establish
the expected mapping. The repeated MPE control produced
`130.812 → 184.996 → 130.812 Hz` with a stable second voice near `195.997 Hz`.
All seven captures had exact digital silence in their final second.

A separate direct ALSA witness replayed the same SMF files into an isolated
receiver and observed note-on channel 0 plus polyphonic-aftertouch channel 0/1,
note 48, value 127. This confirms production of the intended events by
`aplaymidi` in that witness; it does not confirm their receipt by Bitwig's native
engine during the audio probes. The earlier observer subscribed to the virtual
destination logged only headers and supplies no event-delivery evidence.
Channel-pressure D0 contrast, channel 15 and wrong-pitch controls were prepared
but were not part of the performed matrix.

The musical effect of `note_input_assign_expression` remains unvalidated and
its cause open. Read-only Java-path inspection found unchanged argument
forwarding, without establishing native-engine receipt or handling. No host bug
or successful mapping is inferred from dispatch acknowledgement alone.

These bounded incoming-note releases do not resolve the separate exit/reload
audio-tail question above. The campaign report tracks replay of the exact
publication candidate separately from these recorded outcomes.

## Note expressions

`clip_get_note_expressions` reads1–256 unique step/pitch coordinates in the selected
launcher clip: current track/scene bank0–7, channel0, steps0–63 at0.25beats,
pitches0–127. Every coordinate must be an observed NoteOn, not sustain/empty.
The response includes a snapshot and bounded coverage, not full MIDI export.

`clip_set_note_expressions` requires that snapshot and validates the entire batch
before the first setter. Velocity/releaseVelocity/gain are normalized0–1;
pan/timbre−1..1; transpose−96..96semitones. Gain0.5 means0dB. Duration is read in
beats but is not edited by this tool. Each entry must supply at least one
expression field; no implicit note creation or whole-clip replacement.

Pressure has an API range of 0–1, but is explicitly unsupported on Bitwig 6.1.1
in this candidate. Reads return `pressure:null` and
`expressionCapabilities.pressure` reports `readable:false`, `writable:false`,
reason `host_note_step_pressure_readback_unreliable`. Any batch containing a
pressure field is rejected before **any** expression setter, including other
fields/notes in that batch. Inspection of that host's NoteStep implementation
found pressure missing from hydration/equality; a setter's cached echo cannot
establish a previous value or confirmed host outcome. The guard is scoped to the
host release 6.1.1, not API 15 generally. Other/unknown releases retain the public
API path and callback-confirmation/timeout safeguards, without a compatibility
claim. A live batch containing pressure and velocity was rejected on the installed
controller, and readback confirmed that velocity stayed unchanged. The same pass
created a four-beat clip with five notes and confirmed those notes by readback.

Snapshots become stale after relevant identity/content changes. Readback requires
observer evidence. Partial results count setters, including failure halfway through
one note; no automatic replay or fictional rollback is supplied.

A creative mutation that has not reached its observed outcome within ten seconds
becomes explicitly uncertain. This deadline does not prove success, failure or
rollback. Writes stay blocked until controller reload, even if a late callback
matches. Independent read-only diagnostics remain available;
`project_get_summary.creativeMutation` exposes the pending/uncertain state when
present. Object-shaped creative reads also include `mutation`; existing array
responses keep their shape. Same-target expression readback after timeout still
requires the original identity and settled observations. Stop, note-off and panic
remain available. Do not retry an uncertain mutation automatically.

Earlier Bitwig 6.1.1 pressure writes did not reach a callback-confirmed outcome.
The current capability guard prevents dispatch of that unsupported operation;
the uncertainty barrier still protects other mutations whose outcomes cannot be
confirmed. Neither mechanism repairs or synthesizes pressure readback.

## Observed browser filters

`browser_get_filter_items` reads one explicit column and a16-item window, with
session/snapshot, coverage and wildcard state. Columns: smartCollection, location,
device, category, tag, deviceType, fileType, creator. Absent/inapplicable columns
are explicit; an empty bank may report offset−1.

Coverage preserves both counts: `entryCount` is the column's reported count,
`bankItemCount` is the item bank's own total, and
`countSource:"bank.itemCount"` identifies the count used for bank coordinates,
offset validation and completeness. A live filter column reported 27 entries
while its item bank contained 28 items. The controller does not assume equality
or synthesize `entryCount + 1`: wildcard/folder layouts can differ. Existing items
must fit the bank's observed bounds.

`browser_set_filter` deliberately replaces the historical invalid text-search
contract. It accepts `{column,itemIndex,snapshotId}`; index−1 selects the wildcard
(all items),0–15 selects an observed item. It does **not** accept arbitrary search
text and does not claim global text search. `browser_scroll_filter_items` moves a
page forward/backward with the current snapshot. Content/session changes invalidate
old tokens before dispatch. A filter change need not alter result count.

Existing result selection/commit paths are integrated with observed browser state:
selection uses the result item's boolean selection proxy rather than an inferred
count of Next presses. Browser transitions must settle before dependent actions.
The live insertion probe began with an empty track device inventory, selected an
observed Polysynth result, committed it, then read Polysynth in the track's device
inventory. A subsequently created five-note clip produced captured audio. This
establishes that particular insertion/playback path; dispatch alone remains
insufficient for other results, devices or contexts.

`browser_cancel` only requires an observed, settled open session. It does not
require results to be available or selected. Commit retains the stricter result
identity requirements.

Filter changes invalidate result callback evidence separately from the filter
transition. The candidate can read interested host getters when the current
browser-session binding has been observed and settled, even when an unchanged
field emits no second callback. `observation.source` is `interested_host_cache`;
binding/settlement and `mutationConfirmation:changed_field_callback_required`
are explicit. This read path never changes callback evidence into confirmation.
Unreadable fields remain unavailable/null; inconsistent coverage still fails.
Session, query and result epochs guard in-flight target identity. Filter/result
selection completion still requires the relevant changed-field callback. A live
replay of the corrected coverage path confirmed `Analysis` selection with three
results, wildcard reset, bank offsets `0 → 16 → 0`, and cancellation. These are
bounded outcomes for that observed session; the exact publication-head replay
is tracked separately in the campaign report. Settling alone proves no insertion.

## Remote pages and arranger loop

`device_remote_pages_get` reports bounded page names/count/index and a selected-device
snapshot. `device_remote_page_select` validates index against observed count and
waits for the new page before remote-control writes resume. Duplicate page names
or parameter values do not establish identity. No arbitrary plugin parameter ID
is guessed.

After a page change, each remote control has its own availability. Interested
host getters can supply unchanged names/values once the cursor-device binding is
observed and settled; their provenance is exposed as `interested_host_cache`.
Missing/unreadable or nonexistent controls retain `available:false` and null
fields. A write requires the targeted control to be available; unused controls
do not lock all other writes. Changed page/value confirmation still needs its
callback, and a device-binding epoch prevents an away-and-back retarget from
validating an in-flight write. No cached setter echo is a confirmed mutation.

Live Polysynth page navigation completed `0 → 1 → 0`; unchanged and zero-valued
macros remained available. `Osc 2 Pitch` was changed `0.5 → 0.2 → 0.5`, with
readbacks confirming both the change and restoration.

## Mixer and groove observation

The candidate handles a suppressed initial numeric zero separately from write
confirmation. A normalized zero may be read from an interested host getter only
after a nonempty display callback and settled identity, while no numeric callback
or write-confirmation wait exists. A nonzero value still needs its numeric
callback. Changed writes invalidate numeric readiness and require the numeric
callback before readback; display text alone cannot confirm them.
`project_get_summary.observation.mixer` exposes initial-zero and pending-numeric
evidence. Groove enabled is a normalized parameter (`0`/`1` for its boolean
setter), not a BooleanValue proxy.

Live baseline groove readback was enabled false, shuffle amount `0.5`, shuffle
rate `1`, accent amount `1`, accent rate `0`, accent phase `0.5`. Enabling groove
and changing shuffle amount to `0.6` were read back, then disabled/`0.5` were
restored and read back. Send 0 was observed at `0`, changed to `0.1`, then restored
to `0`, with each value read back. These cases cover initial zero and changed
numeric values on the installed host.

## Arranger loop

`transport_get_arranger_loop` observes enabled/start/duration/end in quarter-note
beats. `transport_set_arranger_loop` requires its snapshot, stopped transport,
recording off, positive duration and start+duration within the bridge's1048576beat
bound. Multiple setters are not atomic; only changed values are dispatched, and
partial failures remain explicit. Cue-position editing remains deferred because
moving a cue may reorder its bank and lose index identity.

## Ear: optional local provider and external-service contract

Six historical tools are adapted by a TypeScript HTTP client. An optional
[local TypeScript provider](EAR_LOCAL_PROVIDER.md) is now included, with explicit
output-monitor selection and no automatic startup. Configure `BITWIG_EAR_BASE_URL` only for an
explicitly operated service; allowed origins use literal127.0.0.1 or[::1], HTTP(S),
without credentials/path/query/fragment. There is no default endpoint or auto-discovery.
All operations require audio_capture. Without configuration, status reports
unconfigured and the other calls fail without network access.

| Tool | External endpoint |
| --- | --- |
| `ear_status`, `ear_get_levels` | GET /levels |
| `ear_list_devices` | GET /devices |
| `ear_set_device` | POST /device/{index} |
| `ear_listen` | GET /listen?seconds=N; integer1–10, default5 |
| `ear_analyze` | GET /analyze?seconds=N;0.1–10, default1 |

Redirects are rejected. Metadata deadline3s, capture/analysis15s, response bound8MiB.
Responses must be JSON/UTF-8 and are preserved under an explicitly opaque external
payload. The included provider declares signed 16-bit stereo PCM at 48 kHz, PCM WAV,
linear RMS/peak and dBFS, with timestamps and bounded durations. It does not compute
BPM/key; the generic client retains `external-unverified` provenance. HTTP success
alone establishes no capture quality. Errors never trigger automatic retries.

The authorized live pass exercised all six Ear tools. A 3-second WAV contained
144000 frames; provider RMS was −12.2881 dBFS and peak −5.1315 dBFS. Independent ffmpeg
measurement reported −12.3/−5.1 dBFS, consistent at its displayed precision. This is
evidence of the selected output-monitor capture and measured signal, not musical
quality or a complete arrangement. Offline tests remain separate synthetic
transport/PCM evidence. See the provider document for exact interpretation.

A later end-to-end Polysynth clip probe returned a separate three-second WAV,
144000 frames, peak −18.2917 dBFS and RMS −33.2474 dBFS. Digital silence was
measured before playback and in a three-second capture after stopping. Together
with the device/clip readbacks, this establishes that bounded sound-producing
workflow; it does not assess musical quality or prove every note was rendered.

## Aliases and remaining limitations

`clip_slot_select` maps to the existing slot-selection RPC under clip_write.
`mcp_search_tools` and `mcp_execute_advanced_tool` require the same discovery opt-in
as modern wrappers. All four names are excluded as recursive targets; aliases
preserve cloning, schema validation and policy rechecks.

Cue-color writes still lack a public setter in the inspected API. That historical
stub is not re-exposed as fake functionality. Earlier acceptance established
bounded routed MIDI/audio cases. The latest pass adds the specific device loading,
observer/readback, pressure-rejection, browser wildcard/pagination, member-pitch
MPE and Ear outcomes above. Polyphonic-aftertouch mapping remains unvalidated,
and immediate exit/reload audio cleanup remains unproven. Other MPE dimensions
and target contexts need their own evidence. Full musical parity is not
established by the catalogue count or these selected successes.

## Bounded project persistence witness

A live [save/reopen witness](BITWIG_MCP_PERSISTENCE.md) now verifies persisted
content within an explicit scope. Save As and Save persisted a three-note clip;
a fourth note was then added without saving. Closing with No to the save prompt
and reopening the exact saved file restored the three-note state. The bounded
manifest comparison reported zero differences, using numeric tolerance `1e-6`.

The comparison covers eight visible tracks, scenes, the four-beat clip inspected
over 64 steps and MIDI pitches 0–127 on channel 0, note expressions excluding
unsupported pressure, device inventory and page 0 macros. It does not establish
persistence of the entire arranger, all tracks/channels, every device state or
every remote page. The unsaved fourth-note control and content comparison supply
the evidence; action acknowledgements alone remain insufficient.
