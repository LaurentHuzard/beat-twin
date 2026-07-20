<p align="center">
  <img src="Beat-Twin_logo.png" alt="Beat Twin logo" width="240">
</p>

# Beat Twin

Beat Twin is an experimental, local-first orchestration layer between musical agents and DAWs.

Its current repo contains three working musical surfaces:

- a Bitwig Studio MCP bridge with explicit write-policy gates;
- a standalone browser NanoDAW built on the canonical Beat Twin song and command models;
- a NanoDAW MCP planning surface that prepares instrument-track and MIDI-clip
  plans for explicit review and confirmation in the browser, without Bitwig.

The DAW/agent contracts, transactional NanoDAW memory adapter, LiteRT-LM
provider, Gateway security core, loopback HTTP API, authenticated browser
WebSocket proxy, connected Agent mode, and bounded Bitwig adapter are
implemented and covered by deterministic tests. The separately confirmed live
NanoDAW/Bitwig proof and installable runtime packaging remain gated work.

## What Works

- Read-only session inspection for transport, tracks, scenes, selected device, and remote controls.
- Plan-only arrangement suggestions based on the current read-only Bitwig snapshot.
- A short read-only live smoke that separates TCP/controller setup failures from session-inspection failures.
- Transport, mixer, clip, scene, device, and application write tools, hidden and blocked by default.
- A Bitwig controller script that speaks JSON-RPC over a local TCP connection.
- Offline protocol and policy tests that run without launching Bitwig.
- A browser NanoDAW for command-first song sketches, Tone.js audition, note editing, pattern tools, keyboard shortcuts, local undo/redo, JSON save/load, visible timeline feedback, a local command palette, and deterministic command drafts.
- A browser-owned live runtime with one persistent clock, quantized launcher,
  step editor, and atomic MIDI loop recording/overdub.
- Atomic `ExecutableBeatTwinCommand[]` batches with monotonic revisions, stable errors, and idempotent request IDs.
- A versioned `DawAdapter` contract with fake-adapter conformance tests.
- Strict `SongPatchV1` validation, deterministic compilation, and mutation-free preview.
- A `NanoDawAdapter` memory port plus an abstract browser-owned proxy boundary.
- A real S25 LiteRT-LM capture of the exact three-tool runtime request, plus a strict provider loop bounded to four steps; G1 passed with `gemma4-e2b` on 2026-07-14.
- A fail-closed Gateway core for hashed pairing tokens, quotas, immutable plans, short-lived single-use confirmations, and redacted audit events.
- A loopback-only Gateway HTTP API with strict pairing,
  target-fixed preview/confirmation/execution, and process-lifetime terminal
  uncertain-outcome readback.
- A typed `@beat-twin/gateway-http` delivery package, an explicit
  `apps/nanodaw-mcp` composition root, and CI-enforced workspace dependency
  direction.
- An authenticated browser WebSocket proxy and explicit connected Agent mode
  that preserve the browser as the only NanoDAW song owner.
- A bounded `bitwig-launcher-v1` adapter with authenticated writes, fixed target
  identity, strict musical bounds, and exact note readback in deterministic tests.
- Bounded, clock-injected process-lifetime retention for command, adapter,
  Gateway, MCP review, and browser performance registries. Restart never
  triggers automatic mutation replay.

## Architecture

The current Bitwig MCP path is:

```text
MCP client
  -> Node.js MCP server (index.js)
  -> local TCP JSON-RPC bridge on 127.0.0.1:8888
  -> Bitwig controller script
  -> Bitwig Studio
```

The Node process is the MCP server. It connects to the Bitwig controller on demand through `BITWIG_HOST` and `BITWIG_PORT`.

The browser NanoDAW foundation now lives alongside the MCP bridge:

```text
apps/playground
  -> @beat-twin/commands
  -> @beat-twin/core
  -> @beat-twin/audio-tone browser audition
  -> localStorage JSON save/load
```

The historical 57-tool Bitwig MCP bridge still lives in `index.js` as a
compatibility path. The portable `BitwigAdapter` lives separately under
`packages/adapters/bitwig` and receives the shared authenticated RPC primitive
through an injected port. Browser audition is local Web Audio preview, not a
Bitwig mutation or MCP write.
Browser save/load is also local NanoDAW state, not a Bitwig mutation.
Browser pattern tools are local document edits for duplicate, quantize, and transpose.
Browser undo/redo restores local NanoDAW command snapshots only.
Browser keyboard shortcuts invoke existing local NanoDAW actions only.
Browser timeline feedback is derived from local song state and does not call Bitwig.
Browser command palette actions reuse the same local NanoDAW action boundary.
Browser command drafts parse known local phrases only; they are not an AI chat path.

The standalone NanoDAW MCP path is separate from the historical Bitwig MCP:

```text
MCP client
  -> apps/nanodaw-mcp
  -> @beat-twin/nanodaw-mcp + @beat-twin/gateway-http
  -> immutable plan -> browser review -> human confirm
```

It exposes catalog, inspection, and plan-preparation tools only. It never owns
song state and has no confirmation or execution tool. See
[`docs/NANODAW_MCP.md`](docs/NANODAW_MCP.md).

The Agent architecture keeps the browser as the only owner of NanoDAW song
state and puts Beat Twin on the laptop between the UI, the phone-hosted model,
and the selected DAW adapter:

```text
NanoDAW Agent mode
  -> Beat Twin Gateway on the laptop
  -> LiteRT-LM OpenAI-compatible API on the S25
  -> validated SongPatch
  -> ExecutableBeatTwinCommand[]
  -> side-effect-free preview
  -> explicit human confirmation
  -> NanoDawAdapter | BitwigAdapter
  -> verifiable execution report
```

Gemma may only list targets, inspect the selected session, and propose a
bounded `SongPatchV1`. Confirmation and execution are gateway/UI operations;
they are never model tools. The existing `TOOL_SPECS` registry remains the
historical 57-tool Bitwig MCP surface, not the portable agent language. See
[`docs/LOCAL-LLM-TOOL-ORCHESTRATION.md`](docs/LOCAL-LLM-TOOL-ORCHESTRATION.md).

The provider, security core, typed loopback HTTP/WebSocket delivery, explicit
NanoDAW MCP application, browser connected-mode wiring, architecture guard, and
bounded process-lifetime retention are implemented. Live S25 plus Bitwig
dual-target proof, restart-durable Gateway recovery, and installable packaging
remain separate follow-up gates.

## Requirements

- Node.js 24 for local development; Node.js 22 and 24 are covered by CI
- pnpm 11.10.0 through Corepack
- Bitwig Studio for live/manual verification

## Install

```bash
pnpm install
```

## Run

```bash
node index.js
```

Configure your MCP client to run that command from this repository. A portable example lives in [`llm-mcp/mcp.example.json`](llm-mcp/mcp.example.json).

Codex example:

```bash
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 -- node /absolute/path/to/beat-twin/index.js
```

## Install The Bitwig Controller

Copy the controller script into your Bitwig controller scripts directory.

Linux example:

```bash
mkdir -p "$HOME/Bitwig Studio/Controller Scripts/BeatTwin"
cp bitwig-controller/BeatTwin/BeatTwin.control.js "$HOME/Bitwig Studio/Controller Scripts/BeatTwin/BeatTwin.control.js"
```

macOS users commonly use:

```text
$HOME/Documents/Bitwig Studio/Controller Scripts/
```

Windows users can copy `bitwig-controller/BeatTwin` into:

```text
%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\
```

Then open Bitwig Studio and add the controller manually:

```text
Beat Twin -> Beat Twin
```

If Bitwig was already open before installing the file, restart Bitwig or reload
the controller settings before testing the bridge. See [`docs/LOCAL_MCP_SETUP.md`](docs/LOCAL_MCP_SETUP.md)
for local verification commands and troubleshooting.

## Safety Model

Beat Twin is read-only by default. At the MCP entry point, write tools are not listed by MCP clients and are blocked without an enabling policy. The Bitwig controller also requires per-connection authentication for every non-read RPC. Configure its `Bridge secret` preference and pass the same value as `BITWIG_BRIDGE_SECRET`; keep the default bridge on loopback and never expose it to untrusted networks.

The Agent Gateway does not expose these Bitwig MCP write tools to Gemma.
It validates a constrained SongPatch, materializes executable IDs, previews the
exact plan without mutation, and requires a short-lived human confirmation.
The `bitwig-launcher-v1` adapter now authenticates, validates one bounded empty
launcher target, binds every mutation to its confirmed identity, and requires
tempo/clip/note readback. Its first live write belongs to the separately
confirmed BT-213 disposable-project proof.

To enable a narrow write class:

```bash
BITWIG_MCP_WRITE_POLICY=transport node index.js
```

To enable multiple write classes:

```bash
BITWIG_MCP_WRITE_POLICY=transport,mixer_write node index.js
```

To enable every write class for disposable test sessions only:

```bash
BITWIG_MCP_ENABLE_WRITES=1 node index.js
```

Use write mode only in a disposable Bitwig project or a copy of real work.

## Tests

Run the offline checks:

```bash
pnpm test
pnpm check:architecture
```

Run a syntax check:

```bash
node --check index.js
```

Run the short read-only live smoke after Bitwig has loaded the controller:

```bash
pnpm smoke:read-only
```

This checks TCP connectivity first, then returns a compact read-only session
summary. It does not enable write tools or mutate Bitwig.

Run the browser NanoDAW checks:

```bash
pnpm nanodaw:test
pnpm test:playground
pnpm --filter @beat-twin/playground build
```

Live tests require Bitwig Studio, the controller script, and explicit write permissions. They are intentionally separate from the default test suite.

## Useful Docs

- [`docs/ARCHITECTURE_AUDIT_2026-07-20.md`](docs/ARCHITECTURE_AUDIT_2026-07-20.md)
- [`docs/ADR-002-MODULAR-MONOLITH-BOUNDARIES.md`](docs/ADR-002-MODULAR-MONOLITH-BOUNDARIES.md)
- [`docs/ADR-003-PROCESS-LIFETIME-RETENTION.md`](docs/ADR-003-PROCESS-LIFETIME-RETENTION.md)
- [`docs/ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md`](docs/ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md)
- [`docs/BT-101-SESSION-INSPECTOR.md`](docs/BT-101-SESSION-INSPECTOR.md)
- [`docs/BT-102-PROTOCOL-SMOKE.md`](docs/BT-102-PROTOCOL-SMOKE.md)
- [`docs/BT-103-POLICY-GATE.md`](docs/BT-103-POLICY-GATE.md)
- [`docs/BT-104-ARRANGEMENT-PLAN.md`](docs/BT-104-ARRANGEMENT-PLAN.md)
- [`docs/BITWIG_MANUAL_SMOKE_CHECKLIST.md`](docs/BITWIG_MANUAL_SMOKE_CHECKLIST.md)
- [`docs/FUTURE-DIRECTION.md`](docs/FUTURE-DIRECTION.md)
- [`docs/LOCAL-LLM-TOOL-ORCHESTRATION.md`](docs/LOCAL-LLM-TOOL-ORCHESTRATION.md)
- [`docs/ADR-001-GEMMA-MOBILE-AGENT.md`](docs/ADR-001-GEMMA-MOBILE-AGENT.md)
- [`docs/GEMMA-MOBILE-VERTICAL-SLICE.md`](docs/GEMMA-MOBILE-VERTICAL-SLICE.md)
- [`docs/PLAYGROUND_ARCHITECTURE.md`](docs/PLAYGROUND_ARCHITECTURE.md)
- [`docs/SPRINT-2-BROWSER-AUDITION.md`](docs/SPRINT-2-BROWSER-AUDITION.md)
- [`docs/SPRINT-3-NOTE-EDITOR.md`](docs/SPRINT-3-NOTE-EDITOR.md)
- [`docs/SPRINT-4-SAVE-LOAD.md`](docs/SPRINT-4-SAVE-LOAD.md)
- [`docs/SPRINT-5-PATTERN-TOOLS.md`](docs/SPRINT-5-PATTERN-TOOLS.md)
- [`docs/SPRINT-6-UNDO-REDO.md`](docs/SPRINT-6-UNDO-REDO.md)
- [`docs/SPRINT-7-KEYBOARD-SHORTCUTS.md`](docs/SPRINT-7-KEYBOARD-SHORTCUTS.md)
- [`docs/SPRINT-8-TIMELINE-SELECTION.md`](docs/SPRINT-8-TIMELINE-SELECTION.md)
- [`docs/SPRINT-9-COMMAND-PALETTE.md`](docs/SPRINT-9-COMMAND-PALETTE.md)
- [`docs/SPRINT-10-DRAFT-COMMAND-PARSER.md`](docs/SPRINT-10-DRAFT-COMMAND-PARSER.md)
- [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md)
- [`docs/LOCAL_MCP_SETUP.md`](docs/LOCAL_MCP_SETUP.md)

## Status

Beat Twin is an experimental local integration, not a hardened production tool. It is published as an open-source foundation for safe, inspectable, DAW-agnostic music-agent experiments.

## License

MIT
