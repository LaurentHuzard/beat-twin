# Local NanoDAW MIDI export

Open **Settings → Export MIDI** after creating or loading a song. The browser
requests a `beat-twin.mid` download locally; no Gateway, Bitwig, provider or
network request is involved. It does not change the song, revision, undo history,
autosave, JSON export draft or running arrangement.

The pure `exportSongMidi(song)` API in `@beat-twin/core` validates the complete
Song and returns a deterministic `Uint8Array` Standard MIDI File Type 1. One
conductor track contains the song title and tempo (nearest microsecond per
quarter note); every instrument track, including empty ones, has a MIDI track
with its name and clip-name markers. An empty song produces a conductor-only
file. Audio, effect and group tracks are omitted.

Timing is 480 ticks per quarter note, rounding absolute clip + note starts and
ends to the nearest tick (at most half a tick error per endpoint). Notes are
exported once at their arrangement placement; live launcher looping is omitted.
Note-offs precede note-ons at the same tick. Velocity-zero notes are silent and
omitted. Track/clip/note array order is the stable tie-breaker; labels use UTF-8
(some older DAWs may display accented names differently).

Melodic tracks receive distinct channels in document order, skipping channel 10.
One drum track uses channel 10. At most 15 melodic tracks and one drum track are
supported; additional tracks fail explicitly. Pitches and nonzero velocities
are preserved, including drums. NanoDAW's drum sound mapping is not converted
into a General MIDI kit. No program changes or sound bank are exported: choose
or reassign instruments after importing into your DAW. The four built-in roles
therefore require no external plugin/device dependency in the file.

Export fails explicitly for note durations that round to zero, overlapping
sounding notes of the same pitch within a track (MIDI cannot identify individual
voices), timing beyond 268435455 ticks, or an unrepresentable tempo. Correct the
song and retry; the song remains intact. The UI reports a download request,
not proof that the operating system saved the file.

Audio/stems, macros, live performance state, device/synth configuration, Gateway
metadata and agent provenance are not exported. Preserve the Song JSON when you
need the complete NanoDAW document. MIDI import is outside this slice.
