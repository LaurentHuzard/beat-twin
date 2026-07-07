# Sprint 3 Note Editor

Sprint 3 makes the Playground editable from the browser. The user can add,
update, and remove notes in the selected clip while staying inside the same
command-first model used by browser audition.

## Boundary

```text
Inspector controls
  -> BeatTwinCommand
  -> @beat-twin/commands
  -> immutable @beat-twin/core Song state
  -> React/Zustand render
```

This is local document editing only. It does not call `index.js`, does not open
the Bitwig TCP bridge, and does not use MCP write tools.

## Commands

Sprint 3 extends the command bus with:

- `UpdateNote`;
- `RemoveNote`.

`AddNote` remains the creation path. The Playground Inspector uses these
commands for note edits and records the resulting events in the command log.

## Musical Units

The editor keeps the same units as the core model:

- pitch is MIDI note number;
- velocity is MIDI velocity from 0 to 127;
- note start is relative to the selected clip;
- note length is in beats.

Core validation rejects notes that exceed the selected clip pattern length.

## Validation

Browser editor checks:

```bash
rtk proxy pnpm --filter @beat-twin/playground test
rtk proxy pnpm --filter @beat-twin/playground build
```

Core and command checks:

```bash
rtk proxy node --test packages/core/test/*.test.ts packages/commands/test/*.test.ts
```

Full compatibility checks remain:

```bash
rtk proxy node --check index.js
rtk proxy pnpm test
```

The protocol smoke path still needs a local TCP-capable environment.
