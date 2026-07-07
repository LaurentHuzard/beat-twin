import type { Song } from "@beat-twin/core";

import {
  scheduleSongNotes,
  type ScheduledNoteEvent,
} from "./scheduler.ts";

export type TonePreviewEngine = {
  readonly schedule: (song: Song) => readonly ScheduledNoteEvent[];
  readonly start: (
    song: Song,
    options?: TonePreviewStartOptions,
  ) => Promise<readonly ScheduledNoteEvent[]>;
  readonly stop: () => void;
  readonly dispose: () => void;
};

export type TonePreviewStartOptions = {
  readonly delaySeconds?: number;
};

export type TonePreviewEngineOptions = {
  readonly synth?: TonePreviewSynth;
};

export type TonePreviewSynth = {
  triggerAttackRelease: (
    note: string,
    duration: number,
    time: number,
    velocity?: number,
  ) => void;
  toDestination?: () => TonePreviewSynth;
  releaseAll?: (time?: number) => void;
  dispose?: () => void;
};

type ToneTransportEventId = number | string;

type ToneTransportLike = {
  readonly bpm?: {
    value: number;
  };
  schedule: (
    callback: (time: number) => void,
    time: number,
  ) => ToneTransportEventId;
  start: (time?: number | string) => void;
  stop: () => void;
  clear?: (eventId: ToneTransportEventId) => void;
  cancel?: (after?: number) => void;
};

type ToneModuleLike = {
  Transport?: ToneTransportLike;
  getTransport?: () => ToneTransportLike;
  PolySynth?: new () => TonePreviewSynth;
  Synth?: new () => TonePreviewSynth;
  start?: () => Promise<void>;
};

export async function createTonePreviewEngine(
  options: TonePreviewEngineOptions = {},
): Promise<TonePreviewEngine> {
  const tone = await loadToneModule();
  const transport = resolveTransport(tone);
  const synth = options.synth ?? createDefaultSynth(tone);
  const scheduledIds: ToneTransportEventId[] = [];

  function clearScheduledEvents(): void {
    if (transport.clear) {
      for (const eventId of scheduledIds.splice(0)) {
        transport.clear(eventId);
      }
      return;
    }

    scheduledIds.splice(0);
    transport.cancel?.(0);
  }

  function stop(): void {
    transport.stop();
    clearScheduledEvents();
    synth.releaseAll?.();
  }

  function schedule(song: Song): readonly ScheduledNoteEvent[] {
    clearScheduledEvents();
    const events = scheduleSongNotes(song);
    if (transport.bpm) {
      transport.bpm.value = song.transport.bpm;
    }

    for (const event of events) {
      const eventId = transport.schedule((time) => {
        synth.triggerAttackRelease(
          midiPitchToNoteName(event.pitch),
          event.durationSeconds,
          time,
          midiVelocityToGain(event.velocity),
        );
      }, event.startSeconds);
      scheduledIds.push(eventId);
    }

    return events;
  }

  return {
    schedule,
    async start(song, startOptions = {}) {
      stop();
      const events = schedule(song);
      await tone.start?.();
      transport.start(`+${startOptions.delaySeconds ?? 0}`);
      return events;
    },
    stop,
    dispose() {
      stop();
      synth.dispose?.();
    },
  };
}

export async function startTonePreview(
  song: Song,
  options?: TonePreviewStartOptions,
): Promise<{
  readonly engine: TonePreviewEngine;
  readonly events: readonly ScheduledNoteEvent[];
}> {
  const engine = await createTonePreviewEngine();
  const events = await engine.start(song, options);
  return { engine, events };
}

export function midiPitchToNoteName(pitch: number): string {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    throw new Error("MIDI pitch must be an integer from 0 to 127");
  }

  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(pitch / 12) - 1;
  return `${names[pitch % names.length]}${octave}`;
}

export function midiVelocityToGain(velocity: number): number {
  if (!Number.isInteger(velocity) || velocity < 0 || velocity > 127) {
    throw new Error("MIDI velocity must be an integer from 0 to 127");
  }

  return velocity / 127;
}

async function loadToneModule(): Promise<ToneModuleLike> {
  try {
    return (await import("tone")) as unknown as ToneModuleLike;
  } catch (error) {
    throw new Error(
      "Tone.js is required to start audio preview. Install the tone package in the browser app.",
      { cause: error },
    );
  }
}

function resolveTransport(tone: ToneModuleLike): ToneTransportLike {
  const transport = tone.getTransport?.() ?? tone.Transport;
  if (!transport) {
    throw new Error("Tone.js transport is unavailable");
  }

  return transport;
}

function createDefaultSynth(tone: ToneModuleLike): TonePreviewSynth {
  const Synth = tone.PolySynth ?? tone.Synth;
  if (!Synth) {
    throw new Error("Tone.js synth constructor is unavailable");
  }

  const synth = new Synth();
  return synth.toDestination?.() ?? synth;
}
