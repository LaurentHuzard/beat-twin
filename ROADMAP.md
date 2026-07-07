# Beat Twin Roadmap

## Now

- Keep the default MCP surface read-only.
- Keep offline policy and protocol tests passing.
- Grow the browser Playground through command-first local song editing.
- Keep Playground save/load schema-versioned through `@beat-twin/core`.
- Keep browser pattern tools command-first and autosaved.
- Validate the Beat Twin controller manually in Bitwig Studio.
- Document only behavior that exists or is directly testable.

## Next

- Improve connection diagnostics for the Bitwig TCP bridge.
- Add a smaller live smoke path for read-only inspection.
- Add undo/redo history for local Playground commands.
- Expand policy tests when new tools are added.
- Keep arrangement assistance plan-only until write flows have stronger previews and rollback guidance.

## Later

- Explore a small Go daemon for the Bitwig TCP/JSON-RPC bridge.
- Add richer clip/device inspection before adding more write tools.
- Package the controller and MCP server for easier local installation.
