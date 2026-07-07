# Sprint 7: Playground Keyboard Shortcuts

Sprint 7 adds browser-local keyboard shortcuts for the Playground. The Bitwig
MCP server in `index.js` is unchanged.

## Scope

- `Ctrl/Cmd+Z`: undo local Playground history.
- `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`: redo local Playground history.
- `Space`: play or stop the selected clip preview.
- `N`: add or save the note editor draft.
- `Esc`: cancel note editing.
- `D`: duplicate the selected clip.
- `Q`: quantize the selected clip to a quarter-beat grid.

## Input Safety

Shortcuts are ignored while focus is inside editable fields:

- command draft input;
- song JSON textarea;
- numeric note/tempo inputs;
- native selects or content-editable elements.

## Compatibility Boundary

Keyboard shortcuts dispatch existing browser actions only. They do not call
`index.js`, open the Bitwig TCP bridge, or write into Bitwig.

## Validation

Targeted Playground coverage:

```bash
rtk proxy pnpm --filter @beat-twin/playground test
```

Expected coverage:

- edit/history shortcuts mutate local command state correctly;
- spacebar drives preview play/stop through the browser audio boundary;
- shortcut handling is ignored while editing text fields.
