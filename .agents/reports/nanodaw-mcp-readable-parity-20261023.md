# NanoDAW MCP readable parity — 2026-10-23

## Scope and decision

The user wants NanoDAW MCP to resemble Bitwig MCP as closely as NanoDAW's
state model permits. Added ten focused, read-only tools for transport, tracks,
clips, notes and feature discovery. Existing write behavior and authorization
are unchanged. The parity document names host-specific Bitwig controls that
cannot be represented by NanoDAW's current song model.

## Evidence

- Base: freshly fetched `origin/main` at `8e81fbc87b2f0b3289f180556600a43965fc00a9`.
- `pnpm --filter @beat-twin/nanodaw-mcp-app^... build`: passed.
- `pnpm --filter @beat-twin/nanodaw-mcp test`: 15 passed.
- `pnpm test`: 520 passed, 0 failed, 0 skipped.
- Read-tool integration confirms song ID and revision, targeted values,
  missing-target rejection, zero command batches and unchanged revision.
- No live browser, Bitwig or MUE interaction was performed.

## Boundary

The source Bitwig catalog has 190 tools before wrappers. NanoDAW has no
per-track mixer values, Bitwig device chain or remote controls in its song
model. The new tools do not claim these capabilities. A catalog entry does not
prove a browser connection or audible playback.
