import { deserializeSong, type Song } from "./index.ts";

/** SMF Type 1, one conductor plus one track per instrument, rounded to 480 PPQ. */
export const MIDI_TICKS_PER_BEAT = 480;
const MAX_TICK = 0x0fffffff;
type Event = { tick: number; order: number; bytes: number[] };

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}
function integer(value: number, width: number): number[] {
  return Array.from({ length: width }, (_, index) => Math.floor(value / 256 ** (width - index - 1)) & 0xff);
}
function text(type: number, value: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  return [0xff, type, ...variableLength(bytes.length), ...bytes];
}
function tick(beats: number): number {
  const value = Math.round(beats * MIDI_TICKS_PER_BEAT);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TICK) {
    throw new Error("Song timing exceeds MIDI export range.");
  }
  return value;
}
function chunk(events: Event[], endTick: number): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let previous = 0;
  for (const event of events) {
    for (const byte of variableLength(event.tick - previous)) data.push(byte);
    for (const byte of event.bytes) data.push(byte);
    previous = event.tick;
  }
  for (const byte of [...variableLength(endTick - previous), 0xff, 0x2f, 0]) data.push(byte);
  return [0x4d, 0x54, 0x72, 0x6b, ...integer(data.length, 4), ...data];
}

/** Read-only export. Reject unsupported channel/timing limits instead of lossy mapping. */
export function exportSongMidi(input: Song): Uint8Array {
  const song = deserializeSong(input);
  const tracks = song.tracks.filter((track) => track.kind === "instrument");
  const drums = tracks.filter((track) => track.instrumentId === "drums");
  if (drums.length > 1 || tracks.length - drums.length > 15) {
    throw new Error("MIDI export supports at most 15 melodic tracks and one drum track.");
  }
  const tempo = Math.round(60_000_000 / song.transport.bpm);
  if (tempo < 1 || tempo > 0xffffff) throw new Error("Tempo exceeds MIDI export range.");
  let songEnd = 0;
  let melodicChannel = 0;
  const musicalChunks = tracks.map((track) => {
    const channel = track.instrumentId === "drums" ? 9 : melodicChannel++;
    if (melodicChannel === 9) melodicChannel++; // channel 10 is reserved for percussion
    const events: Event[] = [{ tick: 0, order: 0, bytes: text(3, track.name) }];
    let end = 0;
    for (const clip of track.clips) {
      const start = tick(clip.startBeat);
      end = Math.max(end, tick(clip.startBeat + clip.lengthBeats));
      events.push({ tick: start, order: 1, bytes: text(6, clip.name) });
      for (const note of clip.pattern.notes) {
        const on = tick(clip.startBeat + note.startBeat);
        const off = tick(clip.startBeat + note.startBeat + note.lengthBeats);
        if (off <= on) throw new Error("A note duration is below the MIDI export resolution.");
        // Velocity zero means silence, not a sounding note-on in the MIDI protocol.
        if (note.velocity === 0) continue;
        events.push({ tick: on, order: 3, bytes: [0x90 | channel, note.pitch, note.velocity] });
        events.push({ tick: off, order: 2, bytes: [0x80 | channel, note.pitch, 0] });
      }
    }
    const active = new Set<number>();
    for (const event of [...events].sort((a, b) => a.tick - b.tick || a.order - b.order)) {
      if (event.order === 2) active.delete(event.bytes[1]!);
      if (event.order === 3) {
        if (active.has(event.bytes[1]!)) throw new Error("Overlapping notes of the same pitch cannot be exported losslessly.");
        active.add(event.bytes[1]!);
      }
    }
    songEnd = Math.max(songEnd, end);
    return chunk(events, end);
  });
  const conductor = chunk([
    { tick: 0, order: 0, bytes: text(3, song.title) },
    { tick: 0, order: 1, bytes: [0xff, 0x51, 3, ...integer(tempo, 3)] },
  ], songEnd);
  const data = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1,
    ...integer(tracks.length + 1, 2), ...integer(MIDI_TICKS_PER_BEAT, 2)];
  for (const part of [conductor, ...musicalChunks]) for (const byte of part) data.push(byte);
  return new Uint8Array(data);
}
