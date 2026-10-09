import { describe, expect, it } from "vitest";
import { addTrack, createSong, createTrack, createClip, createNote, exportSongMidi } from "@beat-twin/core";
import { inspectMidiImport, MAX_MIDI_IMPORT_BYTES } from "./midiImport";
import { fixtureMidi } from "./test/midiFixture";

describe("bounded local MIDI inspection", () => {
  it("reads handcrafted Type0 running status with arbitrary PPQ", () => {
    const preview = inspectMidiImport(fixtureMidi());
    expect(preview.bpm).toBe(120);
    expect(preview.tracks[0]?.notes).toEqual([{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1 }]);
    expect(preview.tracks[0]?.name).toBe("Seed · Ch 1");
    expect(Object.isFrozen(preview.tracks[0]?.notes[0])).toBe(true);
  });
  it("splits Type0 channels into separate melodic/drum tracks, warns for program omissions", () => {
    const preview = inspectMidiImport(fixtureMidi([0,192,1, 0,144,60,100, 0,153,36,90, 96,128,60,0, 0,137,36,0]));
    expect(preview.tracks.map(t => t.channel)).toEqual([0,9]);
    expect(preview.noteCount).toBe(2);
    expect(preview.warnings.join()).toMatch(/program assignments/);
  });
  it("roundtrips Type1 exported absolute note positions, tempo and UTF8 labels", () => {
    let song = createSong({ id: "roundtrip", bpm: 125 });
    song = addTrack(song, createTrack({ id: "t", name: "Léàd", clips: [createClip({ id: "c", trackId: "t", startBeat: 4, lengthBeats: 4,
      pattern: { lengthBeats: 4, notes: [createNote({ id: "n", pitch: 64, velocity: 110, startBeat: 0.5, lengthBeats: 1.5 })] } })] }));
    const source = JSON.stringify(song);
    const preview = inspectMidiImport(exportSongMidi(song));
    expect(preview.format).toBe(1);
    expect(preview.bpm).toBe(125);
    expect(preview.tracks[0]?.name).toContain("Léàd");
    expect(preview.tracks[0]?.notes[0]).toEqual({ pitch:64, velocity:110, startBeat:4.5, lengthBeats:1.5 });
    expect(JSON.stringify(song)).toBe(source);
  });
  it("rejects changed tempo, controllers, notes without pairs and ambiguous notes", () => {
    for (const events of [
      [0,255,81,3,7,161,32, 1,255,81,3,6,0,0],
      [0,176,64,127], [0,224,0,64],
      [0,144,60,100], [0,128,60,0],
      [0,144,60,100, 1,144,60,90], [0,144,60,100, 0,128,60,0],
    ]) expect(() => inspectMidiImport(fixtureMidi(events))).toThrow();
  });
  it("rejects framing, counts and unsupported format/timing before permissive parsing", () => {
    expect(() => inspectMidiImport(new Uint8Array(MAX_MIDI_IMPORT_BYTES + 1))).toThrow(/1 MiB/);
    expect(() => inspectMidiImport(fixtureMidi([],2))).toThrow(/Type 0\/1/);
    expect(() => inspectMidiImport(fixtureMidi([],0,0x8001))).toThrow(/SMPTE/);
    const manyTracks = fixtureMidi(); manyTracks[11] = 65;
    expect(() => inspectMidiImport(manyTracks)).toThrow(/64/);
    expect(() => inspectMidiImport(fixtureMidi().slice(0,-1))).toThrow(/Truncated/);
    expect(() => inspectMidiImport(fixtureMidi([0,144,60]))).toThrow(/Truncated/);
    expect(() => inspectMidiImport(fixtureMidi([128,128,128,128,0]))).toThrow(/variable-length/);
    expect(() => inspectMidiImport(fixtureMidi([0,60,0]))).toThrow(/running status/);
    const trailing = new Uint8Array([...fixtureMidi(),1]);
    expect(() => inspectMidiImport(trailing)).toThrow(/after MIDI/);
    expect(() => inspectMidiImport(fixtureMidi([]))).toThrow(/sounding notes/);
    const many = Array.from({length:20001}, () => [0,255,1,0]).flat();
    // Full 32-bit length to exercise >65535 bytes too.
    const file = fixtureMidi(many); new DataView(file.buffer).setUint32(18,many.length + 4);
    expect(() => inspectMidiImport(file)).toThrow(/20000/);
  });
  it("rejects excessive notes and bounded malformed random input without hanging", () => {
    const notes = Array.from({length:4097}, () => [0,144,60,100,1,128,60,0]).flat();
    expect(() => inspectMidiImport(fixtureMidi(notes))).toThrow(/4096/);
    for (let i = 0; i < 64; i++) expect(() => inspectMidiImport(fixtureMidi([0,...Array.from({length:32}, (_,j) => (i*17+j*29)%256)]))).toThrow();
  });
});
