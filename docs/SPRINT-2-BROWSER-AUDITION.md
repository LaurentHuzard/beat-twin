# Sprint 2 Browser Audition

Sprint 2 adds a browser playback and audition layer around the playground song
model. This is a browser preview path, not a Bitwig write path.

## Architecture Boundary

```text
apps/playground
  -> @beat-twin/commands
  -> @beat-twin/core Song state
  -> @beat-twin/audio-tone browser audition engine
  -> Web Audio output
```

The root MCP bridge remains:

```text
MCP client
  -> index.js
  -> local TCP JSON-RPC bridge
  -> Bitwig controller script
  -> Bitwig Studio
```

These paths are intentionally separate. Browser preview must not import
`index.js`, call the Bitwig TCP bridge, or invoke MCP write tools. It renders and
auditions the local `Song` state in the browser only.

## Command Ownership

`@beat-twin/commands` remains the only mutation path for the playground state.
Browser controls may dispatch commands such as `StartPlayback`, `StopPlayback`,
`SetPlayhead`, `SetTempo`, `CreateClip`, or `AddNote`, but those commands only
change the in-memory `Song` document used by the playground.

The audition engine should consume immutable `Song` snapshots and transport
state. It may schedule browser audio from tracks, clips, notes, tempo, and
playhead position, but it must not own song editing rules.

## Bitwig Safety

Browser playback is not a DAW mutation. It must remain safe when Bitwig is
closed, when the Bitwig controller is not installed, and when MCP write policies
are disabled.

Bitwig mutations still require the existing MCP path and explicit policy gates:

- `index.js` remains the compatibility anchor for the MCP server.
- Write tools remain hidden and blocked unless `BITWIG_MCP_WRITE_POLICY` or
  `BITWIG_MCP_ENABLE_WRITES=1` is present at MCP server startup.
- MCP clients may cache `listTools`, so write-policy changes still require a
  client/server restart before relying on the visible tool list.
- Any future "send to Bitwig" or adapter work must be documented as a separate
  policy-gated path, not as browser audition.

## Sprint 2 Validation

No-DAW browser checks:

```bash
rtk proxy pnpm --filter @beat-twin/playground test
rtk proxy pnpm --filter @beat-twin/playground build
rtk proxy pnpm test:unit
```

Manual browser audition check:

```bash
rtk proxy pnpm playground:dev
```

Then use the playground in a browser with Bitwig closed or with the Beat Twin
controller disabled. Creating a demo and auditioning playback should only affect
browser audio and the playground transport state.

MCP compatibility guardrails:

```bash
rtk proxy node --check index.js
rtk proxy node --test tests/session-inspect.test.js tests/policy-gate.test.js tests/arrangement-plan.test.js
```

Protocol smoke is still separate because it needs a local TCP listener:

```bash
rtk proxy node --test --test-isolation=none tests/protocol-smoke.test.js
```

Live Bitwig checks remain manual and policy-gated. Use
[`BITWIG_MANUAL_SMOKE_CHECKLIST.md`](BITWIG_MANUAL_SMOKE_CHECKLIST.md) for those
instead of treating browser audition as proof of Bitwig behavior.
