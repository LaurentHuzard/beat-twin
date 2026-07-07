# BT-103 Policy Gate Lecture / Ecriture

## Decision

Beat Twin now classifies every MCP tool into one policy class:

- `read`
- `transport`
- `mixer_write`
- `clip_write`
- `scene_write`
- `device_write`
- `application_write`

`bitwig_session_inspect` stays `read` and remains read-only.

## Default behavior

By default, the MCP server exposes only `read` tools in `listTools`, and only those tools are callable.

This keeps the default surface aligned with the "inspect before mutate" rule.

## Write activation

Two env toggles are supported:

1. `BITWIG_MCP_WRITE_POLICY=transport,mixer_write`
2. `BITWIG_MCP_ENABLE_WRITES=1`

`BITWIG_MCP_WRITE_POLICY` enables only the listed write classes.

`BITWIG_MCP_ENABLE_WRITES=1` enables every write class.

Examples:

```bash
BITWIG_MCP_WRITE_POLICY=transport,mixer_write node index.js
BITWIG_MCP_ENABLE_WRITES=1 node index.js
```

MCP clients usually discover tools when the server starts. If a write policy is
added after a client session is already running, restart or reload the client
session before expecting write tools to appear in `listTools`.

## Blocked tool response

If a write tool is called without the needed policy, Beat Twin returns a structured MCP error payload before any Bitwig call is attempted:

```json
{
  "error": "policy_blocked",
  "tool": "track_bank_set_volume",
  "policy": "mixer_write",
  "message": "Tool track_bank_set_volume requires the mixer_write write policy before it can call Bitwig.",
  "required_config": {
    "anyOf": [
      {
        "env": "BITWIG_MCP_WRITE_POLICY",
        "value": "mixer_write"
      },
      {
        "env": "BITWIG_MCP_ENABLE_WRITES",
        "value": "1"
      }
    ]
  }
}
```

## Allowed write response

Allowed write tools return a traceable wrapper:

```json
{
  "tool": "track_bank_set_volume",
  "policy": "mixer_write",
  "method": "track.bank.volume",
  "params": [2, 0.75],
  "result": "OK"
}
```

This keeps the policy class, Bitwig method, and params visible in the MCP response.

## Current classification

### Read

- `bitwig_session_inspect`
- `bitwig_arrangement_plan`
- `transport_get_tempo`
- `transport_get_position`
- `transport_playing_status`
- `track_bank_get_status`
- `scene_list`
- `track_selected_get_status`
- `device_get_status`
- `device_get_remote_controls`

### Transport

- `transport_play`
- `transport_stop`
- `transport_restart`
- `transport_record`
- `transport_set_tempo`
- `transport_set_position`

### Mixer Write

- `track_bank_set_volume`
- `track_bank_set_pan`
- `track_bank_set_mute`
- `track_bank_set_solo`
- `track_bank_select`
- `track_selected_set_volume`
- `track_selected_set_pan`
- `track_selected_set_mute`
- `track_selected_set_solo`
- `track_selected_set_arm`

### Clip Write

- `clip_launch`
- `clip_record`
- `clip_stop`
- `clip_create`

### Scene Write

- `scene_launch`
- `scene_create`

### Device Write

- `device_toggle_window`
- `device_toggle_expanded`
- `device_set_remote_control`
- `device_page_next`
- `device_page_previous`

### Application Write

- `application_create_instrument_track`
- `application_create_audio_track`
