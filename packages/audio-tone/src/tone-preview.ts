import {
  BUILT_IN_INSTRUMENTS,
  type BuiltInInstrumentId,
  type Song,
} from "@beat-twin/core";

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
  /** Test seam and advanced host seam. Normal browser callers load Tone.js lazily. */
  readonly tone?: ToneModuleLike;
  /** Legacy single-voice seam retained for compatibility. */
  readonly synth?: TonePreviewSynth;
  readonly voiceFactory?: TonePreviewVoiceFactory;
};

export type TonePreviewSynth = {
  triggerAttackRelease: (
    note: string,
    duration: number,
    time: number,
    velocity?: number,
  ) => void;
  toDestination?: () => TonePreviewSynth;
  connect?: (destination: unknown) => unknown;
  releaseAll?: (time?: number) => void;
  triggerRelease?: (time?: number) => void;
  dispose?: () => void;
};

export type TonePreviewVoiceFactory = (
  instrumentId: BuiltInInstrumentId,
  trackId: string,
) => TonePreviewSynth;

type ToneTransportEventId = number | string;

export type ToneTransportLike = {
  readonly bpm?: { value: number };
  seconds?: number;
  schedule: (
    callback: (time: number) => void,
    time: number,
  ) => ToneTransportEventId;
  scheduleRepeat?: (
    callback: (time: number) => void,
    interval: number,
    startTime?: number,
  ) => ToneTransportEventId;
  start: (time?: number | string) => void;
  stop: () => void;
  pause?: () => void;
  clear?: (eventId: ToneTransportEventId) => void;
  cancel?: (after?: number) => void;
};

export type ToneSynthConstructor = new (options?: unknown) => TonePreviewSynth;
export type TonePolySynthConstructor = new (
  voice?: ToneSynthConstructor,
  options?: unknown,
) => TonePreviewSynth;

export type ToneTrackBusNode = {
  toDestination?: () => unknown;
  dispose?: () => void;
};

export type ToneGainConstructor = new (gain?: number) => ToneTrackBusNode;

export type ToneModuleLike = {
  Transport?: ToneTransportLike;
  getTransport?: () => ToneTransportLike;
  PolySynth?: TonePolySynthConstructor;
  Synth?: ToneSynthConstructor;
  MonoSynth?: ToneSynthConstructor;
  MembraneSynth?: ToneSynthConstructor;
  Gain?: ToneGainConstructor;
  start?: () => Promise<void>;
  now?: () => number;
};

type OwnedVoice = {
  readonly instrumentId: BuiltInInstrumentId;
  readonly voice: TonePreviewSynth;
};

export async function createTonePreviewEngine(
  options: TonePreviewEngineOptions = {},
): Promise<TonePreviewEngine> {
  const tone = options.tone ?? await loadToneModule();
  const transport = resolveTransport(tone);
  const voiceFactory = options.voiceFactory ?? (
    options.synth
      ? () => options.synth!
      : createBuiltInInstrumentVoiceFactory(tone)
  );
  const voices = new Map<string, OwnedVoice>();
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
    for (const { voice } of voices.values()) {
      voice.releaseAll?.();
      voice.dispose?.();
    }
    voices.clear();
  }

  function synchronizeVoices(events: readonly ScheduledNoteEvent[]): void {
    const active = new Map<string, BuiltInInstrumentId>();
    for (const event of events) {
      active.set(event.trackId, event.instrumentId);
    }

    for (const [trackId, owned] of voices) {
      const instrumentId = active.get(trackId);
      if (instrumentId === undefined || instrumentId !== owned.instrumentId) {
        owned.voice.releaseAll?.();
        owned.voice.dispose?.();
        voices.delete(trackId);
      }
    }

    for (const [trackId, instrumentId] of active) {
      if (!voices.has(trackId)) {
        voices.set(trackId, {
          instrumentId,
          voice: voiceFactory(instrumentId, trackId),
        });
      }
    }
  }

  function schedule(song: Song): readonly ScheduledNoteEvent[] {
    clearScheduledEvents();
    const events = scheduleSongNotes(song);
    synchronizeVoices(events);
    if (transport.bpm) {
      transport.bpm.value = song.transport.bpm;
    }

    for (const event of events) {
      const voice = voices.get(event.trackId)?.voice;
      if (!voice) {
        throw new Error(`No preview voice for track ${event.trackId}`);
      }
      const eventId = transport.schedule((time) => {
        voice.triggerAttackRelease(
          midiPitchToInstrumentNoteName(event.instrumentId, event.pitch),
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
    },
  };
}

export function createBuiltInInstrumentVoiceFactory(
  tone: ToneModuleLike,
  destination?: unknown,
): TonePreviewVoiceFactory {
  return (instrumentId) => {
    if (!BUILT_IN_INSTRUMENTS.some((instrument) => instrument.id === instrumentId)) {
      throw new Error(`Unknown built-in instrument: ${String(instrumentId)}`);
    }

    let voice: TonePreviewSynth;
    switch (instrumentId) {
      case "drums": {
        const Drums = tone.MembraneSynth ?? tone.Synth;
        if (!Drums) throw missingVoiceConstructor(instrumentId);
        voice = new Drums({
          pitchDecay: 0.04,
          octaves: 5,
          envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
        });
        break;
      }
      case "bass": {
        const Bass = tone.MonoSynth ?? tone.Synth;
        if (!Bass) throw missingVoiceConstructor(instrumentId);
        voice = new Bass({
          oscillator: { type: "square" },
          filter: { Q: 2, type: "lowpass", rolloff: -24 },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.35, release: 0.25 },
          filterEnvelope: {
            attack: 0.01,
            decay: 0.18,
            sustain: 0.15,
            release: 0.2,
            baseFrequency: 70,
            octaves: 2.5,
          },
        });
        break;
      }
      case "chords": {
        if (tone.PolySynth) {
          voice = new tone.PolySynth(tone.Synth, {
            oscillator: { type: "triangle" },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.8 },
          });
        } else if (tone.Synth) {
          voice = new tone.Synth({ oscillator: { type: "triangle" } });
        } else {
          throw missingVoiceConstructor(instrumentId);
        }
        break;
      }
      case "lead": {
        if (tone.Synth) {
          voice = new tone.Synth({
            oscillator: { type: "sawtooth" },
            envelope: { attack: 0.01, decay: 0.12, sustain: 0.25, release: 0.18 },
          });
        } else if (tone.PolySynth) {
          voice = new tone.PolySynth();
        } else {
          throw missingVoiceConstructor(instrumentId);
        }
        break;
      }
    }

    if (destination !== undefined && voice.connect) {
      voice.connect(destination);
      return voice;
    }
    return voice.toDestination?.() ?? voice;
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

export function midiPitchToInstrumentNoteName(
  instrumentId: BuiltInInstrumentId,
  pitch: number,
): string {
  if (instrumentId !== "drums") {
    return midiPitchToNoteName(pitch);
  }

  const normalized = normalizeDrumPitch(pitch);
  return midiPitchToNoteName(normalized);
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

function normalizeDrumPitch(pitch: number): number {
  midiPitchToNoteName(pitch);
  if (pitch === 36 || pitch === 38 || pitch === 42 || pitch === 46) {
    return pitch;
  }
  const mapped = [36, 38, 42, 46] as const;
  return mapped[pitch % mapped.length]!;
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

function missingVoiceConstructor(instrumentId: BuiltInInstrumentId): Error {
  return new Error(`Tone.js has no compatible constructor for ${instrumentId}`);
}
