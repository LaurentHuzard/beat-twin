import test from "node:test";
import assert from "node:assert/strict";
import { addTrack, createSong, createTrack, createClip, createNote, exportSongMidi, type Song } from "../src/index.ts";

// Independent small SMF decoder: lengths/deltas/meta events and explicit note statuses.
function parse(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) => new TextDecoder().decode(bytes.slice(offset, offset + count));
  assert.equal(ascii(0, 4), "MThd");
  assert.equal(view.getUint32(4), 6);
  assert.equal(view.getUint16(8), 1);
  assert.equal(view.getUint16(12), 480);
  const tracks = [];
  let position = 14;
  while (position < bytes.length) {
    assert.equal(ascii(position, 4), "MTrk");
    const end = position + 8 + view.getUint32(position + 4);
    position += 8;
    let tick = 0;
    const events = [];
    const vlq = () => {
      let value = 0, byte;
      do { byte = bytes[position++]!; value = value * 128 + (byte & 127); } while (byte & 128);
      return value;
    };
    while (position < end) {
      tick += vlq();
      const status = bytes[position++]!;
      if (status === 255) {
        const type = bytes[position++]!;
        const length = vlq();
        const data = [...bytes.slice(position, position + length)];
        position += length;
        events.push({ tick, status, type, data });
      } else {
        assert.ok((status & 240) === 128 || (status & 240) === 144);
        events.push({ tick, status, type: -1, data: [bytes[position++]!, bytes[position++]!] });
      }
    }
    assert.equal(position, end);
    assert.equal(events.at(-1)?.type, 47);
    tracks.push(events);
  }
  assert.equal(tracks.length, view.getUint16(10));
  return tracks;
}
function song(): Song {
  const track = createTrack({ id: "lead", instrumentId: "lead", name: "Léàd", clips: [
    createClip({ id: "a", trackId: "lead", name: "A", startBeat: 2, lengthBeats: 4, pattern: { lengthBeats: 4, notes: [
      createNote({ id: "a1", pitch: 60, velocity: 100, startBeat: 0.5, lengthBeats: 1.5 }),
      createNote({ id: "a2", pitch: 60, velocity: 90, startBeat: 2, lengthBeats: 1 }),
      createNote({ id: "silent", pitch: 61, velocity: 0, startBeat: 0, lengthBeats: 1 }),
    ] } }),
    createClip({ id: "b", trackId: "lead", name: "B", startBeat: 8, lengthBeats: 4, pattern: { lengthBeats: 4, notes: [
      createNote({ id: "b1", pitch: 64, velocity: 127, startBeat: 0, lengthBeats: 0.25 }),
    ] } }),
  ] });
  return addTrack(createSong({ id: "song", title: "Fixture", bpm: 125 }), track);
}

test("SMF preserves tempo, absolute placements, notes, markers and deterministic bytes without mutation", () => {
  const source = song(), before = JSON.stringify(source);
  const bytes = exportSongMidi(source);
  assert.deepEqual(bytes, exportSongMidi(source));
  assert.equal(JSON.stringify(source), before);
  const tracks = parse(bytes);
  assert.deepEqual(tracks[0]!.find(e => e.type === 81)?.data, [7, 83, 0]); // 480000 us
  assert.equal(new TextDecoder().decode(new Uint8Array(tracks[1]![0]!.data)), "Léàd");
  assert.deepEqual(tracks[1]!.filter(e => e.type === 6).map(e => e.tick), [960, 3840]);
  assert.deepEqual(tracks[1]!.filter(e => e.type === -1).map(e => [e.tick, e.status, ...e.data]), [
    [1200, 144, 60, 100], [1920, 128, 60, 0], [1920, 144, 60, 90],
    [2400, 128, 60, 0], [3840, 144, 64, 127], [3960, 128, 64, 0],
  ]);
  assert.equal(tracks[1]!.at(-1)?.tick, 5760);
});

test("empty songs and instrument tracks are valid; noninstrument tracks are omitted", () => {
  assert.equal(parse(exportSongMidi(createSong({ id: "empty" }))).length, 1);
  let source = createSong({ id: "empty" });
  for (const role of ["drums", "bass", "chords", "lead"] as const) source = addTrack(source, createTrack({ id: role, instrumentId: role }));
  source = addTrack(source, createTrack({ id: "audio", kind: "audio" }));
  const tracks = parse(exportSongMidi(source));
  assert.equal(tracks.length, 5);
  for (const track of tracks.slice(1)) assert.equal(track.length, 2);
});

test("channels reserve percussion and reject unsupported counts", () => {
  let source = createSong({ id: "many" });
  for (let i = 0; i < 15; i++) source = addTrack(source, createTrack({ id: `t${i}`, instrumentId: "bass", clips: [createClip({ id: `c${i}`, trackId: `t${i}`, pattern: { lengthBeats: 4, notes: [createNote({ id: `n${i}`, pitch: 60, startBeat: 0 })] } })] }));
  source = addTrack(source, createTrack({ id: "drums", instrumentId: "drums", clips: [createClip({ id: "d", trackId: "drums", pattern: { lengthBeats: 4, notes: [createNote({ id: "dn", pitch: 36, startBeat: 0 })] } })] }));
  const channels = parse(exportSongMidi(source)).slice(1).map(t => t.find(e => e.type === -1)!.status & 15);
  assert.deepEqual(channels, [0,1,2,3,4,5,6,7,8,10,11,12,13,14,15,9]);
  assert.throws(() => exportSongMidi(addTrack(source, createTrack({ id: "too-many" }))), /15 melodic/);
  assert.throws(() => exportSongMidi(addTrack(source, createTrack({ id: "drums2", instrumentId: "drums" }))), /one drum/);
});

test("validation rejects corrupt values and unrepresentable timing; tiny notes and overlap fail explicitly", () => {
  const source = song();
  const modified = (update: Record<string, unknown>) => ({ ...source, tracks: [{ ...source.tracks[0]!, clips: [{ ...source.tracks[0]!.clips[0]!, pattern: { lengthBeats: 4, notes: [{ ...source.tracks[0]!.clips[0]!.pattern.notes[0]!, ...update }] } }] }] }) as Song;
  for (const update of [{ pitch: 128 }, { velocity: -1 }, { startBeat: NaN }, { lengthBeats: -1 }]) assert.throws(() => exportSongMidi(modified(update)));
  assert.throws(() => exportSongMidi(modified({ lengthBeats: 0.00001 })), /resolution/);
  assert.throws(() => exportSongMidi({ ...source, tracks: [{ ...source.tracks[0]!, clips: [{ ...source.tracks[0]!.clips[0]!, startBeat: 1e12 }] }] }), /range/);
  const overlap = modified({ startBeat: 0, lengthBeats: 2 });
  const clip = overlap.tracks[0]!.clips[0]!;
  assert.throws(() => exportSongMidi({ ...overlap, tracks: [{ ...overlap.tracks[0]!, clips: [{ ...clip, pattern: { ...clip.pattern, notes: [...clip.pattern.notes, createNote({ id: "other", pitch: 60, startBeat: 1 })] } }] }] }), /Overlapping/);
});
