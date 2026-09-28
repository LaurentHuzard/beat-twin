# BT-MCP-PORT-005 — Historical parity and API inventory

Status: locally complete, 386 offline tests and all integration checks passed;
independent review complete. Authorized publication in progress. Detailed report:
.agents/reports/feature-20260928-bitwig-parity-next.md. Live acceptance deferred.

Authorized 2026-09-28: continue historical parity, go beyond it using the official
controller API, publish verified tranches under continuing authorization. Real
Bitwig tests are deferred until the larger acceptance pass.

Fresh fetched and remote-confirmed base: 6543c69bce4aee0466173ba4a26b7117ef885820.
Branch: agent/bitwig-parity-next-20260928. Primary checkout preserved.

## Slice

Restore 33 historical names and add application_get_status/project_get_status:
14 explicit global Application commands; arranger zoom; cue creation/rename and
existing cue aliases; seven drum-pad tools; three groove tools; three native
project-wide reset operations. API 15 replaces API 10 to support cue creation,
rename and observed undo/redo availability. Review old overload compatibility.

Global UI commands explicitly expose unknown focus/selection/clipboard and
 dispatch-only results. Do not infer target guarantees from panel layout. Target
bindings are revoked before dispatch; settling is not proof of the effect.
New proxy reads and structure calls require initialized observations.

## Parallel ownership

- application_contract: controller TS and new controller parity tests.
- historical_audit: index.ts and new MCP parity tests.
- api_inventory: full API gap audit, documentation and independent review.
- Coordinator: package/count integration, generated runtime, full offline checks,
  report, inventory reconciliation and exact-head publication.

## Continuation

Investigate MIDI/NoteInput, expression/note-editing opportunities, and honest
replacement contracts for unsupported filter/color stubs and external Ear.
No live install/reload, playback, DAW mutation, listening or model call. Focused
and full offline tests, typecheck, architecture, package smoke and review.
