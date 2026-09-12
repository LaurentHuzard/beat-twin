# Beat Twin Project Summary

Beat Twin is a Bitwig Studio + MCP proof of concept and browser NanoDAW for
agent-assisted music production experiments.

It exposes selected Bitwig controls through a local MCP server so an AI agent
can inspect and, when explicitly authorized, operate parts of the DAW. It also
keeps a local browser NanoDAW where the UI and future agent flows share the
same deterministic command path over a pure song model.

## Current Shape

- Node.js MCP server in `index.js`.
- Bitwig controller script under `bitwig-controller/BeatTwin/`.
- Local TCP JSON-RPC bridge between MCP server and Bitwig.
- Read-only defaults with explicit write-policy gates.
- Offline tests for protocol framing, policy behavior, session inspection, and arrangement planning.
- Short read-only smoke command for live TCP/session diagnostics.
- Pure packages under `packages/core`, `packages/retention`, `packages/commands`, `packages/audio-tone`, `packages/daw-contract`, and `packages/agent-contract`.
- Transactional NanoDAW memory adapter and browser-proxy contract under `packages/adapters/nanodaw`.
- Strict LiteRT-LM provider under `packages/litert-provider` and fail-closed security core under `packages/gateway-core`.
- Typed loopback-only Agent HTTP/WebSocket delivery under
  `packages/gateway-http`, with `apps/gateway` retained as a compatibility
  facade.
- Explicit NanoDAW MCP process composition under `apps/nanodaw-mcp`; reusable
  schemas, service, and MCP transport remain in `packages/mcp`.
- Executable workspace dependency rules in CI and bounded, clock-injected
  process-lifetime retention across mutation and Gateway registries.
- Browser NanoDAW under `apps/playground` for now; the repo path stays stable while the product name shifts.
- Copyright-safe Bitwig API placeholder note under `bitwig-api-docs/`.

## What Is Real

- Transport read/write tools exist.
- Track, mixer, clip, scene, device, and application tools exist.
- Write tools are blocked unless an explicit policy environment variable enables them.
- `bitwig_session_inspect` gives a read-only snapshot of the visible Bitwig session.
- `bitwig_arrangement_plan` creates a plan-only arrangement outline without mutating Bitwig.
- `pnpm smoke:read-only` checks the live Bitwig bridge without enabling write tools.
- The NanoDAW supports local song sketches, Tone.js audition, note editing,
  pattern tools, keyboard shortcuts, undo/redo, save/load, timeline feedback,
  command palette actions, and deterministic command drafts.
- Command batches are atomic, revisioned, fully materialized before execution, and idempotent by request payload.
- `SongPatchV1` validates and previews the first portable one-track/one-clip agent proposal without mutation.
- A real S25 capture proves the exact three-tool OpenAI-style request and a strictly valid `propose_song_patch` response with `gemma4-e2b`.

## Current Risk

- This is still a proof of concept, not a hardened creative production tool.
- Live verification requires Bitwig Studio and a local controller installation.
- Tool exposure must stay conservative because DAW control can quickly become too broad for agents.
- The NanoDAW has a tested memory adapter contract, but connected browser mode
  and the authenticated Bitwig adapter still require separately confirmed live
  dual-target proof and packaging before they are production-ready.
- Gateway pairings, plans, confirmations, and execution status are currently
  bounded process-memory state; restart-durable recovery is not implemented and
  no external mutation is replayed automatically after restart.
- The first architecture migration slices now enforce dependency direction,
  expose typed Gateway delivery, and give NanoDAW MCP an explicit application
  owner. Later hotspot decomposition remains sequenced by the architecture
  roadmap.

## Direction

Keep Beat Twin focused on safe, inspectable Bitwig control and browser-first
composition primitives. The near-term goal is reliability, clear policy
boundaries, and one shared command path, not autonomous music production.
