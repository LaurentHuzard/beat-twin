# Bitwig MCP bounded mix, devices and cursor port

Date: 2026-09-28. Tranche 4 adds **22 historical names**, taking the source
catalogue to **126 tools / 32 reads** with default write policies disabled.
Optional discovery wrappers are counted separately. These counts describe the
source registry; they do not prove deployment or successful live DAW execution.
See [the parity matrix](BITWIG_MCP_PARITY.md) for all 164 historical unique names.

This tranche exposes bounded mix controls, explicit device/cursor navigation,
and track operations. Browser opening does not establish a loaded instrument;
these tools do not yet prove complete autonomous song construction.

## Tool contracts

Track/device/send/return indices are integers 0–7 in their respective current
banks. They are not permanent project identities. Inputs reject extra fields,
nonfinite values, wrong types and out-of-range indices. Empty-argument tools
accept an empty object. Numeric mix `value` fields use **0–1**, not decibels;
pan uses **0 = left, 0.5 = center, 1 = right**. `bypass` is a boolean, and the
controller translates it to `isEnabled = !bypass`.
Cursor clip time fields use beats (quarter-notes), within the selected launcher
clip; they do not describe arranger regions or export note contents.

| Tool | Arguments | Policy | Scope |
| --- | --- | --- | --- |
| `track_delete` | `index` | mixer_write | Deletes an observed individual Instrument/Audio/Hybrid main-bank track and its material; transport must be stopped. |
| `track_duplicate` | `index` | mixer_write | Requests duplication of an observed individual Instrument/Audio/Hybrid main-bank track; transport must be stopped. |
| `cursor_track_get_status` | none | read | Observes the current cursor track. |
| `cursor_device_get_status` | none | read | Observes the current cursor device. |
| `cursor_clip_get_status` | none | read | Observes the selected bounded launcher clip cursor. |
| `application_create_effect_track` | none | application_write | Appends an effect/return track through the host. |
| `device_bypass` | `trackIndex`, `deviceIndex`, `bypass` | device_write | Sets enabled state for an existing bank device. |
| `device_delete` | `trackIndex`, `deviceIndex` | device_write | Deletes a bank device; subsequent indices may change. |
| `device_select_next` | none | device_write | Selects the next cursor device if available. |
| `device_select_previous` | none | device_write | Selects the previous cursor device if available. |
| `device_select_first` | none | device_write | Selects the first device in the cursor's scope. |
| `device_select_last` | none | device_write | Selects the last device in the cursor's scope. |
| `device_browse_insert_before` | none | device_write | Opens the insertion browser before an existing cursor device. |
| `device_browse_insert_after` | none | device_write | Opens the insertion browser after an existing cursor device. |
| `device_browse_replace` | none | device_write | Opens the replacement browser for an existing cursor device. |
| `mixer_get_master_volume` | none | read | Observes normalized master volume. |
| `mixer_set_master_volume` | `value` | mixer_write | Sets normalized master volume. |
| `mixer_get_send_level` | `trackIndex`, `sendIndex` | read | Observes one send in the current main-track bank. |
| `mixer_set_send_level` | `trackIndex`, `sendIndex`, `value` | mixer_write | Sets one existing send's normalized level. |
| `mixer_return_list` | none | read | Observes the current bounded effect/return bank. |
| `mixer_return_set_volume` | `index`, `value` | mixer_write | Sets an existing return track's normalized volume. |
| `mixer_return_set_pan` | `index`, `value` | mixer_write | Sets an existing return track's normalized pan. |

Direct calls and discovery dispatch share validation and current-policy checks.
New mutations are hidden and rejected under default read-only configuration.
Controller mutation RPCs also require an authenticated local relay connection.
Track deletion/duplication, effect-track creation and device deletion require
stopped transport and disabled arranger recording. Group tracks and unknown track
types are rejected by the new track deletion/duplication tools. The expected
single-track count change does not model deletion or duplication of a group.

## Observed identity and asynchronous changes

Reads distinguish absent objects from unknown or unsettled observations.
Unknown existence, malformed numeric/color fields, stale cursor identity and
unavailable bank data must fail closed. A cursor read is not an inventory of the
whole project, and a bank list does not imply every project object is visible.
The main track bank reserves eight sends; return and device windows are eight
objects each. Reported absolute positions and coverage identify those windows.

Track deletion/duplication, effect-track creation, device deletion and device
navigation can change the meaning of existing proxies or indices. Revoke old
target bindings before issuing a structural host call. Keep dependent operations
blocked until the expected change is observed and the resulting bank/cursor
mapping settles. The structural guard must permit a genuinely changed bank
mapping to settle; requiring the old mapping forever would deadlock successful
track changes. It must also reject unchanged or inconsistent observations.

Numeric and enabled-state setters must invalidate stale observations before
dispatch. An immediate read cannot treat the pre-write cached value as proof of
the new state. A setter already equal to a known, settled value can remain a
no-op without waiting for an observer callback that may never arrive.
When bank and cursor proxies represent the same object, changing a level or
enabled state also invalidates the affected cursor field. Proxy equality is
observed through the host API, rather than inferred from matching names or
positions. Unrelated cursor state remains readable.
Volume, pan and send-level reads use the latest initialized observed values;
continuous automation does not restart identity settling on every level change.
These multi-field reads are not atomic snapshots. After a numeric setter, its
value must receive a callback before readback becomes available again.
The existing bank/selected-track volume, pan, mute, solo and selected-track arm
setters also invalidate affected new cursor reads; selected-track changes
invalidate matching master/return observations where applicable.

Mutation results acknowledge issued requests, not successful musical outcomes.
Host operations returning void can fail to produce the expected change. Do not
automatically retry deletion, duplication, navigation or browser operations.
After uncertainty, inspect available state and follow the controller's recovery
instruction instead of assuming rollback or silently replaying an action.
Existing bank-navigation and partial-construction guards remain applicable.
After a structural host exception, the six new reads may serve diagnostic
readback only after inspection settles and the captured operation identity still
matches. Each read retains its own observation checks. Bank/cursor-dependent
mutations remain locked until controller reload; bank-independent bridge and
transport operations retain their existing authentication/policy rules. This
read access does not assert rollback or authorize replay. A silent host no-op
without the expected callback can keep the normal pending guard closed.

Stopped/recording and device-browser closed-state preconditions require explicit
initialized observations. Track/effect/device count changes require the relevant
count callback; a changed getter plus an unrelated callback cannot acknowledge
that structural operation.

## Browser targeting

The three new browse tools require an existing, observed cursor device. They use
that device's before/after/replacement insertion point and reject an absent
device. In particular, replacement does not fall back to insertion before an
absent device, unlike the historical handler.

Opening the browser is the entire operation: there is no implicit search,
selection, commit or proof of a new device. The existing `browser_commit` is a
separate `device_write` mutation. The initial target check does not reserve a
target through later user/session changes. If the cursor or session changes
while browsing, cancel and re-inspect before opening a new browser request.

## API 10 compatibility

The installed official reference under
`/opt/bitwig-studio/resources/doc/control-surface/api/` was consulted. Vendor API
documentation is not copied into the repository. Historical handlers were
written against a controller selecting API 25, so their signatures cannot be
transferred blindly into this controller's API 10 environment.

| Operation | Compatible API pattern | Important distinction |
| --- | --- | --- |
| Return bank | `createEffectTrackBank(8, 8)`; two arguments, API 1 | The historical three-argument overload requires API 18. |
| Track duplicate | `Channel.duplicate()`; API 1 | `DuplicableObject.duplicateObject()` requires API 19. |
| Track/device delete | `deleteObject()`; API 10 | Deletion changes object identity and bank indices. |
| Cross-proxy identity | `ObjectProxy.createEqualsValue(other)`; API 3 | Observed equality identifies the same target object across cursor/bank proxies. |
| Effect track create | `Application.createEffectTrack(-1)`; API 1 | Requests append, without proving the new return index. |
| Cursor navigation | `Cursor.selectNext/Previous/First/Last()`; API 1 | A dispatch result does not establish the resulting selection. |
| Device browse | before/after/replacement insertion points; API 7 | Browser opening is not insertion or replacement completion. |
| Device enabled state | `Device.isEnabled()`; API 2 | `bypass: true` means enabled becomes false. |
| Sends | `Channel.sendBank()` and normalized parameter values; API 2 | `Send.isEnabled()` requires API 18 and is not needed for level control. |
| Volume and pan | Channel parameter accessors; API 5 | Host normalized values are 0–1, including pan. |

The prior main bank used zero sends. Adding a send getter alone would not create
the necessary proxies: the host bank must reserve the same eight sends permitted
by the schema, and their existence/value observations must be initialized.

## Remaining backlog after four tranches

The historical matrix now contains 47 baseline names plus 65 names ported across
four tranches. The other 52 historical names are classified, not silently omitted:
3 current equivalents, 18 remaining source-level ports, 2 historical stubs,
6 Ear-service tools, and 23 historically unwired declarations.

The **18 remaining source-level ports** are:

- **14 Application commands:** undo, redo, cut, copy, paste, selection deletion,
  selection duplication, select-all/none, arrows, enter, escape and editor zoom
  in/out. The installed API provides these actions. Deferral concerns reliable
  focus/selection/clipboard/global edit-history targeting and an acceptance
  contract, not missing API support. Do not wire them as blind keyboard-like
  actions and call that safe parity.
- **Browser filtering:** verify a genuine search/filter API and its semantics.
  The historical `getWildcardFilter().set(text)` does not match the installed
  `BrowserFilterColumn` interface: it documents `getWildcardItem()`, which returns
  a filter item rather than a text-search setter. Copying that handler is not a
  working text-search implementation.
- **Arranger zoom:** direct-method API 10 compatibility remains unproven; the
  documented Action/stepper variants require API 14.
- **Cue creation and cue rename:** the relevant APIs require version 15.

The remaining stub handlers and unwired declarations need separate feasibility
work. Ear requires a separate service. These categories must not be presented
as working capabilities recoverable merely by adding names to `tools/list`.

## Offline review and later live acceptance

Offline adversarial checks should cover unknown/absent objects, out-of-range and
wrong-type inputs, policy revocation during validation, identity changes before
host mutations, stale readback after setters, structural bank renumbering,
wrong-direction bypass, no-op setters, browser fallback rejection, host errors
without retries, and preservation of existing recovery barriers. Actual test
results belong in the implementation report.

Live acceptance is a later, explicitly authorized activity using a disposable
project and a matched MCP/controller build:

1. **Read-only observation:** inspect cursor track/device/clip, master level,
   sends and returns. Confirm real UI values and coverage, including absent and
   unavailable objects, before enabling mutations.
2. **Single reversible setters:** change one send/return/master value or bypass
   state, observe the callback/readback and actual UI, then restore the captured
   value. Check normalization and target identity.
3. **Disposable structure:** duplicate/delete a disposable track/device and
   append a return. Confirm binding invalidation, bank renumbering and settled
   reads, including a target beyond the first eight objects where supported.
4. **Browser session:** open before/after/replace on a known device, verify the
   insertion context and cancel. Test absent-device rejection. Any committed
   device replacement needs its own authorized acceptance step.
5. **Musical chain:** only after those checks, construct and read back a bounded
   musical phrase, then verify playback/audio. A merged PR, passing mocked tests
   or a connected MCP does not demonstrate a finished track.

No live DAW modification, deployment or audio proof is claimed by this document.
