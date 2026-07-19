# Feature Report — BT-MCP-001 Standalone NanoDAW MCP

Date: 2026-07-18
Branch: `agent/nanodaw-mcp`
Base: `origin/agent/nanodaw-instrument-slice`
Worktree: `/tmp/beat-twin-nanodaw-mcp`

## Loop

Expose the first structured MCP vertical slice for a browser-owned NanoDAW:
inspect the session, prepare one strict built-in instrument track and bounded
MIDI clip, review the exact plan, then require a separate human confirmation.

## Product Outcome

An MCP client can now list the four built-in instruments, inspect the connected
NanoDAW, and prepare one exact `SongPatchV2`. The user can load the returned plan
ID in NanoDAW, review every command, and apply the batch once from the browser.
No Bitwig process, controller, bridge, S25 provider, or external DAW is needed.

## Generic Contract

- MCP preparation and DAW mutation are separate operations.
- The MCP surface has three tools and no confirm, apply, or execute tool.
- Plans are immutable, revision-bound, scope-bound, expiring, and fail closed.
- Browser pairing and the existing confirmation path remain mandatory.

## Project-Specific Boundary

- NanoDAW's browser store remains the sole owner of song state.
- The accepted catalog is `drums`, `bass`, `chords`, and `lead`.
- The patch contract remains one instrument track, one clip, and bounded notes.
- Standalone mode does not start the MCP or Gateway implicitly.

## Changes

- Added the TypeScript `@beat-twin/nanodaw-mcp` package, stdio server, loopback
  runtime, CLI, strict tool schemas, and tests.
- Reused `BrowserNanoDawPort`, `NanoDawAdapter`, pairing, plan storage, exact
  confirmation, atomic execution, and readback instead of creating a second
  write path.
- Added authenticated `GET /v1/mcp/plans/:id` review loading to the loopback
  runtime and a plan-ID review control in Agent mode.
- Added root scripts, build/test integration, lockfile entries, setup docs, and
  responsive UI styling.

## Verification

- `pnpm --filter @beat-twin/nanodaw-mcp test`: passed.
- `pnpm test`: 160/160 passed outside the filesystem sandbox, where the HTTP and
  WebSocket tests could bind their loopback ports.
- `pnpm typecheck`: passed.
- `pnpm nanodaw:test`: 41/41 passed.
- `pnpm --filter @beat-twin/playground build`: passed.
- `pnpm smoke:packages`: passed; the MCP package is included in `build:packages`.
- `git diff --check`: passed.

## Fixture Validation

Playwright connected a real NanoDAW page to the loopback runtime and loaded a
prepared `Orbit Bass` plan at revision 0. Before confirmation the song remained
empty while the UI showed five commands. One browser click then produced 118
BPM, one `bass` track, one four-beat `MCP Verse` clip, notes 36 and 39, one undo
checkpoint, autosave, and the expected five command-log entries.

Desktop and 390x844 responsive checks completed. Console capture reported zero
errors and zero warnings.

## Musical Evidence

The browser proved document structure, instrument identity, note placement,
atomic command application, autosave, and undo state. No human listening test
was performed, so audible character or musical quality is not claimed.

## Adversarial Review

- Loading an MCP plan calls no confirm or execute endpoint and causes no song
  mutation; component and browser evidence cover this boundary.
- Unknown instruments and malformed patches fail before plan creation.
- Disconnected browser state, unsupported capabilities/scopes, stale revisions,
  expired plans, invalid origins/hosts, and missing bearer tokens fail closed.
- A live browser run exposed an unbound `crypto.randomUUID` receiver; the
  generator is now wrapped and has a regression test.
- No JavaScript script was added or modified.

## Documentation

`docs/NANODAW_MCP.md`, the root README, documentation index, status, roadmap,
queue, and current plan describe setup, trust boundaries, and the no-DAW flow.

## Provider State

The runtime exposes structured MCP planning over stdio and a loopback Gateway
for browser review/execution. It does not call S25 or another model provider.
No live Bitwig or controller claim is part of this loop.

## Git

The loop was prepared on `agent/nanodaw-mcp` in an isolated worktree. A later
user activation signal authorized committing and pushing this complete tranche.
No PR, merge, deployment, or branch deletion is included. The primary checkout
and existing standalone worktree were not modified.

## Remaining Risks

- Validation ran on Node 26.4.0, while repository engines declare Node 22 or 24;
  commands passed but emitted the engine warning.
- Prepared plans live in runtime memory and expire with the existing short plan
  TTL; restarting the process discards them.
- The first MCP patch is deliberately narrow and does not edit an existing song,
  create several tracks/clips, expose arbitrary plugins, or own playback.
- Human listening remains outstanding.

## Metrics

- MCP tools: 3 preparation/read tools, 0 confirmation/execution tools.
- Browser fixture: 5 reviewed commands, 1 human confirmation, 1 track, 1 clip,
  2 notes, 1 browser-owned batch.
- Automated evidence: 160 root tests and 41 Playground tests passed.

## Next Activation Signal

A user request for one of these bounded follow-ups: add multi-track/multi-clip
patching, edit an existing NanoDAW song with explicit revision semantics, expose
transport preview, or package the local MCP install flow. Live Bitwig work stays
on its separate gate.
