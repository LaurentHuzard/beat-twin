import { midiPitchToNoteName } from "@beat-twin/audio-tone";

import {
  LIVE_PROTOTYPE_BPM,
  type PrototypeObservation,
  type PrototypeTrackId,
} from "./livePrototypeModel";

export type LivePrototypeAudioEngine = {
  readonly setTrackState: (
    trackId: PrototypeTrackId,
    observation: PrototypeObservation,
  ) => void;
  readonly stop: () => void;
};

export type LivePrototypeAudioEngineFactory = () => Promise<LivePrototypeAudioEngine>;

export async function createLivePrototypeAudioEngine(): Promise<LivePrototypeAudioEngine> {
  const tone = await import("tone");
  await tone.start();

  const transport = tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.bpm.value = LIVE_PROTOTYPE_BPM;

  const pulseSynth = new tone.MembraneSynth().toDestination();
  const glassSynth = new tone.FMSynth().toDestination();
  pulseSynth.volume.value = -8;
  glassSynth.volume.value = -15;

  const trackState: Partial<Record<PrototypeTrackId, PrototypeObservation>> = {};
  let step = 0;
  const loop = new tone.Loop((time) => {
    triggerStep(pulseSynth, trackState.pulse, step, time, "16n", 0.78);
    triggerStep(glassSynth, trackState.glass, step, time, "8n", 0.42);
    step += 1;
  }, "8n").start(0);

  transport.start();

  return {
    setTrackState(trackId, observation) {
      trackState[trackId] = observation;
    },
    stop() {
      loop.stop();
      loop.dispose();
      transport.stop();
      transport.cancel(0);
      pulseSynth.dispose();
      glassSynth.dispose();
    },
  };
}

type TriggerSynth = {
  readonly triggerAttackRelease: (
    note: string,
    duration: string,
    time: number,
    velocity: number,
  ) => void;
};

function triggerStep(
  synth: TriggerSynth,
  observation: PrototypeObservation | undefined,
  step: number,
  time: number,
  duration: string,
  velocity: number,
): void {
  if (!observation?.sourceId || observation.pattern.length === 0) {
    return;
  }
  const pitch = observation.pattern[step % observation.pattern.length];
  if (pitch !== null && pitch !== undefined) {
    synth.triggerAttackRelease(midiPitchToNoteName(pitch), duration, time, velocity);
  }
}
