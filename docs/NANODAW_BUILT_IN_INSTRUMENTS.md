# NanoDAW Built-in Instrument Slice

Issue: #36
Status: deterministic vertical slice implemented; live listening and refreshed
S25 evidence remain open.

## Bounded Catalog

NanoDAW persists one stable `instrumentId` on every instrument track:

| ID | Role | Tone.js voice |
| --- | --- | --- |
| `drums` | Percussion | short membrane voice with deterministic drum-note mapping |
| `bass` | Low monophonic line | filtered mono synth |
| `chords` | Polyphonic harmony | poly synth with a slower release |
| `lead` | Melodic default | sawtooth synth |

Tracks cannot carry plugin names, sample paths, arbitrary graphs, or unbounded
synth parameters. Unknown IDs fail strict validation before mutation. Audio,
effect, and group tracks reject instrument configuration.

## Versioning And Compatibility

- Song schema v2 persists `instrumentId`.
- Song schema v1 remains loadable and migrates instrument tracks to the
  deterministic `lead` default.
- `SongPatchV1` remains strict and unchanged. Compiling it omits an explicit
  instrument command field, and NanoDAW applies the same `lead` default.
- `SongPatchV2` requires `track.instrumentId` and compiles it into `CreateTrack`.
- The exact LiteRT/S25 `SongPatchV1` tool projection remains frozen. It must not
  advertise V2 until a fresh real-provider `tool_calls` capture is reviewed.

Example explicit proposal:

```json
{
  "schemaVersion": 2,
  "tempoBpm": 120,
  "track": {
    "kind": "instrument",
    "name": "Night Bass",
    "instrumentId": "bass",
    "clip": {
      "name": "Verse",
      "lengthBeats": 16,
      "notes": [
        { "pitch": 36, "velocity": 110, "startBeat": 0, "lengthBeats": 1 }
      ]
    }
  }
}
```

## Execution Invariant

The Gateway validates either patch version, materializes the full command list,
and shows the instrument in the preview. Confirmation still dispatches exactly
one expected-revision command batch through the browser port. Success therefore
creates one document revision, one autosave, and one undo checkpoint. Adapter
readback returns the browser-owned song containing the same instrument ID.

The Playground inspector exposes the same four-value catalog through
`SetTrackInstrument`, so the selected sound is visible and editable without an
Agent, Gateway, S25, Bitwig, or MCP process.

## Manual Browser Recipe

1. Start `pnpm nanodaw:dev` and choose **Create Demo**.
2. Confirm the inspector says `Drums`; play the preview and stop it.
3. Change **Built-in instrument** to `Bass`; play the same clip again.
4. Undo and redo once, then reload the locally saved song.
5. Confirm the selector and exported JSON retain the expected ID.
6. For connected V2 evidence, use a fake provider returning the example above;
   confirm that preview says `Instrument: Bass (bass)` before applying once.

## Remaining Limitations

- No live S25 run can select V2 yet because the reviewed provider fixture is
  intentionally frozen to V1.
- No live-browser listening recording or screenshot is included in this slice;
  distinct voice constructors and routing are proven deterministically.
- The current preview engine auditions the selected clip. A persistent
  multi-track performance graph and long-running clock remain BT-LIVE-102/#27.
- Bitwig rejects explicit built-in instrument selection until a separately
  bounded device/preset mapping exists.
- Drum playback uses a small deterministic percussion mapping, not samples or a
  complete General MIDI drum kit.
