# Beat Twin

Beat Twin is a proof-of-concept bridge between Bitwig Studio and the Model Context Protocol (MCP).

It exposes a small local MCP server for agent-assisted music workflows while keeping DAW mutations behind explicit write-policy gates. The default mode is read-only.

## What Works

- Read-only session inspection for transport, tracks, scenes, selected device, and remote controls.
- Plan-only arrangement suggestions based on the current read-only Bitwig snapshot.
- Transport, mixer, clip, scene, device, and application write tools, hidden and blocked by default.
- A Bitwig controller script that speaks JSON-RPC over a local TCP connection.
- Offline protocol and policy tests that run without launching Bitwig.
- A browser Playground for command-first song sketches, Tone.js audition, note editing, pattern tools, keyboard shortcuts, local undo/redo, JSON save/load, visible timeline feedback, and a local command palette.

## Architecture

```text
MCP client
  -> Node.js MCP server (index.js)
  -> local TCP JSON-RPC bridge on 127.0.0.1:8888
  -> Bitwig controller script
  -> Bitwig Studio
```

The Node process is the MCP server. It connects to the Bitwig controller on demand through `BITWIG_HOST` and `BITWIG_PORT`.

The browser-first playground foundation now lives alongside the MCP bridge:

```text
apps/playground
  -> @beat-twin/commands
  -> @beat-twin/core
  -> @beat-twin/audio-tone browser audition
  -> localStorage JSON save/load
```

The current Bitwig bridge still lives in `index.js`; adapter extraction is intentionally left for a later compatibility-focused slice. Browser audition is local Web Audio preview, not a Bitwig mutation or MCP write.
Browser save/load is also local Playground state, not a Bitwig mutation.
Browser pattern tools are local document edits for duplicate, quantize, and transpose.
Browser undo/redo restores local Playground command snapshots only.
Browser keyboard shortcuts invoke existing local Playground actions only.
Browser timeline feedback is derived from local song state and does not call Bitwig.
Browser command palette actions reuse the same local Playground action boundary.

## Requirements

- Node.js 26.4.0 or newer
- pnpm 11.10.0 or newer
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

Beat Twin is read-only by default. Write tools are not listed by MCP clients and are blocked if called directly.

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
```

Run a syntax check:

```bash
node --check index.js
```

Live tests require Bitwig Studio, the controller script, and explicit write permissions. They are intentionally separate from the default test suite.

## Useful Docs

- [`docs/BT-101-SESSION-INSPECTOR.md`](docs/BT-101-SESSION-INSPECTOR.md)
- [`docs/BT-102-PROTOCOL-SMOKE.md`](docs/BT-102-PROTOCOL-SMOKE.md)
- [`docs/BT-103-POLICY-GATE.md`](docs/BT-103-POLICY-GATE.md)
- [`docs/BT-104-ARRANGEMENT-PLAN.md`](docs/BT-104-ARRANGEMENT-PLAN.md)
- [`docs/BITWIG_MANUAL_SMOKE_CHECKLIST.md`](docs/BITWIG_MANUAL_SMOKE_CHECKLIST.md)
- [`docs/FUTURE-DIRECTION.md`](docs/FUTURE-DIRECTION.md)
- [`docs/PLAYGROUND_ARCHITECTURE.md`](docs/PLAYGROUND_ARCHITECTURE.md)
- [`docs/SPRINT-2-BROWSER-AUDITION.md`](docs/SPRINT-2-BROWSER-AUDITION.md)
- [`docs/SPRINT-3-NOTE-EDITOR.md`](docs/SPRINT-3-NOTE-EDITOR.md)
- [`docs/SPRINT-4-SAVE-LOAD.md`](docs/SPRINT-4-SAVE-LOAD.md)
- [`docs/SPRINT-5-PATTERN-TOOLS.md`](docs/SPRINT-5-PATTERN-TOOLS.md)
- [`docs/SPRINT-6-UNDO-REDO.md`](docs/SPRINT-6-UNDO-REDO.md)
- [`docs/SPRINT-7-KEYBOARD-SHORTCUTS.md`](docs/SPRINT-7-KEYBOARD-SHORTCUTS.md)
- [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md)
- [`docs/LOCAL_MCP_SETUP.md`](docs/LOCAL_MCP_SETUP.md)

## Status

Beat Twin is an experimental local integration, not a hardened production tool. It is published as an open-source foundation for safe, inspectable DAW control experiments.

## License

MIT
