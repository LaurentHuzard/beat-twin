# BT-104 Arrangement Plan-Only

## Tool

`bitwig_arrangement_plan`

## Scope

This MCP tool creates a plan-only arrangement suggestion from the read-only Bitwig session snapshot.

It calls the same safe inspection surface as `bitwig_session_inspect`:

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

## Inputs

```json
{
  "goal": "Make the loop build cleanly",
  "style": "club",
  "targetLengthBars": 64
}
```

All inputs are optional. The default target length is 64 bars, with a minimum planned length of 20 bars.

## Output Shape

The response is a structured plan:

```json
{
  "connected": true,
  "scope": "plan-only",
  "goal": "...",
  "style": "balanced",
  "target_length_bars": 64,
  "musical_summary": "...",
  "observed_session": {
    "tempo": 124,
    "position": 32,
    "is_playing": false,
    "is_recording": false,
    "tracks": [],
    "scenes": [],
    "selected_track": "Lead",
    "selected_device": "Polysynth"
  },
  "missing_data": [],
  "risks": [],
  "permissions_summary": [
    "read",
    "clip_write",
    "scene_write",
    "mixer_write",
    "device_write",
    "transport"
  ],
  "steps": []
}
```

Each step lists its own `permissions_required`, `missing_data`, and `risks`.

## Safety Rules

- Default policy remains read-only.
- The tool is visible and callable without write env vars.
- Write policies are only declared as future execution requirements.
- A disconnected Bitwig session returns reconnect guidance instead of fabricating a plan.
- If Bitwig reports recording active, the plan marks write execution as risky.

## Validation

```bash
rtk node --check index.js
rtk node --test tests/session-inspect.test.js tests/policy-gate.test.js tests/arrangement-plan.test.js
```
