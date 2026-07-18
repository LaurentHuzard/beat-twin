# @beat-twin/audio-tone

Browser-safe Tone.js audition helpers for Beat Twin songs.

The pure scheduler converts a `@beat-twin/core` `Song` into deterministic note
events with absolute beats and seconds. The Tone preview engine imports Tone.js
only when `createTonePreviewEngine()` or `startTonePreview()` is called, so apps
can import this package without starting browser audio.

Instrument tracks route through a bounded voice factory keyed by the persisted
`drums`, `bass`, `chords`, or `lead` ID. Voices are owned per track, reused while
that track keeps the same instrument, and released and disposed on stop, when
the track/instrument changes, or when the engine is disposed.
