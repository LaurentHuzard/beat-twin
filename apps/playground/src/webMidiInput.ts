export type NormalizedMidiInputEvent = Readonly<{
  type: "noteon" | "noteoff";
  sourceId: string;
  channel: number;
  pitch: number;
  velocity: number;
}>;

export type WebMidiConnection = Readonly<{
  deviceCount: number;
  close: () => void;
}>;

type MidiMessageEventLike = Readonly<{
  data?: Uint8Array;
}>;

type MidiPortLike = {
  readonly id: string;
  readonly type: string;
  readonly state: string;
  onmidimessage: ((event: MidiMessageEventLike) => void) | null;
};

type MidiAccessLike = {
  readonly inputs: Readonly<{
    forEach: (callback: (input: MidiPortLike) => void) => void;
  }>;
  onstatechange: ((event: Readonly<{ port: MidiPortLike }>) => void) | null;
};

type MidiNavigator = Navigator & {
  requestMIDIAccess?: () => Promise<MidiAccessLike>;
};

export async function connectWebMidi(input: {
  readonly onEvent: (event: NormalizedMidiInputEvent) => void;
  readonly onDisconnect: (sourceId: string) => void;
}): Promise<WebMidiConnection> {
  const requestMIDIAccess = (navigator as MidiNavigator).requestMIDIAccess;
  if (!requestMIDIAccess) {
    throw new Error("Web MIDI is not supported by this browser.");
  }

  const access = await requestMIDIAccess.call(navigator);
  const connectedInputs = new Map<string, MidiPortLike>();

  const attach = (port: MidiPortLike) => {
    if (port.type !== "input" || port.state === "disconnected") return;
    const existing = connectedInputs.get(port.id);
    if (existing && existing !== port) existing.onmidimessage = null;
    connectedInputs.set(port.id, port);
    port.onmidimessage = (event) => {
      const normalized = normalizeWebMidiMessage(port.id, event.data);
      if (normalized) input.onEvent(normalized);
    };
  };

  access.inputs.forEach(attach);
  access.onstatechange = ({ port }) => {
    if (port.type !== "input") return;
    if (port.state === "disconnected") {
      const existing = connectedInputs.get(port.id);
      if (existing) existing.onmidimessage = null;
      connectedInputs.delete(port.id);
      input.onDisconnect(port.id);
      return;
    }
    attach(port);
  };

  return Object.freeze({
    deviceCount: connectedInputs.size,
    close: () => {
      access.onstatechange = null;
      for (const port of connectedInputs.values()) port.onmidimessage = null;
      connectedInputs.clear();
    },
  });
}

export function normalizeWebMidiMessage(
  sourceIdInput: string,
  data: Uint8Array | undefined,
): NormalizedMidiInputEvent | null {
  const sourceId = sourceIdInput.trim();
  if (!sourceId || !data || data.length < 3) return null;
  const status = data[0]!;
  const messageType = status & 0xf0;
  const channel = status & 0x0f;
  const pitch = data[1]!;
  const velocity = data[2]!;
  if (pitch > 127 || velocity > 127) return null;
  if (messageType === 0x90 && velocity > 0) {
    return Object.freeze({ type: "noteon", sourceId, channel, pitch, velocity });
  }
  if (messageType === 0x80 || (messageType === 0x90 && velocity === 0)) {
    return Object.freeze({ type: "noteoff", sourceId, channel, pitch, velocity: 0 });
  }
  return null;
}
