# BT-MCP-PORT-005 — API15 historical recovery and API coverage

Date: 2026-09-28. Base 6543c69bce4aee0466173ba4a26b7117ef885820 fetched and
remote-confirmed. Branch agent/bitwig-parity-next-20260928. User authorizes continued
parallel porting/publication; real Bitwig tests are deferred.

## Delivery

33 historical names plus application/project status: 161 tools, 37 default reads.
14 global Application commands, arranger zoom, cue create/rename and aliases,
16-pad drum window, groove and native project-wide solo/mute/arm reset operations.
Controller now selects API15. Installed official API docs come from Bitwig6.1.1;
no earliest compatible Bitwig release is inferred from the API number.

The historical matrix accounts for all164 unique names; API coverage compares
musical domains rather than equating every hardware/UI symbol with an MCP tool.
Unsupported cue color and text-search assumptions, MIDI routing and external Ear
services are explicit. No count is used as evidence of live functionality.

Three agents own controller/tests, MCP/tests, API/docs/review. Coordinator owns
integration, generated runtime, validation and exact-head publication. Primary
checkout and installed controller preserved; no dependency changes.

## Review

Native Project resets replace a fragile bank traversal. Groove enabled is a
normalized Parameter (0/1), not BooleanValue. Cue name read/write share API15
name() proxy. Global Application commands expose unknown keyboard focus and
clipboard: binding revocation and update cycles are not a verified effect.
Undo availability and project aggregates can be unknown after pending writes;
callbacks are required before treating changed cached data as observed.

Drum pad selection and scrolling await observer evidence and device identity.
FOLLOW_SELECTION parent behavior must be examined in the later real-session pass;
a mock does not establish that selecting a pad preserves its parent cursor.

## Validation

Full offline suite: 386 passed, zero failed/skipped. Focused MCP: 84 passed.
Thirteen new controller tests and ten MCP groups included. Typecheck passed;
architecture:16 workspaces/44 edges/no violations; distribution:23 artifacts,
37 default reads, zero DAW calls. Runtime syntax and diff checks passed.
Independent final review found no remaining concrete blocker. Logs in
/tmp/beat-twin-parity-next-{test,typecheck,mcp}.log are not committed.
Actions queried live and disabled; these results are local evidence, not CI.
Source is ready for authorized exact-head publication and merge.

## Boundaries

No controller install/reload, live DAW edit, listening or model inference. API and
mock tests are offline evidence only. Publication/merge authorization persists;
GitHub CI state is checked separately before publication. No branch deletion.
