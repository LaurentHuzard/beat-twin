# Bitwig Manual Smoke Checklist

Date: 2026-06-26

Scope: live manual verification notes for Beat Twin with Bitwig Studio. Do not treat this as an automated test. The offline protocol smoke remains `npm run test:protocol-smoke`.

## Preconditions

- Bitwig Studio is installed and can load controller scripts.
- The `BitwigPOC` controller script is available from `bitwig-controller/BitwigPOC/BitwigPOC.control.js`.
- Node dependencies are installed for the MCP server.
- No important recording session is armed or running.
- The operator understands that write tools are blocked by default unless policy env vars are set.

## Before Launch

Run the offline checks first:

```bash
rtk node --check index.js
rtk node --test tests/session-inspect.test.js tests/policy-gate.test.js tests/arrangement-plan.test.js
rtk npm run test:protocol-smoke
```

Expected:

- Unit tests pass.
- Protocol smoke passes against the mock TCP server.
- No Bitwig instance is required for these checks.

Known blocker to verify before trusting live control:

- `index.js` sends a 4-byte big-endian length prefix before JSON-RPC payloads.
- `BitwigPOC.control.js` currently parses incoming bytes directly as JSON.
- If the controller script has not been adjusted, live Bitwig connection may fail even when the Node smoke passes.

## Start MCP Server

Default read-only mode:

```bash
rtk node index.js
```

Expected:

- Server prints that it is running on stdio.
- Only read tools are listed by MCP clients.
- Mutating tools remain hidden and blocked.

Optional write-gated mode for transport-only smoke:

```bash
BITWIG_MCP_WRITE_POLICY=transport rtk node index.js
```

Use this only after read-only inspection succeeds.

## Activate Bitwig Controller

In Bitwig:

1. Open a disposable project or a copy of a real project.
2. Add/enable the `BitwigPOC` controller.
3. Confirm that the controller listens on `127.0.0.1:8888`.
4. Keep transport stopped before the first tool call.

Expected:

- Controller logs a client connection when the MCP server connects.
- If parsing fails immediately, inspect the framing mismatch before testing musical tools.

## Read-Only Inspector Smoke

Call:

```text
bitwig_session_inspect
```

Expected response:

- `connected: true`
- `scope: read-only`
- transport fields: tempo, position, playing, recording
- track bank data for the visible 8-track window
- selected track
- scene list
- selected device and remote controls
- `read_errors` only for partial read failures

Must not happen:

- Transport starts.
- Track selection changes.
- Clips or scenes launch.
- Devices open, close, expand, or change page.

## Arrangement Plan-Only Smoke

Call:

```text
bitwig_arrangement_plan
```

Suggested args:

```json
{
  "goal": "Turn the current loop into a safe arrangement draft",
  "style": "club",
  "targetLengthBars": 64
}
```

Expected response:

- `scope: plan-only`
- observed session summary
- missing data list
- risk list
- steps with `permissions_required`
- no Bitwig mutation

Must not happen:

- No clip creation.
- No scene creation.
- No playback or transport change.
- No mixer or device change.

## Optional Transport Write Smoke

Only run after read-only checks pass and only in a disposable project.

Start MCP with:

```bash
BITWIG_MCP_WRITE_POLICY=transport rtk node index.js
```

Call sequence:

1. `transport_get_tempo`
2. `transport_play`
3. `transport_stop`

Expected:

- Read returns the current tempo.
- Play starts transport.
- Stop stops transport.
- Returned payload wraps write calls with `tool`, `policy`, `method`, `params`, and `result`.

Rollback:

- Stop transport.
- Disable recording.
- Close the disposable project without saving if anything unexpected changed.

## Failure Notes

- Connection refused: Bitwig controller is not listening or port differs from `BITWIG_PORT`.
- Timeout: controller accepted the socket but did not respond with newline-delimited JSON.
- Parse error: likely framing mismatch between Node length-prefixed requests and controller raw JSON parsing.
- Policy blocked: expected unless the required `BITWIG_MCP_WRITE_POLICY` is enabled.
- Partial read errors: acceptable for inspection if the response is explicit and no mutation occurred.
