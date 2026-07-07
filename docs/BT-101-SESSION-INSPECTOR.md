# BT-101 Session Inspector

## Tool

`bitwig_session_inspect`

## Scope

This MCP tool is read-only. It composes existing Bitwig read calls into one session snapshot:

- `ping`
- `transport.getTempo`
- `transport.getPosition`
- `transport.getIsPlaying`
- `transport.getIsRecording`
- `track.bank.get_status`
- `track.selected.get_status`
- `scene.list`
- `device.get_status`
- `device.get_remote_controls`

It does not call transport, mixer, clip, scene, application, or device mutation methods.

## Disconnected Behavior

If the initial `ping` fails, the tool returns a structured object:

```json
{
  "connected": false,
  "setup_hint": "Start the MCP server, open Bitwig Studio, enable the Beat Twin controller, then retry inspection.",
  "error": "..."
}
```

## Connected Shape

When connected, the tool returns:

```json
{
  "connected": true,
  "scope": "read-only",
  "transport": {
    "tempo": 128,
    "position": 64,
    "isPlaying": true,
    "isRecording": false
  },
  "trackBank": [],
  "selectedTrack": {},
  "scenes": [],
  "selectedDevice": {},
  "remoteControls": [],
  "read_errors": {}
}
```

Individual read failures are captured under `read_errors` without turning the whole inspection into a mutation or a partial hidden failure.
