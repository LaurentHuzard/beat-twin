# Bitwig MCP transport and bounded arranger port

Date: 2026-09-28. Tranche 3 adds **21 historical tool names**: 17 transport tools
and 4 arranger/cue tools. The source catalogue reaches **104 tools**, including
**26 reads** under the default read-only policy. Optional discovery wrappers are
counted separately. The [historical parity inventory](BITWIG_MCP_PARITY.md)
contains all 164 historical unique names and the remaining backlog.

This tranche controls transport, arranger panels and cue playback. It does not
add timeline clip-region editing, cue creation, cue renaming or arranger zoom.
Source/API checks and mocked tests do not establish live Bitwig behavior.

## Tool contracts

All tools reject unknown arguments. A tool shown with no arguments accepts an
empty object. Mutations remain hidden and denied unless their MCP write policy
is enabled, and the controller also requires local relay authentication. Direct
and discovery-dispatched calls use the same validated path.

| Tool | Arguments | Policy | Effect or observation |
| --- | --- | --- | --- |
| `transport_toggle_metronome` | none | transport | Toggles metronome enablement. |
| `transport_set_time_signature` | `numerator`, `denominator` | transport | Sets a signature using the host's string setter. |
| `transport_tap_tempo` | none | transport | Issues one tempo tap; one request is not a complete tapped tempo estimate. |
| `transport_toggle_punch_in` | none | transport | Toggles punch-in enablement. |
| `transport_toggle_punch_out` | none | transport | Toggles punch-out enablement. |
| `transport_set_punch_in` | `state` | transport | Sets punch-in enablement to an explicit boolean. |
| `transport_set_punch_out` | `state` | transport | Sets punch-out enablement to an explicit boolean. |
| `transport_get_punch_status` | none | read | Reads punch-in and punch-out state. |
| `transport_toggle_arranger_overdub` | none | transport | Toggles arranger overdub. |
| `transport_toggle_launcher_overdub` | none | transport | Toggles launcher overdub. |
| `transport_get_overdub_status` | none | read | Reads arranger and launcher overdub state. |
| `transport_continue_playback` | none | transport | Continues playback from the current transport position. |
| `transport_return_to_zero` | none | transport | Requests transport position zero. |
| `transport_fast_forward` | none | transport | Issues one host fast-forward action; no fixed beat distance is promised. |
| `transport_rewind` | none | transport | Issues one host rewind action; no fixed beat distance is promised. |
| `transport_nudge_forward` | none | transport | Requests a one-beat increase with grid snapping disabled. |
| `transport_nudge_backward` | none | transport | Requests a one-beat decrease with grid snapping disabled. |
| `arranger_get_status` | none | read | Reads seven arranger panel/follow flags. |
| `arranger_set_panel_visibility` | `panel`, `state` | application_write | Sets one supported arranger UI flag. |
| `arranger_cues_list` | none | read | Reads the current bounded cue-marker bank. |
| `arranger_cues_jump` | `index` | transport | Launches quantized playback at an existing cue marker. |

`state` is a boolean; truthy numbers or strings are not accepted. `numerator` is
an integer from 1 to 32. `denominator` is one of 1, 2, 4, 8, 16 or 32. The
controller converts the validated pair to a string such as `"7/8"` for
`timeSignature().set(...)`; the historical two-number setter is not reused.
These bounds are this tool's contract, not a claim to expose every signature
Bitwig can represent.

`panel` is one of `timeline`, `io`, `clip_launcher`, `effect_tracks`,
`double_row_height`, `cue_markers`, or `playback_follow`. Density and playback
follow flags use this same interface even though they are not literal panel
visibility controls. Unknown names fail before host mutation.

## Time units and playback semantics

Bitwig transport positions and cue positions use beats measured in quarter
notes. A nudge is **one beat / one quarter note**, not one quarter of a beat.
The controller uses `incPosition(1, false)` or `incPosition(-1, false)`; `false`
disables grid snapping. The controller rejects unknown/nonfinite current
position and a computed destination below zero; a backward nudge from less than
one beat is therefore rejected. The dispatch acknowledgement does not prove the
resulting position. Read the
transport position afterward when the result matters.

`transport_return_to_zero` uses the supported position setter with zero.
Fast-forward and rewind delegate to host actions, so their distance is not
described as a fixed number of beats. Tempo tapping sends one tap per tool call.
No tool repeats, polls or retries a mutation automatically.

Despite its historical name, **`arranger_cues_jump` starts playback** through
`marker.launch(true)`. The boolean requests quantized launch; this is not an
immediate seek-only operation. A successful dispatch does not prove that the
quantization boundary has occurred or audio is playing.

## Cue-bank coverage

The cue bank has **32 entries**, addressed by bank-local indices 0–31. The list
returns `{markers, coverage}`. Each marker includes local `index`,
`absoluteIndex`, `name`, `positionBeats`, and RGB `color`. Coverage contains
`bankSize: 32`, `scrollPosition`, `projectMarkerCount`, and `complete`; the last
flag is true only when offset is zero and all project markers fit in the bank.
This is not an unbounded inventory of every cue in the project. Use the actual bank metadata rather than
assuming all project markers fit in the first window. An empty observed bank
does not establish that a partially observed project contains no cues.

Cue launch validates the integer index, observed existence and marker data
before calling the host. Names use `CueMarker.getName()` because this controller
selects API 10; the newer writable `name()` accessor requires API 15. Positions
are beat-time values. Unknown existence, malformed position/color or unavailable
count data produce an error, not an invented marker or false empty result. The
list also rejects inconsistent count versus observed marker occupancy.

The controller marks values of interest before reading transport state, panel
flags and cue data. Observed groups require two quiet controller flush cycles
before dependent reads/toggles; this is a settling heuristic, not an atomic
project snapshot. Unknown boolean observations must not become `false` through
coercion. Toggling an unavailable state must fail before a host write.

A toggle or a changed boolean setter invalidates that flag synchronously, before
the host call. Reads of that flag and another toggle/set operation must wait for
its observer callback and two quiet flush cycles; time or flushes alone are not
confirmation. An explicit setter equal to the already observed, settled value is
a no-op: it issues no host write and does not wait for a callback that may never
arrive. The acknowledgement remains a bounded request result rather than a claim
that a new host mutation occurred.

## Safety and observation boundaries

Mutation responses acknowledge dispatch and require readback. Toggle actions
are not idempotent; automatically replaying a request after uncertainty could
undo the intended change. Setters also do not establish observation merely by
returning normally. Host errors propagate without a retry loop.

Existing bank-navigation and construction guards remain intact. Independent
`transport.*` RPCs remain available under their authentication and MCP policy
checks while a bank-dependent operation is pending. Arranger RPCs, including
cue launch, retain the existing pending-operation barrier even when their MCP
policy is `transport`. Policy grouping does not bypass controller guards.

The partial-construction recovery contract from
[tranche 2](BITWIG_MCP_CONSTRUCTION.md) is unchanged: diagnostic reads require
settled matching identity, and bank/cursor-dependent mutations remain locked
until reload after a partial host failure.

## Installed API evidence and exclusions

The official API reference installed under
`/opt/bitwig-studio/resources/doc/control-surface/api/` was consulted. No vendor
API reference text or generated corpus is added to the repository.

- `Transport.incPosition(double, boolean)` and the signature string setter are
  documented from API 1. Their units and types differ from tempting but incorrect
  interpretations of the historical handlers.
- The seven supported arranger boolean accessors are documented from API 1.
- `CueMarker.launch(boolean)`, `getName()` and `getColor()` are documented from
  API 2; cue `position()` is documented from API 10.
- Writable `CueMarker.name()` and transport cue creation require API 15. Cue
  creation/renaming are therefore not registered by this tranche.
- Cue color is exposed as a read-only value. The historical write handler always
  threw; the old catalogue entry does not establish a supported color write API.
- The installed reference lists direct arranger zoom methods without an
  introduction version; their Action/stepper counterparts specify API 14. The
  advanced historical controller used API 25, so its code cannot prove these
  methods work under API 10. Zoom stays deferred pending explicit compatibility
  evidence rather than raising the controller API solely for this tranche.

## Adversarial verification targets

The implementation report records actual check results. This list describes the
contract that the review and focused tests must exercise.

- Default policy exposes only the four new reads; direct/discovery mutations
  fail without the correct policy and controller authentication.
- Extra fields, non-object roots, fractional/negative/too-large cue indices,
  invalid denominators, invalid booleans and unknown panel names cause no host
  write. Arguments remain detached across asynchronous validation and policy
  revocation prevents dispatch.
- Every read rejects unknown or malformed host state. Nonexistent cue slots
  are distinguished from unavailable slot state. Cue metadata preserves the
  32-entry window and partial coverage when more markers exist.
- Nudges dispatch exactly `+1`/`-1` beat with snapping false; signature changes
  dispatch one validated string. Cue launch calls `launch(true)` exactly once.
- Host exceptions are reported without retries. Existing bank/construction
  barriers and partial recovery remain covered by regression tests.

No live Bitwig session is modified by these offline checks. Deployment and
musical playback proof are separate steps.
