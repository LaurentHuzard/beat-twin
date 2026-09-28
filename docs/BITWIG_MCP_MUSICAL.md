# Musical extensions, MIDI profile and Ear adapter

Tranche6, 2026-09-28. Source catalogue:187 tools /42 default reads. Opt-in
discovery adds four wrappers, for191 total when all policies are enabled.
Controller API15. This is source/offline coverage; live Bitwig acceptance is
pending. [API inventory](BITWIG_CONTROLLER_API_COVERAGE.md) and
[historical matrix](BITWIG_MCP_PARITY.md) distinguish native, adapted and external
capabilities. [Live acceptance plan](BITWIG_LIVE_ACCEPTANCE.md) defines later checks.

## Profiles and policies

The normal generated `BeatTwin.control.js` retains its existing UUID and no MIDI
ports. The optional generated `BeatTwinMidi.control.js` has a distinct UUID/name
and one MIDI input, zero outputs. Both are built from the same maintained core,
`midi.ts` and `creative.ts`; only the explicit profile flag differs. Use only one
profile with the current relay. No profile was installed or reloaded in this work.
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
| `note_input_set_key_translation`, `note_input_set_velocity_translation` | Exactly128 entries, each integer−1..127; −1 suppresses an incoming value. |
| `midi_get_status`, `midi_all_notes_off` | Inspect profile/voice capability; explicit cleanup/panic under midi_write. |

NoteInput raw injection ignores the MIDI channel and bypasses key/velocity
translation. Raw/note schemas therefore reject nonzero channel claims. Translation
and MPE tools configure routed incoming MIDI; they do not transform raw injected
notes. This corrects unsupported historical assumptions rather than imitating them.

Note-offs are actually scheduled. Per-pitch generation tokens stop stale timers
from releasing a newer voice; duplicate held pitches are rejected. Cleanup runs on
disconnect/exit and is independent of subsequent policy revocation. Hold-controller
leases and panic bound sustained notes. Cleanup remains best effort if the host
throws or the process terminates abruptly; no audio silence is claimed offline.

## Note expressions

`clip_get_note_expressions` reads1–256 unique step/pitch coordinates in the selected
launcher clip: current track/scene bank0–7, channel0, steps0–63 at0.25beats,
pitches0–127. Every coordinate must be an observed NoteOn, not sustain/empty.
The response includes a snapshot and bounded coverage, not full MIDI export.

`clip_set_note_expressions` requires that snapshot and validates the entire batch
before the first setter. Velocity/releaseVelocity/pressure/gain are normalized0–1;
pan/timbre−1..1; transpose−96..96semitones. Gain0.5 means0dB. Duration is read in
beats but is not edited by this tool. Each entry must supply at least one
expression field; no implicit note creation or whole-clip replacement.

Snapshots become stale after relevant identity/content changes. Readback requires
observer evidence. Partial results count setters, including failure halfway through
one note; no automatic replay or fictional rollback is supplied.

## Observed browser filters

`browser_get_filter_items` reads one explicit column and a16-item window, with
session/snapshot, coverage and wildcard state. Columns: smartCollection, location,
device, category, tag, deviceType, fileType, creator. Absent/inapplicable columns
are explicit; an empty bank may report offset−1.

`browser_set_filter` deliberately replaces the historical invalid text-search
contract. It accepts `{column,itemIndex,snapshotId}`; index−1 selects the wildcard
(all items),0–15 selects an observed item. It does **not** accept arbitrary search
text and does not claim global text search. `browser_scroll_filter_items` moves a
page forward/backward with the current snapshot. Content/session changes invalidate
old tokens before dispatch. A filter change need not alter result count.

Existing result selection/commit paths are integrated with observed browser state:
selection uses the result item's boolean selection proxy rather than an inferred
count of Next presses. Browser transitions must settle before dependent actions.
Opening/selecting/committing still requires a later real-session check of the loaded
instrument and sound; dispatch alone is not evidence of successful insertion.

Filter changes invalidate result fields separately from the filter transition.
An item without fresh identity callbacks is returned with `available:false` and
unknown fields; it cannot be selected as though the old cached item were current.
Unchanged fields may receive no new callback. That remains explicit unavailability,
not an invented refresh guarantee after a fixed number of flush cycles.

## Remote pages and arranger loop

`device_remote_pages_get` reports bounded page names/count/index and a selected-device
snapshot. `device_remote_page_select` validates index against observed count and
waits for the new page before remote-control writes resume. Duplicate page names
or parameter values do not establish identity. No arbitrary plugin parameter ID
is guessed.

After a page change, each remote control has its own availability. Missing fresh
name/value observations produce `available:false` and null fields. A write requires
the targeted control to be observed; unused controls do not lock all other writes.

`transport_get_arranger_loop` observes enabled/start/duration/end in quarter-note
beats. `transport_set_arranger_loop` requires its snapshot, stopped transport,
recording off, positive duration and start+duration within the bridge's1048576beat
bound. Multiple setters are not atomic; only changed values are dispatched, and
partial failures remain explicit. Cue-position editing remains deferred because
moving a cue may reorder its bank and lose index identity.

## Ear: explicit external dependency

Six historical endpoints are adapted by a TypeScript HTTP client. No audio service
is bundled, started or declared ready. Configure `BITWIG_EAR_BASE_URL` only for an
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
payload. Units, BPM/key, audio format and DSP accuracy are not invented or verified.
HTTP success establishes a response, not audible capture quality. Errors never
trigger automatic retries. Ear tests use synthetic HTTP responses, not real audio.

## Aliases and remaining limitations

`clip_slot_select` maps to the existing slot-selection RPC under clip_write.
`mcp_search_tools` and `mcp_execute_advanced_tool` require the same discovery opt-in
as modern wrappers. All four names are excluded as recursive targets; aliases
preserve cloning, schema validation and policy rechecks.

Cue-color writes still lack a public setter in the inspected API. That historical
stub is not re-exposed as fake functionality. Raw MIDI routing, device loading,
MIDI expressions, Ear integration and actual sound require the later live pass.
