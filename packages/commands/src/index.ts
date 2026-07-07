import {
  addClip,
  addNote,
  addTrack,
  createClip,
  createNote,
  createSong,
  createTrack,
  duplicateClip,
  quantizeClip,
  removeNote,
  setTempo,
  setTransportPlaying,
  setTransportPosition,
  transposeClip,
  type Song,
  type TrackKind,
  updateNote,
} from "../../core/src/index.ts";

export type IdScope = "song" | "track" | "clip" | "note";
export type IdFactory = (scope: IdScope) => string;

export type Selection =
  | { readonly type: "song"; readonly id: string }
  | { readonly type: "track"; readonly id: string }
  | { readonly type: "clip"; readonly id: string; readonly trackId: string }
  | { readonly type: "note"; readonly id: string; readonly trackId: string; readonly clipId: string }
  | null;

export type CommandState = {
  readonly song: Song | null;
  readonly selection: Selection;
  readonly log: readonly CommandEvent[];
};

export type BeatTwinCommand =
  | {
      readonly type: "CreateSong";
      readonly id?: string;
      readonly title?: string;
      readonly bpm?: number;
    }
  | {
      readonly type: "CreateTrack";
      readonly id?: string;
      readonly name?: string;
      readonly kind?: TrackKind;
      readonly color?: string;
    }
  | {
      readonly type: "CreateClip";
      readonly id?: string;
      readonly trackId: string;
      readonly name?: string;
      readonly startBeat?: number;
      readonly lengthBeats?: number;
    }
  | {
      readonly type: "AddNote";
      readonly id?: string;
      readonly trackId: string;
      readonly clipId: string;
      readonly pitch: number;
      readonly velocity?: number;
      readonly startBeat: number;
      readonly lengthBeats?: number;
    }
  | {
      readonly type: "UpdateNote";
      readonly trackId: string;
      readonly clipId: string;
      readonly noteId: string;
      readonly pitch?: number;
      readonly velocity?: number;
      readonly startBeat?: number;
      readonly lengthBeats?: number;
    }
  | {
      readonly type: "RemoveNote";
      readonly trackId: string;
      readonly clipId: string;
      readonly noteId: string;
    }
  | {
      readonly type: "DuplicateClip";
      readonly id?: string;
      readonly trackId: string;
      readonly clipId: string;
      readonly name?: string;
      readonly startBeat?: number;
    }
  | {
      readonly type: "QuantizeClip";
      readonly trackId: string;
      readonly clipId: string;
      readonly gridBeats: number;
    }
  | {
      readonly type: "TransposeClip";
      readonly trackId: string;
      readonly clipId: string;
      readonly semitones: number;
    }
  | {
      readonly type: "SetTempo";
      readonly bpm: number;
    }
  | {
      readonly type: "StartPlayback";
      readonly positionBeats?: number;
    }
  | {
      readonly type: "StopPlayback";
      readonly positionBeats?: number;
    }
  | {
      readonly type: "SetPlayhead";
      readonly positionBeats: number;
    };

export type CommandEvent =
  | { readonly type: "SongCreated"; readonly songId: string; readonly title: string }
  | { readonly type: "TrackCreated"; readonly trackId: string; readonly name: string }
  | {
      readonly type: "ClipCreated";
      readonly trackId: string;
      readonly clipId: string;
      readonly startBeat: number;
    }
  | {
      readonly type: "NoteAdded";
      readonly trackId: string;
      readonly clipId: string;
      readonly noteId: string;
      readonly pitch: number;
    }
  | {
      readonly type: "NoteUpdated";
      readonly trackId: string;
      readonly clipId: string;
      readonly noteId: string;
      readonly pitch: number;
      readonly startBeat: number;
    }
  | {
      readonly type: "NoteRemoved";
      readonly trackId: string;
      readonly clipId: string;
      readonly noteId: string;
    }
  | {
      readonly type: "ClipDuplicated";
      readonly trackId: string;
      readonly sourceClipId: string;
      readonly clipId: string;
      readonly startBeat: number;
    }
  | {
      readonly type: "ClipQuantized";
      readonly trackId: string;
      readonly clipId: string;
      readonly gridBeats: number;
    }
  | {
      readonly type: "ClipTransposed";
      readonly trackId: string;
      readonly clipId: string;
      readonly semitones: number;
    }
  | { readonly type: "TempoSet"; readonly bpm: number }
  | { readonly type: "PlaybackStarted"; readonly positionBeats: number }
  | { readonly type: "PlaybackStopped"; readonly positionBeats: number }
  | { readonly type: "PlayheadSet"; readonly positionBeats: number };

export type CommandResult =
  | {
      readonly ok: true;
      readonly state: CommandState;
      readonly events: readonly CommandEvent[];
    }
  | {
      readonly ok: false;
      readonly state: CommandState;
      readonly events: readonly [];
      readonly error: string;
    };

export type ExecuteCommandOptions = {
  readonly idFactory?: IdFactory;
};

export function createCommandState(song: Song | null = null): CommandState {
  return freezeState({
    song,
    selection: song ? { type: "song", id: song.id } : null,
    log: [],
  });
}

export function executeCommand(
  state: CommandState,
  command: BeatTwinCommand,
  options: ExecuteCommandOptions = {},
): CommandResult {
  try {
    const applied = applyCommand(state, command, options);
    return {
      ok: true,
      state: applied,
      events: applied.log.slice(state.log.length),
    };
  } catch (error) {
    return {
      ok: false,
      state,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function applyCommand(
  state: CommandState,
  command: BeatTwinCommand,
  options: ExecuteCommandOptions,
): CommandState {
  switch (command.type) {
    case "CreateSong": {
      const song = createSong({
        id: resolveId(command.id, "song", options.idFactory),
        title: command.title,
        bpm: command.bpm,
      });
      const event: CommandEvent = {
        type: "SongCreated",
        songId: song.id,
        title: song.title,
      };
      return freezeState({
        song,
        selection: { type: "song", id: song.id },
        log: [...state.log, event],
      });
    }

    case "CreateTrack": {
      const song = requireSong(state);
      const track = createTrack({
        id: resolveId(command.id, "track", options.idFactory),
        name: command.name,
        kind: command.kind,
        color: command.color,
      });
      const nextSong = addTrack(song, track);
      const event: CommandEvent = {
        type: "TrackCreated",
        trackId: track.id,
        name: track.name,
      };
      return freezeState({
        song: nextSong,
        selection: { type: "track", id: track.id },
        log: [...state.log, event],
      });
    }

    case "CreateClip": {
      const song = requireSong(state);
      const clip = createClip({
        id: resolveId(command.id, "clip", options.idFactory),
        trackId: command.trackId,
        name: command.name,
        startBeat: command.startBeat,
        lengthBeats: command.lengthBeats,
      });
      const nextSong = addClip(song, command.trackId, clip);
      const event: CommandEvent = {
        type: "ClipCreated",
        trackId: command.trackId,
        clipId: clip.id,
        startBeat: clip.startBeat,
      };
      return freezeState({
        song: nextSong,
        selection: { type: "clip", id: clip.id, trackId: command.trackId },
        log: [...state.log, event],
      });
    }

    case "AddNote": {
      const song = requireSong(state);
      const note = createNote({
        id: resolveId(command.id, "note", options.idFactory),
        pitch: command.pitch,
        velocity: command.velocity,
        startBeat: command.startBeat,
        lengthBeats: command.lengthBeats,
      });
      const nextSong = addNote(song, command.trackId, command.clipId, note);
      const event: CommandEvent = {
        type: "NoteAdded",
        trackId: command.trackId,
        clipId: command.clipId,
        noteId: note.id,
        pitch: note.pitch,
      };
      return freezeState({
        song: nextSong,
        selection: {
          type: "note",
          id: note.id,
          trackId: command.trackId,
          clipId: command.clipId,
        },
        log: [...state.log, event],
      });
    }

    case "UpdateNote": {
      const song = requireSong(state);
      const nextSong = updateNote(song, command.trackId, command.clipId, command.noteId, {
        pitch: command.pitch,
        velocity: command.velocity,
        startBeat: command.startBeat,
        lengthBeats: command.lengthBeats,
      });
      const nextNote = findNote(nextSong, command.trackId, command.clipId, command.noteId);
      const event: CommandEvent = {
        type: "NoteUpdated",
        trackId: command.trackId,
        clipId: command.clipId,
        noteId: command.noteId,
        pitch: nextNote.pitch,
        startBeat: nextNote.startBeat,
      };
      return freezeState({
        song: nextSong,
        selection: {
          type: "note",
          id: command.noteId,
          trackId: command.trackId,
          clipId: command.clipId,
        },
        log: [...state.log, event],
      });
    }

    case "RemoveNote": {
      const song = requireSong(state);
      const nextSong = removeNote(song, command.trackId, command.clipId, command.noteId);
      const event: CommandEvent = {
        type: "NoteRemoved",
        trackId: command.trackId,
        clipId: command.clipId,
        noteId: command.noteId,
      };
      return freezeState({
        song: nextSong,
        selection: { type: "clip", id: command.clipId, trackId: command.trackId },
        log: [...state.log, event],
      });
    }

    case "DuplicateClip": {
      const song = requireSong(state);
      const sourceClip = findClip(song, command.trackId, command.clipId);
      const clipId = resolveId(command.id, "clip", options.idFactory);
      const noteIds = sourceClip.pattern.notes.map(() =>
        resolveId(undefined, "note", options.idFactory),
      );
      const nextSong = duplicateClip(song, command.trackId, command.clipId, {
        id: clipId,
        name: command.name,
        startBeat: command.startBeat,
        noteIds,
      });
      const duplicated = findClip(nextSong, command.trackId, clipId);
      const event: CommandEvent = {
        type: "ClipDuplicated",
        trackId: command.trackId,
        sourceClipId: command.clipId,
        clipId,
        startBeat: duplicated.startBeat,
      };
      return freezeState({
        song: nextSong,
        selection: { type: "clip", id: clipId, trackId: command.trackId },
        log: [...state.log, event],
      });
    }

    case "QuantizeClip": {
      const song = requireSong(state);
      const nextSong = quantizeClip(song, command.trackId, command.clipId, command.gridBeats);
      const event: CommandEvent = {
        type: "ClipQuantized",
        trackId: command.trackId,
        clipId: command.clipId,
        gridBeats: command.gridBeats,
      };
      return freezeState({
        song: nextSong,
        selection: { type: "clip", id: command.clipId, trackId: command.trackId },
        log: [...state.log, event],
      });
    }

    case "TransposeClip": {
      const song = requireSong(state);
      const nextSong = transposeClip(song, command.trackId, command.clipId, command.semitones);
      const event: CommandEvent = {
        type: "ClipTransposed",
        trackId: command.trackId,
        clipId: command.clipId,
        semitones: command.semitones,
      };
      return freezeState({
        song: nextSong,
        selection: { type: "clip", id: command.clipId, trackId: command.trackId },
        log: [...state.log, event],
      });
    }

    case "SetTempo": {
      const song = requireSong(state);
      const nextSong = setTempo(song, command.bpm);
      const event: CommandEvent = { type: "TempoSet", bpm: nextSong.transport.bpm };
      return freezeState({
        song: nextSong,
        selection: state.selection,
        log: [...state.log, event],
      });
    }

    case "StartPlayback": {
      const song = requireSong(state);
      const positioned =
        command.positionBeats === undefined
          ? song
          : setTransportPosition(song, command.positionBeats);
      const nextSong = setTransportPlaying(positioned, true);
      const event: CommandEvent = {
        type: "PlaybackStarted",
        positionBeats: nextSong.transport.positionBeats,
      };
      return freezeState({
        song: nextSong,
        selection: state.selection,
        log: [...state.log, event],
      });
    }

    case "StopPlayback": {
      const song = requireSong(state);
      const positioned =
        command.positionBeats === undefined
          ? song
          : setTransportPosition(song, command.positionBeats);
      const nextSong = setTransportPlaying(positioned, false);
      const event: CommandEvent = {
        type: "PlaybackStopped",
        positionBeats: nextSong.transport.positionBeats,
      };
      return freezeState({
        song: nextSong,
        selection: state.selection,
        log: [...state.log, event],
      });
    }

    case "SetPlayhead": {
      const song = requireSong(state);
      const nextSong = setTransportPosition(song, command.positionBeats);
      const event: CommandEvent = {
        type: "PlayheadSet",
        positionBeats: nextSong.transport.positionBeats,
      };
      return freezeState({
        song: nextSong,
        selection: state.selection,
        log: [...state.log, event],
      });
    }
  }
}

function resolveId(id: string | undefined, scope: IdScope, idFactory?: IdFactory): string {
  if (id) {
    return id;
  }

  if (!idFactory) {
    throw new Error(`Missing idFactory for ${scope} id`);
  }

  return idFactory(scope);
}

function requireSong(state: CommandState): Song {
  if (!state.song) {
    throw new Error("No song is loaded");
  }

  return state.song;
}

function findNote(song: Song, trackId: string, clipId: string, noteId: string) {
  const clip = findClip(song, trackId, clipId);
  const note = clip?.pattern.notes.find((candidate) => candidate.id === noteId);
  if (!note) {
    throw new Error(`Note not found: ${noteId}`);
  }

  return note;
}

function findClip(song: Song, trackId: string, clipId: string) {
  const track = song.tracks.find((candidate) => candidate.id === trackId);
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  return clip;
}

function freezeState(state: CommandState): CommandState {
  return Object.freeze({
    song: state.song,
    selection: state.selection ? Object.freeze({ ...state.selection }) : null,
    log: Object.freeze([...state.log]),
  }) as CommandState;
}
