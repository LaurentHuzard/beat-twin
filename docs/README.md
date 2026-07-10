# Beat Twin Docs

This directory contains the current technical notes for the public Beat Twin proof of concept.

## Current Notes

- [`AGENT_SETUP.md`](AGENT_SETUP.md): what a coding agent can automate and what must be requested from the user in Bitwig.
- [`BT-101-SESSION-INSPECTOR.md`](BT-101-SESSION-INSPECTOR.md): read-only session snapshot behavior.
- [`BT-102-PROTOCOL-SMOKE.md`](BT-102-PROTOCOL-SMOKE.md): TCP framing, offline protocol smoke tests, and connection diagnostic coverage.
- [`BT-103-POLICY-GATE.md`](BT-103-POLICY-GATE.md): write-policy model and current tool classification.
- [`BT-104-ARRANGEMENT-PLAN.md`](BT-104-ARRANGEMENT-PLAN.md): plan-only arrangement helper.
- [`BITWIG_MANUAL_SMOKE_CHECKLIST.md`](BITWIG_MANUAL_SMOKE_CHECKLIST.md): manual live verification with Bitwig Studio.
- [`FUTURE-DIRECTION.md`](FUTURE-DIRECTION.md): conservative direction for arrangement assistance.
- [`LOCAL_MCP_SETUP.md`](LOCAL_MCP_SETUP.md): local MCP and Bitwig controller setup, including `pnpm smoke:read-only`.
- [`LOCAL-LLM-TOOL-ORCHESTRATION.md`](LOCAL-LLM-TOOL-ORCHESTRATION.md): the laptop Gateway to S25 provider loop, model-visible tools, and fixture gate.
- [`ADR-001-GEMMA-MOBILE-AGENT.md`](ADR-001-GEMMA-MOBILE-AGENT.md): the accepted dual-target boundary; the historical filename is retained while native Android is deferred.
- [`GEMMA-MOBILE-VERTICAL-SLICE.md`](GEMMA-MOBILE-VERTICAL-SLICE.md): the first NanoDAW Agent-mode slice targeting NanoDAW or Bitwig.
- [`S25-TOOL-CALL-GATE.md`](S25-TOOL-CALL-GATE.md): the mandatory real LiteRT-LM `tool_calls` capture before provider implementation.
- [`PLAYGROUND_ARCHITECTURE.md`](PLAYGROUND_ARCHITECTURE.md): browser-first architecture, package map, and compatibility boundary.
- [`SPRINT-2-BROWSER-AUDITION.md`](SPRINT-2-BROWSER-AUDITION.md): browser playback/audition boundary, Bitwig safety rules, and validation commands.
- [`SPRINT-3-NOTE-EDITOR.md`](SPRINT-3-NOTE-EDITOR.md): browser note editing commands, units, safety boundary, and validation commands.
- [`SPRINT-4-SAVE-LOAD.md`](SPRINT-4-SAVE-LOAD.md): browser-local Playground save/load, JSON import/export, and validation commands.
- [`SPRINT-5-PATTERN-TOOLS.md`](SPRINT-5-PATTERN-TOOLS.md): browser pattern duplicate, quantize, transpose commands, and validation commands.
- [`SPRINT-6-UNDO-REDO.md`](SPRINT-6-UNDO-REDO.md): browser-local command history, undo/redo UI, and validation commands.
- [`SPRINT-7-KEYBOARD-SHORTCUTS.md`](SPRINT-7-KEYBOARD-SHORTCUTS.md): browser-local keyboard shortcuts and input-safety validation.
- [`SPRINT-8-TIMELINE-SELECTION.md`](SPRINT-8-TIMELINE-SELECTION.md): visible timeline selection, density summary, and clip note markers.
- [`SPRINT-9-COMMAND-PALETTE.md`](SPRINT-9-COMMAND-PALETTE.md): browser-local command palette, action filtering, and command-boundary rules.
- [`SPRINT-10-DRAFT-COMMAND-PARSER.md`](SPRINT-10-DRAFT-COMMAND-PARSER.md): deterministic command draft parsing and local action execution.
- [`../bitwig-api-docs/README.md`](../bitwig-api-docs/README.md): why Bitwig API reference material is not vendored.

## Documentation Rule

Docs should describe behavior that exists, behavior covered by tests, or clearly marked future direction. Avoid product claims that the current code cannot validate.
