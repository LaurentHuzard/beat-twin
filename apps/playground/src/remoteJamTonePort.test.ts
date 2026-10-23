import { describe, expect, it, vi } from "vitest";
import {
  acquireNanoDawRemoteJamAudio,
  createNanoDawToneRemoteJamPort,
  type NanoJamToneModule,
} from "./remoteJamTonePort";

function toneHarness() {
  const calls: unknown[][] = [];
  const tone: NanoJamToneModule = {
    start: vi.fn(async () => { calls.push(["unlock"]); }),
    now: () => 42.125,
    Synth: class Synth {},
    PolySynth: class PolySynth {
      constructor() { calls.push(["create-synth"]); }
      connect(node: unknown) { calls.push(["connect", Boolean(node)]); }
      triggerAttack(note: string, time?: number, velocity?: number) {
        calls.push(["attack", note, time, velocity]);
      }
      triggerRelease(note: string, time?: number) { calls.push(["release", note, time]); }
      releaseAll(time?: number) { calls.push(["panic", time]); }
      dispose() { calls.push(["dispose-synth"]); }
    },
    Gain: class Gain {
      constructor(gain?: number) { calls.push(["create-gain", gain]); }
      toDestination() { calls.push(["connect-to-speakers"]); }
      dispose() { calls.push(["dispose-gain"]); }
    },
  };
  return { tone, calls };
}

describe("NanoDAW Remote Jam Tone voice", () => {
  it("unlocks after operator action, plays note on/off without touching Tone transport", async () => {
    const h = toneHarness();
    const port = await createNanoDawToneRemoteJamPort({ tone: h.tone });
    port.noteOn(60, 127);
    port.noteOff(60);
    port.panic();
    expect(h.calls).toContainEqual(["unlock"]);
    expect(h.calls).toContainEqual(["attack", "C4", 42.125, 1]);
    expect(h.calls).toContainEqual(["release", "C4", 42.125]);
    expect(h.calls).toContainEqual(["panic", 42.125]);
    expect(h.calls).toContainEqual(["create-gain", 0.18]);
    port.dispose();
    port.dispose();
    expect(h.calls.filter((call) => call[0] === "dispose-synth")).toHaveLength(1);
    expect(h.calls.filter((call) => call[0] === "dispose-gain")).toHaveLength(1);
    expect(() => port.noteOn(60, 80)).toThrow(/disposed/);
  });

  it("owns and releases the exclusive browser audio lease, even on failure", async () => {
    const h = toneHarness();
    const port = await createNanoDawToneRemoteJamPort({ tone: h.tone });
    const release = vi.fn();
    const acquire = vi.fn(async (owner: "remote-jam" | "preview" | "live" | "song" | "browser-smoke") => ({
      owner, engine: null as never, release,
    }));
    const controlled = await acquireNanoDawRemoteJamAudio(acquire, async () => port);
    expect(acquire).toHaveBeenCalledWith("remote-jam");
    controlled.noteOn(72, 90);
    controlled.dispose();
    controlled.dispose();
    expect(release).toHaveBeenCalledOnce();

    const failedRelease = vi.fn();
    const failedAcquire = async () => ({
      owner: "remote-jam" as const, engine: null as never, release: failedRelease,
    });
    await expect(acquireNanoDawRemoteJamAudio(failedAcquire, async () => {
      throw new Error("unlock denied");
    })).rejects.toThrow(/unlock denied/);
    expect(failedRelease).toHaveBeenCalledOnce();
  });
});
