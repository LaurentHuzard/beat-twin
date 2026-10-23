import { midiPitchToNoteName, midiVelocityToGain } from "@beat-twin/audio-tone";

import {
  acquireBrowserAudioLease,
  type BrowserAudioLeaseAcquirer,
} from "./browserAudioRuntime";
import type { NanoJamNotePort } from "./remoteJamMidiSink";

type ToneVoice = {
  connect(node: unknown): unknown;
  triggerAttack(note: string, time?: number, velocity?: number): void;
  triggerRelease(note: string, time?: number): void;
  releaseAll(time?: number): void;
  dispose(): void;
};
type ToneGain = {
  toDestination(): unknown;
  dispose(): void;
};
export type NanoJamToneModule = {
  start(): Promise<void>;
  now(): number;
  Synth: new (options?: unknown) => unknown;
  PolySynth: new (instrument: unknown, options?: unknown) => ToneVoice;
  Gain: new (gain?: number) => ToneGain;
};

export type NanoJamSoundPort = NanoJamNotePort & Readonly<{ dispose(): void }>;

/**
 * Sound is unlocked ONLY after a human-initiated browser action. This is an
 * independent voice; it does not start, pause or reset NanoDAW's Tone transport.
 */
export async function createNanoDawToneRemoteJamPort(
  options: Readonly<{ tone?: NanoJamToneModule }> = {},
): Promise<NanoJamSoundPort> {
  const tone = options.tone ?? await loadTone();
  await tone.start();

  const gain = new tone.Gain(0.18);
  let voice: ToneVoice | null = null;
  try {
    gain.toDestination();
    voice = new tone.PolySynth(tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.008, decay: 0.16, sustain: 0.55, release: 0.18 },
      maxPolyphony: 32,
    });
    voice.connect(gain);
  } catch (error) {
    voice?.dispose();
    gain.dispose();
    throw error;
  }

  const synth = voice;
  let disposed = false;
  function requireActive(): void {
    if (disposed) throw new Error("remote jam voice disposed");
  }
  return Object.freeze({
    noteOn(pitch: number, velocity: number): void {
      requireActive();
      synth.triggerAttack(midiPitchToNoteName(pitch), tone.now(), midiVelocityToGain(velocity));
    },
    noteOff(pitch: number): void {
      requireActive();
      synth.triggerRelease(midiPitchToNoteName(pitch), tone.now());
    },
    panic(): void {
      requireActive();
      synth.releaseAll(tone.now());
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try { synth.releaseAll(tone.now()); }
      finally {
        try { synth.dispose(); }
        finally { gain.dispose(); }
      }
    },
  });
}

/**
 * Live Jam owns the browser audio lease for the session. Existing NanoDAW
 * preview, song playback and live-launcher modes remain mutually exclusive.
 */
export async function acquireNanoDawRemoteJamAudio(
  acquire: BrowserAudioLeaseAcquirer = acquireBrowserAudioLease,
  createSoundPort: () => Promise<NanoJamSoundPort> = () => createNanoDawToneRemoteJamPort(),
): Promise<NanoJamSoundPort> {
  const lease = await acquire("remote-jam");
  let port: NanoJamSoundPort;
  try { port = await createSoundPort(); }
  catch (error) { lease.release(); throw error; }
  let released = false;
  return Object.freeze({
    noteOn: (pitch: number, velocity: number) => port.noteOn(pitch, velocity),
    noteOff: (pitch: number) => port.noteOff(pitch),
    panic: () => port.panic(),
    dispose() {
      if (released) return;
      released = true;
      try { port.dispose(); } finally { lease.release(); }
    },
  });
}

async function loadTone(): Promise<NanoJamToneModule> {
  return await import("tone") as unknown as NanoJamToneModule;
}
