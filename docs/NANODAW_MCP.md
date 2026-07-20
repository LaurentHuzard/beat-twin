# NanoDAW MCP

NanoDAW MCP is the standalone, no-external-DAW path for preparing musical
edits from an MCP client. It connects to the browser-owned NanoDAW over the
existing loopback Gateway and does not require Bitwig, a controller script, the
historical Bitwig MCP server, or the S25 provider.

## First Tool Slice

The MCP server exposes exactly three tools:

- `nanodaw_list_instruments`: returns `drums`, `bass`, `chords`, and `lead`;
- `nanodaw_inspect`: reads the connected browser-owned song and revision;
- `nanodaw_prepare_instrument_clip`: validates one `SongPatchV2`, materializes
  the track, instrument, clip, and note commands, and stores a two-minute plan.

There is deliberately no MCP confirmation, apply, execute, transport, plugin,
filesystem, or arbitrary-synthesis tool. Preparation does not mutate the song.

## End-to-End Flow

```text
MCP client
  -> nanodaw_prepare_instrument_clip
  -> immutable plan id + exact preview
  -> NanoDAW loads /v1/mcp/plans/{planId}
  -> human reviews track, instrument, clip, notes, revision, and scopes
  -> human clicks Confirm and apply once
  -> one browser command batch, one revision, one autosave, one undo checkpoint
```

The MCP and Gateway never keep a second song copy. Inspection and execution are
authenticated RPCs to the currently connected browser. A disconnected browser,
stale revision, expired plan, unsupported command, invalid instrument, or
failed readback stops the flow before a claimed success.

## Build And Configure

Build the workspace packages once:

```bash
pnpm nanodaw:mcp:build
```

Choose a local operator secret of at least 16 characters. The MCP process and
the browser pairing form must receive the same value. Example MCP configuration:

```bash
codex mcp add nanodaw \
  --env NANODAW_MCP_OPERATOR_SECRET=replace-with-a-long-local-secret \
  -- node --experimental-strip-types \
  /absolute/path/to/beat-twin/apps/nanodaw-mcp/src/cli.ts
```

The process starts its browser Gateway on `http://127.0.0.1:8787`. The default
allowed NanoDAW origins are `http://127.0.0.1:5173` and
`http://127.0.0.1:4173`. Override them with a comma-separated
`NANODAW_MCP_ALLOWED_ORIGINS` value, or the port with `NANODAW_MCP_PORT`.

Start NanoDAW separately:

```bash
pnpm nanodaw:dev
```

In **Agent mode**, use the Gateway URL, pair with the operator secret, paste the
plan id returned by MCP, and select **Load MCP plan**. Loading is still
read-only. The only mutation authority is the subsequent browser button
**Confirm and apply once**.

## Example Tool Input

```json
{
  "schemaVersion": 2,
  "tempoBpm": 118,
  "track": {
    "kind": "instrument",
    "name": "Night Bass",
    "instrumentId": "bass",
    "clip": {
      "name": "Verse",
      "lengthBeats": 4,
      "notes": [
        { "pitch": 36, "velocity": 110, "startBeat": 0, "lengthBeats": 1 },
        { "pitch": 39, "velocity": 96, "startBeat": 2, "lengthBeats": 1 }
      ]
    }
  }
}
```

## Evidence Boundary

Offline tests cover strict input validation, materialized commands, immutable
pending plans, absence of MCP execution tools, browser plan loading, atomic
application, autosave, and undo. The BT-MCP-001 loop report records one real
browser proof; future UI changes require fresh rendered evidence. Neither that
run nor offline tests prove audible quality, Bitwig, S25, or another external
runtime.
