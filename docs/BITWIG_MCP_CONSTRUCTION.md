# Bitwig MCP bounded launcher construction

Date: 2026-09-28. This is the second capability-port tranche, following the
inspection/navigation baseline merged in PR #94. It adds 13 tools to the source
catalogue: 9 historical names and 4 new names. The catalogue has **83 tools**,
including **22 reads** available with the default read-only policy. Discovery
wrappers remain optional and are counted separately.

This is a launcher construction contract. It does not establish arbitrary
arranger timeline editing, full MIDI export, instrument loading, finished-track
composition, deployment, or live Bitwig verification. See the
[complete historical parity inventory](BITWIG_MCP_PARITY.md) for deferred domains.

## Tools and policies

All indices below are integers from 0 to 7 in the current bank. Re-inspect after
bank navigation; a local index is not a persistent project object identity.
Names contain 1–128 characters, include a non-whitespace character, and exclude
control characters. RGB components are finite values between 0 and 1.

| Tool | Arguments | Policy | Contract |
| --- | --- | --- | --- |
| `transport_get_recording_status` | none | read | Reads arranger recording state. |
| `clip_get_color` | `trackIndex`, `sceneIndex` | read | Reads the targeted existing launcher's clip color. |
| `clip_set_color` | `trackIndex`, `sceneIndex`, `r`, `g`, `b` | clip_write | Changes a targeted clip's color. |
| `clip_rename` | `trackIndex`, `sceneIndex`, `name` | clip_write | Renames the already selected, matching, settled clip cursor. |
| `clip_duplicate` | `trackIndex`, `sourceSceneIndex`, `destinationSceneIndex` | clip_write | Copies within one track to a distinct, observed empty slot. |
| `clip_delete` | `trackIndex`, `sceneIndex` | clip_write | Deletes the targeted clip; no implicit track or scene deletion. |
| `clip_browse_insert` | `trackIndex`, `sceneIndex` | clip_write | Opens the clip browser at an empty target; opening does not confirm insertion. |
| `scene_select` | `sceneIndex` | scene_write | Changes editor selection. |
| `scene_delete` | `sceneIndex` | scene_write | Deletes a scene and its associated clips; destructive by design. |
| `scene_create_from_playing` | none | scene_write | Requests scene capture from currently playing launcher clips. |
| `clip_set_notes` | `trackIndex`, `sceneIndex`, `notes` | clip_write | Inserts bounded notes without replacing observed note starts or sustains. |
| `clip_clear_notes` | `trackIndex`, `sceneIndex`, `notes` | clip_write | Clears only explicitly targeted, observed note starts. |
| `clip_set_loop_length` | `trackIndex`, `sceneIndex`, `lengthBeats` | clip_write | Extends the selected stopped clip's loop from origin zero; rejects shortening. |

The four new names absent from the historical catalogue are `clip_rename`,
`clip_set_notes`, `clip_clear_notes`, and `clip_set_loop_length`. The other nine
appear as Ported 2 in the parity matrix. Historical `clip_duplicate` accepted a
source slot alone; its new explicit destination schema intentionally replaces
the old host-chosen destination behavior.

New schemas reject unknown fields, missing fields, non-object argument roots,
nonfinite numbers, and out-of-range values. The dispatcher detaches JSON input
before asynchronous validation and rechecks current write policy afterward.
Direct calls and discovery-dispatched calls use the same policy and validation
path. Controller mutations also require an authenticated local relay session.

## Cursor and note boundaries

Naming and MIDI construction require the requested track/slot to match the
already selected launcher cursor and its observed absolute positions. They do
not select a different target implicitly. Reads and mutations must fail closed
while the cursor or bank is synchronizing.

The note window contains **64 sixteenth-note steps**, **MIDI pitches 0–127**, and
**channel 0**. One step is **0.25 beats**. `clip_set_notes` accepts 1–256 entries
with `{step, pitch, velocity, durationBeats}`: step 0–63, pitch 0–127, velocity
1–127, duration 0.25–16 beats on a quarter-beat grid. Every note must remain within
the supported clip/window limits. Loop-origin zero is required for bounded MIDI
construction. `clip_clear_notes` accepts 1–256 explicit
`{step, pitch}` entries. A sustained cell is not a removable note start.

Validate the entire requested batch before the first host write, including
duplicate positions, overlaps within the batch, collisions with observed note
starts/sustains, clip boundaries and target identity. A malformed final entry
must not leave the valid prefix applied. Insertion is not a replace operation.

Host writes are sequential and **not atomic**. Validation cannot guarantee that
Bitwig accepts every operation. If an exception occurs after a prefix is issued,
return `status: "partial"`, `dispatchedCount`, `totalCount`, `uncertain: true`,
`verified: false`, `requiresReadback: true`, and
`recovery: "readback_then_reload_controller"`. The MCP marks that response as an
error (`partial_mutation`). Do not automatically replay the batch or imply
rollback. After two quiet inspection update cycles and only while the captured
project/bank/cursor identity still matches, the controller permits diagnostic
reads (`clip_get_notes`, status/grid/color, track reads and project summary).
Construction and bank/cursor-dependent mutations remain locked until the
controller is reloaded. Independent bridge and transport requests remain
available under their existing authentication and MCP policy checks. Inspect the
observed partial result first, reload the controller, then
inspect again and make a fresh plan; old target bindings must not be reused.
A host call returning normally establishes an issued operation, not an observed audio or MIDI
result. Successful dispatch responses carry `status: "dispatched"`,
`verified: false`, and `requiresReadback: true`; batches also include issued/total
counts. `clip_get_notes` provides a separate bounded readback.

`clip_set_loop_length` accepts a quarter-beat-aligned length from 0.25 to 16 beats
that is at least the current length; it rejects shortening. A nonzero loop origin
is rejected. This extension-only policy avoids relying on incomplete readback
to decide whether shortening would hide musical content.

The readback does not enumerate other MIDI channels, notes outside the window,
all expressive note properties, or audio content. An empty result does not prove
that the clip is empty. `coverage.completeClip` remains false.

## Structural changes and observation

Deleting clips, copying into slots and creating/deleting scenes can invalidate
cached target identities. Revoke existing target bindings before issuing a host
mutation, then wait for refreshed observations before allowing dependent
operations. Existing bank-navigation protection must also cover these tools.
Renumbered scenes must not make a previously approved position silently target
another clip. If Bitwig silently does nothing and emits no matching state
change, the pending barrier remains closed; recovery requires a controller
reload. This can occur for scene capture when transport is playing but no
launcher clips are playing. A transport-playing flag alone does not prove
launcher activity.

Copy validates both source and destination, rejects self-copy and any occupied
or unknown destination, and does not clear the destination to make room. Browser
opening is a UI request; later `browser_commit` is a separate legacy mutation
under `device_write`. The empty-slot check before opening does not reserve the
destination until commit and does not provide a global no-overwrite guarantee.
If the session or target changes while browsing, cancel and re-inspect before
starting again. Scene capture is a request against current playback, not a
promise of a stable new
scene index or a complete arrangement snapshot.

## API evidence and known limits

The installed official Controller API reference was consulted under
`/opt/bitwig-studio/resources/doc/control-surface/api/`. API reference files are
not copied into this repository.

- `ClipLauncherSlotOrScene.name()` returns a read-only `StringValue`; clip naming
  must use `Clip.setName()` with a verified cursor. `Scene.name()` overrides the
  return type with a settable value, which is why scene naming differs.
- `destination.replaceInsertionPoint().copySlotsOrScenes(source)` supplies
  explicit copy targeting. The older `copyFrom` API is deprecated. Historical
  `duplicateClip()` leaves destination choice to Bitwig and does not meet this
  contract's empty-destination requirement.
- Launcher slots and scenes expose deletion; `Project` provides scene capture
  from playing launcher clips. These APIs returning void do not establish a
  completed, observed structural change.
- `Clip.getStep()` and `NoteStep` distinguish note starts, sustains and empty
  cells. Normalized observed velocity must be converted to MIDI velocity once.
- `Clip.getLoopStart()` and `getLoopLength()` are separate beat-time values.
  Nonzero loop origins and hidden channel/window content need explicit handling;
  bounded channel-0 readback alone cannot prove that shortening a loop preserves
  the entire clip's musical content.
- Two quiet controller flush cycles are a settling heuristic. Offline mocks do
  not establish real Bitwig observer ordering or successful playback.

## Adversarial verification checklist

The implementation report must state which checks were run and their outcomes.
This checklist is a review target, not a claim that all checks already passed.

- Default policy hides every new mutation; direct and discovery calls both
  reject it. Revoking policy during validation prevents dispatch.
- Invalid final batch entry, duplicate coordinates, occupied destination,
  unknown occupancy, absent track, stale selection and pending bank navigation
  cause zero host writes.
- Note insertion rejects sustain/start collisions and overlap across the same
  pitch; clearing rejects empty cells and sustain cells. Validate boundaries at
  step 63, pitch 127, velocity 1/127, and 256/257 batch entries.
- A host exception at operation k produces an honest partial result with the
  issued prefix identified. Diagnostic reads become available after settling
  only for the captured identity; construction writes remain locked until reload.
  Changed identity must keep those reads blocked. Recovery starts with readback,
  controller reload, then fresh inspection and planning.
- Clip/scene deletion and copy invalidate previous Agent-mode bindings before
  mutation; observer-delayed updates cannot reopen stale targets immediately.
- Browser opening into occupied/unknown targets is rejected. Scene capture does
  not invent an index before observing the resulting bank.
- Output metadata and documentation retain channel/window scope and do not
  claim a full musical round trip from an empty or partial readback.

Live verification requires the built controller and MCP to be installed together
and the explicitly authorized disposable Bitwig project to be inspected before
writing. Source checks, mock tests and a merged PR do not substitute for that
evidence.
