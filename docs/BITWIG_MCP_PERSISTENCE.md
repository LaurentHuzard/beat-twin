# Bitwig project persistence

Beat Twin exposes three tools for discovering application actions and requesting
project saves. The direct MCP catalogue contains **190 tools**, with **43 reads
available by default**. Save requests require the `application_write` policy.

## Tool contract

| Tool | Required arguments | Policy | Result |
| --- | --- | --- | --- |
| `application_list_actions` | `offset`: integer 0–4096; `limit`: integer 1–64 | `read` | A page of action IDs and names, total count and coverage. Never invokes an action. |
| `project_save` | `expectedProjectName`: nonblank string, 1–256 characters, without control characters | `application_write` | Requests the exact host action `Save`. |
| `project_save_as` | Same project-name argument | `application_write` | Requests the exact host action `Save as`. |

All three schemas reject additional arguments. Save tools accept neither a file
path nor an arbitrary action ID. Direct calls and discovery-dispatched calls use
the same argument validation and policy checks.

Example requests:

```json
{"name":"application_list_actions","arguments":{"offset":0,"limit":64}}
{"name":"project_save_as","arguments":{"expectedProjectName":"Disposable Test"}}
{"name":"project_save","arguments":{"expectedProjectName":"Disposable Test"}}
```

Action discovery returns `actions: [{id, name}]`, `count`, and a `coverage`
object containing `offset`, `limit`, `returned`, `hasMore`, `nextOffset` and
`complete`. `complete` means that this response contains the entire catalogue.
If additional actions exist beyond the permitted pagination range, `hasMore`
remains true while `nextOffset` is null. Action presence does not establish that
the host currently enables that command.

Before invoking a save action, the controller requires an observed, settled
project name matching the supplied name, stopped transport, and disabled
arranger recording. It resolves the dedicated action and checks its exact ID
and callable `invoke` method. It then rechecks the project and transport before
dispatch. Missing actions and changed or unavailable project identity fail
before invocation. Names can collide: this check is a **project-name guard**,
not a persistent project identifier or path check.

## Dispatch and completion

A successful save request returns this shape:

```json
{
  "status": "dispatched",
  "command": "project.save",
  "actionId": "Save",
  "projectName": "Disposable Test",
  "identityScope": "project_name_only",
  "projectPath": null,
  "verified": false,
  "saved": null,
  "mayOpenDialog": true,
  "requiresUserInteraction": true,
  "requiresReadback": true,
  "persistenceVerified": false
}
```

`requiresUserInteraction` conservatively signals that native UI may need to be
completed; it does not prove that a dialog appeared. Save As requires a target,
and Save can open a dialog for a project without a known save location. A user
can cancel either workflow. Dispatch cannot establish file creation, successful
replacement, asset collection or durable musical content.

The controller creates no permanent mutation barrier waiting for a save
acknowledgement: the public action API supplies no completion acknowledgement.
Any uncertain native dialog must be inspected before another save request;
there is no automatic retry.

## Installed API basis

The controller remains on **API 15**. The installed Bitwig control-surface
reference documents:

- `Application.getActions()` and `Application.getAction(String)`, available
  since API 1, for discovering and resolving action objects.
- `Action.getId()`, `Action.getName()` and `Action.invoke()`, available since
  API 1. `invoke()` takes no arguments and returns `void`.
- `Application.projectName()` for the active project's name.
- `Project.isModified()`, introduced in **API 18**, which is not used by this
  API 15 controller. A dirty-state read is therefore unavailable here.

The inspected `Application`, `Project` and `ControllerHost` contracts expose no
project-path getter or direct `save(path)` / `openProject(path)` operation.
Native file selection and reopening remain outside these three MCP tools.

The 2026-09-28 live catalogue contained **782 actions**. It confirmed the exact
IDs `Save` and `Save as`; their names were `Save` and `Save as...`. Catalogue
size and displayed names describe that host observation, not a fixed API-wide
count or a locale-independent identifier rule.

## Real save/reopen witness

The 2026-09-28 disposable-project campaign established the following sequence
using the running Bitwig host and independent file/UI observations:

1. A save request with the wrong expected project name was rejected.
2. Save As opened a native GTK dialog. After explicit authorization for the
   native interaction, a project copy was created at the chosen location.
3. A clip name was changed and Save was requested. The saved file's hash changed.
4. A fourth MIDI note was added without saving. Readback confirmed the extra
   note while the saved file hash remained unchanged.
5. The project was closed through native UI; the save prompt was declined to
   discard that deliberate unsaved change. The exact saved file was reopened.
6. A fresh musical manifest matched the saved baseline with **zero
   differences**, and the unsaved fourth note was absent.

The manifest compared the current window of eight tracks and its scenes, the
witness clip's four-beat length and complete 64-step MIDI inspection, the three
saved note coordinates and their values, device inventory including Polysynth
and its Side Chain entry, page-0 macro names/values, and supported note
expressions. Numeric comparisons used an absolute tolerance of `1e-6`.
Pressure remained explicitly null because Bitwig 6.1.1 pressure readback is
unreliable; it was not counted as verified expression persistence.

File-hash changes alone were auxiliary evidence. The decisive content witness
was the fresh read after reopening, together with disappearance of the known
unsaved note. Volatile snapshot tokens, selection/session counters and
controller-instance identifiers were excluded from musical equality.

## Coverage and artifact boundaries

This witness covers the inspected musical fixture and visible windows. The
note reader is bounded to MIDI channel 0, pitches 0–127, and the first 64
sixteenth-note steps. Macro coverage is the selected device's page 0. No claim
is made about every bank, every remote page, all arranger material, every
expression, or plugin-internal state outside the inspected values.

Saving the native project does not establish a self-contained export: external
samples, plugins and other dependencies were not exhaustively collected or
validated. A completed artistic track is also outside this persistence witness.

Raw project copies, file paths, audio, desktop captures and detailed live
manifests remain private operator evidence, outside the published repository
and package. The retained copy supports later reinspection; this document
publishes only the contract, method and bounded result.
