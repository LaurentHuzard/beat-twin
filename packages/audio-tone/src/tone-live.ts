import { beatToSeconds, beatsToSeconds } from "./scheduler.ts";
import {
  createLiveAudioEngine,
  LiveAudioEngineFault,
  type LiveAudioEngine,
  type LiveAudioPort,
  type LiveMaterialPreparer,
  type LivePreparedMaterial,
  type LiveScheduleHandle,
  type LiveTrackBus,
} from "./live-engine.ts";
import {
  midiMaterialEvents,
  validateLiveMidiClipMaterial,
  type LiveMidiClipMaterial,
} from "./live-scheduler.ts";
import {
  createBuiltInInstrumentVoiceFactory,
  midiPitchToInstrumentNoteName,
  midiVelocityToGain,
  type ToneModuleLike,
  type ToneTrackBusNode,
  type ToneTransportLike,
} from "./tone-preview.ts";

export type ToneLiveAudioEngineOptions = {
  /** Deterministic test seam. Browser callers load Tone.js lazily. */
  readonly tone?: ToneModuleLike;
};

export async function createToneLiveAudioEngine(
  options: ToneLiveAudioEngineOptions = {},
): Promise<LiveAudioEngine> {
  const tone = options.tone ?? await loadToneModule();
  const port = createToneLiveAudioPort(tone);
  return createLiveAudioEngine({
    port,
    prepareMaterial: createToneMidiMaterialPreparer(tone),
  });
}

export function createToneLiveAudioPort(tone: ToneModuleLike): LiveAudioPort {
  const transport = resolveTransport(tone);
  let bpm = 120;
  const buses = new Set<ToneTrackBusNode>();

  return {
    async unlock() {
      await tone.start?.();
    },
    setBpm(nextBpm) {
      bpm = positiveFinite(nextBpm, "bpm");
      if (transport.bpm) transport.bpm.value = bpm;
    },
    currentBeat() {
      return (transport.seconds ?? 0) * (bpm / 60);
    },
    scheduleAtBeat(beat, callback) {
      return transport.schedule(callback, beatToSeconds(beat, bpm));
    },
    scheduleRepeatAtBeat(firstBeat, intervalBeats, callback) {
      if (!transport.scheduleRepeat) {
        throw new LiveAudioEngineFault({
          code: "tone_unavailable",
          message: "Tone.js transport repeat scheduling is unavailable",
        });
      }
      const intervalSeconds = beatsToSeconds(
        positiveFinite(intervalBeats, "repeat interval"),
        bpm,
      );
      let occurrenceBeat = firstBeat;
      return transport.scheduleRepeat(
        (audioTime) => {
          const scheduledBeat = occurrenceBeat;
          occurrenceBeat += intervalBeats;
          callback(audioTime, scheduledBeat);
        },
        intervalSeconds,
        beatToSeconds(firstBeat, bpm),
      );
    },
    cancel(handle) {
      transport.clear?.(handle);
    },
    start(atBeat) {
      if (transport.seconds !== undefined) {
        transport.seconds = beatToSeconds(atBeat, bpm);
      }
      transport.start();
    },
    suspend() {
      if (!transport.pause) {
        throw new Error("Tone.js transport pause is unavailable");
      }
      transport.pause();
    },
    resume() {
      transport.start();
    },
    stop(audioTime) {
      transport.stop(audioTime);
    },
    reset() {
      transport.stop();
      transport.cancel?.(0);
      if (transport.seconds !== undefined) transport.seconds = 0;
    },
    createTrackBus(trackId) {
      if (!tone.Gain) {
        throw new LiveAudioEngineFault({
          code: "tone_unavailable",
          message: "Tone.js Gain is required for a stable per-track bus",
        });
      }
      const node = new tone.Gain(1);
      node.toDestination?.();
      buses.add(node);
      const bus: LiveTrackBus = {
        trackId,
        destination: node,
        dispose() {
          if (!buses.delete(node)) return;
          node.dispose?.();
        },
      };
      return bus;
    },
    dispose() {
      transport.stop();
      transport.cancel?.(0);
      for (const bus of buses) bus.dispose?.();
      buses.clear();
    },
  };
}

export function createToneMidiMaterialPreparer(
  tone: ToneModuleLike,
): LiveMaterialPreparer {
  return async (material, bus) => {
    if (material.kind !== "midi") {
      throw new LiveAudioEngineFault({
        code: "unsupported_material",
        message: `No Tone material adapter is registered for ${material.kind}`,
      });
    }
    const midi = material as LiveMidiClipMaterial;
    validateLiveMidiClipMaterial(midi);
    if (bus.destination === undefined) {
      throw new LiveAudioEngineFault({
        code: "material_not_ready",
        message: `Track ${bus.trackId} has no audio destination`,
      });
    }
    const voice = createBuiltInInstrumentVoiceFactory(tone, bus.destination)(
      midi.instrumentId,
      bus.trackId,
    );
    let disposed = false;
    let disposeTimer: ReturnType<typeof setTimeout> | null = null;
    const disposeVoiceNow = () => {
      if (disposed) return;
      if (disposeTimer !== null) {
        clearTimeout(disposeTimer);
        disposeTimer = null;
      }
      disposed = true;
      voice.dispose?.();
    };
    const noteById = new Map(midi.notes.map((note) => [note.id, note]));
    const prepared: LivePreparedMaterial = {
      kind: midi.kind,
      materialId: midi.materialId,
      version: midi.version,
      clipId: midi.clipId,
      lengthBeats: midi.lengthBeats,
      events: midiMaterialEvents(midi),
      trigger(event, audioTime, bpm) {
        const note = noteById.get(event.id);
        if (!note) {
          throw new Error(`Prepared MIDI event ${event.id} is missing`);
        }
        voice.triggerAttackRelease(
          midiPitchToInstrumentNoteName(midi.instrumentId, note.pitch),
          beatsToSeconds(note.lengthBeats, bpm),
          audioTime,
          midiVelocityToGain(note.velocity),
        );
      },
      releaseAll(audioTime) {
        if (voice.releaseAll) {
          voice.releaseAll(audioTime);
        } else {
          voice.triggerRelease?.(audioTime);
        }
      },
      dispose(audioTime) {
        if (disposed) return;
        if (audioTime === undefined) {
          disposeVoiceNow();
          return;
        }
        if (disposeTimer !== null) return;
        const delayMs = Math.max(0, (audioTime - (tone.now?.() ?? audioTime)) * 1_000) + 20;
        disposeTimer = setTimeout(() => {
          disposeTimer = null;
          disposeVoiceNow();
        }, delayMs);
      },
    };
    return prepared;
  };
}

async function loadToneModule(): Promise<ToneModuleLike> {
  try {
    return (await import("tone")) as unknown as ToneModuleLike;
  } catch (cause) {
    throw new LiveAudioEngineFault({
      code: "tone_unavailable",
      message: "Tone.js is required to start the live browser audio engine",
      cause,
    });
  }
}

function resolveTransport(tone: ToneModuleLike): ToneTransportLike {
  const transport = tone.getTransport?.() ?? tone.Transport;
  if (!transport) {
    throw new LiveAudioEngineFault({
      code: "tone_unavailable",
      message: "Tone.js transport is unavailable",
    });
  }
  return transport;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return value;
}
