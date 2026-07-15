# Beat Twin / NanoDAW Execution Roadmap

Updated: 2026-07-14
Development branch: `dev/nanodaw-standalone`

This Linear-style roadmap separates three concerns that must not be conflated:

1. NanoDAW as a browser-owned standalone instrument;
2. honest detection of optional desktop dependencies such as Bitwig;
3. the later authenticated gateway and dual-target Agent mode.

`.agents/queue.md` is the short execution view. This document owns detailed
scope, dependencies, and acceptance criteria.

The launcher-first reflection remains an exploration. The Council decision in
[`NANODAW_LIVE_COUNCIL_DECISION_2026-07-14.md`](NANODAW_LIVE_COUNCIL_DECISION_2026-07-14.md)
requires the standalone evidence gate before a shared-clock comparison between
the Session Deck and Mutation Instrument. No persistent scene/slot model,
recording, macro, or capture architecture is authorized by that spike.

## Conventions

- Priority: `P0` protects the standalone or diagnostic baseline, `P1` unlocks
  connected mode, `P2` covers packaging and broader delivery.
- Size: `S`, `M`, `L`, `XL` describe implementation breadth, not elapsed time.
- Offline CI must not require Bitwig, MCP, a gateway, or the S25.
- Live validation may block a release gate without invalidating offline tests.

## Milestone BT-M0 - Standalone NanoDAW Proof

Goal: prove NanoDAW is independently useful and does not make hidden calls to
Bitwig, MCP, the gateway, or the mobile model.

Exit criteria:

- a clean worktree can install, build, typecheck, and test NanoDAW;
- a real browser loads a meaningful first screen without runtime errors;
- one complete edit/audition/persistence interaction is demonstrated;
- network/process evidence shows no external music runtime was required.

### BT-201 - Create the isolated development worktree

- Priority: P0
- Size: S
- Status: Done
- Branch: `dev/nanodaw-standalone`
- Base: `main` at `d64067e`

Acceptance:

- the existing `agent/s25-provider-gateway` checkout remains untouched;
- the worktree starts from the merged NanoDAW dual-target foundation;
- standalone tasks and changes remain isolated on the development branch.

### BT-202 - Verify the deterministic offline baseline

- Priority: P0
- Size: M
- Status: Done
- Depends on: BT-201
- Evidence: 116 root tests, 22 NanoDAW tests, typecheck, and the eight-package
  smoke passed locally on 2026-07-14. Node 26 emitted an engine warning because
  the supported matrix remains Node 22/24.

Checks:

```bash
pnpm test
pnpm typecheck
pnpm nanodaw:test
pnpm smoke:packages
```

Acceptance:

- failures are classified as code, dependency, or environment failures;
- no command requires Bitwig, MCP, gateway, or S25 availability;
- exact test counts and any skipped checks are recorded in the ticket evidence.

### BT-203 - Browser smoke with all external targets absent

- Priority: P0
- Size: M
- Status: Done
- Depends on: BT-202

Target flow:

```text
NanoDAW loads -> first meaningful screen renders -> a primary editing or
transport control changes visible state -> no relevant console/runtime error
```

Acceptance:

- Bitwig is not running;
- no Beat Twin MCP or gateway process is started;
- page title, meaningful DOM, framework-overlay absence, console health, one
  interaction, desktop screenshot, and mobile screenshot are captured;
- the app does not stall on an unavailable external dependency.

Evidence (2026-07-14): Chromium loaded `Beat Twin Playground`, rendered the
timeline and inspector, and completed a visible note edit. Console finished at
0 errors and 0 warnings after adding an inline favicon. Desktop 1440 x 1000 and
mobile 390 x 844 were inspected; the mobile body width stayed at 390 px. All 48
captured requests were successful and limited to `127.0.0.1` or a local `blob:`
URL. No Bitwig, MCP, gateway, S25, or cloud target was started or contacted.

### BT-204 - Prove the standalone musical loop

- Priority: P0
- Size: L
- Status: Done
- Depends on: BT-203

Scope:

- create or edit notes/pattern content;
- trigger browser audition using the existing Tone.js surface;
- verify undo and redo;
- save, reload, and load the schema-versioned song;
- confirm a single browser-owned document remains authoritative.

Acceptance:

- visible state and saved state agree after reload;
- undo/redo restore deterministic document revisions;
- audition failure, including browser autoplay restrictions, is explained;
- no external DAW receives a command.

Evidence (2026-07-14): the real-browser flow produced pitch `37`, undo restored
`36`, redo restored `37`, and save/reload/load restored `37`. Tone.js audition
started from an explicit click. Preview transport was removed from persistent
command history after the gate exposed a mismatch between stopped audio and a
serialized `transport.isPlaying: true`; the persisted value now remains `false`.
The focused NanoDAW suite remains 22/22 and typecheck passes.

### BT-205 - Make runtime mode explicit

- Priority: P1
- Size: M
- Status: Done
- Depends on: BT-203

Scope:

- show `Standalone` as the default NanoDAW mode;
- show external targets as optional rather than as startup requirements;
- avoid alarming connection errors until the user explicitly enables connected
  Agent mode.

Acceptance:

- fresh load communicates that NanoDAW is ready without Bitwig;
- unavailable Bitwig/S25 states do not block editing or audition;
- no simulated connected badge is shown.

## Milestone BT-M1 - Honest Bitwig Dependency Diagnostics

Goal: replace generic connection failures with a layered local diagnosis.

### BT-206 - Detect the Bitwig desktop process

- Priority: P0
- Size: M
- Status: Done
- Cross-project consumer: TwinPilot TP-202

Scope:

- add a read-only host preflight that checks whether a Bitwig Studio process is
  present;
- return structured JSON plus a concise human message;
- support Linux first, with explicit `unknown` behavior on unsupported hosts;
- never start, stop, or signal Bitwig.

Acceptance:

- Bitwig absent returns `process_not_running` with a suggested next action;
- a matching process returns `process_running` without claiming that the
  controller or TCP bridge is ready;
- fixtures test matching, false positives, permission errors, and unsupported
  platforms without depending on the real process table.

### BT-207 - Layer the complete readiness state

- Priority: P0
- Size: M
- Status: Done
- Depends on: BT-206

Required states:

```text
process_not_running
process_running_controller_unknown
controller_port_unavailable
controller_ready_mcp_unavailable
ready_read_only
ready_write_policy_enabled
unknown
```

Acceptance:

- `pnpm smoke:read-only` prints the earliest failing layer;
- MCP startup remains independent from Bitwig availability where the protocol
  architecture allows it;
- process, TCP/controller, MCP, and write-policy claims are never collapsed into
  a single `connected` boolean;
- output is safe to consume from TwinPilot.

### BT-208 - Publish a generic dependency-health contract

- Priority: P1
- Size: M
- Status: Done
- Depends on: BT-207 and TwinPilot TP-202

Evidence (2026-07-15): the portable MCP example declares the generic
`requiredProcesses` field consumed by TwinPilot TP-202. A root test locks the
process metadata and proves the shared preset contains neither secrets nor
write-policy activation. TwinPilot's MCP config and health fixture suites passed
unchanged against the generic contract.

Acceptance:

- Beat Twin declares its required/optional processes through metadata or a
  structured status command;
- TwinPilot renders the status without hard-coding `Bitwig` or Beat Twin paths;
- secrets and mutable tool policy are not exposed by the health contract.

## Milestone BT-M2 - Connected Browser Agent Mode

Goal: add the gateway path without weakening standalone ownership or human
confirmation.

### BT-209 - Clear the live S25 three-tool gate

- Priority: P1
- Size: M
- Status: Done
- Evidence: G1 passed with `gemma4-e2b` on 2026-07-14; the sanitized exact
  three-tool capture is tracked in `tests/fixtures/litert-s25-tool-call.json`.

Acceptance:

- the exact `list_daw_targets`, `inspect_session`, and `propose_song_patch`
  payload is captured from the real provider;
- schema, tool-call parsing, and bounded loop fixtures are frozen from evidence;
- the release gate remains fail-closed if the model, tool projection, or
  LiteRT-LM wire shape changes without a fresh capture.

### BT-210 - Implement `BrowserNanoDawPort` WebSocket proxy

- Priority: P1
- Size: L
- Status: Ready
- Depends on: BT-204

Acceptance:

- pairing and authentication are mandatory;
- the browser remains the only song-state owner;
- preview and execution bind adapter, revision, digest, scopes, and expiry;
- disconnects produce honest uncertain outcomes and recoverable status reads.

### BT-211 - Add explicit connected Agent mode

- Priority: P1
- Size: L
- Status: Blocked
- Depends on: BT-209, BT-210

Acceptance:

- standalone remains the default and keeps working when connected services
  disappear;
- model proposals are previewed before confirmation;
- Gemma receives no confirmation or execution tool;
- one accepted patch becomes one atomic NanoDAW batch, revision, autosave, and
  undo checkpoint.

## Milestone BT-M3 - Authenticated Dual Target

Goal: execute the same portable musical patch through separate, explicitly
confirmed NanoDAW and Bitwig flows.

### BT-212 - Implement the bounded `BitwigAdapter`

- Priority: P1
- Size: XL
- Status: Blocked
- Depends on: BT-207, BT-211

Acceptance:

- the historical 57-tool MCP snapshot stays compatible;
- the write bridge is authenticated and strictly bounded;
- target identity and note readback are available before writes are enabled;
- partial execution is reported honestly.

### BT-213 - Prove separate target execution

- Priority: P2
- Size: XL
- Status: Blocked
- Depends on: BT-211, BT-212

Acceptance:

- one portable `SongPatchV1` is previewed for each target;
- NanoDAW and Bitwig each receive a separate human confirmation;
- target or command replacement after confirmation is impossible;
- evidence records plan IDs, revisions, results, and any partial outcome.

### BT-214 - Package the local system

- Priority: P2
- Size: L
- Status: Parked
- Depends on: BT-213

Acceptance:

- install instructions clearly separate standalone NanoDAW from optional
  gateway, provider, controller, and MCP pieces;
- package smoke runs from published artifacts;
- dependency diagnostics are part of setup verification.

## Recommended Order

```text
Standalone: BT-201 -> BT-202 -> BT-203 -> BT-204 -> BT-205
Diagnostics: BT-206 -> BT-207 -> BT-208
Connected:   BT-209 + BT-210 -> BT-211 -> BT-212 -> BT-213 -> BT-214
```
