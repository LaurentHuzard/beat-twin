# Bitwig Manual Smoke Checklist

Scope: live manual verification notes for Beat Twin with Bitwig Studio.

This is not an automated test. The offline protocol smoke remains `npm test`.

## Preconditions

- Bitwig Studio is installed and can load controller scripts.
- The Beat Twin controller script is available from `bitwig-controller/BeatTwin/BeatTwin.control.js`.
- Node dependencies are installed for the MCP server.
- No important recording session is armed or running.
- Live write checks are performed only in a disposable Bitwig project.

## Before Launch

Run the offline checks first:

```bash
node --check index.js
npm test
```

Expected:

- Protocol smoke passes against the mock TCP server.
- No Bitwig instance is required for these checks.

## Start MCP Server

Default mode:

```bash
node index.js
```

Expected:

- Server starts on stdio for MCP clients.
- Server attempts to connect to the Bitwig controller bridge.

## Activate Bitwig Controller

In Bitwig:

1. Open a disposable project or a copy of a real project.
2. Add/enable the `Beat Twin` controller.
3. Confirm that the controller listens on `127.0.0.1:8888`.
4. Keep transport stopped before the first tool call.

Expected:

- Controller logs a client connection when the MCP server connects.
- Transport remains stopped until explicitly controlled.

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

Call sequence:

1. `transport_get_tempo`
2. `transport_play`
3. `transport_stop`

Expected:

- Read returns the current tempo.
- Play starts transport.
- Stop stops transport.

Rollback:

- Stop transport.
- Disable recording.
- Close the disposable project without saving if anything unexpected changed.

## Failure Notes

- Connection refused: Bitwig controller is not listening or port differs from `BITWIG_PORT`.
- Timeout: controller accepted the socket but did not respond with newline-delimited JSON.
- Parse error: inspect the frame parser or malformed payload.
- Partial read errors: acceptable for inspection if the response is explicit and no mutation occurred.
