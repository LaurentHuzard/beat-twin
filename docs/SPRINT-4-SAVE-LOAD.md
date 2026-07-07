# Sprint 4: Playground Save/Load

Sprint 4 adds browser-local persistence to the Beat Twin Playground without
changing the Bitwig MCP server in `index.js`.

## Scope

- Autosave the current browser `Song` after successful command-bus mutations.
- Save, load, export, import, and clear songs from the Playground command dock.
- Reuse the schema-versioned `@beat-twin/core` serializer/deserializer for JSON.
- Keep storage browser-local through `localStorage`; no MCP, Bitwig, or network writes.

## UI Surface

The command dock now includes a song storage panel:

- save local song;
- load local song;
- export song JSON into the textarea;
- import song JSON from the textarea;
- clear the local save.

The local storage key is:

```text
beat-twin.playground.song.v1
```

## Data Boundary

Save/load is still document-level Playground state. The browser UI does not call
the Bitwig TCP bridge, does not import `index.js`, and does not write clips into
Bitwig. Imported JSON must pass `deserializeSong()` before replacing local state.

## Validation

Targeted Playground coverage:

```bash
rtk proxy pnpm --filter @beat-twin/playground test
```

Expected coverage:

- demo creation autosaves to browser storage;
- saved songs reload into the Playground selection/inspector;
- exported JSON can be imported back as a new local song;
- invalid imported JSON reports an error without replacing the current song.
