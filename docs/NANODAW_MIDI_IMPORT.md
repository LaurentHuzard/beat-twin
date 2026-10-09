# Inspect and add a local MIDI sketch

In **Settings**, choose a **Local MIDI file**. The browser reads that file only;
no upload, provider, Gateway or Bitwig is involved. The preview shows its name,
new tracks, note count, source tempo and omitted information. Open **Review notes**
for pitch, velocity, beat and duration; displayed beats round to six decimals
while the import retains the original PPQ ratios. Selecting a file
or **Discard MIDI preview** does not change the song, revision, undo or autosave.

Choose **Add MIDI tracks** to append new tracks to the browser-owned song. Existing
tracks, notes and song identity are retained. **The current song tempo stays
unchanged**, so the imported beat positions may play faster/slower than the source.
The source and destination tempos are shown beside acceptance. With no existing
song, acceptance creates a new song at the source tempo (120 BPM if omitted).
The whole acceptance uses one atomic command batch, one revision, one undo
checkpoint and one autosave attempt. **Undo** restores the preceding song.
If another edit changes the revision after preview, reselect the file to inspect
again. Acceptance never replaces an existing song silently.

## Supported musical subset

- Standard MIDI File Type 0 or 1, PPQ timing, one constant tempo at beat zero.
- Arbitrary PPQ divisions preserve note starts and durations as musical beats.
  Clip bounds include computed note endpoints so floating-point rounding does not
  reject a valid note; musical note values remain unchanged.
- Explicit and running-status notes; velocity-zero note-on is note-off.
- Notes split into new tracks per source track/channel. Each has one arrangement
  clip beginning at beat zero; note placement is absolute within that clip.
- Melodic tracks default to NanoDAW Lead; channel 10 defaults to Drums. Choose
  voices afterwards. Pitches are preserved; no General MIDI drum-bank conversion.
- Source track names are interpreted as UTF-8 (invalid sequences display replacement
  characters). Text is shown as data, never executed or used as a file path.

Program/instrument assignments, markers/clip boundaries, signatures and descriptive
metadata are not imported and are disclosed in the preview. Device/live state,
audio, macros and sounds are not recreated. This is a notes-only sketch handoff,
not a full performance/session import. A channel becomes a single arrangement clip,
so the original multi-clip structure is not reconstructed.

## Explicit limits and errors

File size <=1 MiB; <=64 source MIDI tracks; <=20000 events; <=4096 sounding notes;
<=100000 beats; tempo 20–300 BPM; <=15 melodic result tracks and one drum track.
Empty files/songs, Type 2, SMPTE division, changing tempo, controllers (including
sustain), pitch bend, pressure and SysEx fail explicitly. Overlapping notes of the
same pitch/channel, unpaired note events and zero-duration notes also fail: the
first slice does not invent voicing or sustain semantics.

Header, chunks, event boundaries, variable-length fields (max four bytes), running
status, data bytes, end-of-track and trailing bytes are checked before invoking
the parser. Parsed event times, musical counts and pairings are checked afterwards.
Malformed or unsupported input leaves the current song intact; correct/export a
notes-only file and try again. The maintained parser is pinned `midi-file` 1.2.4,
MIT licensed, with no runtime dependencies, bundled into the local browser app.

Export remains available through **Export MIDI**. Export → import preserves tempo
and musical note data at the exporter's documented 480 PPQ resolution, while
reconstructing one clip per track/channel. Save Song JSON for full document fidelity.
