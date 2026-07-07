# Beat Twin Project Summary

Beat Twin is a Bitwig Studio + MCP proof of concept for agent-assisted music production workflows.

It exposes a small set of Bitwig controls through a local MCP server so an AI agent can inspect and operate parts of the DAW while keeping the human producer in charge of creative decisions.

## Current Shape

- Node.js MCP server in `index.js`.
- Bitwig controller script under `bitwig-controller/`.
- Local TCP bridge between MCP server and Bitwig.
- Protocol smoke tests under `tests/`.
- Agent workflow notes under `agents-team/`.

## Implemented Surface

- Transport controls: play, stop, restart, record, tempo, and position.
- Track and mixer controls: bank status, selected-track status, volume, pan, mute, solo, arm, and selection.
- Local protocol checks for framing, response parsing, timeout, malformed responses, and reconnect behavior.

## Design Posture

Beat Twin is intentionally conservative:

- local-first;
- explicit MCP tools;
- narrow write operations;
- no broad automation surface;
- no claim of production readiness.

## Direction

Keep Beat Twin focused on safe, inspectable Bitwig control. Expand only when preview, permission, and rollback boundaries are clear enough for agent-assisted creative workflows.