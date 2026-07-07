export const SONG_SCHEMA_VERSION = 1;
export const DEFAULT_BPM = 120;
export const DEFAULT_TRANSPORT_POSITION_BEATS = 0;

export type TrackKind = "instrument" | "audio" | "effect" | "group";

export type Note = {
  readonly id: string;
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
};

export type Pattern = {
  readonly lengthBeats: number;
  readonly notes: readonly Note[];
};

export type Clip = {
  readonly id: string;
  readonly trackId: string;
  readonly name: string;
  readonly startBeat: number;
  readonly lengthBeats: number;
  readonly pattern: Pattern;
};

export type Track = {
  readonly id: string;
  readonly name: string;
  readonly kind: TrackKind;
  readonly color: string;
  readonly clips: readonly Clip[];
};

export type Transport = {
  readonly bpm: number;
  readonly positionBeats: number;
  readonly isPlaying: boolean;
  readonly isRecording: boolean;
};

export type Song = {
  readonly schemaVersion: typeof SONG_SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly transport: Transport;
  readonly tracks: readonly Track[];
};

export type CreateSongInput = {
  readonly id: string;
  readonly title?: string;
  readonly bpm?: number;
};

export type CreateTrackInput = {
  readonly id: string;
  readonly name?: string;
  readonly kind?: TrackKind;
  readonly color?: string;
  readonly clips?: readonly Clip[];
};

export type CreateClipInput = {
  readonly id: string;
  readonly trackId: string;
  readonly name?: string;
  readonly startBeat?: number;
  readonly lengthBeats?: number;
  readonly pattern?: Pattern;
};

export type CreateNoteInput = {
  readonly id: string;
  readonly pitch: number;
  readonly velocity?: number;
  readonly startBeat: number;
  readonly lengthBeats?: number;
};

export type UpdateNoteInput = {
  readonly pitch?: number;
  readonly velocity?: number;
  readonly startBeat?: number;
  readonly lengthBeats?: number;
};

export type DuplicateClipInput = {
  readonly id: string;
  readonly name?: string;
  readonly startBeat?: number;
  readonly noteIds: readonly string[];
};

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value.trim();
}

function optionalString(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  return assertNonEmptyString(value, "string value");
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
}

function assertIntegerNumber(value: unknown, label: string): number {
  const numberValue = assertFiniteNumber(value, label);
  if (!Number.isInteger(numberValue)) {
    throw new Error(`${label} must be an integer`);
  }

  return numberValue;
}

function assertPositiveNumber(value: unknown, label: string): number {
  const numberValue = assertFiniteNumber(value, label);
  if (numberValue <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }

  return numberValue;
}

function assertNonNegativeNumber(value: unknown, label: string): number {
  const numberValue = assertFiniteNumber(value, label);
  if (numberValue < 0) {
    throw new Error(`${label} must be greater than or equal to 0`);
  }

  return numberValue;
}

function assertMidiRange(value: unknown, label: string): number {
  const numberValue = assertFiniteNumber(value, label);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 127) {
    throw new Error(`${label} must be an integer from 0 to 127`);
  }

  return numberValue;
}

function assertTrackKind(value: unknown): TrackKind {
  if (
    value === "instrument" ||
    value === "audio" ||
    value === "effect" ||
    value === "group"
  ) {
    return value;
  }

  throw new Error("track kind must be instrument, audio, effect, or group");
}

function freezeNote(note: Note): Note {
  return freeze({ ...note }) as Note;
}

function freezePattern(pattern: Pattern): Pattern {
  return freeze({
    lengthBeats: pattern.lengthBeats,
    notes: freezeArray(pattern.notes.map(freezeNote)),
  }) as Pattern;
}

function freezeClip(clip: Clip): Clip {
  return freeze({
    ...clip,
    pattern: freezePattern(clip.pattern),
  }) as Clip;
}

function freezeTrack(track: Track): Track {
  return freeze({
    ...track,
    clips: freezeArray(track.clips.map(freezeClip)),
  }) as Track;
}

function freezeSong(song: Song): Song {
  return freeze({
    ...song,
    transport: freeze({ ...song.transport }) as Transport,
    tracks: freezeArray(song.tracks.map(freezeTrack)),
  }) as Song;
}

export function createSong(input: CreateSongInput): Song {
  const id = assertNonEmptyString(input.id, "song id");
  const title = optionalString(input.title, "Untitled Beat Twin Song");
  const bpm = input.bpm === undefined ? DEFAULT_BPM : assertPositiveNumber(input.bpm, "bpm");

  return freezeSong({
    schemaVersion: SONG_SCHEMA_VERSION,
    id,
    title,
    transport: {
      bpm,
      positionBeats: DEFAULT_TRANSPORT_POSITION_BEATS,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [],
  });
}

export function createTrack(input: CreateTrackInput): Track {
  const id = assertNonEmptyString(input.id, "track id");
  const kind = input.kind === undefined ? "instrument" : assertTrackKind(input.kind);
  const clips = input.clips ?? [];

  return freezeTrack({
    id,
    name: optionalString(input.name, "Untitled Track"),
    kind,
    color: optionalString(input.color, "#36c2a1"),
    clips,
  });
}

export function createClip(input: CreateClipInput): Clip {
  const id = assertNonEmptyString(input.id, "clip id");
  const trackId = assertNonEmptyString(input.trackId, "clip track id");
  const startBeat =
    input.startBeat === undefined
      ? 0
      : assertNonNegativeNumber(input.startBeat, "clip startBeat");
  const lengthBeats =
    input.lengthBeats === undefined
      ? 4
      : assertPositiveNumber(input.lengthBeats, "clip lengthBeats");
  const pattern = input.pattern ?? { lengthBeats, notes: [] };
  const frozenPattern = normalizePattern(pattern);

  if (frozenPattern.lengthBeats !== lengthBeats) {
    throw new Error("clip lengthBeats must match pattern lengthBeats");
  }

  return freezeClip({
    id,
    trackId,
    name: optionalString(input.name, "Untitled Clip"),
    startBeat,
    lengthBeats,
    pattern: frozenPattern,
  });
}

export function createNote(input: CreateNoteInput): Note {
  return freezeNote({
    id: assertNonEmptyString(input.id, "note id"),
    pitch: assertMidiRange(input.pitch, "note pitch"),
    velocity:
      input.velocity === undefined ? 100 : assertMidiRange(input.velocity, "note velocity"),
    startBeat: assertNonNegativeNumber(input.startBeat, "note startBeat"),
    lengthBeats:
      input.lengthBeats === undefined
        ? 1
        : assertPositiveNumber(input.lengthBeats, "note lengthBeats"),
  });
}

export function addTrack(song: Song, track: Track): Song {
  assertUniqueId(song.tracks.map((candidate) => candidate.id), track.id, "track");

  return freezeSong({
    ...song,
    tracks: [...song.tracks, track],
  });
}

export function addClip(song: Song, trackId: string, clip: Clip): Song {
  const normalizedTrackId = assertNonEmptyString(trackId, "track id");
  if (clip.trackId !== normalizedTrackId) {
    throw new Error("clip trackId must match target track id");
  }

  let updated = false;
  const tracks = song.tracks.map((track) => {
    if (track.id !== normalizedTrackId) {
      return track;
    }

    assertUniqueId(track.clips.map((candidate) => candidate.id), clip.id, "clip");
    updated = true;
    return freezeTrack({
      ...track,
      clips: [...track.clips, clip],
    });
  });

  if (!updated) {
    throw new Error(`Track not found: ${normalizedTrackId}`);
  }

  return freezeSong({
    ...song,
    tracks,
  });
}

export function addNote(song: Song, trackId: string, clipId: string, note: Note): Song {
  const normalizedTrackId = assertNonEmptyString(trackId, "track id");
  const normalizedClipId = assertNonEmptyString(clipId, "clip id");
  let updated = false;

  const tracks = song.tracks.map((track) => {
    if (track.id !== normalizedTrackId) {
      return track;
    }

    const clips = track.clips.map((clip) => {
      if (clip.id !== normalizedClipId) {
        return clip;
      }

      assertUniqueId(clip.pattern.notes.map((candidate) => candidate.id), note.id, "note");
      if (note.startBeat + note.lengthBeats > clip.pattern.lengthBeats) {
        throw new Error("note must fit inside the clip pattern");
      }

      updated = true;
      return freezeClip({
        ...clip,
        pattern: {
          ...clip.pattern,
          notes: [...clip.pattern.notes, note],
        },
      });
    });

    return freezeTrack({ ...track, clips });
  });

  if (!updated) {
    throw new Error(`Clip not found: ${normalizedClipId}`);
  }

  return freezeSong({
    ...song,
    tracks,
  });
}

export function removeNote(
  song: Song,
  trackId: string,
  clipId: string,
  noteId: string,
): Song {
  const normalizedTrackId = assertNonEmptyString(trackId, "track id");
  const normalizedClipId = assertNonEmptyString(clipId, "clip id");
  const normalizedNoteId = assertNonEmptyString(noteId, "note id");
  let updated = false;

  const tracks = song.tracks.map((track) => {
    if (track.id !== normalizedTrackId) {
      return track;
    }

    const clips = track.clips.map((clip) => {
      if (clip.id !== normalizedClipId) {
        return clip;
      }

      const notes = clip.pattern.notes.filter((note) => note.id !== normalizedNoteId);
      if (notes.length === clip.pattern.notes.length) {
        return clip;
      }

      updated = true;
      return freezeClip({
        ...clip,
        pattern: {
          ...clip.pattern,
          notes,
        },
      });
    });

    return freezeTrack({ ...track, clips });
  });

  if (!updated) {
    throw new Error(`Note not found: ${normalizedNoteId}`);
  }

  return freezeSong({
    ...song,
    tracks,
  });
}

export function updateNote(
  song: Song,
  trackId: string,
  clipId: string,
  noteId: string,
  updates: UpdateNoteInput,
): Song {
  const normalizedTrackId = assertNonEmptyString(trackId, "track id");
  const normalizedClipId = assertNonEmptyString(clipId, "clip id");
  const normalizedNoteId = assertNonEmptyString(noteId, "note id");
  let updated = false;

  const tracks = song.tracks.map((track) => {
    if (track.id !== normalizedTrackId) {
      return track;
    }

    const clips = track.clips.map((clip) => {
      if (clip.id !== normalizedClipId) {
        return clip;
      }

      const notes = clip.pattern.notes.map((note) => {
        if (note.id !== normalizedNoteId) {
          return note;
        }

        const nextNote = createNote({
          id: note.id,
          pitch: updates.pitch ?? note.pitch,
          velocity: updates.velocity ?? note.velocity,
          startBeat: updates.startBeat ?? note.startBeat,
          lengthBeats: updates.lengthBeats ?? note.lengthBeats,
        });

        if (nextNote.startBeat + nextNote.lengthBeats > clip.pattern.lengthBeats) {
          throw new Error("note must fit inside the clip pattern");
        }

        updated = true;
        return nextNote;
      });

      return freezeClip({
        ...clip,
        pattern: {
          ...clip.pattern,
          notes,
        },
      });
    });

    return freezeTrack({ ...track, clips });
  });

  if (!updated) {
    throw new Error(`Note not found: ${normalizedNoteId}`);
  }

  return freezeSong({
    ...song,
    tracks,
  });
}

export function duplicateClip(
  song: Song,
  trackId: string,
  clipId: string,
  input: DuplicateClipInput,
): Song {
  const normalizedTrackId = assertNonEmptyString(trackId, "track id");
  const normalizedClipId = assertNonEmptyString(clipId, "clip id");
  const sourceClip = findClipInSong(song, normalizedTrackId, normalizedClipId);
  const noteIds = input.noteIds.map((id) => assertNonEmptyString(id, "note id"));

  if (noteIds.length !== sourceClip.pattern.notes.length) {
    throw new Error("duplicate clip noteIds must match source notes");
  }

  const duplicatedNotes = sourceClip.pattern.notes.map((note, index) =>
    createNote({
      id: noteIds[index],
      pitch: note.pitch,
      velocity: note.velocity,
      startBeat: note.startBeat,
      lengthBeats: note.lengthBeats,
    }),
  );
  const duplicatedClip = createClip({
    id: assertNonEmptyString(input.id, "clip id"),
    trackId: normalizedTrackId,
    name: input.name ?? `${sourceClip.name} Copy`,
    startBeat: input.startBeat ?? sourceClip.startBeat + sourceClip.lengthBeats,
    lengthBeats: sourceClip.lengthBeats,
    pattern: {
      lengthBeats: sourceClip.pattern.lengthBeats,
      notes: duplicatedNotes,
    },
  });

  return addClip(song, normalizedTrackId, duplicatedClip);
}

export function quantizeClip(song: Song, trackId: string, clipId: string, gridBeats: number): Song {
  const normalizedGridBeats = assertPositiveNumber(gridBeats, "gridBeats");

  return updateClipPattern(song, trackId, clipId, (clip) => ({
    lengthBeats: clip.pattern.lengthBeats,
    notes: clip.pattern.notes.map((note) => {
      const maxStartBeat = Math.max(0, clip.pattern.lengthBeats - note.lengthBeats);
      const snappedStartBeat = roundBeat(
        Math.round(note.startBeat / normalizedGridBeats) * normalizedGridBeats,
      );

      return createNote({
        id: note.id,
        pitch: note.pitch,
        velocity: note.velocity,
        startBeat: Math.min(maxStartBeat, Math.max(0, snappedStartBeat)),
        lengthBeats: note.lengthBeats,
      });
    }),
  }));
}

export function transposeClip(
  song: Song,
  trackId: string,
  clipId: string,
  semitones: number,
): Song {
  const normalizedSemitones = assertIntegerNumber(semitones, "semitones");

  return updateClipPattern(song, trackId, clipId, (clip) => ({
    lengthBeats: clip.pattern.lengthBeats,
    notes: clip.pattern.notes.map((note) =>
      createNote({
        id: note.id,
        pitch: note.pitch + normalizedSemitones,
        velocity: note.velocity,
        startBeat: note.startBeat,
        lengthBeats: note.lengthBeats,
      }),
    ),
  }));
}

export function setTempo(song: Song, bpm: number): Song {
  return freezeSong({
    ...song,
    transport: {
      ...song.transport,
      bpm: assertPositiveNumber(bpm, "bpm"),
    },
  });
}

export function setTransportPlaying(song: Song, isPlaying: boolean): Song {
  return freezeSong({
    ...song,
    transport: {
      ...song.transport,
      isPlaying,
      isRecording: isPlaying ? song.transport.isRecording : false,
    },
  });
}

export function setTransportPosition(song: Song, positionBeats: number): Song {
  return freezeSong({
    ...song,
    transport: {
      ...song.transport,
      positionBeats: assertNonNegativeNumber(positionBeats, "positionBeats"),
    },
  });
}

export function serializeSong(song: Song): string {
  return JSON.stringify(song, null, 2);
}

export function deserializeSong(source: string | unknown): Song {
  const parsed = typeof source === "string" ? JSON.parse(source) : source;
  return normalizeSong(parsed);
}

function assertUniqueId(existingIds: readonly string[], id: string, label: string): void {
  if (existingIds.includes(id)) {
    throw new Error(`Duplicate ${label} id: ${id}`);
  }
}

function findClipInSong(song: Song, trackId: string, clipId: string): Clip {
  const track = song.tracks.find((candidate) => candidate.id === trackId);
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  return clip;
}

function updateClipPattern(
  song: Song,
  trackId: string,
  clipId: string,
  transform: (clip: Clip) => Pattern,
): Song {
  const normalizedTrackId = assertNonEmptyString(trackId, "track id");
  const normalizedClipId = assertNonEmptyString(clipId, "clip id");
  let updated = false;

  const tracks = song.tracks.map((track) => {
    if (track.id !== normalizedTrackId) {
      return track;
    }

    const clips = track.clips.map((clip) => {
      if (clip.id !== normalizedClipId) {
        return clip;
      }

      updated = true;
      return freezeClip({
        ...clip,
        pattern: freezePattern(transform(clip)),
      });
    });

    return freezeTrack({ ...track, clips });
  });

  if (!updated) {
    throw new Error(`Clip not found: ${normalizedClipId}`);
  }

  return freezeSong({
    ...song,
    tracks,
  });
}

function roundBeat(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeSong(value: unknown): Song {
  assertPlainObject(value, "song");
  if (value.schemaVersion !== SONG_SCHEMA_VERSION) {
    throw new Error(`Unsupported song schema: ${String(value.schemaVersion)}`);
  }

  const transport = normalizeTransport(value.transport);
  const tracksValue = value.tracks;
  if (!Array.isArray(tracksValue)) {
    throw new Error("song tracks must be an array");
  }

  const tracks = tracksValue.map(normalizeTrack);
  const trackIds = new Set<string>();
  for (const track of tracks) {
    if (trackIds.has(track.id)) {
      throw new Error(`Duplicate track id: ${track.id}`);
    }
    trackIds.add(track.id);
  }

  return freezeSong({
    schemaVersion: SONG_SCHEMA_VERSION,
    id: assertNonEmptyString(value.id, "song id"),
    title: optionalString(value.title, "Untitled Beat Twin Song"),
    transport,
    tracks,
  });
}

function normalizeTransport(value: unknown): Transport {
  assertPlainObject(value, "transport");

  return freeze({
    bpm: assertPositiveNumber(value.bpm, "transport bpm"),
    positionBeats: assertNonNegativeNumber(
      value.positionBeats,
      "transport positionBeats",
    ),
    isPlaying: Boolean(value.isPlaying),
    isRecording: Boolean(value.isRecording),
  }) as Transport;
}

function normalizeTrack(value: unknown): Track {
  assertPlainObject(value, "track");
  const clipsValue = value.clips;
  if (!Array.isArray(clipsValue)) {
    throw new Error("track clips must be an array");
  }

  const track = freezeTrack({
    id: assertNonEmptyString(value.id, "track id"),
    name: optionalString(value.name, "Untitled Track"),
    kind: assertTrackKind(value.kind ?? "instrument"),
    color: optionalString(value.color, "#36c2a1"),
    clips: clipsValue.map(normalizeClip),
  });

  const clipIds = new Set<string>();
  for (const clip of track.clips) {
    if (clip.trackId !== track.id) {
      throw new Error(`Clip ${clip.id} does not belong to track ${track.id}`);
    }
    if (clipIds.has(clip.id)) {
      throw new Error(`Duplicate clip id: ${clip.id}`);
    }
    clipIds.add(clip.id);
  }

  return track;
}

function normalizeClip(value: unknown): Clip {
  assertPlainObject(value, "clip");
  const lengthBeats = assertPositiveNumber(value.lengthBeats, "clip lengthBeats");
  const pattern = normalizePattern(value.pattern);

  if (pattern.lengthBeats !== lengthBeats) {
    throw new Error("clip lengthBeats must match pattern lengthBeats");
  }

  return freezeClip({
    id: assertNonEmptyString(value.id, "clip id"),
    trackId: assertNonEmptyString(value.trackId, "clip track id"),
    name: optionalString(value.name, "Untitled Clip"),
    startBeat: assertNonNegativeNumber(value.startBeat, "clip startBeat"),
    lengthBeats,
    pattern,
  });
}

function normalizePattern(value: unknown): Pattern {
  assertPlainObject(value, "pattern");
  const lengthBeats = assertPositiveNumber(value.lengthBeats, "pattern lengthBeats");
  const notesValue = value.notes;
  if (!Array.isArray(notesValue)) {
    throw new Error("pattern notes must be an array");
  }

  const notes = notesValue.map(normalizeNote);
  const noteIds = new Set<string>();
  for (const note of notes) {
    if (noteIds.has(note.id)) {
      throw new Error(`Duplicate note id: ${note.id}`);
    }
    if (note.startBeat + note.lengthBeats > lengthBeats) {
      throw new Error(`Note ${note.id} exceeds pattern length`);
    }
    noteIds.add(note.id);
  }

  return freezePattern({ lengthBeats, notes });
}

function normalizeNote(value: unknown): Note {
  assertPlainObject(value, "note");

  return createNote({
    id: assertNonEmptyString(value.id, "note id"),
    pitch: assertMidiRange(value.pitch, "note pitch"),
    velocity: assertMidiRange(value.velocity, "note velocity"),
    startBeat: assertNonNegativeNumber(value.startBeat, "note startBeat"),
    lengthBeats: assertPositiveNumber(value.lengthBeats, "note lengthBeats"),
  });
}
