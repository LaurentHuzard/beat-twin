import { create } from "zustand";

import {
  createCommandState,
  executeCommand,
  type BeatTwinCommand,
  type CommandEvent,
  type CommandState,
  type IdScope,
} from "@beat-twin/commands";
import type { Song } from "@beat-twin/core";

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

type PlaygroundStore = {
  readonly commandState: CommandState;
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
  readonly createDemo: () => void;
  readonly addTrack: () => void;
  readonly addClipToSelection: () => void;
  readonly setTempo: (bpm: number) => void;
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
  let nextState = state;
  const events: CommandEvent[] = [];

  for (const command of commands) {
    const result = executeCommand(nextState, command, { idFactory: makeId });
    if (!result.ok) {
      return { state: nextState, events, error: result.error };
    }
    nextState = result.state;
    events.push(...result.events);
  }

  return { state: nextState, events, error: null };
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

export const usePlaygroundStore = create<PlaygroundStore>((set, get) => ({
  commandState: createCommandState(),
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
        ...deriveSelection(result.state),
        persistence: persistence ?? current.persistence,
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
      const persistence = autosaveSong(result.state.song);
      return {
        commandState: result.state,
        ...deriveSelection(result.state),
        songJsonDraft: result.state.song ? exportSongJson(result.state.song) : current.songJsonDraft,
        persistence: persistence ?? current.persistence,
        lastError: result.error,
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
        detail: `${audition.trackName} - ${audition.bpm} BPM`,
      },
    });
    get().dispatch({ type: "StartPlayback", positionBeats: 0 });

    try {
      await previewAudioEngine.play(audition);
    } catch (error) {
      get().dispatch({ type: "StopPlayback" });
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

    get().dispatch({ type: "StopPlayback" });
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

      set({
        commandState: createCommandState(song),
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
      set({
        commandState: createCommandState(song),
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

    set((current) => ({
      draft: "",
      messages: [
        ...current.messages,
        { id: messageId(), role: "draft", text: draft },
        { id: messageId(), role: "system", text: "Queued as a command draft." },
      ],
    }));
  },
}));
