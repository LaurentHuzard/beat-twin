# Bitwig MCP parity continuation: application, cues, pads and groove

Date: 2026-09-28. Tranche 5 adds **35 tools: 33 historical names and 2 new
reads**, taking the source catalogue to **161 tools / 37 default reads**.
Optional discovery wrappers are counted separately. The controller now selects
**API 15** explicitly. This is source/offline evidence; the installed controller
has not been replaced and real Bitwig tests remain deferred.

See the [historical matrix](BITWIG_MCP_PARITY.md) and the
[API coverage inventory](BITWIG_CONTROLLER_API_COVERAGE.md). The installation
used for reference inspection reports Bitwig Studio 6.1.1. No older Bitwig
release compatibility is inferred from that installation.

## Tools and inputs

Inputs reject unknown fields, wrong types and invalid ranges. Empty-argument
tools accept `{}`. Indices describe current observed banks, not permanent IDs.
Cue indices are 0–31; drum-pad indices are 0–15. Normalized `value` is 0–1.
Cue names must contain 1–128 characters, be nonblank and contain no control
characters.

| Tools | Arguments | Policy | Scope |
| --- | --- | --- | --- |
| `application_get_status` | none | read | Observed application state and undo/redo availability; focus and clipboard content remain unknown. |
| `application_undo`, `application_redo` | none | application_write | Global edit history, with observed availability; no target-specific rollback promise. |
| `application_cut`, `application_copy`, `application_paste` | none | application_write | Current UI selection/clipboard. Copy changes application clipboard state. |
| `application_delete`, `application_duplicate` | none | application_write | Current focused UI selection, potentially musical material. |
| `application_select_all`, `application_select_none` | none | application_write | Current UI context. |
| `application_arrow_key` | `direction`: left/right/up/down | application_write | Current keyboard focus. |
| `application_enter`, `application_escape` | none | application_write | Current focused UI context/dialog. |
| `application_zoom_in`, `application_zoom_out` | none | application_write | Global focused editor zoom. |
| `arranger_zoom` | `action`: in_all/out_all/in_selected/out_selected | application_write | Arranger lane heights, all or selected lanes; not horizontal timeline zoom. |
| `transport_add_cue_marker`, `arranger_cues_create` | none | application_write | Two historical names for cue creation at playback position. |
| `arranger_cues_rename` | `index`, `name` | application_write | Existing observed cue in the 32-marker bank. |
| `arranger_get_cue_markers` | none | read | Historical alias for the bounded `arranger_cues_list` contract. |
| `arranger_jump_to_cue_marker` | `index` | transport | Historical alias for cue launch; starts quantized playback. |
| `drumpad_get_status` | none | read | Current device's bounded 16-pad bank, with explicit coverage. |
| `drumpad_select` | `index` | device_write | Selects one existing observed drum pad. |
| `drumpad_scroll_forward`, `drumpad_scroll_backward` | none | device_write | Changes current drum-pad bank mapping. |
| `drumpad_set_volume` | `index`, `value` | device_write | Existing pad's normalized volume. |
| `drumpad_set_mute`, `drumpad_set_solo` | `index`, `state`: boolean | device_write | Existing observed pad's state. |
| `groove_get_status` | none | read | Native observed groove parameters. |
| `groove_set_enabled` | `state`: boolean | transport | Enables/disables groove through its normalized parameter. |
| `groove_set_shuffle_amount` | `value` | transport | Normalized shuffle amount, not a timing division. |
| `project_get_status` | none | read | Native project-wide muted/soloed/armed aggregate flags. |
| `project_unsolo_all`, `project_unmute_all`, `project_unarm_all` | none | mixer_write | Native whole-project reset, including tracks outside the current bank. |

The five newly exposed reads are application status, cue-list alias, drum-pad
status, groove status and project status. Direct and discovery calls share the
same validation and current-policy checks. Writes remain hidden and rejected by
default and require authenticated mutation RPCs at the controller boundary.

## Global commands and what their results mean

Application commands explicitly act on current global focus, selection,
clipboard or history. Panel layout is observable; it does **not** identify the
focused widget or selected notes/clips. A successful dispatch does not prove a
particular item was copied/deleted, a dialog accepted, or an undo operation
reverted the agent's preceding command. Results expose those limits instead of
inventing target guarantees. No hidden UI targeting or fallback is performed.

`application_get_status.canUndo/canRedo` are nullable. When history availability
has not been observed after an edit or possible no-op, the fields are `null` and
`availabilityObserved` is false. Two flush cycles do not manufacture a missing
observer callback. Undo/redo require the corresponding settled, observed flag
to be true before dispatch; unknown availability is rejected.

Application commands, arranger zoom, cue writes and project resets require
stopped transport and disabled arranger recording.
Mutation dispatch invalidates previous target bindings before invoking the host.
Observation settlement prevents reusing known-stale bindings, but is not proof
of a command's musical effect. Global destructive commands deserve explicit
intent from the caller; enabling the policy does not make their target known.

## Observed state, structural changes and readback

Drum-pad operations require a valid observed cursor device that reports drum
pads. The bank is a 16-item window; names and local indices do not prove stable
identity across device changes or scrolling. Navigation and selection invalidate
old bindings and wait for relevant observations to settle. Reads must distinguish
unknown data from an absent/empty item. Numeric/boolean writes invalidate their
affected observations until the host echoes state; unchanged known setters may
return without waiting for a callback that will never occur.

The pad bank follows the selected device. The later live pass must check whether
selecting a pad preserves the parent device cursor or moves it into a child
chain. A changed device identity must fail closed rather than silently operating
on another pad bank; mocks do not establish this host selection behavior.

Cue creation is at the host's playback position, without an arbitrary-position
argument. Rename requires an existing observed marker; marker count and bank
coverage retain the earlier transport contract. The alias named `jump` launches
a cue and can start playback. It is not a silent seek.

Project resets call `Project.unsoloAll`, `unmuteAll` and `unarmAll`, rather than
looping over the eight visible tracks. Their aggregate flags provide project
evidence, while per-track banks remain bounded. Groove uses interested
`Parameter` values; it is not an invented project setting or MIDI transform.

`project_get_status.hasSoloedTracks/hasMutedTracks/hasArmedTracks` are also
nullable, with `availabilityObserved` false until all three are known. The
affected flag is invalidated by legacy bank/selected-track mute, solo or arm
writes and by native resets. An aggregate can remain unchanged because another
track still has that state; without a callback it remains `null`, rather than
being presented as verified. Resets require a known settled aggregate; a known
false flag can remain a no-op.

Void host calls can produce no effect. Responses report dispatch and available
observations, not fabricated success. Do not automatically retry structural or
global commands after uncertainty. Existing partial-mutation diagnostics and
reload recovery apply where the structural guard enters an uncertain state.

## API evidence

Official local references inspected:

- `Application.html`: command methods API 1; `canUndo/canRedo` API 15.
- `Arranger.html`: lane-height zoom wrappers and Action APIs annotated 14;
  this tranche uses the explicit API 15 profile.
- `Transport.html`: `addCueMarkerAtPlaybackPosition` API 15.
- `CueMarker.html`: writable `name()` API 15; `getColor()` remains read-only.
- `Device.html`, `DrumPadBank.html`, `DrumPad.html`: native pad bank and channel
  inheritance. Values and bank positions need interested observers.
- `Groove.html`: enabled, shuffle and accent parameters API 1.
- `Project.html`: reset operations and muted/armed aggregate flags API 10.

The controller's previously used constructors and deprecated overloads must also
remain compatible with the API 15 selection; changing the version is not proof
of runtime compatibility. Focused mocks and type/syntax checks exercise the
implemented contract. Live observer behavior and actual musical effects belong
to the later real Bitwig acceptance pass.

## Remaining historical work

After this tranche, 145 of 164 historical names are registered, plus three
documented equivalents. Sixteen names remain: eight MIDI/NoteInput functions,
six Ear integrations, browser filtering and cue color. MIDI routing can use a
separate optional input-enabled controller profile; it must not silently change
the zero-port installation. Browser item/column selection is a supported
alternative to the unproven historical text setter. Cue color lacks a direct
writable proxy in the inspected API. Ear requires a separate service contract.
None of these boundaries are converted into fake successful tools.
