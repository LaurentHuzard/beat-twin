# Bitwig MCP capability parity and port plan

Audit dates: 2026-09-27 (tranche 1), 2026-09-28 (tranche 2). Historical source: `llm2Bitwig` advanced branch at
`52563e4be42da37abf589245dd9ce3862c9dd7e1`. This inventory follows each catalogue
name through the Java dispatch and the modules initialized by `controller-mcp.ts`.
A declaration, a dispatch branch, a handler body, and a successful live operation
are separate levels of evidence. This document establishes source coverage; it
does not claim live verification or that the full port is complete.

## Scope and counts

The historical catalogue has **167 entries / 164 unique names**. The duplicated
names are `arranger_get_status`, `arranger_set_panel_visibility`, and
`arranger_zoom` (two entries each). Before these ports, the base catalogue had
**57 tools**, including **47 historical names** and **10 newer names**. Tranche 1
added **13 historical names**, reaching **70 tools**. Tranche 2 adds **9 historical
names and 4 new names**, reaching **83 tools**, with **22 reads** exposed under
the default read-only policy. Optional discovery wrappers are counted separately.
These are source catalogue counts, not claims about an installed live controller.

Each of the 164 historical names appears exactly once below. Categories are
exclusive and concern this port's status, while the last column records any
historical incompleteness:

- **Current: 47** — same name present before either tranche; not a fresh live claim.
- **Ported 1: 13** — historical name added in the inspection/navigation tranche.
- **Ported 2: 9** — historical name added in the construction tranche.
- **Equivalent: 3** — usable current replacement; historical alias is not registered.
- **Next: 61** — historical handler exists; explicitly deferred to a later tranche.
- **Stub: 2** — historical handler deliberately does not execute the requested operation.
- **External: 6** — separate Ear service integration; outside the controller.
- **Unwired: 23** — missing Java dispatch or missing/uninitialized controller handler.

`clip_get_notes` is counted as Ported 1 because it now has a bounded implementation;
its historical implementation was also a stub. Thus the audit identifies **three
historical stubs**, of which two remain deferred.

## First tranche: inspection before musical construction

The added reads are `project_get_summary`, `track_list`, `track_get_info`,
`clip_get_grid`, `clip_get_status`, and `clip_get_notes`. Added mutations are
track bank forward/backward/absolute navigation, scrolling a track into view,
track naming/color, and scene naming. Navigation is a mutation because it changes
the bank-relative meaning of subsequent indices.

All track/scene indices in these tools refer to the current eight-item bank.
The grid contains eight tracks by eight launcher slots; it is not a full project
or arranger snapshot. Re-inspect after navigation and use reported absolute
positions where supplied. Names are bounded to 128 characters; colors use `r`,
`g`, `b` in [0, 1]. `track_set_color` therefore intentionally differs from the old
`red`, `green`, `blue` schema. New tool schemas reject unknown properties and
validate finite integer indices. The existing bridge authentication and MCP
write policy apply to new mutations.

`clip_get_notes` requires `trackIndex` and `sceneIndex`, matching the currently
selected launcher cursor; it does not select another clip as a side effect.
Its scope is **MIDI channel 0, steps 0–63, pitches 0–127, step size 0.25 beats**.
The response is a bounded observation with explicit coverage, not a full MIDI
export. A missing, mismatched, or unsettled cursor is an error. An empty notes
array only means no note starts were observed in this window and channel; the
API inspection does not establish that the clip is an empty MIDI clip or classify
its audio/MIDI content. The historical inputs (`startStep`, `stepCount`, `pitch`) are not
accepted. Coverage beyond that window, other channels, expressions, overlap and
full-fidelity MIDI round trips need a separate contract.

The current `target.*` Agent-mode bridge already has bounded cursor inspection
and note reads. Reuse its supported API patterns while preserving target identity
and keeping launcher-bank navigation from silently retargeting an approved plan.
The existence of a read API alone does not make autonomous full-track composition
ready.

## Second tranche: bounded launcher construction

See [the construction contract](BITWIG_MCP_CONSTRUCTION.md) for the complete tool
list, API evidence, overwrite limits, partial batch semantics, and offline/live
verification boundary. Nine historical rows below move to Ported 2.

Four additional names **do not belong to the historical 164-name catalogue**:
`clip_rename`, `clip_set_notes`, `clip_clear_notes`, and `clip_set_loop_length`.
They add selected-cursor naming, bounded batch insertion/removal, and loop length
control. Their inclusion in the 83-tool catalogue does not change the historical
matrix denominator.

## Complete historical-name matrix

`Next` means source-level port candidate, not guaranteed API correctness. Current
and Ported 1/2 identify exact registered names. Equivalent identifies replacements,
not source-compatible aliases. Historical module names refer to the archived
`bitwig-controller/modules/` files.

| Historical unique name | Status | Current name or next action | Historical execution evidence / limits |
| --- | --- | --- | --- |
| `mcp_search_tools` | Equivalent | `search_tools (opt-in; schema differs)` | Java server discovery/dispatch |
| `mcp_execute_advanced_tool` | Equivalent | `call_tool (opt-in; schema differs)` | Java server discovery/dispatch |
| `ear_status` | External | `Deferred: Ear service` | Java → HTTP |
| `ear_get_levels` | External | `Deferred: Ear service` | Java → HTTP |
| `ear_list_devices` | External | `Deferred: Ear service` | Java → HTTP |
| `ear_set_device` | External | `Deferred: Ear service` | Java → HTTP |
| `ear_listen` | External | `Deferred: Ear service` | Java → HTTP |
| `ear_analyze` | External | `Deferred: Ear service` | Java → HTTP |
| `transport_play` | Current | `transport_play` | `transport.play` / Transport |
| `transport_stop` | Current | `transport_stop` | `transport.stop` / Transport |
| `transport_restart` | Current | `transport_restart` | `transport.restart` / Transport |
| `transport_record` | Current | `transport_record` | `transport.record` / Transport |
| `transport_get_tempo` | Current | `transport_get_tempo` | `transport.getTempo` / Transport |
| `transport_set_tempo` | Current | `transport_set_tempo` | `transport.setTempo` / Transport |
| `transport_get_position` | Current | `transport_get_position` | `transport.getPosition` / Transport |
| `transport_set_position` | Current | `transport_set_position` | `transport.setPosition` / Transport |
| `transport_playing_status` | Current | `transport_playing_status` | `transport.getIsPlaying` / Transport |
| `transport_get_recording_status` | Ported 2 | `transport_get_recording_status` | `transport.getIsRecording` / Transport |
| `track_bank_get_status` | Current | `track_bank_get_status` | `track.bank.get_status` / TrackBank |
| `track_bank_set_volume` | Current | `track_bank_set_volume` | `track.bank.volume` / TrackBank |
| `track_bank_set_pan` | Current | `track_bank_set_pan` | `track.bank.pan` / TrackBank |
| `track_bank_set_mute` | Current | `track_bank_set_mute` | `track.bank.mute` / TrackBank |
| `track_bank_set_solo` | Current | `track_bank_set_solo` | `track.bank.solo` / TrackBank |
| `track_bank_select` | Current | `track_bank_select` | `track.bank.select` / TrackBank |
| `track_delete` | Next | `Deferred: track_delete` | `track.delete` / TrackBank |
| `track_rename` | Ported 1 | `track_rename` | `track.rename` / TrackBank |
| `track_duplicate` | Next | `Deferred: track_duplicate` | `track.duplicate` / TrackBank |
| `track_set_color` | Ported 1 | `track_set_color` | `track.set_color` / TrackBank — New r/g/b fields replace historical red/green/blue. |
| `track_list` | Ported 1 | `track_list` | `track.list` / TrackBank — Visible bank, not all tracks in project. |
| `track_get_info` | Ported 1 | `track_get_info` | `track.get_info` / TrackBank |
| `track_scroll_into_view` | Ported 1 | `track_scroll_into_view` | `track.scroll_into_view` / TrackBank |
| `track_bank_scroll_forward` | Ported 1 | `track_bank_scroll_forward` | `track.bank.scroll_forward` / TrackBank |
| `track_bank_scroll_backward` | Ported 1 | `track_bank_scroll_backward` | `track.bank.scroll_backward` / TrackBank |
| `track_bank_scroll_to_position` | Ported 1 | `track_bank_scroll_to_position` | `track.bank.scroll_to_position` / TrackBank |
| `clip_launch` | Current | `clip_launch` | `clip.launch` / TrackBank |
| `clip_record` | Current | `clip_record` | `clip.record` / TrackBank |
| `clip_stop` | Current | `clip_stop` | `clip.stop` / TrackBank |
| `clip_get_status` | Ported 1 | `clip_get_status` | `clip.get_status` / TrackBank |
| `clip_get_grid` | Ported 1 | `clip_get_grid` | `clip.get_grid` / TrackBank |
| `clip_set_color` | Ported 2 | `clip_set_color` | `clip.set_color` / TrackBank |
| `clip_get_color` | Ported 2 | `clip_get_color` | `clip.get_color` / TrackBank |
| `scene_launch` | Current | `scene_launch` | `scene.launch` / SceneBank |
| `scene_list` | Current | `scene_list` | `scene.list` / SceneBank |
| `scene_create` | Current | `scene_create` | `scene.create` / SceneBank |
| `scene_delete` | Ported 2 | `scene_delete` | `scene.delete` / SceneBank |
| `scene_rename` | Ported 1 | `scene_rename` | `scene.rename` / SceneBank |
| `scene_select` | Ported 2 | `scene_select` | `scene.select` / SceneBank |
| `scene_create_from_playing` | Ported 2 | `scene_create_from_playing` | `scene.create_from_playing` / SceneBank |
| `clip_duplicate` | Ported 2 | `clip_duplicate` | `clip.duplicate` / TrackBank — new explicit source/destination schema; copies into an observed empty slot. |
| `clip_slot_select` | Equivalent | `clip_select_slot` | `clip.select_slot` / TrackBank |
| `clip_create` | Current | `clip_create` | `clip.create` / TrackBank |
| `clip_delete` | Ported 2 | `clip_delete` | `clip.delete` / TrackBank |
| `clip_browse_insert` | Ported 2 | `clip_browse_insert` | `clip.browse_insert` / TrackBank |
| `track_selected_get_status` | Current | `track_selected_get_status` | `track.selected.get_status` / Cursor |
| `track_selected_set_volume` | Current | `track_selected_set_volume` | `track.selected.volume` / Cursor |
| `track_selected_set_pan` | Current | `track_selected_set_pan` | `track.selected.pan` / Cursor |
| `track_selected_set_mute` | Current | `track_selected_set_mute` | `track.selected.mute` / Cursor |
| `track_selected_set_solo` | Current | `track_selected_set_solo` | `track.selected.solo` / Cursor |
| `track_selected_set_arm` | Current | `track_selected_set_arm` | `track.selected.arm` / Cursor |
| `cursor_track_get_status` | Next | `Deferred: cursor_track_get_status` | `cursor_track.get_status` / Cursor — Current selected status APIs overlap, but do not return the full historical fields. |
| `cursor_device_get_status` | Next | `Deferred: cursor_device_get_status` | `cursor_device.get_status` / Cursor — Current selected status APIs overlap, but do not return the full historical fields. |
| `cursor_clip_get_status` | Next | `Deferred: cursor_clip_get_status` | `cursor_clip.get_status` / Cursor — Current selected status APIs overlap, but do not return the full historical fields. |
| `application_create_instrument_track` | Current | `application_create_instrument_track` | `application.createInstrumentTrack` / Application |
| `application_create_audio_track` | Current | `application_create_audio_track` | `application.createAudioTrack` / Application |
| `application_create_effect_track` | Next | `Deferred: application_create_effect_track` | `application.createEffectTrack` / Application |
| `device_get_status` | Current | `device_get_status` | `device.get_status` / Cursor |
| `device_toggle_window` | Current | `device_toggle_window` | `device.toggle_window` / Cursor |
| `device_toggle_expanded` | Current | `device_toggle_expanded` | `device.toggle_expanded` / Cursor |
| `device_list` | Current | `device_list` | `device.list` / Device |
| `device_bypass` | Next | `Deferred: device_bypass` | `device.bypass` / Device |
| `device_delete` | Next | `Deferred: device_delete` | `device.delete` / Device |
| `device_get_remote_controls` | Current | `device_get_remote_controls` | `device.get_remote_controls` / Cursor |
| `device_set_remote_control` | Current | `device_set_remote_control` | `device.set_remote_control` / Cursor |
| `device_page_next` | Current | `device_page_next` | `device.page_next` / Cursor |
| `device_page_previous` | Current | `device_page_previous` | `device.page_previous` / Cursor |
| `device_select_next` | Next | `Deferred: device_select_next` | `device.select_next` / Cursor |
| `device_select_previous` | Next | `Deferred: device_select_previous` | `device.select_previous` / Cursor |
| `device_select_first` | Next | `Deferred: device_select_first` | `device.select_first` / Cursor |
| `device_select_last` | Next | `Deferred: device_select_last` | `device.select_last` / Cursor |
| `device_browse_insert_before` | Next | `Deferred: device_browse_insert_before` | `device.browse_insert_before` / Cursor — Current device_browse_* insertion APIs overlap; selected-device replacement semantics not equivalent. |
| `device_browse_insert_after` | Next | `Deferred: device_browse_insert_after` | `device.browse_insert_after` / Cursor — Current device_browse_* insertion APIs overlap; selected-device replacement semantics not equivalent. |
| `device_browse_replace` | Next | `Deferred: device_browse_replace` | `device.browse_replace` / Cursor — Current device_browse_* insertion APIs overlap; selected-device replacement semantics not equivalent. |
| `clip_get_info` | Current | `clip_get_info` | `clip.get_info` / Clip |
| `clip_set_note` | Current | `clip_set_note` | `clip.set_note` / Clip |
| `clip_clear_note` | Current | `clip_clear_note` | `clip.clear_note` / Clip |
| `clip_toggle_note` | Current | `clip_toggle_note` | `clip.toggle_note` / Clip |
| `clip_get_notes` | Ported 1 | `clip_get_notes` | `clip.get_notes` / Clip — Historical Clip handler was a stub. New implementation reads bounded selected cursor; changed input schema. |
| `mixer_get_master_volume` | Next | `Deferred: mixer_get_master_volume` | `mixer.master.get_volume` / Mixer |
| `mixer_set_master_volume` | Next | `Deferred: mixer_set_master_volume` | `mixer.master.set_volume` / Mixer |
| `mixer_get_send_level` | Next | `Deferred: mixer_get_send_level` | `mixer.track.get_send` / TrackBank |
| `mixer_set_send_level` | Next | `Deferred: mixer_set_send_level` | `mixer.track.set_send` / TrackBank |
| `mixer_return_list` | Next | `Deferred: mixer_return_list` | `mixer.return.list` / Mixer |
| `mixer_return_set_volume` | Next | `Deferred: mixer_return_set_volume` | `mixer.return.volume` / Mixer |
| `mixer_return_set_pan` | Next | `Deferred: mixer_return_set_pan` | `mixer.return.pan` / Mixer |
| `project_get_summary` | Ported 1 | `project_get_summary` | `project.get_summary` / controller-mcp — Visible bank only; new shape is not the old selection/mixer/arranger aggregate. |
| `arranger_get_status` | Next | `Deferred: arranger_get_status` | `arranger.get_status` / Arranger |
| `arranger_set_panel_visibility` | Next | `Deferred: arranger_set_panel_visibility` | `arranger.set_panel_visibility` / Arranger |
| `arranger_zoom` | Next | `Deferred: arranger_zoom` | `arranger.zoom` / Arranger |
| `arranger_get_cue_markers` | Unwired | `Deferred: implement/fix wiring` | Java only / missing dispatch — No Java dispatch case; use future arranger_cues_list/jump port. |
| `arranger_jump_to_cue_marker` | Unwired | `Deferred: implement/fix wiring` | Java only / missing dispatch — No Java dispatch case; use future arranger_cues_list/jump port. |
| `midi_send_raw` | Unwired | `Deferred: implement/fix wiring` | `note_input.send_raw_midi` / no active handler — NoteInput.ts handler exists but module not initialized; zero MIDI ports. note_play only sends note-on. |
| `note_on` | Unwired | `Deferred: implement/fix wiring` | `note_input.send_note_on` / no active handler — NoteInput.ts handler exists but module not initialized; zero MIDI ports. note_play only sends note-on. |
| `note_off` | Unwired | `Deferred: implement/fix wiring` | `note_input.send_note_off` / no active handler — NoteInput.ts handler exists but module not initialized; zero MIDI ports. note_play only sends note-on. |
| `note_play` | Unwired | `Deferred: implement/fix wiring` | `note_input.send_note_on` / no active handler — NoteInput.ts handler exists but module not initialized; zero MIDI ports. note_play only sends note-on. |
| `note_input_assign_expression` | Unwired | `Deferred: implement/fix wiring` | `note_input.assign_poly_aftertouch_to_expression` / no active handler — No corresponding handler even in uninitialized NoteInput.ts. |
| `note_input_set_mpe` | Unwired | `Deferred: implement/fix wiring` | `note_input.set_use_expressive_midi` / no active handler — No corresponding handler even in uninitialized NoteInput.ts. |
| `note_input_set_key_translation` | Unwired | `Deferred: implement/fix wiring` | `note_input.set_key_translation_table` / no active handler — No corresponding handler even in uninitialized NoteInput.ts. |
| `note_input_set_velocity_translation` | Unwired | `Deferred: implement/fix wiring` | `note_input.set_velocity_translation_table` / no active handler — No corresponding handler even in uninitialized NoteInput.ts. |
| `drumpad_get_status` | Unwired | `Deferred: implement/fix wiring` | `drumpad.get_status` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `drumpad_select` | Unwired | `Deferred: implement/fix wiring` | `drumpad.select` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `drumpad_scroll_forward` | Unwired | `Deferred: implement/fix wiring` | `drumpad.scroll_forward` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `drumpad_scroll_backward` | Unwired | `Deferred: implement/fix wiring` | `drumpad.scroll_backward` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `drumpad_set_volume` | Unwired | `Deferred: implement/fix wiring` | `drumpad.set_volume` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `drumpad_set_mute` | Unwired | `Deferred: implement/fix wiring` | `drumpad.set_mute` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `drumpad_set_solo` | Unwired | `Deferred: implement/fix wiring` | `drumpad.set_solo` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `groove_get_status` | Unwired | `Deferred: implement/fix wiring` | `groove.get_status` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `groove_set_enabled` | Unwired | `Deferred: implement/fix wiring` | `groove.set_enabled` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `groove_set_shuffle_amount` | Unwired | `Deferred: implement/fix wiring` | `groove.set_shuffle_amount` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `project_unsolo_all` | Unwired | `Deferred: implement/fix wiring` | `project.unsolo_all` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `project_unmute_all` | Unwired | `Deferred: implement/fix wiring` | `project.unmute_all` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `project_unarm_all` | Unwired | `Deferred: implement/fix wiring` | `project.unarm_all` / no active handler — Java dispatch exists; no handler in initialized controller modules. |
| `arranger_cues_create` | Stub | `Deferred` | `arranger.cues.create` / Arranger — Always throws; use future transport_add_cue_marker port. |
| `browser_get_status` | Current | `browser_get_status` | `browser.get_status` / Browser |
| `browser_set_filter` | Next | `Deferred: browser_set_filter` | `browser.set_filter` / Browser — Historical smart-collection wildcard call needs API review; not proven text search. |
| `browser_list_results` | Current | `browser_list_results` | `browser.list_results` / Browser |
| `browser_select_result` | Current | `browser_select_result` | `browser.select_result` / Browser |
| `browser_commit` | Current | `browser_commit` | `browser.commit` / Browser |
| `browser_cancel` | Current | `browser_cancel` | `browser.cancel` / Browser |
| `transport_toggle_metronome` | Next | `Deferred: transport_toggle_metronome` | `transport.toggle_metronome` / Transport |
| `transport_set_time_signature` | Next | `Deferred: transport_set_time_signature` | `transport.time_signature` / Transport |
| `transport_tap_tempo` | Next | `Deferred: transport_tap_tempo` | `transport.tap_tempo` / Transport |
| `transport_toggle_punch_in` | Next | `Deferred: transport_toggle_punch_in` | `transport.toggle_punch_in` / Transport |
| `transport_toggle_punch_out` | Next | `Deferred: transport_toggle_punch_out` | `transport.toggle_punch_out` / Transport |
| `transport_set_punch_in` | Next | `Deferred: transport_set_punch_in` | `transport.set_punch_in` / Transport |
| `transport_set_punch_out` | Next | `Deferred: transport_set_punch_out` | `transport.set_punch_out` / Transport |
| `transport_get_punch_status` | Next | `Deferred: transport_get_punch_status` | `transport.get_punch_status` / Transport |
| `transport_toggle_arranger_overdub` | Next | `Deferred: transport_toggle_arranger_overdub` | `transport.toggle_arranger_overdub` / Transport |
| `transport_toggle_launcher_overdub` | Next | `Deferred: transport_toggle_launcher_overdub` | `transport.toggle_launcher_overdub` / Transport |
| `transport_get_overdub_status` | Next | `Deferred: transport_get_overdub_status` | `transport.get_overdub_status` / Transport |
| `transport_continue_playback` | Next | `Deferred: transport_continue_playback` | `transport.continue_playback` / Transport |
| `transport_return_to_zero` | Next | `Deferred: transport_return_to_zero` | `transport.return_to_zero` / Transport |
| `transport_fast_forward` | Next | `Deferred: transport_fast_forward` | `transport.fast_forward` / Transport |
| `transport_rewind` | Next | `Deferred: transport_rewind` | `transport.rewind` / Transport |
| `transport_nudge_forward` | Next | `Deferred: transport_nudge_forward` | `transport.nudge_forward` / Transport |
| `transport_nudge_backward` | Next | `Deferred: transport_nudge_backward` | `transport.nudge_backward` / Transport |
| `arranger_cues_list` | Next | `Deferred: arranger_cues_list` | `arranger.cues.list` / Arranger |
| `arranger_cues_jump` | Next | `Deferred: arranger_cues_jump` | `arranger.cues.jump` / Arranger |
| `arranger_cues_rename` | Next | `Deferred: arranger_cues_rename` | `arranger.cues.rename` / Arranger |
| `arranger_cues_color` | Stub | `Deferred` | `arranger.cues.color` / Arranger — Always throws: cue marker color read-only in historical API. |
| `transport_add_cue_marker` | Next | `Deferred: transport_add_cue_marker` | `transport.add_cue_marker` / Transport |
| `application_undo` | Next | `Deferred: application_undo` | `application.undo` / Application |
| `application_redo` | Next | `Deferred: application_redo` | `application.redo` / Application |
| `application_cut` | Next | `Deferred: application_cut` | `application.cut` / Application |
| `application_copy` | Next | `Deferred: application_copy` | `application.copy` / Application |
| `application_paste` | Next | `Deferred: application_paste` | `application.paste` / Application |
| `application_delete` | Next | `Deferred: application_delete` | `application.delete` / Application |
| `application_duplicate` | Next | `Deferred: application_duplicate` | `application.duplicate` / Application |
| `application_select_all` | Next | `Deferred: application_select_all` | `application.select_all` / Application |
| `application_select_none` | Next | `Deferred: application_select_none` | `application.select_none` / Application |
| `application_arrow_key` | Next | `Deferred: application_arrow_key` | `application.arrow_key` / Application |
| `application_enter` | Next | `Deferred: application_enter` | `application.enter` / Application |
| `application_escape` | Next | `Deferred: application_escape` | `application.escape` / Application |
| `application_zoom_in` | Next | `Deferred: application_zoom_in` | `application.zoom_in` / Application |
| `application_zoom_out` | Next | `Deferred: application_zoom_out` | `application.zoom_out` / Application |

## Deferred delivery sequence

1. **Further musical construction:** occupancy-aware creation, broader verified
   note readback, full-fidelity MIDI and cross-track copy remain separate from
   tranche 2. Its duplication, names/colors, bounded note batches and selected
   scene operations are documented in the construction contract. Avoid
   destructive destinations and confirm the effective target before mutations.
2. **Sound and mix:** device navigation and replacement, real browser filtering,
   sends/returns/master, effect-track creation. Loading an instrument requires a
   device identity and settled browser result, not a successful request alone.
3. **Song form:** advanced transport, overdub, scene construction, cue markers
   and arranger view controls. These historical arranger handlers control views
   and markers; they do not establish arbitrary timeline clip-region editing.
4. **Separate feasibility work:** raw MIDI, expressive MIDI, drum pads, groove,
   project-wide bulk actions and Ear. These include missing wiring, missing
   implementations and external services; they cannot be recovered just by
   copying the historical catalogue.

## API and correctness review

- The repository's `bitwig-api-docs/README.md` explicitly says the API reference
  corpus was removed for redistribution reasons. It is not a local API spec.
  Historical TypeScript establishes implementation intent, not runtime support.
  The installed official reference under
  `/opt/bitwig-studio/resources/doc/control-surface/api/` was independently
  checked for `Clip.getStep`, `Clip.addNoteStepObserver`, `NoteStep` state values,
  and inherited `TrackBank` scroll/count APIs. These signatures are supported;
  asynchronous runtime behavior still needs the live smoke gate. No reference
  text or generated API notes are redistributed in this document.
- `Clip.getStep(channel, step, pitch)` and `NoteStep.state() == "NoteOn"` are
  already used by the current bounded target reader. Count note starts, not
  sustain cells. Velocity is normalized at the API boundary; convert once to
  MIDI 1–127. Durations are beats, not grid cells. Asynchronous cursor changes
  and bank navigation need stable identity and settled observations. The
  implementation waits for two controller flush cycles without relevant
  observer changes; this is a settling heuristic pending live validation, not
  a documented atomic snapshot guarantee.
- Track-bank indices are local; `track.position()` supplies project position.
  Scroll requests must validate finite integers against known item count. An
  acknowledgement is not proof that the next observed bank has settled.
- Interested flags and observers must be initialized before reading clip
  existence, occupancy, names, colors, and cursor identity. Unknown cached data
  must not be presented as an available empty slot.
- Historical `arranger_cues_create` always throws and redirects to
  `transport.add_cue_marker`. Historical `arranger_cues_color` always throws a
  read-only limitation. Do not present either as a restored write capability.
- Historical `note_play` dispatched only note-on: its apparent duration was not
  implemented. MIDI requires explicit port configuration, note-off guarantees,
  cleanup on failure and an instantiated module. The historical controller
  declared zero MIDI ports and never initialized `NoteInputModule`.
- Historical browser filtering used a smart-collection wildcard setter. Verify
  that API and intended search semantics before porting. Browser result
  selection used first/next stepping, so selection must be read back after any
  asynchronous result change.
- The historical summary swallowed errors while combining modules. The new
  summary must report unavailable data honestly instead of implying a complete
  project from a single bank.

## Why the coverage diverged

The loss was a branch-lineage divergence, not evidence that every absent historical tool
was working and deliberately deleted from the current server.

| Date | Primary Git evidence | Consequence |
| --- | --- | --- |
| 2026-01-29 | Historical main `829514acc44291278195a1cd0ad7a492719a3dc3`; Beat Twin ancestor `4bd384192fa94e03137caafc064d4d006db53373` | Both `index.js` paths share blob `413b5ab7790659bf841cf87356a46ab7acd54a56`. |
| February–June | Advanced branch reaches `52563e4be42da37abf589245dd9ce3862c9dd7e1`; Java and modular controllers evolve separately | Advanced catalogue and controller do not enter old main. |
| 2026-06-17 | Beat Twin `0fbc21c049244da0863fb04eba744569d01f3ccc`, direct parent `4bd384192fa94e03137caafc064d4d006db53373`; restoration recorded in STATUS | Recovery after reformatting continues the January lineage. |
| 2026-07-07 / 2026-07-10 | Conservative scope in `d57ef8b2b974360764bc293b426d1a6150f429c3`, then 57-tool compatibility baseline in `d64067e` | Tests protect the restored baseline; they do not prove historical feature parity. |
| 2026-07-18 | Archive decision `22e39123549fde7684c074a528828995f2d0727d` | Old project redirects to Beat Twin while advanced branch remains in archive. |

The sources establish the lineage and archive decision. They do not establish
why the earlier base was selected or an intention to remove capabilities.
No parity-transfer audit was found in the examined restoration/archive records.

## Reproducible evidence

- [Historical catalogue](https://github.com/LaurentHuzard/llm2Bitwig/blob/52563e4be42da37abf589245dd9ce3862c9dd7e1/server-mcp-java/src/main/resources/tools.json)
- [Historical Java dispatch](https://github.com/LaurentHuzard/llm2Bitwig/blob/52563e4be42da37abf589245dd9ce3862c9dd7e1/server-mcp-java/src/main/java/com/beattwin/mcp/tools/BitwigTools.java)
- [Historical controller modules and bootstrap](https://github.com/LaurentHuzard/llm2Bitwig/tree/52563e4be42da37abf589245dd9ce3862c9dd7e1/bitwig-controller)
- [Restoration commit](https://github.com/LaurentHuzard/beat-twin/commit/0fbc21c049244da0863fb04eba744569d01f3ccc)
- [Archive decision](https://github.com/LaurentHuzard/llm2Bitwig/blob/22e39123549fde7684c074a528828995f2d0727d/ARCHIVE.md)
- Current [`index.ts`](../index.ts), controller source under
  [`bitwig-controller/BeatTwin`](../bitwig-controller/BeatTwin), and
  [`bitwig-api-docs/README.md`](../bitwig-api-docs/README.md).

The full-name inventory is the durable backlog. Offline checks and live smoke
results belong to the implementation report; this document does not infer live
success from catalogue count or mocked controller responses.
