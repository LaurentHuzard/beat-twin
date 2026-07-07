# Beat Twin Project Summary

Beat Twin is a Bitwig Studio + MCP proof of concept for agent-assisted music production.

It exposes selected Bitwig controls through a local MCP server so an AI agent can inspect and, when explicitly authorized, operate parts of the DAW.

## Current Shape

- Node.js MCP server in `index.js`.
- Bitwig controller script under `bitwig-controller/BeatTwin/`.
- Local TCP JSON-RPC bridge between MCP server and Bitwig.
- Read-only defaults with explicit write-policy gates.
- Offline tests for protocol framing, policy behavior, session inspection, and arrangement planning.
- Copyright-safe Bitwig API placeholder note under `bitwig-api-docs/`.

## What Is Real

- Transport read/write tools exist.
- Track, mixer, clip, scene, device, and application tools exist.
- Write tools are blocked unless an explicit policy environment variable enables them.
- `bitwig_session_inspect` gives a read-only snapshot of the visible Bitwig session.
- `bitwig_arrangement_plan` creates a plan-only arrangement outline without mutating Bitwig.

## Current Risk

- This is still a proof of concept, not a hardened creative production tool.
- Live verification requires Bitwig Studio and a local controller installation.
- Tool exposure must stay conservative because DAW control can quickly become too broad for agents.

## Direction

Keep Beat Twin focused on safe, inspectable Bitwig control. The near-term goal is reliability and clear policy boundaries, not autonomous music production.
