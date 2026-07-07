# Sprint 10 Draft Command Parser

Sprint 10 turns the Playground command draft input into a small deterministic
action parser.

## Scope

- Recognize short local commands such as `demo`, `add track`, `add clip`,
  `tempo 132`, `duplicate clip`, `quantize 1/4`, `transpose up`, `save`,
  `load`, `export`, `undo`, and `redo`.
- Execute parsed commands through existing Playground store actions.
- Report unrecognized or context-blocked commands in the command log.
- Keep the command draft input deterministic and testable.

## Boundary

This parser is not an AI chat integration and does not guess intent beyond its
known command phrases. It does not call Bitwig or the MCP server. Song mutations
still flow through existing store actions and `BeatTwinCommand`.

## Validation

```bash
rtk proxy pnpm --filter @beat-twin/playground test
rtk proxy pnpm --filter @beat-twin/playground build
rtk proxy pnpm test:unit
rtk proxy node --check index.js
```

The full `rtk proxy pnpm test` suite includes protocol smoke coverage that may
need a local TCP-capable environment.
