# Bitwig capability port — tranche 1

This document records tranche 1 (merged in PR #94). For the subsequent tools
and current catalog, see [launcher construction](BITWIG_MCP_CONSTRUCTION.md).

This tranche restores the inspection and navigation needed to find occupied
launcher slots before proposing musical edits. It adds 13 tools to the original
57-tool registry: 70 total, of which 20 are available with no write policy.
The original tools keep their names, input schemas and policies.

The [parity inventory](BITWIG_MCP_PARITY.md) tracks every unique historical tool,
including aliases, deferred ports, external services and unimplemented handlers.
It also documents why the advanced historical branch was absent from the
restored Beat Twin base.

## Restored tools

| Tool | Policy | Scope |
| --- | --- | --- |
| `project_get_summary` | read | Project name, transport, current tracks/scenes; bounded snapshot |
| `track_list` | read | Current eight bank positions, with existence and absolute positions |
| `track_get_info` | read | One bank-local track, `index` 0–7 |
| `clip_get_grid` | read | Current 8 × 8 launcher window with slot existence and occupancy |
| `clip_get_status` | read | One slot, `trackIndex` and `sceneIndex` 0–7 |
| `clip_get_notes` | read | Already selected, matching launcher clip; bounded note readback |
| `track_bank_scroll_forward` | mixer_write | Navigate the track bank |
| `track_bank_scroll_backward` | mixer_write | Navigate the track bank |
| `track_bank_scroll_to_position` | mixer_write | Navigate to an absolute track position |
| `track_scroll_into_view` | mixer_write | Bring one bank-local track into view |
| `track_rename` | mixer_write | Rename an existing bank-local track |
| `track_set_color` | mixer_write | Set finite RGB components in 0–1 |
| `scene_rename` | scene_write | Rename an existing bank-local scene |

Navigation changes the meaning of bank-local indices. Read the bank/grid again
after navigation settles. Do not treat an index observed before a bank movement
as the identity of the same track afterwards. Navigation immediately invalidates
previous Agent-mode bindings; bank-dependent operations fail while the new
position is still being observed.

New names must contain 1–128 characters, include a non-whitespace character,
and contain no C0/C1 control characters. New arguments reject unknown fields,
coercion, non-finite numbers and out-of-range indices before controller dispatch.
The controller independently validates targets and bounds. Write policies remain
required; enabling a policy does not itself provide human approval.

## Note-readback contract

`clip_get_notes` takes `{ "trackIndex": 0, "sceneIndex": 0 }`. Both indices refer
to the currently visible bank window. The requested slot must contain a clip and
already match the selected launcher cursor. Otherwise the read fails; it does
not select a slot, scroll a cursor, create a clip or silently inspect another
target.

The read cursor has a fixed grid established at controller initialization:

- first 64 steps, each one sixteenth note (0.25 beats), covering the first 16 beats;
- MIDI pitches 0–127;
- MIDI channel 0;
- note-on starts, MIDI velocities 1–127 and durations in beats;
- explicit coverage metadata with `completeClip: false`.

A longer clip, other channels and material outside this window are not covered.
An empty notes array only describes this channel and window; it does not prove
an empty MIDI clip or identify whether the clip contains audio. The result is
not a full-project MIDI export. A changed or unsynchronized cursor
fails until controller updates have settled. Inspection uses a separate cursor,
preserving both the legacy paged editor and the existing Agent-mode target path.

## Controller and server upgrade

Build the bridge from TypeScript:

```bash
pnpm build:bridge
```

Both `index.js` and `bitwig-controller/BeatTwin/BeatTwin.control.js` are generated
from their tracked TypeScript sources. Update the installed Beat Twin controller
from the same revision, reload it in Bitwig, then restart the MCP server and
refresh the client tool list. Keep the existing outbound loopback relay setup
described in [LOCAL_BITWIG_BRIDGE.md](LOCAL_BITWIG_BRIDGE.md).

A newly listed tool can still fail against an older installed controller.
`tools/list` proves server exposure only. Do not retry an uncertain write
automatically; inspect/reconcile first.

This development tranche does not install or reload the controller automatically.
Use a dedicated scratch project for subsequent live write validation.

## Offline verification

```bash
pnpm build:bridge
node --experimental-strip-types --test tests/mcp-capability-port.test.ts tests/bitwig-controller-port.test.ts tests/tool-registry.test.ts tests/policy-gate.test.ts tests/mcp-diagnostics.test.ts
pnpm smoke:distribution
```

These checks use injected calls, mocked Bitwig API objects or MCP discovery with
no tools/call. They establish policy, argument, handler, packaging and legacy
compatibility behavior. They do not prove that the new controller has been
loaded in Bitwig or that a musical edit has succeeded live. See the [implementation report](../.agents/reports/feature-20260927-bitwig-capability-port.md)
for executed checks and remaining live acceptance.

## Following tranches

Composition primitives such as duplication, broader MIDI coverage and safe
targeted bulk edits remain separately tracked in the parity inventory. Device
browsing, sends, scene operations, arranger markers and external audio services
need their own contract and runtime validation. No catalogue stub is presented
as a restored implementation.
