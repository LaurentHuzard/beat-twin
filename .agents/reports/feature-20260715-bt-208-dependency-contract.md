# Feature Report - BT-208 Generic Dependency Contract

Date: 2026-07-15
Branch: `dev/nanodaw-standalone`
Ticket: BT-208
Outcome: Passed locally

## Product Outcome

Beat Twin now publishes generic MCP host-dependency metadata. TwinPilot TP-202
can report that Bitwig is not running without hard-coding Beat Twin paths or
starting the MCP server.

## Changes

- `llm-mcp/mcp.example.json` declares `requiredProcesses: ["BitwigStudio"]`.
- `docs/LOCAL_MCP_SETUP.md` documents dependency-aware and generic-client
  behavior, plus the independent structured smoke command.
- `tests/mcp-metadata.test.js` locks metadata shape and rejects shared write
  policies, tokens, or secrets.
- Root test scripts include the contract test.

## Verification

- Beat Twin targeted tests: 4/4 passed.
- TwinPilot TP-202 compatibility: 14/14 MCP config/health tests passed unchanged.
- `git diff --check`: passed.

## Evidence Boundary

- The metadata is an MCP-client preflight hint, not proof of controller or MCP
  readiness.
- Generic clients may ignore `requiredProcesses`.
- Omitting the field preserves independent MCP startup; `pnpm smoke:read-only`
  remains the explicit layered diagnostic.

## Safety

- No TwinPilot file was modified.
- No Bitwig, gateway, MCP, or S25 process was started.
- No write policy or secret is published by the shared preset.

## Git

- The prior Armada branch was pushed through SSH before this slice.
- No PR was opened.

## Next Activation Signal

BT-210 is the next Ready Beat Twin ticket. It must preserve browser-owned song
state while adding an authenticated WebSocket proxy boundary.
