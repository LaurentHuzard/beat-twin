# Sprint 8 Timeline Selection Feedback

Sprint 8 makes the Playground timeline easier to read while keeping the browser
surface command-first and local-only.

## Scope

- Highlight the selected track row and selected clip block.
- Show a compact timeline summary for track, clip, and note counts.
- Render note-density markers inside each clip block.
- Keep clip positions in absolute beats and note positions relative to the clip.

## Boundary

This sprint is a UI feedback slice. It does not add commands, change
`@beat-twin/core`, call Bitwig, or touch the MCP server in `index.js`.

## Validation

```bash
rtk proxy pnpm --filter @beat-twin/playground test
rtk proxy pnpm --filter @beat-twin/playground build
rtk proxy pnpm test:unit
rtk proxy node --check index.js
```

The full `rtk proxy pnpm test` suite includes protocol smoke coverage that may
need an environment where local TCP listen on `127.0.0.1` is allowed.
