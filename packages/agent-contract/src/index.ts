import type {
  CommandSnapshot,
  ExecutableBeatTwinCommand,
} from "@beat-twin/commands";

export type { ExecutableBeatTwinCommand };

export const SONG_PATCH_SCHEMA_VERSION = 1 as const;
export const SONG_PATCH_QUANTIZATION_BEATS = 0.25 as const;

export type SongPatchNoteV1 = {
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
};

export type SongPatchClipV1 = {
  readonly name: string;
  readonly lengthBeats: number;
  readonly notes: readonly SongPatchNoteV1[];
};

export type SongPatchInstrumentTrackV1 = {
  readonly kind: "instrument";
  readonly name: string;
  readonly clip: SongPatchClipV1;
};

export type SongPatchV1 = {
  readonly schemaVersion: typeof SONG_PATCH_SCHEMA_VERSION;
  readonly tempoBpm?: number;
  readonly track: SongPatchInstrumentTrackV1;
};

export type SongPatchValidationIssue = {
  readonly path: string;
  readonly code:
    | "invalid_type"
    | "unknown_field"
    | "missing_field"
    | "out_of_range"
    | "not_quantized"
    | "note_outside_clip";
  readonly message: string;
};

export type SongPatchValidationResult =
  | { readonly ok: true; readonly value: SongPatchV1 }
  | { readonly ok: false; readonly issues: readonly SongPatchValidationIssue[] };

export class SongPatchValidationError extends TypeError {
  readonly issues: readonly SongPatchValidationIssue[];

  constructor(issues: readonly SongPatchValidationIssue[]) {
    const firstIssue = issues[0];
    super(firstIssue ? `${firstIssue.path}: ${firstIssue.message}` : "Invalid SongPatchV1");
    this.name = "SongPatchValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

export type SongPatchExecutableIds = {
  readonly songId: string;
  readonly trackId: string;
  readonly clipId: string;
  readonly noteIds: readonly string[];
};

export type SongPatchCompileOptions = {
  /** A gateway-owned seed such as a request ID. The model never supplies it. */
  readonly idSeed?: string;
  /** Fully materialized gateway/adapter IDs. Partial ID injection is rejected. */
  readonly ids?: SongPatchExecutableIds;
  /** The inspected target snapshot. Missing or null song means CreateSong is required. */
  readonly snapshot?: CommandSnapshot;
};

export type SongPatchPreviewDiff = {
  readonly tempoBpm: {
    readonly before: number | null;
    readonly after: number | null;
    readonly changed: boolean;
  };
  readonly instrumentTracks: {
    readonly before: number;
    readonly after: number;
    readonly added: 1;
  };
  readonly clipsAdded: 1;
  readonly notesAdded: number;
  readonly clipLengthBeats: number;
  readonly pitchRange: {
    readonly min: number;
    readonly max: number;
  };
};

export type SongPatchPreview = {
  readonly baseRevision: number;
  readonly commands: readonly ExecutableBeatTwinCommand[];
  readonly diff: SongPatchPreviewDiff;
  readonly summary: readonly string[];
};

export type SongPatchPreviewOptions = SongPatchCompileOptions;

type MutableIssue = {
  path: string;
  code: SongPatchValidationIssue["code"];
  message: string;
};

const ROOT_FIELDS = new Set(["schemaVersion", "tempoBpm", "track"]);
const TRACK_FIELDS = new Set(["kind", "name", "clip"]);
const CLIP_FIELDS = new Set(["name", "lengthBeats", "notes"]);
const NOTE_FIELDS = new Set(["pitch", "velocity", "startBeat", "lengthBeats"]);

export const SONG_PATCH_V1_JSON_SCHEMA = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://beat-twin.local/schemas/song-patch-v1.json",
  title: "SongPatchV1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "track"],
  properties: {
    schemaVersion: { const: SONG_PATCH_SCHEMA_VERSION },
    tempoBpm: { type: "number", minimum: 40, maximum: 240 },
    track: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "name", "clip"],
      properties: {
        kind: { const: "instrument" },
        name: { type: "string", minLength: 1, maxLength: 64 },
        clip: {
          type: "object",
          additionalProperties: false,
          required: ["name", "lengthBeats", "notes"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 64 },
            lengthBeats: { type: "number", minimum: 1, maximum: 16 },
            notes: {
              type: "array",
              minItems: 1,
              maxItems: 16,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["pitch", "velocity", "startBeat", "lengthBeats"],
                properties: {
                  pitch: { type: "integer", minimum: 0, maximum: 127 },
                  velocity: { type: "integer", minimum: 1, maximum: 127 },
                  startBeat: { type: "number", minimum: 0, multipleOf: 0.25 },
                  lengthBeats: {
                    type: "number",
                    exclusiveMinimum: 0,
                    multipleOf: 0.25,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const);

/**
 * Parses an untrusted model/tool payload. Unknown fields are rejected at every
 * nesting level and a detached, deeply frozen value is returned on success.
 */
export function safeValidateSongPatchV1(value: unknown): SongPatchValidationResult {
  const issues: MutableIssue[] = [];

  if (!isPlainRecord(value)) {
    return validationFailure(issue("$", "invalid_type", "must be an object"));
  }

  rejectUnknownFields(value, ROOT_FIELDS, "$", issues);
  requireFields(value, ["schemaVersion", "track"], "$", issues);

  if (value.schemaVersion !== SONG_PATCH_SCHEMA_VERSION) {
    issues.push(issue("$.schemaVersion", "out_of_range", "must equal 1"));
  }

  let tempoBpm: number | undefined;
  if (value.tempoBpm !== undefined) {
    tempoBpm = boundedFiniteNumber(value.tempoBpm, 40, 240, "$.tempoBpm", issues);
  }

  const track = parseTrack(value.track, issues);

  if (issues.length > 0 || !track) {
    return validationFailure(...issues);
  }

  const patch: SongPatchV1 = {
    schemaVersion: SONG_PATCH_SCHEMA_VERSION,
    ...(tempoBpm === undefined ? {} : { tempoBpm }),
    track,
  };

  return Object.freeze({ ok: true, value: deepFreeze(patch) });
}

/** Throws SongPatchValidationError when an untrusted payload is invalid. */
export function validateSongPatchV1(value: unknown): SongPatchV1 {
  const result = safeValidateSongPatchV1(value);
  if (!result.ok) {
    throw new SongPatchValidationError(result.issues);
  }
  return result.value;
}

/** Materializes every command ID before preview or execution. */
export function materializeSongPatchIds(
  value: unknown,
  options: SongPatchCompileOptions = {},
): SongPatchExecutableIds {
  const patch = validateSongPatchV1(value);

  if (options.ids !== undefined) {
    return validateInjectedIds(options.ids, patch.track.clip.notes.length);
  }

  const seed = options.idSeed ?? "song-patch-v1";
  if (typeof seed !== "string" || seed.trim().length === 0) {
    throw new TypeError("idSeed must be a non-empty string");
  }

  const digest = fnv1a64(`${seed}\u0000${JSON.stringify(patch)}`);
  const prefix = `btsp-${digest}`;

  return deepFreeze({
    songId: `${prefix}-song`,
    trackId: `${prefix}-track`,
    clipId: `${prefix}-clip`,
    noteIds: patch.track.clip.notes.map((_, index) => `${prefix}-note-${index + 1}`),
  });
}

/**
 * Deterministically compiles a validated patch into the portable command
 * boundary. It never executes commands or reads/mutates a DAW session.
 */
export function compileSongPatchV1(
  value: unknown,
  options: SongPatchCompileOptions = {},
): readonly ExecutableBeatTwinCommand[] {
  const patch = validateSongPatchV1(value);
  const ids = materializeSongPatchIds(patch, options);
  const commands: ExecutableBeatTwinCommand[] = [];
  const hasSong = options.snapshot?.song !== null && options.snapshot?.song !== undefined;

  if (!hasSong) {
    commands.push({
      type: "CreateSong",
      id: ids.songId,
      title: patch.track.name,
      ...(patch.tempoBpm === undefined ? {} : { bpm: patch.tempoBpm }),
    });
  } else if (patch.tempoBpm !== undefined) {
    commands.push({ type: "SetTempo", bpm: patch.tempoBpm });
  }

  commands.push({
    type: "CreateTrack",
    id: ids.trackId,
    name: patch.track.name,
    kind: "instrument",
  });
  commands.push({
    type: "CreateClip",
    id: ids.clipId,
    trackId: ids.trackId,
    name: patch.track.clip.name,
    startBeat: 0,
    lengthBeats: patch.track.clip.lengthBeats,
  });

  patch.track.clip.notes.forEach((note, index) => {
    commands.push({
      type: "AddNote",
      id: ids.noteIds[index]!,
      trackId: ids.trackId,
      clipId: ids.clipId,
      pitch: note.pitch,
      velocity: note.velocity,
      startBeat: note.startBeat,
      lengthBeats: note.lengthBeats,
    });
  });

  return deepFreeze(commands);
}

/** Builds a deterministic, human-readable diff without executing the batch. */
export function previewSongPatchV1(
  value: unknown,
  options: SongPatchPreviewOptions = {},
): SongPatchPreview {
  const patch = validateSongPatchV1(value);
  const commands = compileSongPatchV1(patch, options);
  const snapshot = options.snapshot;
  const song = snapshot?.song ?? null;
  const beforeTempo = song?.transport.bpm ?? null;
  const afterTempo = patch.tempoBpm ?? beforeTempo ?? 120;
  const tracksBefore = song?.tracks.filter((track) => track.kind === "instrument").length ?? 0;
  const pitches = patch.track.clip.notes.map((note) => note.pitch);

  const diff: SongPatchPreviewDiff = deepFreeze({
    tempoBpm: {
      before: beforeTempo,
      after: afterTempo,
      changed: afterTempo !== beforeTempo,
    },
    instrumentTracks: {
      before: tracksBefore,
      after: tracksBefore + 1,
      added: 1,
    },
    clipsAdded: 1,
    notesAdded: patch.track.clip.notes.length,
    clipLengthBeats: patch.track.clip.lengthBeats,
    pitchRange: {
      min: Math.min(...pitches),
      max: Math.max(...pitches),
    },
  });

  const summary = [
    ...(song === null ? [`Create song "${patch.track.name}"`] : []),
    ...(patch.tempoBpm === undefined
      ? []
      : [`Tempo: ${beforeTempo === null ? "unset" : beforeTempo} -> ${patch.tempoBpm} BPM`]),
    `Add instrument track \"${patch.track.name}\"`,
    `Add clip \"${patch.track.clip.name}\" (${patch.track.clip.lengthBeats} beats)`,
    `Add ${patch.track.clip.notes.length} note${patch.track.clip.notes.length === 1 ? "" : "s"}`,
  ];

  return deepFreeze({
    baseRevision: snapshot?.revision ?? 0,
    commands,
    diff,
    summary,
  });
}

function parseTrack(
  value: unknown,
  issues: MutableIssue[],
): SongPatchInstrumentTrackV1 | undefined {
  if (!isPlainRecord(value)) {
    issues.push(issue("$.track", "invalid_type", "must be an object"));
    return undefined;
  }

  rejectUnknownFields(value, TRACK_FIELDS, "$.track", issues);
  requireFields(value, ["kind", "name", "clip"], "$.track", issues);

  if (value.kind !== "instrument") {
    issues.push(issue("$.track.kind", "out_of_range", 'must equal "instrument"'));
  }

  const name = boundedName(value.name, "$.track.name", issues);
  const clip = parseClip(value.clip, issues);
  if (value.kind !== "instrument" || name === undefined || !clip) {
    return undefined;
  }

  return deepFreeze({ kind: "instrument", name, clip });
}

function parseClip(value: unknown, issues: MutableIssue[]): SongPatchClipV1 | undefined {
  if (!isPlainRecord(value)) {
    issues.push(issue("$.track.clip", "invalid_type", "must be an object"));
    return undefined;
  }

  rejectUnknownFields(value, CLIP_FIELDS, "$.track.clip", issues);
  requireFields(value, ["name", "lengthBeats", "notes"], "$.track.clip", issues);

  const name = boundedName(value.name, "$.track.clip.name", issues);
  const lengthBeats = boundedFiniteNumber(
    value.lengthBeats,
    1,
    16,
    "$.track.clip.lengthBeats",
    issues,
  );

  if (!Array.isArray(value.notes)) {
    issues.push(issue("$.track.clip.notes", "invalid_type", "must be an array"));
    return undefined;
  }

  if (value.notes.length < 1 || value.notes.length > 16) {
    issues.push(
      issue("$.track.clip.notes", "out_of_range", "must contain between 1 and 16 notes"),
    );
  }

  const notes = value.notes.map((note, index) => parseNote(note, index, lengthBeats, issues));
  if (
    name === undefined ||
    lengthBeats === undefined ||
    value.notes.length < 1 ||
    value.notes.length > 16 ||
    notes.some((note) => note === undefined)
  ) {
    return undefined;
  }

  return deepFreeze({
    name,
    lengthBeats,
    notes: notes as SongPatchNoteV1[],
  });
}

function parseNote(
  value: unknown,
  index: number,
  clipLengthBeats: number | undefined,
  issues: MutableIssue[],
): SongPatchNoteV1 | undefined {
  const path = `$.track.clip.notes[${index}]`;
  if (!isPlainRecord(value)) {
    issues.push(issue(path, "invalid_type", "must be an object"));
    return undefined;
  }

  rejectUnknownFields(value, NOTE_FIELDS, path, issues);
  requireFields(value, ["pitch", "velocity", "startBeat", "lengthBeats"], path, issues);

  const pitch = boundedInteger(value.pitch, 0, 127, `${path}.pitch`, issues);
  const velocity = boundedInteger(value.velocity, 1, 127, `${path}.velocity`, issues);
  const startBeat = boundedFiniteNumber(value.startBeat, 0, 16, `${path}.startBeat`, issues);
  const lengthBeats = positiveFiniteNumber(value.lengthBeats, `${path}.lengthBeats`, issues);

  if (startBeat !== undefined && !isSixteenthQuantized(startBeat)) {
    issues.push(
      issue(`${path}.startBeat`, "not_quantized", "must be a multiple of 0.25 beats"),
    );
  }
  if (lengthBeats !== undefined && !isSixteenthQuantized(lengthBeats)) {
    issues.push(
      issue(`${path}.lengthBeats`, "not_quantized", "must be a multiple of 0.25 beats"),
    );
  }
  if (
    clipLengthBeats !== undefined &&
    startBeat !== undefined &&
    lengthBeats !== undefined &&
    startBeat + lengthBeats > clipLengthBeats + Number.EPSILON
  ) {
    issues.push(issue(path, "note_outside_clip", "must end within the clip"));
  }

  if (
    pitch === undefined ||
    velocity === undefined ||
    startBeat === undefined ||
    lengthBeats === undefined ||
    !isSixteenthQuantized(startBeat) ||
    !isSixteenthQuantized(lengthBeats) ||
    (clipLengthBeats !== undefined && startBeat + lengthBeats > clipLengthBeats + Number.EPSILON)
  ) {
    return undefined;
  }

  return deepFreeze({ pitch, velocity, startBeat, lengthBeats });
}

function validateInjectedIds(value: SongPatchExecutableIds, noteCount: number): SongPatchExecutableIds {
  if (!isPlainRecord(value)) {
    throw new TypeError("ids must be an object");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    !keys.includes("songId") ||
    !keys.includes("trackId") ||
    !keys.includes("clipId") ||
    !keys.includes("noteIds")
  ) {
    throw new TypeError("ids must contain exactly songId, trackId, clipId, and noteIds");
  }
  if (!isNonEmptyString(value.songId) || !isNonEmptyString(value.trackId) || !isNonEmptyString(value.clipId)) {
    throw new TypeError("songId, trackId, and clipId must be non-empty strings");
  }
  if (
    !Array.isArray(value.noteIds) ||
    value.noteIds.length !== noteCount ||
    !value.noteIds.every(isNonEmptyString)
  ) {
    throw new TypeError(`noteIds must contain exactly ${noteCount} non-empty strings`);
  }

  const allIds = [value.songId, value.trackId, value.clipId, ...value.noteIds];
  if (new Set(allIds).size !== allIds.length) {
    throw new TypeError("all materialized IDs must be unique");
  }

  return deepFreeze({
    songId: value.songId,
    trackId: value.trackId,
    clipId: value.clipId,
    noteIds: [...value.noteIds],
  });
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: MutableIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue(`${path}.${key}`, "unknown_field", "is not allowed"));
    }
  }
}

function requireFields(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  issues: MutableIssue[],
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push(issue(`${path}.${key}`, "missing_field", "is required"));
    }
  }
}

function boundedName(
  value: unknown,
  path: string,
  issues: MutableIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type", "must be a string"));
    return undefined;
  }
  if (value.trim().length === 0 || [...value].length > 64) {
    issues.push(issue(path, "out_of_range", "must be non-empty and at most 64 characters"));
    return undefined;
  }
  return value;
}

function boundedFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  issues: MutableIssue[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue(path, "invalid_type", "must be a finite number"));
    return undefined;
  }
  if (value < minimum || value > maximum) {
    issues.push(issue(path, "out_of_range", `must be between ${minimum} and ${maximum}`));
    return undefined;
  }
  return value;
}

function positiveFiniteNumber(
  value: unknown,
  path: string,
  issues: MutableIssue[],
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue(path, "invalid_type", "must be a finite number"));
    return undefined;
  }
  if (value <= 0) {
    issues.push(issue(path, "out_of_range", "must be greater than 0"));
    return undefined;
  }
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  issues: MutableIssue[],
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(issue(path, "invalid_type", "must be an integer"));
    return undefined;
  }
  if (value < minimum || value > maximum) {
    issues.push(issue(path, "out_of_range", `must be between ${minimum} and ${maximum}`));
    return undefined;
  }
  return value;
}

function isSixteenthQuantized(value: number): boolean {
  return Number.isInteger(value / SONG_PATCH_QUANTIZATION_BEATS);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(
  path: string,
  code: SongPatchValidationIssue["code"],
  message: string,
): MutableIssue {
  return { path, code, message };
}

function validationFailure(...issues: MutableIssue[]): SongPatchValidationResult {
  return Object.freeze({
    ok: false,
    issues: Object.freeze(issues.map((entry) => Object.freeze({ ...entry }))),
  });
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
