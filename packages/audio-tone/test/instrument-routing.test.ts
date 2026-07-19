import assert from "node:assert/strict";
import test from "node:test";

import type { Song } from "@beat-twin/core";

import {
  createToneLiveAudioPort,
  createToneMidiMaterialPreparer,
  createTonePreviewEngine,
  midiPitchToInstrumentNoteName,
  type ToneModuleLike,
  type LiveMidiClipMaterial,
  type TonePreviewSynth,
  type ToneSynthConstructor,
  type ToneTransportLike,
} from "../src/index.ts";

class RecordingVoice implements TonePreviewSynth {
  readonly calls: Array<{ note: string; duration: number; time: number; velocity?: number }> = [];
  readonly role: string;
  released = 0;
  readonly releaseTimes: Array<number | undefined> = [];
  disposed = 0;

  constructor(role: string) {
    this.role = role;
  }

  triggerAttackRelease(note: string, duration: number, time: number, velocity?: number): void {
    this.calls.push({ note, duration, time, velocity });
  }

  toDestination(): TonePreviewSynth {
    return this;
  }

  connect(): TonePreviewSynth {
    return this;
  }

  releaseAll(time?: number): void {
    this.released += 1;
    this.releaseTimes.push(time);
  }

  dispose(): void {
    this.disposed += 1;
  }
}

class MonophonicRecordingVoice implements TonePreviewSynth {
  readonly releaseTimes: Array<number | undefined> = [];
  disposed = 0;

  triggerAttackRelease(): void {}

  connect(): TonePreviewSynth {
    return this;
  }

  triggerRelease(time?: number): void {
    this.releaseTimes.push(time);
  }

  dispose(): void {
    this.disposed += 1;
  }
}

function voiceConstructor(role: string, created: RecordingVoice[]): ToneSynthConstructor {
  return class extends RecordingVoice {
    constructor(_options?: unknown) {
      super(role);
      created.push(this);
    }
  };
}

function instrumentSong(): Song {
  const track = (
    id: string,
    instrumentId: "drums" | "bass",
    pitch: number,
  ) => ({
    id,
    name: id,
    kind: "instrument" as const,
    instrumentId,
    color: "#36c2a1",
    clips: [{
      id: `clip-${id}`,
      trackId: id,
      name: "Loop",
      startBeat: 0,
      lengthBeats: 4,
      pattern: {
        lengthBeats: 4,
        notes: [{
          id: `note-${id}`,
          pitch,
          velocity: 100,
          startBeat: 0,
          lengthBeats: 1,
        }],
      },
    }],
  });

  return {
    schemaVersion: 2,
    id: "song-1",
    title: "Instrument routing",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [track("drums-track", "drums", 60), track("bass-track", "bass", 36)],
  };
}

test("routes tracks through distinct bounded voices and disposes owned nodes", async () => {
  const created: RecordingVoice[] = [];
  const callbacks = new Map<number, (time: number) => void>();
  let eventId = 0;
  const transport: ToneTransportLike = {
    bpm: { value: 0 },
    schedule: (callback) => {
      eventId += 1;
      callbacks.set(eventId, callback);
      return eventId;
    },
    start: () => undefined,
    stop: () => undefined,
    clear: (id) => callbacks.delete(Number(id)),
  };
  const tone: ToneModuleLike = {
    getTransport: () => transport,
    Synth: voiceConstructor("lead", created),
    MonoSynth: voiceConstructor("bass", created),
    MembraneSynth: voiceConstructor("drums", created),
  };
  const engine = await createTonePreviewEngine({ tone });
  const song = instrumentSong();

  const events = engine.schedule(song);
  assert.deepEqual(events.map((event) => event.instrumentId), ["drums", "bass"]);
  assert.deepEqual(created.map((voice) => voice.role), ["drums", "bass"]);
  assert.equal(transport.bpm?.value, 120);

  for (const callback of callbacks.values()) callback(0.25);
  assert.equal(created[0]?.calls[0]?.note, "C2");
  assert.equal(created[1]?.calls[0]?.note, "C2");

  engine.schedule(song);
  assert.equal(created.length, 2, "same track/instrument keeps stable voice ownership");

  engine.stop();
  assert.deepEqual(created.map((voice) => voice.disposed), [1, 1]);
  assert.ok(created.every((voice) => voice.released >= 1));
  engine.dispose();
  assert.deepEqual(created.map((voice) => voice.disposed), [1, 1]);
});

test("uses deterministic percussion mapping without changing pitched voices", () => {
  assert.equal(midiPitchToInstrumentNoteName("drums", 60), "C2");
  assert.equal(midiPitchToInstrumentNoteName("drums", 38), "D2");
  assert.equal(midiPitchToInstrumentNoteName("bass", 60), "C4");
});

test("maps beat recurrence to one Tone scheduleRepeat handle without callback scheduling", () => {
  let repeatCallback: ((time: number) => void) | null = null;
  let repeatInterval = -1;
  let repeatStart = -1;
  let oneShotSchedules = 0;
  const transport: ToneTransportLike = {
    bpm: { value: 0 },
    seconds: 0,
    schedule: () => {
      oneShotSchedules += 1;
      return "once";
    },
    scheduleRepeat: (callback, interval, startTime) => {
      repeatCallback = callback;
      repeatInterval = interval;
      repeatStart = startTime ?? -1;
      return "repeat";
    },
    start: () => undefined,
    stop: () => undefined,
  };
  const port = createToneLiveAudioPort({ getTransport: () => transport });
  port.setBpm(120);
  const occurrences: Array<{ audioTime: number; beat: number }> = [];

  const handle = port.scheduleRepeatAtBeat(2, 4, (audioTime, beat) => {
    occurrences.push({ audioTime, beat });
  });
  assert.equal(handle, "repeat");
  assert.equal(repeatInterval, 2);
  assert.equal(repeatStart, 1);
  assert.ok(repeatCallback);
  (repeatCallback as (time: number) => void)(9.5);
  (repeatCallback as (time: number) => void)(11.5);

  assert.deepEqual(occurrences, [
    { audioTime: 9.5, beat: 2 },
    { audioTime: 11.5, beat: 6 },
  ]);
  assert.equal(oneShotSchedules, 0);
});

test("releases at Tone callback time and defers boundary disposal idempotently", async () => {
  const created: RecordingVoice[] = [];
  let now = 10;
  const tone: ToneModuleLike = {
    now: () => now,
    MonoSynth: voiceConstructor("bass", created),
  };
  const prepare = createToneMidiMaterialPreparer(tone);
  const material: LiveMidiClipMaterial = {
    kind: "midi",
    materialId: "clip-a@1",
    version: 1,
    clipId: "clip-a",
    instrumentId: "bass",
    lengthBeats: 4,
    notes: [
      { id: "note-a", pitch: 48, velocity: 100, startBeat: 0, lengthBeats: 1 },
    ],
  };
  const bus = { trackId: "track-a", destination: {}, dispose() {} };
  const prepared = await prepare(material, bus);

  prepared.releaseAll(10);
  prepared.dispose(10);
  prepared.dispose(11);
  assert.deepEqual(created[0]?.releaseTimes, [10]);
  assert.equal(created[0]?.disposed, 0);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(created[0]?.disposed, 1);

  now = 20;
  const immediate = await prepare(
    { ...material, materialId: "clip-b@1", clipId: "clip-b" },
    { ...bus, trackId: "track-b" },
  );
  immediate.dispose(22);
  immediate.dispose();
  assert.equal(created[1]?.disposed, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(created[1]?.disposed, 1);

  const monoVoices: MonophonicRecordingVoice[] = [];
  const MonoVoice = class extends MonophonicRecordingVoice {
    constructor(_options?: unknown) {
      super();
      monoVoices.push(this);
    }
  };
  const prepareMono = createToneMidiMaterialPreparer({
    now: () => 30,
    MonoSynth: MonoVoice,
  });
  const monophonic = await prepareMono(
    { ...material, materialId: "clip-mono@1", clipId: "clip-mono" },
    { ...bus, trackId: "track-mono" },
  );
  monophonic.releaseAll(30);
  monophonic.dispose(30);
  assert.deepEqual(monoVoices[0]?.releaseTimes, [30]);
  assert.equal(monoVoices[0]?.disposed, 0);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(monoVoices[0]?.disposed, 1);
});
