export const LIVE_PROTOTYPE_BPM = 112;
export const LIVE_PROTOTYPE_BEATS_PER_BAR = 4;

export type PrototypeTrackId = "pulse" | "glass";

export type PrototypeAction =
  | { readonly kind: "activate"; readonly sourceId: string }
  | { readonly kind: "stop" }
  | {
      readonly kind: "transform";
      readonly operation: "transpose" | "rotate" | "restore";
    };

export type PrototypeObservation = {
  readonly sourceId: string | null;
  readonly variation: string;
  readonly pattern: readonly (number | null)[];
};

export type PrototypeSource = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly pattern: readonly (number | null)[];
};

export type PrototypeTrack = {
  readonly id: PrototypeTrackId;
  readonly name: string;
  readonly role: string;
  readonly color: string;
  readonly sources: readonly [PrototypeSource, PrototypeSource];
};

const pulseAnchor = [36, null, 36, 43, 36, null, 39, 43] as const;
const glassAnchor = [60, 67, 63, 67, 60, 67, 70, 67] as const;

export const LIVE_PROTOTYPE_TRACKS: readonly [PrototypeTrack, PrototypeTrack] = [
  {
    id: "pulse",
    name: "Pulse",
    role: "Low voice",
    color: "#d85b40",
    sources: [
      {
        id: "pulse-anchor",
        label: "Anchor",
        detail: "Root pattern",
        pattern: pulseAnchor,
      },
      {
        id: "pulse-turn",
        label: "Lift",
        detail: "+5 semitones",
        pattern: transposePattern(pulseAnchor, 5),
      },
    ],
  },
  {
    id: "glass",
    name: "Glass",
    role: "High voice",
    color: "#2d7f73",
    sources: [
      {
        id: "glass-anchor",
        label: "Anchor",
        detail: "Root pattern",
        pattern: glassAnchor,
      },
      {
        id: "glass-turn",
        label: "Turn",
        detail: "Rotate two steps",
        pattern: rotatePattern(glassAnchor, 2),
      },
    ],
  },
];

export function applyPrototypeAction(
  trackId: PrototypeTrackId,
  action: PrototypeAction,
  current: PrototypeObservation | undefined,
): PrototypeObservation {
  const track = requireTrack(trackId);
  if (action.kind === "stop") {
    return {
      sourceId: null,
      variation: "Stopped",
      pattern: [],
    };
  }

  if (action.kind === "activate") {
    const source = track.sources.find((candidate) => candidate.id === action.sourceId);
    if (!source) {
      throw new Error(`source ${action.sourceId} does not belong to track ${trackId}`);
    }
    return {
      sourceId: source.id,
      variation: source.label,
      pattern: source.pattern,
    };
  }

  const anchor = track.sources[0];
  const base = current?.sourceId ? current : applyPrototypeAction(
    trackId,
    { kind: "activate", sourceId: anchor.id },
    undefined,
  );

  switch (action.operation) {
    case "transpose":
      return {
        ...base,
        variation: "+5",
        pattern: transposePattern(base.pattern, 5),
      };
    case "rotate":
      return {
        ...base,
        variation: "Rotated",
        pattern: rotatePattern(base.pattern, 2),
      };
    case "restore":
      return {
        sourceId: anchor.id,
        variation: "Anchor",
        pattern: anchor.pattern,
      };
  }
}

export function describePrototypeAction(
  trackId: PrototypeTrackId,
  action: PrototypeAction,
): string {
  if (action.kind === "stop") {
    return "Stop";
  }
  if (action.kind === "transform") {
    return {
      transpose: "Transpose +5",
      rotate: "Rotate",
      restore: "Restore anchor",
    }[action.operation];
  }
  const track = requireTrack(trackId);
  return track.sources.find((source) => source.id === action.sourceId)?.label ?? action.sourceId;
}

function requireTrack(trackId: PrototypeTrackId): PrototypeTrack {
  const track = LIVE_PROTOTYPE_TRACKS.find((candidate) => candidate.id === trackId);
  if (!track) {
    throw new Error(`unknown prototype track ${trackId}`);
  }
  return track;
}

function transposePattern(
  pattern: readonly (number | null)[],
  semitones: number,
): readonly (number | null)[] {
  return pattern.map((pitch) => (pitch === null ? null : pitch + semitones));
}

function rotatePattern(
  pattern: readonly (number | null)[],
  steps: number,
): readonly (number | null)[] {
  if (pattern.length === 0) {
    return pattern;
  }
  const offset = ((steps % pattern.length) + pattern.length) % pattern.length;
  return [...pattern.slice(offset), ...pattern.slice(0, offset)];
}
