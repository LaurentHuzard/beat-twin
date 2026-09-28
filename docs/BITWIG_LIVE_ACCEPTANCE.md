# Deferred Bitwig real-session acceptance

Prepared 2026-09-28. **NOT RUN.** The user deferred live testing until after the
capability ports. Source tests, mocked observers, packaged tool discovery and API
signatures are not live DAW/audio evidence. This plan includes original tools as
well as restored and new tools; historical presence is not a waiver from testing.

## Evidence record

For every case record: source commit, generated profile checksum, Bitwig/API
version, MCP client/harness, active policies, tool name/input, pre-state, dispatch
reply, subsequent observed state, UI/audio evidence where applicable, cleanup and
verdict. Use `passed`, `failed`, `blocked`, or `not_run`; no partial score promoted
to complete parity. Preserve unexpected errors and delayed/no-op observations.

Keep individual runs bounded. A timeout or partial mutation is not permission to
retry a destructive command. Stop that case, capture readback and recover the
controller/project before a new case. Test a disposable project with captured
baseline; do not use an existing musical session as the destructive fixture.

## Session preparation — later only

1. Confirm source and distribution versions agree. Install one generated controller
   profile, normal first. Check relay connection and bridge profile/instance ID.
2. Start with default read-only policies. Record tools/list counts and verify the
   active harness refreshes its list after a server restart. Discovery aliases
   require explicit opt-in; optional service configuration is separately recorded.
3. Prepare identifiable tracks/devices/clips, more than one bank of tracks/scenes,
   cue markers and returns, and an instrument with drum pads. Record indices,
   absolute positions, names, colors, notes, levels and project settings.
4. For subsequent sound tests, select a conservative output level and an explicit
   monitor/capture route. Record what was actually heard/captured, not just a
   transport boolean. MIDI profile routing and Ear service require separate setup.

## Acceptance matrix

| ID | Scope | Real evidence required |
| --- | --- | --- |
| LIVE-01 | Relay, authentication, policies, discovery | Read-only connection; hidden/blocked writes do not mutate. Selective policies expose only intended classes. Four wrappers reject recursion and cannot bypass a revoked policy. |
| LIVE-02 | Project/track/scene/grid/cursor reads | UI correspondence, absent versus unknown state, bounded coverage, more than eight tracks/scenes/returns. Startup callbacks must initialize before truthful reads. |
| LIVE-03 | Track-bank navigation/visibility | Forward/back/absolute scroll and visible track requests; old binding rejected immediately; newly observed absolute positions agree with UI. |
| LIVE-04 | Track/scene/clip names and colors | Set one reversible value, observe readback, restore; missing target and stale identity produce no edit. Cue color is explicitly unsupported and must not be called as a working tool. |
| LIVE-05 | Clip construction and copying | Create only in an empty slot, verify length/content, duplicate to explicit empty destination, rename/color/delete disposable copy, compare source unchanged. Include bank retarget between inspection and call. |
| LIVE-06 | Notes and expressions | Write a short known pattern, read NoteOn/sustain correctly, clear explicit starts, extend loop. Read/set normalized expressions on selected coordinates; confirm MIDI editor values. Test stale snapshots and multi-setter failure recovery without replay. |
| LIVE-07 | Scenes | Select/launch/stop, create-from-playing and delete disposable scene; observe selection/content/count. Verify queued versus active playback honestly. |
| LIVE-08 | Transport and arranger | Tempo/time signature, play/stop/continue, return/nudge/seek, metronome, punch, overdub and panels. Check units, negative-bound rejection and immediate read-after-write. Restore captured state. |
| LIVE-09 | Cues and arranger loop | Create/name cues, compare bounded list, quantized jump actually starts playback. Change loop enabled/start/duration and observe each value. No arbitrary timeline-region editing claim. |
| LIVE-10 | Mix and global resets | Track/master/send/return values, pan, mute/solo/arm. Include hidden tracks in native project resets. Cross-proxy cursor values cannot falsely confirm old state after writes. |
| LIVE-11 | Devices and remote pages | Bypass/unbypass, navigate first/last/next/previous, disposable deletion. Read/select remote page and observe correct parameter target before a write. Test identical page/parameter names. |
| LIVE-12 | Browser and sound loading | Before/after/replace context, filter wildcard/items and page navigation, result selection and commit/cancel. Session reopen invalidates old snapshot. Confirm actual inserted device and audition sound; browser closing alone is insufficient. |
| LIVE-13 | Drum pads | Device without pads fails explicitly; list/select/pan-independent volume/mute/solo and bank pages. Determine whether selecting a pad changes FOLLOW_SELECTION parent cursor; no subsequent write may silently target another device. |
| LIVE-14 | Groove | Enabled boolean through normalized parameter, shuffle read/write and audible timing change. Restore all captured settings. Normalized values do not imply musical percentage or division without evidence. |
| LIVE-15 | Global Application | In a known disposable focused editor: undo/redo, copy/cut/paste/delete/duplicate, selection/arrows/enter/escape/zoom. Include legal no-op, unknown availability and changed focus. Never infer target from panel layout. |
| LIVE-16 | Optional MIDI profile | Stop/remove normal instance before MIDI profile. Verify UUID/one input and explicit routing. Note on/off/play duration, duplicate rejection, leases, old timer versus new voice, hold controllers, panic, disconnect/exit cleanup. Confirm no stuck audible notes. |
| LIVE-17 | MIDI input transforms/MPE | Test routed physical/virtual incoming MIDI separately from raw injection; verify translation tables and expression/MPE behavior. Raw channel is ignored and mappings bypassed: tests must not claim otherwise. |
| LIVE-18 | Optional Ear service | Confirm selected capture device/source, then exercise status/levels/devices/set/listen/analyze under audio_capture. Validate actual payload semantics, duration, audible recording and analysis quality independently of HTTP success. No service means blocked, not passed. |
| LIVE-19 | Recovery and concurrency | No-op host, disconnect, unavailable callbacks, user edits during pending operations, project switch, bank/device/cursor change, delayed responses. Ensure old targets/timers/snapshots cannot silently apply to replacement objects. |
| LIVE-20 | Musical end-to-end | Construct a short dark-acid phrase, choose/load instrument, program drums/bass, modulate expression/macros, set levels/groove, develop a launcher structure and record performance if supported. Read back structure, hear/capture playback, save manually, reopen and compare. A tool-count increase is not a completed track. |

## Coverage checklist per tool

Build the run's checklist from the live policy-enabled MCP catalogue and the
historical matrix, not a copied count. For every tool, exercise one valid case,
one invalid/stale/absent case where meaningful, policy rejection for mutations,
and observed outcome/cleanup. Aliases additionally compare dispatch and error
behavior with the canonical tool. Document coverage limits: selected launcher
windows, cue32/pad16/item16 banks, explicit channels, device scope and external Ear.

Unsupported capability rows stay `unsupported` with API evidence. External
service rows stay `blocked` if their dependency is absent. Wrapper availability,
HTTP200 and controller dispatch acknowledgements must never turn these into passes.

## Exit criteria

- No unexplained wrong-target edits or stuck notes; all uncertain partial effects
  recorded and recovered.
- Expected live values and actual UI/audio agree for tested musical paths.
- Baseline or disposable cleanup documented; persisted state reopened where relevant.
- Every tool/capability has an evidence-backed verdict, including not-run/blocked
  exclusions. Model autonomy (MUE/Gemma) is evaluated in a separate later harness
  run after deterministic tool behavior is established.
