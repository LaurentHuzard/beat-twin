import { parseMidi } from "midi-file";
import { createSong } from "@beat-twin/core";
import type { BeatTwinCommand } from "@beat-twin/commands";

export const MAX_MIDI_IMPORT_BYTES = 1024 * 1024;
export type ImportedMidiNote = Readonly<{ pitch: number; velocity: number; startBeat: number; lengthBeats: number }>;
export type ImportedMidiTrack = Readonly<{ name: string; channel: number; lengthBeats: number; notes: readonly ImportedMidiNote[] }>;
export type MidiImportPreview = Readonly<{ format: number; bpm: number; tracks: readonly ImportedMidiTrack[]; noteCount: number; warnings: readonly string[] }>;

// Validate event framing before the permissive third-party parser: bounded VLQs,
// lengths, running status and data bytes. This does not interpret musical events.
function validateFraming(bytes: Uint8Array): void {
  if (bytes.length < 14 || bytes.length > MAX_MIDI_IMPORT_BYTES) throw new Error("Choose a MIDI file between 14 bytes and 1 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (p: number) => String.fromCharCode(...bytes.slice(p, p + 4));
  if (tag(0) !== "MThd" || view.getUint32(4) !== 6) throw new Error("Invalid Standard MIDI header.");
  const format = view.getUint16(8), count = view.getUint16(10), division = view.getUint16(12);
  if (format > 1 || count < 1 || count > 64 || (format === 0 && count !== 1)) throw new Error("Support is limited to SMF Type 0/1 with 1–64 source tracks.");
  if (!division || division & 0x8000) throw new Error("SMPTE timing is unsupported; choose a PPQ MIDI file.");
  let p = 14, events = 0;
  for (let track = 0; track < count; track++) {
    if (p + 8 > bytes.length || tag(p) !== "MTrk") throw new Error("Missing MIDI track chunk.");
    const end = p + 8 + view.getUint32(p + 4);
    p += 8;
    if (end > bytes.length) throw new Error("Truncated MIDI track.");
    let status = 0, ended = false;
    const read = () => { if (p >= end) throw new Error("Truncated MIDI event."); return bytes[p++]!; };
    const vlq = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) { const b = read(); value = value * 128 + (b & 127); if (!(b & 128)) return value; }
      throw new Error("Invalid MIDI variable-length value.");
    };
    while (p < end) {
      if (ended || ++events > 20000) throw new Error("Trailing events or more than 20000 MIDI events.");
      vlq();
      let b = read(), firstData = false;
      if (b < 128) { if (!status) throw new Error("Invalid MIDI running status."); firstData = true; b = status; }
      if (b === 255 || b === 240 || b === 247) {
        status = 0;
        const meta = b === 255 ? read() : -1;
        if (meta > 127) throw new Error("Invalid MIDI meta type.");
        const length = vlq();
        if (p + length > end) throw new Error("Truncated MIDI payload.");
        if (meta === 47) { if (length !== 0) throw new Error("Invalid end-of-track."); ended = true; }
        p += length;
      } else {
        if (b < 128 || b > 239) throw new Error("Unsupported MIDI status.");
        status = b;
        const length = (b >> 4) === 12 || (b >> 4) === 13 ? 1 : 2;
        for (let n = firstData ? 1 : 0; n < length; n++) if (read() > 127) throw new Error("Invalid MIDI data byte.");
      }
    }
    if (!ended) throw new Error("MIDI track has no end-of-track event.");
  }
  if (p !== bytes.length) throw new Error("Unexpected data after MIDI tracks.");
}

export function inspectMidiImport(bytes: Uint8Array): MidiImportPreview {
  validateFraming(bytes);
  let midi: ReturnType<typeof parseMidi>;
  try { midi = parseMidi(bytes); } catch { throw new Error("Malformed MIDI events."); }
  const ppq = midi.header.ticksPerBeat!;
  const tracks: ImportedMidiTrack[] = [], warnings = new Set<string>();
  let tempo: number | null = null, noteCount = 0;
  for (const [index, events] of midi.tracks.entries()) {
    let tick = 0, name = `MIDI track ${index + 1}`;
    const channels = new Map<number, { notes: ImportedMidiNote[]; held: Map<number, { tick: number; velocity: number }> }>();
    for (const event of events) {
      if (!Number.isSafeInteger(event.deltaTime) || event.deltaTime < 0) throw new Error("Invalid MIDI event time.");
      tick += event.deltaTime;
      if (!Number.isSafeInteger(tick) || tick / ppq > 100000) throw new Error("MIDI duration exceeds 100000 beats.");
      if (event.type === "setTempo") {
        if (event.microsecondsPerBeat <= 0 || (tempo !== null && tempo !== event.microsecondsPerBeat) || (tempo === null && tick !== 0)) throw new Error("Tempo changes are unsupported; use one constant tempo at beat zero.");
        tempo = event.microsecondsPerBeat;
      } else if (event.type === "trackName") {
        // midi-file returns byte characters; decode UTF-8 emitted by our exporter.
        name = new TextDecoder().decode(Uint8Array.from(event.text, c => c.charCodeAt(0))).trim().slice(0, 120) || name;
      } else if (event.type === "controller" || event.type === "pitchBend" || event.type === "noteAftertouch" || event.type === "channelAftertouch" || event.type === "sysEx" || event.type === "endSysEx") {
        throw new Error("Controllers, sustain, pitch bend, pressure and SysEx are unsupported; export notes only.");
      } else if (event.type === "noteOn" || event.type === "noteOff") {
        const channel: { notes: ImportedMidiNote[]; held: Map<number, { tick: number; velocity: number }> } = channels.get(event.channel) ?? { notes: [], held: new Map() };
        channels.set(event.channel, channel);
        if (event.type === "noteOn") {
          if (channel.held.has(event.noteNumber)) throw new Error("Overlapping notes of the same pitch are unsupported.");
          channel.held.set(event.noteNumber, { tick, velocity: event.velocity });
        } else {
          const held = channel.held.get(event.noteNumber);
          if (!held || tick <= held.tick) throw new Error("Unpaired or zero-duration MIDI note.");
          channel.held.delete(event.noteNumber);
          if (++noteCount > 4096) throw new Error("MIDI import supports at most 4096 notes.");
          channel.notes.push({ pitch: event.noteNumber, velocity: held.velocity, startBeat: held.tick / ppq, lengthBeats: tick / ppq - held.tick / ppq });
        }
      } else if (event.type === "programChange" || event.type === "instrumentName") {
        warnings.add("Instrument/program assignments are omitted; choose NanoDAW voices after import.");
      } else if (!["endOfTrack", "marker", "text", "copyrightNotice", "sequenceNumber"].includes(event.type)) {
        warnings.add("Time/key signatures and other descriptive MIDI metadata are omitted.");
      }
    }
    for (const [channel, data] of channels) {
      if (data.held.size) throw new Error("MIDI has notes without a matching note-off.");
      if (data.notes.length) tracks.push(Object.freeze({ name: `${name} · Ch ${channel + 1}`, channel, lengthBeats: Math.max(1, tick / ppq), notes: Object.freeze(data.notes.map(n => Object.freeze(n))) }));
    }
  }
  if (!noteCount || tracks.length > 16 || tracks.filter(t => t.channel === 9).length > 1 || tracks.filter(t => t.channel !== 9).length > 15) throw new Error("Import needs sounding notes, at most 15 melodic tracks and one drum track.");
  const bpm = tempo === null ? 120 : 60_000_000 / tempo;
  if (bpm < 20 || bpm > 300) throw new Error("MIDI tempo must be between 20 and 300 BPM.");
  createSong({ id: "midi-validation", bpm }); // validate NanoDAW tempo
  warnings.add("Notes only: sounds, clip boundaries and live/device state are not imported. Each channel becomes one arrangement clip.");
  return Object.freeze({ format: midi.header.format, bpm, tracks: Object.freeze(tracks), noteCount, warnings: Object.freeze([...warnings]) });
}

export function midiImportCommands(preview: MidiImportPreview, hasSong: boolean, id: () => string): BeatTwinCommand[] {
  const commands: BeatTwinCommand[] = hasSong ? [] : [{ type: "CreateSong", title: "Imported MIDI sketch", bpm: preview.bpm }];
  for (const track of preview.tracks) {
    const trackId = id(), clipId = id();
    commands.push({ type: "CreateTrack", id: trackId, name: track.name, instrumentId: track.channel === 9 ? "drums" : "lead" });
    commands.push({ type: "CreateClip", id: clipId, trackId, name: "Imported arrangement", startBeat: 0, lengthBeats: track.lengthBeats });
    for (const note of track.notes) commands.push({ type: "AddNote", trackId, clipId, ...note });
  }
  return commands;
}
