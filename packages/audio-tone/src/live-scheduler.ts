import type { BuiltInInstrumentId } from "@beat-twin/core";

export type LiveClipMaterial = {
  /** Open adapter key. Only `midi` is implemented in this tranche. */
  readonly kind: string;
  /** Stable identity of the prepared content, independent from a launcher slot. */
  readonly materialId: string;
  /** Deterministic numeric hash of adapter-defined audible content. */
  readonly version: number;
  readonly clipId: string;
  readonly lengthBeats: number;
};

export type LiveMidiNote = {
  readonly id: string;
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
};

export type LiveMidiClipMaterial = LiveClipMaterial & {
  readonly kind: "midi";
  readonly instrumentId: BuiltInInstrumentId;
  readonly notes: readonly LiveMidiNote[];
};

export type LivePreparedEvent = {
  readonly id: string;
  readonly startBeat: number;
  readonly durationBeats: number;
};

export type LiveLoopOccurrence = {
  readonly id: string;
  readonly eventId: string;
  readonly cycle: number;
  readonly startBeat: number;
  readonly durationBeats: number;
};

export function validateLiveClipMaterial(material: LiveClipMaterial): void {
  identifier(material.kind, "material kind");
  identifier(material.materialId, "materialId");
  nonNegativeInteger(material.version, "material version");
  identifier(material.clipId, "clipId");
  positiveFinite(material.lengthBeats, "material lengthBeats");
}

export function validateLiveMidiClipMaterial(material: LiveMidiClipMaterial): void {
  validateLiveClipMaterial(material);
  if (material.kind !== "midi") {
    throw new Error(`unsupported MIDI material kind ${String(material.kind)}`);
  }
  const noteIds = new Set<string>();
  for (const note of material.notes) {
    identifier(note.id, "note id");
    if (noteIds.has(note.id)) {
      throw new Error(`material contains duplicate note id ${note.id}`);
    }
    noteIds.add(note.id);
    midiValue(note.pitch, "note pitch");
    midiValue(note.velocity, "note velocity");
    validatePreparedEvent(
      {
        id: note.id,
        startBeat: note.startBeat,
        durationBeats: note.lengthBeats,
      },
      material.lengthBeats,
    );
  }
}

export function midiMaterialEvents(
  material: LiveMidiClipMaterial,
): readonly LivePreparedEvent[] {
  validateLiveMidiClipMaterial(material);
  return Object.freeze(
    material.notes.map((note) =>
      Object.freeze({
        id: note.id,
        startBeat: note.startBeat,
        durationBeats: note.lengthBeats,
      }),
    ),
  );
}

/**
 * Pure finite-window planner used by tests and by future look-ahead adapters.
 * The runtime engine may schedule recursively, but both paths share these
 * validation and cycle semantics.
 */
export function planLiveLoopOccurrences(input: {
  readonly materialId: string;
  readonly lengthBeats: number;
  readonly activationBeat: number;
  readonly windowStartBeat: number;
  readonly windowEndBeat: number;
  readonly events: readonly LivePreparedEvent[];
}): readonly LiveLoopOccurrence[] {
  const materialId = requiredId(input.materialId, "materialId");
  const lengthBeats = positiveFinite(input.lengthBeats, "lengthBeats");
  const activationBeat = nonNegativeFinite(input.activationBeat, "activationBeat");
  const windowStartBeat = nonNegativeFinite(input.windowStartBeat, "windowStartBeat");
  const windowEndBeat = nonNegativeFinite(input.windowEndBeat, "windowEndBeat");
  if (windowEndBeat < windowStartBeat) {
    throw new Error("windowEndBeat must be greater than or equal to windowStartBeat");
  }

  const eventIds = new Set<string>();
  for (const event of input.events) {
    validatePreparedEvent(event, lengthBeats);
    if (eventIds.has(event.id)) {
      throw new Error(`prepared material contains duplicate event id ${event.id}`);
    }
    eventIds.add(event.id);
  }

  const firstCycle = Math.max(
    0,
    Math.floor((windowStartBeat - activationBeat) / lengthBeats),
  );
  const occurrences: LiveLoopOccurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const cycleBeat = activationBeat + cycle * lengthBeats;
    if (cycleBeat >= windowEndBeat) {
      break;
    }
    for (const event of input.events) {
      const startBeat = cycleBeat + event.startBeat;
      if (startBeat < windowStartBeat || startBeat >= windowEndBeat) {
        continue;
      }
      occurrences.push(
        Object.freeze({
          id: `${materialId}:${event.id}:${cycle}`,
          eventId: event.id,
          cycle,
          startBeat,
          durationBeats: event.durationBeats,
        }),
      );
    }
  }

  occurrences.sort((left, right) =>
    left.startBeat === right.startBeat
      ? left.id.localeCompare(right.id)
      : left.startBeat - right.startBeat,
  );
  return Object.freeze(occurrences);
}

function validatePreparedEvent(event: LivePreparedEvent, lengthBeats: number): void {
  identifier(event.id, "event id");
  const startBeat = nonNegativeFinite(event.startBeat, "event startBeat");
  const durationBeats = positiveFinite(event.durationBeats, "event durationBeats");
  if (startBeat >= lengthBeats) {
    throw new Error(`event ${event.id} starts outside material length ${lengthBeats}`);
  }
  if (startBeat + durationBeats > lengthBeats) {
    throw new Error(`event ${event.id} extends beyond material length ${lengthBeats}`);
  }
}

function midiValue(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new Error(`${label} must be an integer from 0 to 127`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return number;
}

function nonNegativeFinite(value: number, label: string): number {
  const number = finite(value, label);
  if (number < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function requiredId(value: string, label: string): string {
  identifier(value, label);
  return value;
}

function identifier(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
}
