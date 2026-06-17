# Beat Twin Project Summary

Beat Twin is a Bitwig Studio + MCP proof of concept for agent-assisted music production.

It exposes selected Bitwig controls through a local MCP server so an AI agent can inspect and operate parts of the DAW without owning the creative process.

## Current Shape

- Node.js MCP server in `index.js`.
- Bitwig controller script under `bitwig-controller/`.
- Local TCP bridge between MCP server and Bitwig.
- Bitwig API reference material under `bitwig-api-docs/`.
- Agent/team notes under `agents-team/`.

## What Is Real

- Transport tools exist for play, stop, restart, record, tempo, and position.
- Track and mixer tools exist for bank and selected-track operations.
- The controller script can be installed into Bitwig's controller scripts directory.
- The project has a substantial Bitwig API knowledge base checked in for local reference.

## Current Risk

- This is still a proof of concept, not a hardened creative production tool.
- Tool exposure must stay conservative because DAW control can quickly become too broad for agents.
- The repository was restored locally from the previous `llm2Bitwig` remote and is being renamed to `beat-twin`.

## Direction

Keep Beat Twin focused on safe, inspectable Bitwig control and music-production workflows. It should remain an audio/MCP lab unless it graduates into a maintained Bitwig integration.
