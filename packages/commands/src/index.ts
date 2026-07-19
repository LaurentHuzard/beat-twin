import {
  addClip,
  addNote,
  addTrack,
  createClip,
  createNote,
  createSong,
  createTrack,
  deserializeSong,
  duplicateClip,
  quantizeClip,
  removeNote,
  setTempo,
  setTrackInstrument,
  setTransportPlaying,
  setTransportPosition,
  transposeClip,
  type BuiltInInstrumentId,
  type Song,
  type TrackKind,
  updateNote,
} from "@beat-twin/core";

export type { BuiltInInstrumentId } from "@beat-twin/core";

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
  readonly revision: number;
  readonly selection: Selection;
  readonly log: readonly CommandEvent[];
};

export type CommandSnapshot = {
  readonly song: Song | null;
  readonly revision: number;
};

export type BeatTwinErrorCode =
  | "invalid_command"
  | "stale_revision"
  | "unsupported_capability"
  | "policy_blocked"
  | "partial_execution";

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
      readonly instrumentId?: BuiltInInstrumentId;
      readonly color?: string;
    }
  | {
      readonly type: "SetTrackInstrument";
      readonly trackId: string;
      readonly instrumentId: BuiltInInstrumentId;
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
      readonly noteIds?: readonly string[];
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

type WithRequiredId<T> = T extends { readonly id?: string }
  ? Omit<T, "id"> & { readonly id: string }
  : T;

export type ExecutableBeatTwinCommand = BeatTwinCommand extends infer Command
  ? Command extends { readonly type: "CreateSong" | "CreateTrack" | "CreateClip" | "AddNote" }
    ? WithRequiredId<Command>
    : Command extends { readonly type: "DuplicateClip" }
      ? Omit<Command, "id" | "noteIds"> & {
          readonly id: string;
          readonly noteIds: readonly string[];
        }
      : Command
  : never;

export type CommandEvent =
  | { readonly type: "SongCreated"; readonly songId: string; readonly title: string }
  | {
      readonly type: "TrackCreated";
      readonly trackId: string;
      readonly name: string;
      readonly kind: TrackKind;
      readonly instrumentId?: BuiltInInstrumentId;
    }
  | {
      readonly type: "TrackInstrumentSet";
      readonly trackId: string;
      readonly instrumentId: BuiltInInstrumentId;
    }
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
      readonly errorCode: BeatTwinErrorCode;
      readonly error: string;
    };

export type ExecuteCommandBatchRequest = {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly commands: readonly ExecutableBeatTwinCommand[];
};

export type CommandMaterializationResult =
  | {
      readonly ok: true;
      readonly state: CommandState;
      readonly snapshot: CommandSnapshot;
      readonly commands: readonly ExecutableBeatTwinCommand[];
      readonly events: readonly CommandEvent[];
    }
  | {
      readonly ok: false;
      readonly state: CommandState;
      readonly snapshot: CommandSnapshot;
      readonly commands: readonly [];
      readonly events: readonly [];
      readonly errorCode: "invalid_command";
      readonly error: string;
    };

export type CommandBatchItemResult = {
  readonly index: number;
  readonly command: ExecutableBeatTwinCommand;
  readonly events: readonly CommandEvent[];
};

export type CommandBatchResult =
  | {
      readonly ok: true;
      readonly requestId: string;
      readonly state: CommandState;
      readonly snapshot: CommandSnapshot;
      readonly commands: readonly ExecutableBeatTwinCommand[];
      readonly results: readonly CommandBatchItemResult[];
      readonly events: readonly CommandEvent[];
    }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly state: CommandState;
      readonly snapshot: CommandSnapshot;
      readonly commands: readonly ExecutableBeatTwinCommand[];
      readonly results: readonly [];
      readonly events: readonly [];
      readonly errorCode: BeatTwinErrorCode;
      readonly error: string;
    };

export type ExecuteCommandOptions = {
  readonly idFactory?: IdFactory;
};

export function createCommandState(song: Song | null = null, revision = 0): CommandState {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("revision must be a non-negative integer");
  }
  return freezeState({
    song,
    revision,
    selection: song ? { type: "song", id: song.id } : null,
    log: [],
  });
}

export function snapshotCommandState(state: CommandState): CommandSnapshot {
  return Object.freeze({ song: state.song, revision: state.revision });
}

/** Validates an untrusted snapshot and its full song graph without normalization. */
export function validateCommandSnapshot(value: unknown): value is CommandSnapshot {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["song", "revision"])) return false;
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) return false;
  if (value.song === null) return true;
  try {
    return deepExact(value.song, deserializeSong(value.song));
  } catch {
    return false;
  }
}

export function restoreCommandState(state: CommandState, revision: number): CommandState {
  if (!Number.isInteger(revision) || revision <= state.revision) {
    throw new Error("restored revision must be greater than the snapshot revision");
  }
  return freezeState({ ...state, revision });
}

export function executeCommand(
  state: CommandState,
  command: BeatTwinCommand,
  options: ExecuteCommandOptions = {},
): CommandResult {
  const materialized = materializeCommandBatch(state, [command], options);
  if (!materialized.ok) {
    return {
      ok: false,
      state,
      events: [],
      errorCode: materialized.errorCode,
      error: materialized.error,
    };
  }

  const result = executeCommandBatch(
    state,
    {
      requestId: `single:${state.revision}`,
      expectedRevision: state.revision,
      commands: materialized.commands,
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      state,
      events: [],
      errorCode: result.errorCode,
      error: result.error,
    };
  }

  return {
    ok: true,
    state: result.state,
    events: result.events,
  };
}

export function materializeCommandBatch(
  state: CommandState,
  commandsInput: readonly BeatTwinCommand[],
  options: ExecuteCommandOptions = {},
): CommandMaterializationResult {
  if (!Array.isArray(commandsInput) || commandsInput.length === 0) {
    return materializationError(state, "commands must be a non-empty array");
  }

  let workingState = state;
  const commands: ExecutableBeatTwinCommand[] = [];

  try {
    for (const command of commandsInput) {
      const executable = materializeCommand(workingState, command, options);
      assertExecutableCommand(executable);
      workingState = applyCommand(workingState, executable, options);
      commands.push(executable);
    }
  } catch (error) {
    return materializationError(
      state,
      error instanceof Error ? error.message : String(error),
    );
  }

  const projectedState = freezeState({
    ...workingState,
    revision: state.revision + 1,
  });
  return Object.freeze({
    ok: true,
    state: projectedState,
    snapshot: snapshotCommandState(projectedState),
    commands: Object.freeze(commands),
    events: Object.freeze(projectedState.log.slice(state.log.length)),
  });
}

export function executeCommandBatch(
  state: CommandState,
  request: ExecuteCommandBatchRequest,
): CommandBatchResult {
  const requestId = normalizeRequestId(request?.requestId);

  if (requestId === null) {
    return batchError("invalid-request", state, [], "invalid_command", "requestId must be a non-empty string");
  }

  if (!Number.isInteger(request?.expectedRevision) || request.expectedRevision < 0) {
    return batchError(requestId, state, [], "invalid_command", "expectedRevision must be a non-negative integer");
  }

  if (request.expectedRevision !== state.revision) {
    return batchError(
      requestId,
      state,
      [],
      "stale_revision",
      `Expected revision ${request.expectedRevision}, current revision is ${state.revision}`,
    );
  }

  if (!Array.isArray(request.commands) || request.commands.length === 0) {
    return batchError(requestId, state, [], "invalid_command", "commands must be a non-empty array");
  }

  let workingState = state;
  const commands: ExecutableBeatTwinCommand[] = [];
  const results: CommandBatchItemResult[] = [];

  try {
    for (const [index, command] of request.commands.entries()) {
      assertExecutableCommand(command, index);
      const logStart = workingState.log.length;
      workingState = applyCommand(workingState, command, {});
      const events = Object.freeze(workingState.log.slice(logStart));
      commands.push(command);
      results.push(Object.freeze({ index, command, events }));
    }
  } catch (error) {
    return batchError(
      requestId,
      state,
      commands,
      "invalid_command",
      error instanceof Error ? error.message : String(error),
    );
  }

  const committedState = freezeState({
    ...workingState,
    revision: state.revision + 1,
  });
  const events = Object.freeze(committedState.log.slice(state.log.length));

  return Object.freeze({
    ok: true,
    requestId,
    state: committedState,
    snapshot: snapshotCommandState(committedState),
    commands: Object.freeze(commands),
    results: Object.freeze(results),
    events,
  });
}

export type CommandRuntime = {
  readonly inspect: () => CommandSnapshot;
  readonly getState: () => CommandState;
  readonly executeCommandBatch: (request: ExecuteCommandBatchRequest) => CommandBatchResult;
};

export function createCommandRuntime(
  initialState: CommandState = createCommandState(),
): CommandRuntime {
  let state = initialState;
  const completedRequests = new Map<
    string,
    { readonly fingerprint: string; readonly result: CommandBatchResult }
  >();

  return Object.freeze({
    inspect: () => snapshotCommandState(state),
    getState: () => state,
    executeCommandBatch: (request: ExecuteCommandBatchRequest) => {
      const requestId = normalizeRequestId(request?.requestId);
      if (requestId === null) {
        return executeCommandBatch(state, request);
      }

      let fingerprint: string;
      try {
        fingerprint = requestFingerprint(request);
      } catch (error) {
        return batchError(
          requestId,
          state,
          [],
          "invalid_command",
          error instanceof Error ? error.message : String(error),
        );
      }

      const cached = completedRequests.get(requestId);
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          return batchError(
            requestId,
            state,
            [],
            "invalid_command",
            `requestId ${requestId} was already used with a different payload`,
          );
        }
        return cached.result;
      }

      const result = executeCommandBatch(state, request);
      completedRequests.set(requestId, Object.freeze({ fingerprint, result }));
      if (result.ok) {
        state = result.state;
      }
      return result;
    },
  });
}

function materializationError(
  state: CommandState,
  error: string,
): CommandMaterializationResult {
  return Object.freeze({
    ok: false,
    state,
    snapshot: snapshotCommandState(state),
    commands: [] as const,
    events: [] as const,
    errorCode: "invalid_command" as const,
    error,
  });
}

function assertExecutableCommand(
  command: unknown,
  index?: number,
): asserts command is ExecutableBeatTwinCommand {
  const label = index === undefined ? "command" : `command ${index}`;
  if (!command || typeof command !== "object" || !("type" in command)) {
    throw new Error(`${label} must be an object with a type`);
  }
  const candidate = command as Record<string, unknown>;
  const knownTypes = new Set<string>([
    "CreateSong", "CreateTrack", "SetTrackInstrument", "CreateClip", "AddNote", "UpdateNote",
    "RemoveNote", "DuplicateClip", "QuantizeClip", "TransposeClip",
    "SetTempo", "StartPlayback", "StopPlayback", "SetPlayhead",
  ]);
  if (typeof candidate.type !== "string" || !knownTypes.has(candidate.type)) {
    throw new Error(`${label} has an unknown type`);
  }
  if (
    ["CreateSong", "CreateTrack", "CreateClip", "AddNote", "DuplicateClip"].includes(candidate.type) &&
    (typeof candidate.id !== "string" || candidate.id.trim().length === 0)
  ) {
    throw new Error(`${label} must have a materialized id`);
  }
  if (
    candidate.type === "DuplicateClip" &&
    (!Array.isArray(candidate.noteIds) ||
      candidate.noteIds.some((id) => typeof id !== "string" || id.trim().length === 0))
  ) {
    throw new Error(`${label} must have materialized noteIds`);
  }
}

function requestFingerprint(request: ExecuteCommandBatchRequest): string {
  const fingerprint = JSON.stringify({
    expectedRevision: request?.expectedRevision,
    commands: request?.commands,
  });
  if (typeof fingerprint !== "string") {
    throw new Error("request payload must be JSON serializable");
  }
  return fingerprint;
}

function materializeCommand(
  state: CommandState,
  command: BeatTwinCommand,
  options: ExecuteCommandOptions,
): ExecutableBeatTwinCommand {
  if (!command || typeof command !== "object" || typeof command.type !== "string") {
    throw new Error("command must be an object with a type");
  }

  switch (command.type) {
    case "CreateSong":
    case "CreateClip":
    case "AddNote":
      return Object.freeze({
        ...command,
        id: resolveId(command.id, idScopeForCommand(command.type), options.idFactory),
      }) as ExecutableBeatTwinCommand;
    case "CreateTrack":
      requireSong(state);
      return Object.freeze({
        ...command,
        id: resolveId(command.id, "track", options.idFactory),
      }) as ExecutableBeatTwinCommand;
    case "DuplicateClip": {
      const sourceClip = findClip(requireSong(state), command.trackId, command.clipId);
      const clipId = resolveId(command.id, "clip", options.idFactory);
      const noteIds = command.noteIds ?? sourceClip.pattern.notes.map(() =>
        resolveId(undefined, "note", options.idFactory),
      );
      if (noteIds.length !== sourceClip.pattern.notes.length) {
        throw new Error("duplicate clip noteIds must match source notes");
      }
      return Object.freeze({
        ...command,
        id: clipId,
        noteIds: Object.freeze([...noteIds]),
      }) as ExecutableBeatTwinCommand;
    }
    default:
      return Object.freeze({ ...command }) as ExecutableBeatTwinCommand;
  }
}

function idScopeForCommand(type: "CreateSong" | "CreateTrack" | "CreateClip" | "AddNote"): IdScope {
  switch (type) {
    case "CreateSong": return "song";
    case "CreateTrack": return "track";
    case "CreateClip": return "clip";
    case "AddNote": return "note";
  }
}

function normalizeRequestId(requestId: unknown): string | null {
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    return null;
  }
  return requestId.trim();
}

function batchError(
  requestId: string,
  state: CommandState,
  commands: readonly ExecutableBeatTwinCommand[],
  errorCode: BeatTwinErrorCode,
  error: string,
): CommandBatchResult {
  return Object.freeze({
    ok: false,
    requestId,
    state,
    snapshot: snapshotCommandState(state),
    commands: Object.freeze([...commands]),
    results: [] as const,
    events: [] as const,
    errorCode,
    error,
  });
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
        revision: state.revision,
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
        instrumentId: command.instrumentId,
        color: command.color,
      });
      const nextSong = addTrack(song, track);
      const event: CommandEvent = {
        type: "TrackCreated",
        trackId: track.id,
        name: track.name,
        kind: track.kind,
        ...(track.instrumentId === undefined ? {} : { instrumentId: track.instrumentId }),
      };
      return freezeState({
        song: nextSong,
        revision: state.revision,
        selection: { type: "track", id: track.id },
        log: [...state.log, event],
      });
    }

    case "SetTrackInstrument": {
      const song = requireSong(state);
      const nextSong = setTrackInstrument(song, command.trackId, command.instrumentId);
      const event: CommandEvent = {
        type: "TrackInstrumentSet",
        trackId: command.trackId,
        instrumentId: command.instrumentId,
      };
      return freezeState({
        song: nextSong,
        revision: state.revision,
        selection: { type: "track", id: command.trackId },
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
        selection: { type: "clip", id: command.clipId, trackId: command.trackId },
        log: [...state.log, event],
      });
    }

    case "DuplicateClip": {
      const song = requireSong(state);
      const sourceClip = findClip(song, command.trackId, command.clipId);
      const clipId = resolveId(command.id, "clip", options.idFactory);
      const noteIds = command.noteIds ?? sourceClip.pattern.notes.map(() =>
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
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
        revision: state.revision,
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
    revision: state.revision,
    selection: state.selection ? Object.freeze({ ...state.selection }) : null,
    log: Object.freeze([...state.log]),
  }) as CommandState;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function deepExact(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepExact(value, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && deepExact(left[key], right[key]),
    );
}
