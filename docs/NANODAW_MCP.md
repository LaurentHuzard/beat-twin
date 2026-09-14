# NanoDAW MCP

NanoDAW MCP is the standalone, no-external-DAW path for preparing musical
edits from an MCP client. It connects to the browser-owned NanoDAW over the
existing loopback Gateway and does not require Bitwig, a controller script, the
historical Bitwig MCP server, or the S25 provider.

## Musical catalog

The MCP server preserves these three original tools:

- `nanodaw_list_instruments`: returns `drums`, `bass`, `chords`, and `lead`;
- `nanodaw_inspect`: reads the connected browser-owned song and revision;
- `nanodaw_prepare_instrument_clip`: validates one `SongPatchV2`, materializes
  the track, instrument, clip, and note commands, and stores a two-minute plan.

The expanded [musical catalog](NANODAW_MCP_CATALOG.md) adds search_tools/call_tool,
track/clip/note editing, grouped plans, transport preparation, status/report
inspection and revision-bound recovery. All mutations and transport changes
remain preparations for browser confirmation. There is no MCP confirmation,
autonomous apply/execute, plugin, filesystem or arbitrary-synthesis tool.
Preparation does not mutate the song.

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

Open **TWIN**, enable **Agent mode**, open **Connection settings**, then pair
with the Gateway URL. For this standalone MCP server, select **This gateway
requires an operator secret** and enter the configured secret before connecting.
Leave it unchecked for a local-pairing Gateway. External plans appear automatically
in **Incoming MCP proposals** (refresh every ten seconds while connected).
Choose **Review <track>** to load the exact plan. Developer Mode is not required;
its manual **Load MCP plan** field remains a diagnostic fallback.

Arrival and loading are read-only and never replace the preview being reviewed.
Only **Confirm and apply once** requests mutation. A discarded proposal stays
hidden in this browser pairing session. Closing TWIN preserves the session;
disabling Agent mode clears it. Discovery stops on errors or an older Gateway's
404 response; disable/re-enable and pair again to retry.

## NanoDAW-only Musical Agent

To generate proposals directly from the TWIN text box, configure an explicit
OpenAI-compatible endpoint and model. Native llama.cpp is supported; Docker,
Bitwig, a bridge secret and S25 are not required. For example, with your already
running MUE model server:

```bash
NANODAW_MCP_OPERATOR_SECRET=replace-with-a-long-local-secret \
LITERT_BASE_URL=http://mue.orbit:8003/ \
LITERT_MODEL=qwen3-8b \
LITERT_API_KEY=replace-with-your-provider-key \
pnpm nanodaw:agent
```

Omit `LITERT_API_KEY` only when the chosen provider does not require authentication.
The key is sent to the configured provider for model listing and chat requests.

Start `pnpm nanodaw:dev` separately and pair TWIN with
`http://127.0.0.1:8787`. Select **Generate preview**, inspect the exact changes,
then explicitly confirm. The endpoint receives the musical request and inspected
song data during an agent run; configure only a provider you intend to use.
Startup and inbox discovery do not contact the model. A gateway health check
does query its model list. The model loop uses at most four steps, a 60-second
per-request timeout and a llama.cpp reasoning budget of 512 tokens.

`nanodaw:agent` runs the browser HTTP/WebSocket gateway without stdio. To combine
the TWIN text box and an external MCP agent in one process, pass `LITERT_BASE_URL`
and `LITERT_MODEL` to the existing MCP CLI instead. Do not run both entrypoints
on port 8787: they have separate in-memory plans and cannot share a browser.
Without provider configuration, the MCP CLI retains structured planning only;
TWIN disables **Generate preview** and explains the missing configuration.

The NanoDAW provider explicitly opts into `SongPatchV2`: instrumentId is required
and limited to drums/bass/chords/lead. Legacy and dual-target providers remain
V1 by default. This slice still creates one new track and one clip with 1–16
notes, not variations or placement into existing slots. No audition, live
transport control, multi-clip generation or MIDI export is added.

## Discovery And Retention

`GET /v1/mcp/plans` requires a paired token with `plan.confirm`, loopback Host
and an allowed Origin when supplied. It returns `agentAvailable` and at most
32 pending, unexpired MCP plan summaries. At capacity, further preparation
fails before storing another plan. Expired and consumed reviews leave the inbox.
Discovery does not grant confirmation or execution authority to the model.

All plans remain process-memory only and expire after two minutes. Restarting
loses them. Inbox pruning uses the bounded retention infrastructure from main;
restart-durable recovery remains a follow-up. Reconnect and create a fresh proposal
after expiry/restart, and inspect the song before acting after an uncertain
execution result. Never blindly retry an uncertain plan.

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
