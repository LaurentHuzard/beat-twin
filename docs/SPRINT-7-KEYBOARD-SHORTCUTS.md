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
- `?` (`Shift+/`): open the voluntary shortcut guide after entering the full
  workspace.

The guide is never shown automatically. It is absent from the calm first-run
surface, renders inline instead of covering the workspace, closes with `Esc`,
and returns focus to its Shortcuts trigger. If MIDI recording is armed, the
recorder keeps ownership of unmodified note keys; an already-open guide still
allows `Esc` dismissal.

## Input Safety

Shortcuts are ignored while focus is inside editable fields:

- command draft input;
- song JSON textarea;
- numeric note/tempo inputs;
- native selects or content-editable elements.

One narrow exception keeps the voluntarily opened guide recoverable: `Esc`
closes that guide even after focus moves into an editable field, then returns
focus to Shortcuts. It does not run the field's unrelated NanoDAW shortcuts.

## Compatibility Boundary

Keyboard shortcuts dispatch existing browser actions only. They do not call
`index.js`, open the Bitwig TCP bridge, or write into Bitwig.

## Validation

Targeted Playground coverage:

```bash
corepack pnpm --filter @beat-twin/playground test
```

Expected coverage:

- edit/history shortcuts mutate local command state correctly;
- spacebar drives preview play/stop through the browser audio boundary;
- shortcut handling is ignored while editing text fields;
- the guide stays absent on first run, opens by explicit click or `?`, and
  restores trigger focus after `Esc`.
