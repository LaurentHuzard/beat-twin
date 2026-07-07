# Sprint 6: Playground Undo/Redo

Sprint 6 adds browser-local undo/redo for Playground command state snapshots.
The Bitwig MCP server in `index.js` is unchanged.

## Scope

- Keep undo and redo stacks in the Playground Zustand store.
- Push the previous `CommandState` before successful local command mutations.
- Restore track/clip selection, inspector editing state, preview state, and local JSON autosave after undo or redo.
- Clear redo history when a new command is dispatched after undo.

## UI Surface

The transport strip now has icon buttons for:

- undo;
- redo.

Buttons are disabled when their corresponding stack is empty.

## Data Boundary

Undo/redo is not a new `BeatTwinCommand`. It restores previous immutable
`CommandState` snapshots produced by the command bus. It does not call
`index.js`, open the Bitwig TCP bridge, or write into Bitwig.

## Persistence

Undo/redo writes the restored browser song back through the existing Playground
local save path. If undo restores the empty initial state, the local save is
cleared.

## Validation

Targeted Playground coverage:

```bash
rtk proxy pnpm --filter @beat-twin/playground test
```

Expected coverage:

- undo and redo buttons start disabled;
- undo removes the most recent note command from the inspector and local save;
- redo restores that note and local save;
- a new command after undo clears redo history.
