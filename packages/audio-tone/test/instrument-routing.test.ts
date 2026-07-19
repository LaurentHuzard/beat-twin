import assert from "node:assert/strict";
import test from "node:test";

import type { Song } from "@beat-twin/core";

import {
  createTonePreviewEngine,
  midiPitchToInstrumentNoteName,
  type ToneModuleLike,
  type TonePreviewSynth,
  type ToneSynthConstructor,
  type ToneTransportLike,
} from "../src/index.ts";

class RecordingVoice implements TonePreviewSynth {
  readonly calls: Array<{ note: string; duration: number; time: number; velocity?: number }> = [];
  readonly role: string;
  released = 0;
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

  releaseAll(): void {
    this.released += 1;
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
