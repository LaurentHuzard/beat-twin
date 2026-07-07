# Sprint 9 Command Palette

Sprint 9 adds a browser-local command palette to the Playground.

## Scope

- Open the palette from the transport bar or with `Ctrl/Cmd+K`.
- Filter available Playground actions by label, detail, or status.
- Execute existing local actions for demo creation, tracks, clips, preview,
  pattern tools, save/export, and undo/redo.
- Keep unavailable actions visible but disabled when the current selection or
  song state does not support them.

## Boundary

The palette does not parse chat text, call Bitwig, or add a new command
executor. It invokes existing Playground store actions, which still route song
mutations through `BeatTwinCommand` and local immutable command state.

## Validation

```bash
rtk proxy pnpm --filter @beat-twin/playground test
rtk proxy pnpm --filter @beat-twin/playground build
rtk proxy pnpm test:unit
rtk proxy node --check index.js
```

For browser verification, run the Playground dev server and use Playwright with
Chromium against the local Vite URL.
