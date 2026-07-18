import { create } from "zustand";

import {
  createCommandState,
  executeCommand,
  executeCommandBatch,
  materializeCommandBatch,
  restoreCommandState,
  snapshotCommandState,
  type BeatTwinCommand,
  type CommandBatchResult,
  type CommandEvent,
  type CommandSnapshot,
  type CommandState,
  type ExecuteCommandBatchRequest,
  type IdScope,
} from "@beat-twin/commands";
import type { BuiltInInstrumentId, Song } from "@beat-twin/core";

import {
  buildPreviewAudition,
  createBrowserPreviewAudioEngine,
  idlePreviewState,
  type PreviewAudioEngine,
  type PreviewState,
} from "./previewAudio";
import {
  clearSongFromStorage,
  exportSongJson,
  hasSavedSong,
  importSongJson,
  loadSongFromStorage,
  saveSongToStorage,
} from "./persistence";

const trackColors = ["#2d7f73", "#d85b40", "#826aed", "#c8971b", "#2f6fa3"];

let previewAudioEngine: PreviewAudioEngine = createBrowserPreviewAudioEngine();

export type CommandMessage = {
  readonly id: string;
  readonly role: "draft" | "system";
  readonly text: string;
};

export type NoteDraft = {
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
};

const defaultNoteDraft: NoteDraft = {
  pitch: 60,
  velocity: 100,
  startBeat: 0,
  lengthBeats: 0.5,
};

export type PersistencePhase = "idle" | "saved" | "loaded" | "exported" | "cleared" | "error";

export type PersistenceState = {
  readonly phase: PersistencePhase;
  readonly label: string;
  readonly detail?: string;
  readonly hasSavedSong: boolean;
};

const defaultPersistenceState: PersistenceState = {
  phase: "idle",
  label: "No saved song",
  hasSavedSong: hasSavedSong(),
};

export type PlaygroundStore = {
  readonly commandState: CommandState;
  readonly undoStack: readonly CommandState[];
  readonly redoStack: readonly CommandState[];
  readonly messages: readonly CommandMessage[];
  readonly draft: string;
  readonly songJsonDraft: string;
  readonly persistence: PersistenceState;
  readonly noteDraft: NoteDraft;
  readonly editingNoteId: string | null;
  readonly selectedTrackId: string | null;
  readonly selectedClipId: string | null;
  readonly preview: PreviewState;
  readonly lastError: string | null;
  readonly dispatch: (command: BeatTwinCommand) => void;
  readonly inspectRemoteSession: () => CommandSnapshot;
  readonly executeRemoteCommandBatch: (request: ExecuteCommandBatchRequest) => CommandBatchResult;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly createDemo: () => void;
  readonly addTrack: () => void;
  readonly addClipToSelection: () => void;
  readonly setTempo: (bpm: number) => void;
  readonly setSelectedTrackInstrument: (instrumentId: BuiltInInstrumentId) => void;
  readonly playPreview: () => Promise<void>;
  readonly stopPreview: () => Promise<void>;
  readonly duplicateSelectedClip: () => void;
  readonly quantizeSelectedClip: (gridBeats: number) => void;
  readonly transposeSelectedClip: (semitones: number) => void;
  readonly saveSong: () => void;
  readonly loadSavedSong: () => void;
  readonly exportSong: () => void;
  readonly importSong: () => void;
  readonly clearSavedSong: () => void;
  readonly setSongJsonDraft: (draft: string) => void;
  readonly setNoteDraft: (draft: Partial<NoteDraft>) => void;
  readonly commitNoteDraft: () => void;
  readonly editNoteFromSelection: (noteId: string) => void;
  readonly removeNoteFromSelection: (noteId: string) => void;
  readonly cancelNoteEdit: () => void;
  readonly selectTrack: (trackId: string) => void;
  readonly selectClip: (trackId: string, clipId: string) => void;
  readonly setDraft: (draft: string) => void;
  readonly submitDraft: () => void;
};

export function setPreviewAudioEngine(engine: PreviewAudioEngine): void {
  previewAudioEngine = engine;
}

function makeId(scope: IdScope): string {
  if (globalThis.crypto?.randomUUID) {
    return `${scope}-${globalThis.crypto.randomUUID()}`;
  }

  return `${scope}-${Date.now().toString(36)}`;
}

function messageId(): string {
  return makeId("note").replace("note-", "msg-");
}

function applyCommands(
  state: CommandState,
  commands: readonly BeatTwinCommand[],
): {
  readonly state: CommandState;
  readonly events: readonly CommandEvent[];
  readonly error: string | null;
} {
  const materialized = materializeCommandBatch(state, commands, { idFactory: makeId });
  if (!materialized.ok) {
    return { state, events: [], error: materialized.error };
  }
  const result = executeCommandBatch(state, {
    requestId: makeId("note").replace("note-", "batch-"),
    expectedRevision: state.revision,
    commands: materialized.commands,
  });

  return result.ok
    ? { state: result.state, events: result.events, error: null }
    : { state, events: [], error: result.error };
}

function deriveSelection(state: CommandState): {
  readonly selectedTrackId: string | null;
  readonly selectedClipId: string | null;
} {
  if (state.selection?.type === "track") {
    return { selectedTrackId: state.selection.id, selectedClipId: null };
  }

  if (state.selection?.type === "clip") {
    return { selectedTrackId: state.selection.trackId, selectedClipId: state.selection.id };
  }

  if (state.selection?.type === "note") {
    return {
      selectedTrackId: state.selection.trackId,
      selectedClipId: state.selection.clipId,
    };
  }

  return { selectedTrackId: null, selectedClipId: null };
}

function deriveSongSelection(song: Song | null): {
  readonly selectedTrackId: string | null;
  readonly selectedClipId: string | null;
} {
  const track = song?.tracks[0] ?? null;
  const clip = track?.clips[0] ?? null;
  return {
    selectedTrackId: track?.id ?? null,
    selectedClipId: clip?.id ?? null,
  };
}

function persistenceStatus(
  phase: PersistencePhase,
  label: string,
  detail?: string,
): PersistenceState {
  return {
    phase,
    label,
    detail,
    hasSavedSong: hasSavedSong(),
  };
}

function autosaveSong(song: Song | null): PersistenceState | null {
  if (!song) {
    return null;
  }

  try {
    saveSongToStorage(song);
    return persistenceStatus("saved", "Autosaved", song.title);
  } catch (error) {
    return persistenceStatus(
      "error",
      "Autosave failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function persistCommandStateSnapshot(
  state: CommandState,
  label: string,
): {
  readonly songJsonDraft: string;
  readonly persistence: PersistenceState;
} {
  try {
    if (!state.song) {
      clearSongFromStorage();
      return {
        songJsonDraft: "",
        persistence: persistenceStatus("cleared", label, "No song loaded"),
      };
    }

    const songJsonDraft = saveSongToStorage(state.song);
    return {
      songJsonDraft,
      persistence: persistenceStatus("saved", label, state.song.title),
    };
  } catch (error) {
    return {
      songJsonDraft: state.song ? exportSongJson(state.song) : "",
      persistence: persistenceStatus(
        "error",
        `${label} autosave failed`,
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function resolveEditableClip(
  state: CommandState,
  selectedTrackId: string | null,
  selectedClipId: string | null,
) {
  const song = state.song;
  if (!song) {
    return null;
  }

  if (selectedClipId) {
    for (const track of song.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
      if (clip) {
        return { track, clip };
      }
    }
  }

  const track = selectedTrackId
    ? song.tracks.find((candidate) => candidate.id === selectedTrackId)
    : song.tracks[0];
  const clip = track?.clips[0] ?? null;
  return track && clip ? { track, clip } : null;
}

type DraftCommandIntent =
  | { readonly type: "createDemo"; readonly label: "Create Demo" }
  | { readonly type: "addTrack"; readonly label: "Add Track" }
  | { readonly type: "addClip"; readonly label: "Add Clip" }
  | { readonly type: "playPreview"; readonly label: "Play Preview" }
  | { readonly type: "stopPreview"; readonly label: "Stop Preview" }
  | { readonly type: "duplicateClip"; readonly label: "Duplicate Clip" }
  | {
      readonly type: "quantizeClip";
      readonly label: string;
      readonly gridBeats: number;
    }
  | {
      readonly type: "transposeClip";
      readonly label: string;
      readonly semitones: number;
    }
  | {
      readonly type: "setTempo";
      readonly label: string;
      readonly bpm: number;
    }
  | { readonly type: "saveSong"; readonly label: "Save Song" }
  | { readonly type: "loadSong"; readonly label: "Load Song" }
  | { readonly type: "exportSong"; readonly label: "Export Song" }
  | { readonly type: "undo"; readonly label: "Undo" }
  | { readonly type: "redo"; readonly label: "Redo" };

type DraftCommandParseResult =
  | { readonly ok: true; readonly intent: DraftCommandIntent }
  | { readonly ok: false; readonly error: string };

function parseDraftCommand(draft: string): DraftCommandParseResult {
  const command = normalizeDraftCommand(draft);

  if (["demo", "create demo", "new demo", "playground demo"].includes(command)) {
    return { ok: true, intent: { type: "createDemo", label: "Create Demo" } };
  }

  if (["add track", "new track", "track"].includes(command)) {
    return { ok: true, intent: { type: "addTrack", label: "Add Track" } };
  }

  if (["add clip", "new clip", "clip"].includes(command)) {
    return { ok: true, intent: { type: "addClip", label: "Add Clip" } };
  }

  if (["play", "preview", "play preview"].includes(command)) {
    return { ok: true, intent: { type: "playPreview", label: "Play Preview" } };
  }

  if (["stop", "stop preview"].includes(command)) {
    return { ok: true, intent: { type: "stopPreview", label: "Stop Preview" } };
  }

  if (["duplicate", "duplicate clip", "dupe"].includes(command)) {
    return { ok: true, intent: { type: "duplicateClip", label: "Duplicate Clip" } };
  }

  if (["save", "save song", "save local", "save locally"].includes(command)) {
    return { ok: true, intent: { type: "saveSong", label: "Save Song" } };
  }

  if (["load", "load song", "load local", "load local song"].includes(command)) {
    return { ok: true, intent: { type: "loadSong", label: "Load Song" } };
  }

  if (["export", "export song", "export json", "export song json"].includes(command)) {
    return { ok: true, intent: { type: "exportSong", label: "Export Song" } };
  }

  if (command === "undo") {
    return { ok: true, intent: { type: "undo", label: "Undo" } };
  }

  if (command === "redo") {
    return { ok: true, intent: { type: "redo", label: "Redo" } };
  }

  const tempoMatch = command.match(/^(?:tempo|bpm|set tempo|set bpm) ([0-9]{2,3})$/);
  if (tempoMatch) {
    const bpm = Number(tempoMatch[1]);
    if (bpm < 60 || bpm > 180) {
      return { ok: false, error: "Tempo command expects 60 to 180 BPM." };
    }

    return {
      ok: true,
      intent: { type: "setTempo", label: `Set Tempo ${bpm} BPM`, bpm },
    };
  }

  const quantizeMatch = command.match(/^quantize(?: clip)?(?: to)?(?: (.+))?$/);
  if (quantizeMatch) {
    const grid = parseQuantizeGrid(quantizeMatch[1] ?? "1/4");
    if (!grid) {
      return { ok: false, error: "Quantize command supports 1/4, 1/2, or 1 beat." };
    }

    return {
      ok: true,
      intent: {
        type: "quantizeClip",
        label: `Quantize Clip ${grid.label}`,
        gridBeats: grid.beats,
      },
    };
  }

  const transpose = parseTransposeCommand(command);
  if (transpose) {
    return {
      ok: true,
      intent: {
        type: "transposeClip",
        label: `Transpose Clip ${transpose.label}`,
        semitones: transpose.semitones,
      },
    };
  }

  return {
    ok: false,
    error: "Command not recognized.",
  };
}

function normalizeDraftCommand(draft: string): string {
  return draft
    .trim()
    .toLowerCase()
    .replace(/[^\w\s/+.-]/g, " ")
    .replace(/\s+/g, " ");
}

function parseQuantizeGrid(
  value: string,
): { readonly beats: number; readonly label: string } | null {
  const normalized = value.trim().toLowerCase();

  if (["1/4", "0.25", "quarter", "quarter beat"].includes(normalized)) {
    return { beats: 0.25, label: "1/4" };
  }

  if (["1/2", "0.5", "half", "half beat"].includes(normalized)) {
    return { beats: 0.5, label: "1/2" };
  }

  if (["1", "1 beat", "beat"].includes(normalized)) {
    return { beats: 1, label: "1 beat" };
  }

  return null;
}

function parseTransposeCommand(
  command: string,
): { readonly semitones: number; readonly label: string } | null {
  const match = command.match(/^transpose(?: clip)?(?: (up|down))?(?: ([+-]?[0-9]{1,2}))?$/);
  if (!match) {
    return null;
  }

  const direction = match[1];
  const amount = match[2] ? Number(match[2]) : 1;
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 12) {
    return null;
  }

  const semitones =
    direction === "down" ? -Math.abs(amount) : direction === "up" ? Math.abs(amount) : amount;
  const label = semitones > 0 ? `+${semitones}` : String(semitones);
  return { semitones, label };
}

function getDraftCommandBlocker(
  intent: DraftCommandIntent,
  state: PlaygroundStore,
): string | null {
  const target = resolveEditableClip(
    state.commandState,
    state.selectedTrackId,
    state.selectedClipId,
  );

  switch (intent.type) {
    case "addClip":
      return state.commandState.song?.tracks.length ? null : "Create a track before adding a clip.";
    case "playPreview":
      return buildPreviewAudition(
        state.commandState.song,
        state.selectedTrackId,
        state.selectedClipId,
      )
        ? null
        : "Create a playable clip before previewing.";
    case "stopPreview":
      return state.preview.phase === "playing" ? null : "Preview is already idle.";
    case "duplicateClip":
    case "quantizeClip":
    case "transposeClip":
      return target ? null : "Select a clip before editing its pattern.";
    case "setTempo":
    case "saveSong":
    case "exportSong":
      return state.commandState.song ? null : "Create a song first.";
    case "loadSong":
      return state.persistence.hasSavedSong ? null : "No local song is saved yet.";
    case "undo":
      return state.undoStack.length > 0 ? null : "Nothing to undo.";
    case "redo":
      return state.redoStack.length > 0 ? null : "Nothing to redo.";
    case "createDemo":
    case "addTrack":
      return null;
  }
}

function executeDraftCommandIntent(intent: DraftCommandIntent, state: PlaygroundStore): void {
  switch (intent.type) {
    case "createDemo":
      state.createDemo();
      return;
    case "addTrack":
      state.addTrack();
      return;
    case "addClip":
      state.addClipToSelection();
      return;
    case "playPreview":
      void state.playPreview();
      return;
    case "stopPreview":
      void state.stopPreview();
      return;
    case "duplicateClip":
      state.duplicateSelectedClip();
      return;
    case "quantizeClip":
      state.quantizeSelectedClip(intent.gridBeats);
      return;
    case "transposeClip":
      state.transposeSelectedClip(intent.semitones);
      return;
    case "setTempo":
      state.setTempo(intent.bpm);
      return;
    case "saveSong":
      state.saveSong();
      return;
    case "loadSong":
      state.loadSavedSong();
      return;
    case "exportSong":
      state.exportSong();
      return;
    case "undo":
      state.undo();
      return;
    case "redo":
      state.redo();
      return;
  }
}

export const usePlaygroundStore = create<PlaygroundStore>((set, get) => ({
  commandState: createCommandState(),
  undoStack: [],
  redoStack: [],
  messages: [],
  draft: "",
  songJsonDraft: "",
  persistence: defaultPersistenceState,
  noteDraft: defaultNoteDraft,
  editingNoteId: null,
  selectedTrackId: null,
  selectedClipId: null,
  preview: idlePreviewState,
  lastError: null,

  dispatch: (command) => {
    set((current) => {
      const result = executeCommand(current.commandState, command, { idFactory: makeId });
      if (!result.ok) {
        return { lastError: result.error };
      }

      const persistence = autosaveSong(result.state.song);
      return {
        commandState: result.state,
        undoStack: [...current.undoStack, current.commandState],
        redoStack: [],
        ...deriveSelection(result.state),
        persistence: persistence ?? current.persistence,
        lastError: null,
      };
    });
  },

  inspectRemoteSession: () => snapshotCommandState(get().commandState),

  executeRemoteCommandBatch: (request) => {
    void previewAudioEngine.stop();
    let response: CommandBatchResult | null = null;
    set((current) => {
      const result = executeCommandBatch(current.commandState, request);
      response = result;
      if (!result.ok) {
        return { lastError: result.error };
      }

      const persistence = autosaveSong(result.state.song);
      return {
        commandState: result.state,
        undoStack: [...current.undoStack, current.commandState],
        redoStack: [],
        ...deriveSelection(result.state),
        persistence: persistence ?? current.persistence,
        editingNoteId: null,
        noteDraft: defaultNoteDraft,
        preview: idlePreviewState,
        lastError: null,
      };
    });

    if (!response) {
      throw new Error("remote command batch did not complete synchronously");
    }
    return response;
  },

  undo: () => {
    void previewAudioEngine.stop();
    set((current) => {
      const previousState = current.undoStack.at(-1);
      if (!previousState) {
        return { lastError: "Nothing to undo." };
      }

      return {
        commandState: restoreCommandState(
          previousState,
          current.commandState.revision + 1,
        ),
        undoStack: current.undoStack.slice(0, -1),
        redoStack: [current.commandState, ...current.redoStack],
        ...deriveSelection(previousState),
        ...persistCommandStateSnapshot(previousState, "Undo saved"),
        editingNoteId: null,
        noteDraft: defaultNoteDraft,
        preview: idlePreviewState,
        lastError: null,
      };
    });
  },

  redo: () => {
    void previewAudioEngine.stop();
    set((current) => {
      const nextState = current.redoStack[0];
      if (!nextState) {
        return { lastError: "Nothing to redo." };
      }

      return {
        commandState: restoreCommandState(
          nextState,
          current.commandState.revision + 1,
        ),
        undoStack: [...current.undoStack, current.commandState],
        redoStack: current.redoStack.slice(1),
        ...deriveSelection(nextState),
        ...persistCommandStateSnapshot(nextState, "Redo saved"),
        editingNoteId: null,
        noteDraft: defaultNoteDraft,
        preview: idlePreviewState,
        lastError: null,
      };
    });
  },

  createDemo: () => {
    const trackId = makeId("track");
    const clipId = makeId("clip");
    const commands: BeatTwinCommand[] = [
      { type: "CreateSong", title: "Playground Sketch", bpm: 124 },
      {
        type: "CreateTrack",
        id: trackId,
        name: "Drums",
        kind: "instrument",
        instrumentId: "drums",
        color: trackColors[1],
      },
      {
        type: "CreateClip",
        id: clipId,
        trackId,
        name: "Kick Ladder",
        startBeat: 0,
        lengthBeats: 8,
      },
      {
        type: "AddNote",
        trackId,
        clipId,
        pitch: 36,
        velocity: 118,
        startBeat: 0,
        lengthBeats: 0.5,
      },
      {
        type: "AddNote",
        trackId,
        clipId,
        pitch: 38,
        velocity: 92,
        startBeat: 2,
        lengthBeats: 0.5,
      },
      {
        type: "AddNote",
        trackId,
        clipId,
        pitch: 42,
        velocity: 84,
        startBeat: 3.5,
        lengthBeats: 0.25,
      },
    ];

    set((current) => {
      const result = applyCommands(current.commandState, commands);
      if (result.error) {
        return { lastError: result.error };
      }
      const persistence = autosaveSong(result.state.song);
      return {
        commandState: result.state,
        undoStack: [...current.undoStack, current.commandState],
        redoStack: [],
        ...deriveSelection(result.state),
        songJsonDraft: result.state.song ? exportSongJson(result.state.song) : current.songJsonDraft,
        persistence: persistence ?? current.persistence,
        lastError: null,
      };
    });
  },

  addTrack: () => {
    const state = get().commandState;
    if (!state.song) {
      get().dispatch({ type: "CreateSong", title: "Playground Sketch" });
    }

    const updatedState = get().commandState;
    const trackNumber = (updatedState.song?.tracks.length ?? 0) + 1;
    get().dispatch({
      type: "CreateTrack",
      name: `Track ${trackNumber}`,
      color: trackColors[(trackNumber - 1) % trackColors.length],
    });
  },

  addClipToSelection: () => {
    const { commandState, selectedTrackId } = get();
    const trackId = selectedTrackId ?? commandState.song?.tracks[0]?.id;
    if (!trackId) {
      return;
    }

    const track = commandState.song?.tracks.find((candidate) => candidate.id === trackId);
    const clipCount = track?.clips.length ?? 0;
    get().dispatch({
      type: "CreateClip",
      trackId,
      name: `Clip ${clipCount + 1}`,
      startBeat: clipCount * 4,
      lengthBeats: 4,
    });
  },

  setTempo: (bpm) => {
    get().dispatch({ type: "SetTempo", bpm });
  },

  setSelectedTrackInstrument: (instrumentId) => {
    const { commandState, selectedTrackId } = get();
    const track = commandState.song?.tracks.find((candidate) => candidate.id === selectedTrackId);
    if (!track) {
      set({ lastError: "Select a track before choosing an instrument." });
      return;
    }
    if (track.kind !== "instrument") {
      set({ lastError: "Only instrument tracks can select a built-in instrument." });
      return;
    }
    get().dispatch({
      type: "SetTrackInstrument",
      trackId: track.id,
      instrumentId,
    });
  },

  playPreview: async () => {
    const { commandState, selectedTrackId, selectedClipId } = get();
    const audition = buildPreviewAudition(commandState.song, selectedTrackId, selectedClipId);

    if (!audition) {
      set({
        preview: {
          phase: "error",
          label: "No clip to preview",
          detail: "Create a clip first.",
        },
      });
      return;
    }

    set({
      preview: {
        phase: "playing",
        label: `Auditioning ${audition.clipName}`,
        detail: `${audition.trackName} · ${audition.instrumentId} · ${audition.bpm} BPM`,
      },
    });

    try {
      await previewAudioEngine.play(audition);
    } catch (error) {
      set({
        preview: {
          phase: "error",
          label: "Preview unavailable",
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },

  stopPreview: async () => {
    try {
      await previewAudioEngine.stop();
    } catch (error) {
      set({
        preview: {
          phase: "error",
          label: "Stop failed",
          detail: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    set({ preview: idlePreviewState });
  },

  duplicateSelectedClip: () => {
    const { commandState, selectedTrackId, selectedClipId } = get();
    const target = resolveEditableClip(commandState, selectedTrackId, selectedClipId);
    if (!target) {
      set({ lastError: "Select a clip before duplicating it." });
      return;
    }

    get().dispatch({
      type: "DuplicateClip",
      trackId: target.track.id,
      clipId: target.clip.id,
    });

    if (!get().lastError) {
      set({ editingNoteId: null, noteDraft: defaultNoteDraft });
    }
  },

  quantizeSelectedClip: (gridBeats) => {
    const { commandState, selectedTrackId, selectedClipId } = get();
    const target = resolveEditableClip(commandState, selectedTrackId, selectedClipId);
    if (!target) {
      set({ lastError: "Select a clip before quantizing it." });
      return;
    }

    get().dispatch({
      type: "QuantizeClip",
      trackId: target.track.id,
      clipId: target.clip.id,
      gridBeats,
    });

    if (!get().lastError) {
      set({ editingNoteId: null, noteDraft: defaultNoteDraft });
    }
  },

  transposeSelectedClip: (semitones) => {
    const { commandState, selectedTrackId, selectedClipId } = get();
    const target = resolveEditableClip(commandState, selectedTrackId, selectedClipId);
    if (!target) {
      set({ lastError: "Select a clip before transposing it." });
      return;
    }

    get().dispatch({
      type: "TransposeClip",
      trackId: target.track.id,
      clipId: target.clip.id,
      semitones,
    });

    if (!get().lastError) {
      set({ editingNoteId: null, noteDraft: defaultNoteDraft });
    }
  },

  saveSong: () => {
    const song = get().commandState.song;
    if (!song) {
      set({ persistence: persistenceStatus("error", "Nothing to save", "Create a song first.") });
      return;
    }

    try {
      const json = saveSongToStorage(song);
      set({
        songJsonDraft: json,
        persistence: persistenceStatus("saved", "Saved locally", song.title),
        lastError: null,
      });
    } catch (error) {
      set({
        persistence: persistenceStatus(
          "error",
          "Save failed",
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  },

  loadSavedSong: () => {
    try {
      const song = loadSongFromStorage();
      if (!song) {
        set({ persistence: persistenceStatus("error", "No saved song", "Nothing is stored yet.") });
        return;
      }

      const current = get();
      set({
        commandState: createCommandState(song, current.commandState.revision + 1),
        undoStack: [...current.undoStack, current.commandState],
        redoStack: [],
        ...deriveSongSelection(song),
        songJsonDraft: exportSongJson(song),
        persistence: persistenceStatus("loaded", "Loaded local song", song.title),
        editingNoteId: null,
        noteDraft: defaultNoteDraft,
        lastError: null,
      });
    } catch (error) {
      set({
        persistence: persistenceStatus(
          "error",
          "Load failed",
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  },

  exportSong: () => {
    const song = get().commandState.song;
    if (!song) {
      set({ persistence: persistenceStatus("error", "Nothing to export", "Create a song first.") });
      return;
    }

    set({
      songJsonDraft: exportSongJson(song),
      persistence: persistenceStatus("exported", "Export ready", song.title),
      lastError: null,
    });
  },

  importSong: () => {
    const source = get().songJsonDraft.trim();
    if (!source) {
      set({ persistence: persistenceStatus("error", "Nothing to import", "Paste song JSON first.") });
      return;
    }

    try {
      const song = importSongJson(source);
      saveSongToStorage(song);
      const current = get();
      set({
        commandState: createCommandState(song, current.commandState.revision + 1),
        undoStack: [...current.undoStack, current.commandState],
        redoStack: [],
        ...deriveSongSelection(song),
        persistence: persistenceStatus("loaded", "Imported song", song.title),
        editingNoteId: null,
        noteDraft: defaultNoteDraft,
        lastError: null,
      });
    } catch (error) {
      set({
        persistence: persistenceStatus(
          "error",
          "Import failed",
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  },

  clearSavedSong: () => {
    try {
      clearSongFromStorage();
      set({
        persistence: persistenceStatus("cleared", "Local save cleared"),
        lastError: null,
      });
    } catch (error) {
      set({
        persistence: persistenceStatus(
          "error",
          "Clear failed",
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  },

  setSongJsonDraft: (draft) => {
    set({ songJsonDraft: draft });
  },

  setNoteDraft: (draft) => {
    set((current) => ({
      noteDraft: {
        ...current.noteDraft,
        ...draft,
      },
    }));
  },

  commitNoteDraft: () => {
    const { commandState, selectedTrackId, selectedClipId, noteDraft, editingNoteId } = get();
    const target = resolveEditableClip(commandState, selectedTrackId, selectedClipId);
    if (!target) {
      set({ lastError: "Select a clip before editing notes." });
      return;
    }

    const command: BeatTwinCommand = editingNoteId
      ? {
          type: "UpdateNote",
          trackId: target.track.id,
          clipId: target.clip.id,
          noteId: editingNoteId,
          ...noteDraft,
        }
      : {
          type: "AddNote",
          trackId: target.track.id,
          clipId: target.clip.id,
          ...noteDraft,
        };

    get().dispatch(command);

    if (!get().lastError) {
      set({ editingNoteId: null, noteDraft: { ...noteDraft, startBeat: noteDraft.startBeat + 0.5 } });
    }
  },

  editNoteFromSelection: (noteId) => {
    const { commandState, selectedTrackId, selectedClipId } = get();
    const target = resolveEditableClip(commandState, selectedTrackId, selectedClipId);
    const note = target?.clip.pattern.notes.find((candidate) => candidate.id === noteId);
    if (!target || !note) {
      set({ lastError: `Note not found: ${noteId}` });
      return;
    }

    set({
      editingNoteId: note.id,
      noteDraft: {
        pitch: note.pitch,
        velocity: note.velocity,
        startBeat: note.startBeat,
        lengthBeats: note.lengthBeats,
      },
      lastError: null,
    });
  },

  removeNoteFromSelection: (noteId) => {
    const { commandState, selectedTrackId, selectedClipId, editingNoteId } = get();
    const target = resolveEditableClip(commandState, selectedTrackId, selectedClipId);
    if (!target) {
      set({ lastError: "Select a clip before removing notes." });
      return;
    }

    get().dispatch({
      type: "RemoveNote",
      trackId: target.track.id,
      clipId: target.clip.id,
      noteId,
    });

    if (editingNoteId === noteId) {
      set({ editingNoteId: null, noteDraft: defaultNoteDraft });
    }
  },

  cancelNoteEdit: () => {
    set({ editingNoteId: null, noteDraft: defaultNoteDraft });
  },

  selectTrack: (trackId) => {
    set({ selectedTrackId: trackId, selectedClipId: null, editingNoteId: null });
  },

  selectClip: (trackId, clipId) => {
    set({ selectedTrackId: trackId, selectedClipId: clipId, editingNoteId: null });
  },

  setDraft: (draft) => {
    set({ draft });
  },

  submitDraft: () => {
    const draft = get().draft.trim();
    if (!draft) {
      return;
    }

    const parsed = parseDraftCommand(draft);
    set((current) => ({
      draft: "",
      messages: [
        ...current.messages,
        { id: messageId(), role: "draft", text: draft },
      ],
    }));

    if (!parsed.ok) {
      set((current) => ({
        messages: [
          ...current.messages,
          { id: messageId(), role: "system", text: parsed.error },
        ],
        lastError: parsed.error,
      }));
      return;
    }

    const blocker = getDraftCommandBlocker(parsed.intent, get());
    if (blocker) {
      set((current) => ({
        messages: [
          ...current.messages,
          { id: messageId(), role: "system", text: blocker },
        ],
        lastError: blocker,
      }));
      return;
    }

    executeDraftCommandIntent(parsed.intent, get());
    set((current) => ({
      messages: [
        ...current.messages,
        { id: messageId(), role: "system", text: `Executed: ${parsed.intent.label}.` },
      ],
    }));
  },
}));
