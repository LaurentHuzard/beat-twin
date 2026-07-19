import { describe, expect, it, vi } from "vitest";

import { connectWebMidi, normalizeWebMidiMessage } from "./webMidiInput";

describe("optional Web MIDI input", () => {
  it("normalizes note-on, note-off, velocity-zero, and ignores other messages", () => {
    expect(normalizeWebMidiMessage("device-a", new Uint8Array([0x92, 64, 99])))
      .toEqual({ type: "noteon", sourceId: "device-a", channel: 2, pitch: 64, velocity: 99 });
    expect(normalizeWebMidiMessage("device-a", new Uint8Array([0x82, 64, 17])))
      .toEqual({ type: "noteoff", sourceId: "device-a", channel: 2, pitch: 64, velocity: 0 });
    expect(normalizeWebMidiMessage("device-a", new Uint8Array([0x92, 64, 0])))
      .toEqual({ type: "noteoff", sourceId: "device-a", channel: 2, pitch: 64, velocity: 0 });
    expect(normalizeWebMidiMessage("device-a", new Uint8Array([0xb2, 64, 99]))).toBeNull();
  });

  it("keeps connection ownership bounded and reports device disconnect", async () => {
    const port = {
      id: "device-a",
      type: "input",
      state: "connected",
      onmidimessage: null as ((event: { data?: Uint8Array }) => void) | null,
    };
    const access = {
      inputs: { forEach: (callback: (input: typeof port) => void) => callback(port) },
      onstatechange: null as ((event: { port: typeof port }) => void) | null,
    };
    const requestMIDIAccess = vi.fn(async () => access);
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: requestMIDIAccess,
    });
    const onEvent = vi.fn();
    const onDisconnect = vi.fn();

    const connection = await connectWebMidi({ onEvent, onDisconnect });
    port.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) });
    expect(onEvent).toHaveBeenCalledWith({
      type: "noteon",
      sourceId: "device-a",
      channel: 0,
      pitch: 60,
      velocity: 100,
    });

    const replacement = {
      ...port,
      state: "connected",
      onmidimessage: null as ((event: { data?: Uint8Array }) => void) | null,
    };
    access.onstatechange?.({ port: replacement });
    expect(port.onmidimessage).toBeNull();
    replacement.onmidimessage?.({ data: new Uint8Array([0x91, 62, 90]) });
    expect(onEvent).toHaveBeenLastCalledWith({
      type: "noteon",
      sourceId: "device-a",
      channel: 1,
      pitch: 62,
      velocity: 90,
    });

    replacement.state = "disconnected";
    access.onstatechange?.({ port: replacement });
    expect(onDisconnect).toHaveBeenCalledWith("device-a");
    expect(replacement.onmidimessage).toBeNull();

    connection.close();
    expect(access.onstatechange).toBeNull();
    Reflect.deleteProperty(navigator, "requestMIDIAccess");
  });

  it("reports unsupported browsers without affecting keyboard input", async () => {
    Reflect.deleteProperty(navigator, "requestMIDIAccess");
    await expect(connectWebMidi({ onEvent: vi.fn(), onDisconnect: vi.fn() }))
      .rejects.toThrow(/not supported/);
  });

  it("surfaces permission denial as a bounded connection failure", async () => {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: vi.fn(async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      }),
    });

    await expect(connectWebMidi({ onEvent: vi.fn(), onDisconnect: vi.fn() }))
      .rejects.toThrow(/Permission denied/);
    Reflect.deleteProperty(navigator, "requestMIDIAccess");
  });
});
