# NanoDAW direct musical tools — 2026-10-23

## Scope

The user's requested track, note and transport operations now execute in one
MCP call when `NANODAW_MCP_DIRECT_WRITE=1`. The default runtime still prepares
plans for browser confirmation. `nanodaw_execute_batch` applies an ordered
group atomically. This builds on the earlier opt-in direct-plan change.

## Evidence

- Fresh `origin/main`: `360cca5eebd0d898b79e3bfc3a8ef0503b059f34`.
- Prior direct-plan commit cherry-picked as `8c10ad3` from `ddee089`.
- `pnpm --filter @beat-twin/nanodaw-mcp-app^... build`: passed.
- `pnpm --filter @beat-twin/nanodaw-mcp --filter @beat-twin/nanodaw-mcp-app test`: 16 tests passed.
- MCP integration test applied track, clip, note, play, tempo and stop against an
  in-memory NanoDAW adapter; revisions advanced from 0 to 5 and stale input
  was rejected. Default preparation tests still pass.
- `git diff --check`: passed.

## Limits

No live browser or audible playback was exercised for this extension. NanoDAW
supports its current bounded song command catalog; this is not parity with
Bitwig's host-specific mixer, device, controller or audio-capture tools. The
running MCP process must be restarted from the delivered code with the flag
before the new tool behavior is available.
