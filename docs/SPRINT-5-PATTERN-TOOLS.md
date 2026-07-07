# Sprint 5: Pattern Tools

Sprint 5 adds command-first pattern operations to the browser Playground while
leaving the Bitwig MCP bridge unchanged.

## Scope

- Duplicate the selected clip with fresh deterministic note IDs.
- Quantize selected clip note starts to 1/4 beat, 1/2 beat, or 1 beat.
- Transpose selected clip notes by -12, -1, +1, or +12 semitones.
- Autosave successful pattern commands through the existing local Playground persistence.

## Command Boundary

The new commands are:

- `DuplicateClip`;
- `QuantizeClip`;
- `TransposeClip`.

The corresponding events are:

- `ClipDuplicated`;
- `ClipQuantized`;
- `ClipTransposed`.

The UI does not mutate `Song` objects directly. It dispatches these commands
through `@beat-twin/commands`, which calls pure immutable helpers in
`@beat-twin/core`.

## Musical Rules

- Clip duplication copies note pitch, velocity, start, and length, but assigns
  new note IDs through the injected command `idFactory`.
- Quantization changes note starts only and keeps notes inside the clip pattern.
- Transposition validates the resulting MIDI pitch range through the core note
  model.
- Note positions remain relative to the clip pattern.

## Compatibility Boundary

Pattern tools are browser-only document edits. They do not call `index.js`, do
not open the Bitwig TCP bridge, and do not write clips into Bitwig.

## Validation

Targeted checks:

```bash
rtk proxy node --test packages/core/test/core.test.ts packages/commands/test/commands.test.ts
rtk proxy pnpm --filter @beat-twin/playground test
```

Expected coverage:

- core helper immutability and invalid musical input rejection;
- command events and deterministic duplicated IDs;
- Playground inspector controls dispatch commands and autosave the result.
