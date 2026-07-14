import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Clock3,
  Command as CommandIcon,
  Copy,
  Download,
  FolderOpen,
  Grid3X3,
  ListMusic,
  MessageSquareText,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Redo2,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  StepForward,
  Square,
  TimerReset,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  Waves,
  X,
} from "lucide-react";

import type { Clip, Note, Song, Track } from "@beat-twin/core";

import { LiveComparisonLab } from "./LiveComparisonLab";
import { buildPreviewAudition, type PreviewState } from "./previewAudio";
import {
  usePlaygroundStore,
  type NoteDraft,
  type PersistenceState,
} from "./store";

const beatColumns = 16;

function App() {
  const song = usePlaygroundStore((state) => state.commandState.song);
  const events = usePlaygroundStore((state) => state.commandState.log);
  const canUndo = usePlaygroundStore((state) => state.undoStack.length > 0);
  const canRedo = usePlaygroundStore((state) => state.redoStack.length > 0);
  const messages = usePlaygroundStore((state) => state.messages);
  const draft = usePlaygroundStore((state) => state.draft);
  const songJsonDraft = usePlaygroundStore((state) => state.songJsonDraft);
  const persistence = usePlaygroundStore((state) => state.persistence);
  const noteDraft = usePlaygroundStore((state) => state.noteDraft);
  const editingNoteId = usePlaygroundStore((state) => state.editingNoteId);
  const selectedTrackId = usePlaygroundStore((state) => state.selectedTrackId);
  const selectedClipId = usePlaygroundStore((state) => state.selectedClipId);
  const preview = usePlaygroundStore((state) => state.preview);
  const lastError = usePlaygroundStore((state) => state.lastError);
  const undo = usePlaygroundStore((state) => state.undo);
  const redo = usePlaygroundStore((state) => state.redo);
  const createDemo = usePlaygroundStore((state) => state.createDemo);
  const addTrack = usePlaygroundStore((state) => state.addTrack);
  const addClipToSelection = usePlaygroundStore((state) => state.addClipToSelection);
  const setTempo = usePlaygroundStore((state) => state.setTempo);
  const playPreview = usePlaygroundStore((state) => state.playPreview);
  const stopPreview = usePlaygroundStore((state) => state.stopPreview);
  const duplicateSelectedClip = usePlaygroundStore((state) => state.duplicateSelectedClip);
  const quantizeSelectedClip = usePlaygroundStore((state) => state.quantizeSelectedClip);
  const transposeSelectedClip = usePlaygroundStore((state) => state.transposeSelectedClip);
  const setNoteDraft = usePlaygroundStore((state) => state.setNoteDraft);
  const commitNoteDraft = usePlaygroundStore((state) => state.commitNoteDraft);
  const editNoteFromSelection = usePlaygroundStore((state) => state.editNoteFromSelection);
  const removeNoteFromSelection = usePlaygroundStore((state) => state.removeNoteFromSelection);
  const cancelNoteEdit = usePlaygroundStore((state) => state.cancelNoteEdit);
  const saveSong = usePlaygroundStore((state) => state.saveSong);
  const loadSavedSong = usePlaygroundStore((state) => state.loadSavedSong);
  const exportSong = usePlaygroundStore((state) => state.exportSong);
  const importSong = usePlaygroundStore((state) => state.importSong);
  const clearSavedSong = usePlaygroundStore((state) => state.clearSavedSong);
  const setSongJsonDraft = usePlaygroundStore((state) => state.setSongJsonDraft);
  const setDraft = usePlaygroundStore((state) => state.setDraft);
  const submitDraft = usePlaygroundStore((state) => state.submitDraft);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isLiveLabRunning, setLiveLabRunning] = useState(false);

  const selectedTrack =
    song?.tracks.find((track) => track.id === selectedTrackId) ?? song?.tracks[0] ?? null;
  const selectedClip =
    selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ??
    selectedTrack?.clips[0] ??
    null;
  const canPreview =
    Boolean(buildPreviewAudition(song, selectedTrackId, selectedClipId)) && !isLiveLabRunning;
  const isPlayingPreview = preview.phase === "playing";

  useKeyboardShortcuts({
    canPreview,
    isPlayingPreview,
    onUndo: undo,
    onRedo: redo,
    onPlayPreview: playPreview,
    onStopPreview: stopPreview,
    onCommitNote: commitNoteDraft,
    onCancelNoteEdit: cancelNoteEdit,
    onDuplicateClip: duplicateSelectedClip,
    onQuantizeClip: quantizeSelectedClip,
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
  });

  const commandPaletteActions = useMemo<readonly PaletteAction[]>(
    () => [
      {
        id: "create-demo",
        label: "Create Demo",
        detail: "Song sketch",
        status: song ? "Replace" : "New",
        icon: <Sparkles size={18} />,
        run: createDemo,
      },
      {
        id: "add-track",
        label: "Add Track",
        detail: "Command bus",
        status: song ? "Track" : "Song + track",
        icon: <Plus size={18} />,
        run: addTrack,
      },
      {
        id: "add-clip",
        label: "Add Clip",
        detail: selectedTrack?.name ?? "No track",
        status: selectedTrack ? "Clip" : "Blocked",
        icon: <ListMusic size={18} />,
        disabled: !selectedTrack,
        run: addClipToSelection,
      },
      {
        id: "play-preview",
        label: "Play Preview",
        detail: selectedClip?.name ?? "No clip",
        status: canPreview && !isPlayingPreview ? "Audio" : "Blocked",
        icon: <Play size={18} />,
        disabled: !canPreview || isPlayingPreview,
        run: () => {
          void playPreview();
        },
      },
      {
        id: "stop-preview",
        label: "Stop Preview",
        detail: preview.label,
        status: isPlayingPreview ? "Audio" : "Idle",
        icon: <Square size={18} />,
        disabled: !isPlayingPreview,
        run: () => {
          void stopPreview();
        },
      },
      {
        id: "duplicate-clip",
        label: "Duplicate Clip",
        detail: selectedClip?.name ?? "No clip",
        status: selectedClip ? "Pattern" : "Blocked",
        icon: <Copy size={18} />,
        disabled: !selectedClip,
        run: duplicateSelectedClip,
      },
      {
        id: "quantize-clip",
        label: "Quantize Clip",
        detail: selectedClip?.name ?? "No clip",
        status: "1/4",
        icon: <Grid3X3 size={18} />,
        disabled: !selectedClip,
        run: () => quantizeSelectedClip(0.25),
      },
      {
        id: "transpose-up",
        label: "Transpose Up",
        detail: selectedClip?.name ?? "No clip",
        status: "+1",
        icon: <ArrowUp size={18} />,
        disabled: !selectedClip,
        run: () => transposeSelectedClip(1),
      },
      {
        id: "transpose-down",
        label: "Transpose Down",
        detail: selectedClip?.name ?? "No clip",
        status: "-1",
        icon: <ArrowDown size={18} />,
        disabled: !selectedClip,
        run: () => transposeSelectedClip(-1),
      },
      {
        id: "save-song",
        label: "Save Song",
        detail: song?.title ?? "No song",
        status: song ? "Local" : "Blocked",
        icon: <Save size={18} />,
        disabled: !song,
        run: saveSong,
      },
      {
        id: "load-song",
        label: "Load Song",
        detail: persistence.hasSavedSong ? "Stored song" : "No local save",
        status: persistence.hasSavedSong ? "Local" : "Blocked",
        icon: <FolderOpen size={18} />,
        disabled: !persistence.hasSavedSong,
        run: loadSavedSong,
      },
      {
        id: "export-song",
        label: "Export Song",
        detail: song?.title ?? "No song",
        status: song ? "JSON" : "Blocked",
        icon: <Download size={18} />,
        disabled: !song,
        run: exportSong,
      },
      {
        id: "undo",
        label: "Undo",
        detail: "History",
        status: canUndo ? "Ready" : "Empty",
        icon: <Undo2 size={18} />,
        disabled: !canUndo,
        run: undo,
      },
      {
        id: "redo",
        label: "Redo",
        detail: "History",
        status: canRedo ? "Ready" : "Empty",
        icon: <Redo2 size={18} />,
        disabled: !canRedo,
        run: redo,
      },
    ],
    [
      addClipToSelection,
      addTrack,
      canPreview,
      canRedo,
      canUndo,
      createDemo,
      duplicateSelectedClip,
      exportSong,
      isPlayingPreview,
      loadSavedSong,
      persistence.hasSavedSong,
      playPreview,
      preview.label,
      quantizeSelectedClip,
      redo,
      saveSong,
      selectedClip,
      selectedTrack,
      song,
      stopPreview,
      transposeSelectedClip,
      undo,
    ],
  );

  return (
    <main className="app-shell">
      <TransportStrip
        song={song}
        preview={preview}
        canPreview={canPreview}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onCreateDemo={createDemo}
        onAddTrack={addTrack}
        onAddClip={addClipToSelection}
        onTempoChange={setTempo}
        onPlayPreview={playPreview}
        onStopPreview={stopPreview}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      <section className="workspace-grid" aria-label="Beat Twin workspace">
        <Timeline
          song={song}
          selectedTrackId={selectedTrack?.id ?? null}
          selectedClipId={selectedClip?.id ?? null}
        />
        <Inspector
          song={song}
          track={selectedTrack}
          clip={selectedClip}
          noteDraft={noteDraft}
          editingNoteId={editingNoteId}
          onNoteDraftChange={setNoteDraft}
          onCommitNote={commitNoteDraft}
          onEditNote={editNoteFromSelection}
          onRemoveNote={removeNoteFromSelection}
          onCancelNoteEdit={cancelNoteEdit}
          onDuplicateClip={duplicateSelectedClip}
          onQuantizeClip={quantizeSelectedClip}
          onTransposeClip={transposeSelectedClip}
        />
      </section>

      <LiveComparisonLab
        externalAudioActive={isPlayingPreview}
        onRunningChange={setLiveLabRunning}
      />

      <CommandDock
        events={events}
        messages={messages}
        draft={draft}
        songJsonDraft={songJsonDraft}
        persistence={persistence}
        lastError={lastError}
        onDraftChange={setDraft}
        onSubmitDraft={submitDraft}
        onSongJsonDraftChange={setSongJsonDraft}
        onSaveSong={saveSong}
        onLoadSavedSong={loadSavedSong}
        onExportSong={exportSong}
        onImportSong={importSong}
        onClearSavedSong={clearSavedSong}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        actions={commandPaletteActions}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </main>
  );
}

type KeyboardShortcutOptions = {
  readonly canPreview: boolean;
  readonly isPlayingPreview: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onPlayPreview: () => Promise<void>;
  readonly onStopPreview: () => Promise<void>;
  readonly onCommitNote: () => void;
  readonly onCancelNoteEdit: () => void;
  readonly onDuplicateClip: () => void;
  readonly onQuantizeClip: (gridBeats: number) => void;
  readonly onOpenCommandPalette: () => void;
};

function useKeyboardShortcuts({
  canPreview,
  isPlayingPreview,
  onUndo,
  onRedo,
  onPlayPreview,
  onStopPreview,
  onCommitNote,
  onCancelNoteEdit,
  onDuplicateClip,
  onQuantizeClip,
  onOpenCommandPalette,
}: KeyboardShortcutOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasCommandModifier = event.metaKey || event.ctrlKey;

      if (hasCommandModifier && key === "k") {
        event.preventDefault();
        onOpenCommandPalette();
        return;
      }

      if (hasCommandModifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          onRedo();
          return;
        }

        onUndo();
        return;
      }

      if (hasCommandModifier && key === "y") {
        event.preventDefault();
        onRedo();
        return;
      }

      if (hasCommandModifier || event.altKey) {
        return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (isPlayingPreview) {
          void onStopPreview();
          return;
        }

        if (canPreview) {
          void onPlayPreview();
        }
        return;
      }

      if (key === "n") {
        event.preventDefault();
        onCommitNote();
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        onCancelNoteEdit();
        return;
      }

      if (key === "d") {
        event.preventDefault();
        onDuplicateClip();
        return;
      }

      if (key === "q") {
        event.preventDefault();
        onQuantizeClip(0.25);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canPreview,
    isPlayingPreview,
    onCancelNoteEdit,
    onCommitNote,
    onDuplicateClip,
    onOpenCommandPalette,
    onPlayPreview,
    onQuantizeClip,
    onRedo,
    onStopPreview,
    onUndo,
  ]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

type TransportStripProps = {
  readonly song: Song | null;
  readonly preview: PreviewState;
  readonly canPreview: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCreateDemo: () => void;
  readonly onAddTrack: () => void;
  readonly onAddClip: () => void;
  readonly onTempoChange: (bpm: number) => void;
  readonly onPlayPreview: () => Promise<void>;
  readonly onStopPreview: () => Promise<void>;
  readonly onOpenCommandPalette: () => void;
};

function TransportStrip({
  song,
  preview,
  canPreview,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCreateDemo,
  onAddTrack,
  onAddClip,
  onTempoChange,
  onPlayPreview,
  onStopPreview,
  onOpenCommandPalette,
}: TransportStripProps) {
  const bpm = song?.transport.bpm ?? 120;
  const isPlayingPreview = preview.phase === "playing";

  return (
    <header className="transport-strip">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <Waves size={24} />
        </div>
        <div>
          <h1>Beat Twin</h1>
          <p>{song?.title ?? "No song loaded"}</p>
        </div>
      </div>

      <div className="transport-meters" aria-label="Transport">
        <div className="meter">
          <Clock3 size={18} />
          <span>{bpm} BPM</span>
        </div>
        <div className="meter">
          <StepForward size={18} />
          <span>{song?.transport.positionBeats ?? 0} beats</span>
        </div>
        <label className="tempo-control">
          <TimerReset size={18} />
          <input
            aria-label="Tempo"
            type="range"
            min="60"
            max="180"
            step="1"
            value={bpm}
            onChange={(event) => onTempoChange(Number(event.currentTarget.value))}
            disabled={!song}
          />
        </label>
        <div
          className={`preview-status ${preview.phase}`}
          role="status"
          aria-live="polite"
        >
          <Volume2 size={18} />
          <span>{preview.label}</span>
          {preview.detail ? <small>{preview.detail}</small> : null}
        </div>
      </div>

      <div className="transport-actions">
        <button
          type="button"
          className="icon-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          <Redo2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
          title="Open command palette (Ctrl/Cmd+K)"
        >
          <CommandIcon size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            void onPlayPreview();
          }}
          disabled={!canPreview || isPlayingPreview}
          aria-label="Play preview"
          title="Play preview (Space)"
        >
          <Play size={19} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            void onStopPreview();
          }}
          disabled={!isPlayingPreview}
          aria-label="Stop preview"
          title="Stop preview (Space)"
        >
          <Square size={18} />
        </button>
        <button type="button" className="tool-button primary" onClick={onCreateDemo}>
          <Sparkles size={18} />
          <span>Create Demo</span>
        </button>
        <button type="button" className="tool-button" onClick={onAddTrack}>
          <Plus size={18} />
          <span>Add Track</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onAddClip}
          aria-label="Add clip"
          title="Add clip"
        >
          <ListMusic size={19} />
        </button>
      </div>
    </header>
  );
}

type TimelineProps = {
  readonly song: Song | null;
  readonly selectedTrackId: string | null;
  readonly selectedClipId: string | null;
};

function Timeline({ song, selectedTrackId, selectedClipId }: TimelineProps) {
  const tracks = song?.tracks ?? [];
  const selectTrack = usePlaygroundStore((state) => state.selectTrack);
  const selectClip = usePlaygroundStore((state) => state.selectClip);
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const selectedClip =
    selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ?? null;
  const clipCount = tracks.reduce((total, track) => total + track.clips.length, 0);
  const noteCount = tracks.reduce(
    (total, track) =>
      total +
      track.clips.reduce((clipTotal, clip) => clipTotal + clip.pattern.notes.length, 0),
    0,
  );

  return (
    <section className="timeline-surface" aria-label="Timeline">
      <div className="timeline-header">
        <div className="surface-title">
          <Music2 size={18} />
          <h2>Timeline</h2>
        </div>
        <div className="beat-ruler" aria-hidden="true">
          {Array.from({ length: beatColumns }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <div className="timeline-summary" aria-label="Timeline summary">
          <span>{formatCount(tracks.length, "track")}</span>
          <span>{formatCount(clipCount, "clip")}</span>
          <span>{formatCount(noteCount, "note")}</span>
          <strong>{selectedClip?.name ?? selectedTrack?.name ?? "No selection"}</strong>
        </div>
      </div>

      <div className="track-lanes">
        {tracks.length === 0 ? (
          <div className="empty-lane">Create Demo</div>
        ) : (
          tracks.map((track) => {
            const isSelectedTrack = track.id === selectedTrackId;

            return (
              <button
                type="button"
                className={isSelectedTrack ? "track-row selected" : "track-row"}
                key={track.id}
                onClick={() => selectTrack(track.id)}
                aria-pressed={isSelectedTrack}
                data-testid="track-row"
              >
                <span className="track-name">
                  <span className="track-swatch" style={{ background: track.color }} />
                  {track.name}
                </span>
                <span className="clip-lane">
                  {track.clips.map((clip) => (
                    <span
                      role="button"
                      tabIndex={0}
                      key={clip.id}
                      className={
                        clip.id === selectedClipId ? "clip-block selected" : "clip-block"
                      }
                      style={clipStyle(clip)}
                      aria-label={`${clip.name}, ${formatCount(
                        clip.pattern.notes.length,
                        "note",
                      )}, starts at beat ${clip.startBeat}`}
                      data-testid="clip-block"
                      onClick={(event) => {
                        event.stopPropagation();
                        selectClip(track.id, clip.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          selectClip(track.id, clip.id);
                        }
                      }}
                    >
                      <span className="clip-title">{clip.name}</span>
                      <span className="clip-meta">
                        {formatCount(clip.pattern.notes.length, "note")}
                      </span>
                      <span className="clip-note-map" aria-hidden="true">
                        {clip.pattern.notes.map((note) => (
                          <span
                            key={note.id}
                            className="clip-note-marker"
                            style={noteMarkerStyle(note, clip)}
                            data-testid="clip-note-marker"
                          />
                        ))}
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function clipStyle(clip: Clip) {
  const left = (clip.startBeat / beatColumns) * 100;
  const width = (clip.lengthBeats / beatColumns) * 100;

  return {
    left: `${Math.min(left, 92)}%`,
    width: `${Math.max(8, Math.min(width, 100 - left))}%`,
  };
}

function noteMarkerStyle(note: Note, clip: Clip) {
  const left = clip.lengthBeats > 0 ? (note.startBeat / clip.lengthBeats) * 100 : 0;
  const width =
    clip.lengthBeats > 0 ? (note.lengthBeats / clip.lengthBeats) * 100 : 100;
  const clampedLeft = Math.min(98, Math.max(0, left));

  return {
    left: `${clampedLeft}%`,
    width: `${Math.max(3, Math.min(width, 100 - clampedLeft))}%`,
  };
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

type PaletteAction = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly status: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly run: () => void;
};

type CommandPaletteProps = {
  readonly isOpen: boolean;
  readonly actions: readonly PaletteAction[];
  readonly onClose: () => void;
};

function CommandPalette({ isOpen, actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredActions = useMemo(() => filterPaletteActions(actions, query), [actions, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setQuery("");
    setActiveIndex(firstEnabledActionIndex(actions));
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [actions, isOpen]);

  useEffect(() => {
    setActiveIndex(firstEnabledActionIndex(filteredActions));
  }, [filteredActions]);

  if (!isOpen) {
    return null;
  }

  const executeAction = (action: PaletteAction | undefined) => {
    if (!action || action.disabled) {
      return;
    }

    onClose();
    action.run();
  };

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="palette-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchInputRef}
            aria-label="Command palette search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => nextEnabledActionIndex(filteredActions, index, 1));
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => nextEnabledActionIndex(filteredActions, index, -1));
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                executeAction(filteredActions[activeIndex]);
              }
            }}
            placeholder="Search actions"
          />
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close command palette"
            title="Close command palette"
          >
            <X size={18} />
          </button>
        </div>

        <div className="palette-list" role="listbox" aria-label="Command palette actions">
          {filteredActions.length === 0 ? (
            <div className="palette-empty">No command</div>
          ) : (
            filteredActions.map((action, index) => (
              <button
                type="button"
                role="option"
                key={action.id}
                className={
                  index === activeIndex ? "palette-action active" : "palette-action"
                }
                aria-selected={index === activeIndex}
                disabled={action.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => executeAction(action)}
              >
                <span className="palette-action-icon">{action.icon}</span>
                <span className="palette-action-copy">
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
                <span className="palette-action-status">{action.status}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function filterPaletteActions(
  actions: readonly PaletteAction[],
  query: string,
): readonly PaletteAction[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return actions;
  }

  return actions.filter((action) =>
    `${action.label} ${action.detail} ${action.status}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function firstEnabledActionIndex(actions: readonly PaletteAction[]): number {
  const index = actions.findIndex((action) => !action.disabled);
  return index === -1 ? 0 : index;
}

function nextEnabledActionIndex(
  actions: readonly PaletteAction[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (actions.length === 0) {
    return 0;
  }

  for (let offset = 1; offset <= actions.length; offset += 1) {
    const index = (currentIndex + offset * direction + actions.length) % actions.length;
    if (!actions[index]?.disabled) {
      return index;
    }
  }

  return currentIndex;
}

type InspectorProps = {
  readonly song: Song | null;
  readonly track: Track | null;
  readonly clip: Clip | null;
  readonly noteDraft: NoteDraft;
  readonly editingNoteId: string | null;
  readonly onNoteDraftChange: (draft: Partial<NoteDraft>) => void;
  readonly onCommitNote: () => void;
  readonly onEditNote: (noteId: string) => void;
  readonly onRemoveNote: (noteId: string) => void;
  readonly onCancelNoteEdit: () => void;
  readonly onDuplicateClip: () => void;
  readonly onQuantizeClip: (gridBeats: number) => void;
  readonly onTransposeClip: (semitones: number) => void;
};

function Inspector({
  song,
  track,
  clip,
  noteDraft,
  editingNoteId,
  onNoteDraftChange,
  onCommitNote,
  onEditNote,
  onRemoveNote,
  onCancelNoteEdit,
  onDuplicateClip,
  onQuantizeClip,
  onTransposeClip,
}: InspectorProps) {
  const notes = clip?.pattern.notes ?? [];

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="surface-title">
        <SlidersHorizontal size={18} />
        <h2>Inspector</h2>
      </div>

      <dl className="inspector-list">
        <div>
          <dt>Song</dt>
          <dd>{song?.title ?? "None"}</dd>
        </div>
        <div>
          <dt>Track</dt>
          <dd>{track?.name ?? "None"}</dd>
        </div>
        <div>
          <dt>Clip</dt>
          <dd>{clip?.name ?? "None"}</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{clip ? `${clip.lengthBeats} beats` : "0 beats"}</dd>
        </div>
      </dl>

      <div className="note-strip" aria-label="Notes">
        {notes.length === 0 ? (
          <span className="note-empty">No notes</span>
        ) : (
          notes.map((note) => (
            <NotePill
              key={note.id}
              note={note}
              isEditing={editingNoteId === note.id}
              onEdit={onEditNote}
              onRemove={onRemoveNote}
            />
          ))
        )}
      </div>

      <PatternTools
        disabled={!clip}
        onDuplicateClip={onDuplicateClip}
        onQuantizeClip={onQuantizeClip}
        onTransposeClip={onTransposeClip}
      />

      <NoteEditor
        disabled={!clip}
        draft={noteDraft}
        isEditing={Boolean(editingNoteId)}
        onDraftChange={onNoteDraftChange}
        onCommit={onCommitNote}
        onCancel={onCancelNoteEdit}
      />
    </aside>
  );
}

type PatternToolsProps = {
  readonly disabled: boolean;
  readonly onDuplicateClip: () => void;
  readonly onQuantizeClip: (gridBeats: number) => void;
  readonly onTransposeClip: (semitones: number) => void;
};

function PatternTools({
  disabled,
  onDuplicateClip,
  onQuantizeClip,
  onTransposeClip,
}: PatternToolsProps) {
  return (
    <div className="pattern-tools" aria-label="Pattern tools">
      <button
        type="button"
        className="icon-button"
        onClick={onDuplicateClip}
        disabled={disabled}
        aria-label="Duplicate clip"
        title="Duplicate clip (D)"
      >
        <Copy size={18} />
      </button>
      <div className="pattern-tool-group" aria-label="Quantize grid">
        <Grid3X3 size={16} aria-hidden="true" />
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onQuantizeClip(0.25)}
          disabled={disabled}
          aria-label="Quantize clip to quarter beat"
          title="Quantize clip to quarter beat (Q)"
        >
          1/4
        </button>
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onQuantizeClip(0.5)}
          disabled={disabled}
          aria-label="Quantize clip to half beat"
          title="Quantize clip to half beat"
        >
          1/2
        </button>
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onQuantizeClip(1)}
          disabled={disabled}
          aria-label="Quantize clip to 1 beat"
          title="Quantize clip to 1 beat"
        >
          1
        </button>
      </div>
      <div className="pattern-tool-group" aria-label="Transpose">
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onTransposeClip(-12)}
          disabled={disabled}
          aria-label="Transpose clip down 12 semitones"
          title="Transpose clip down 12 semitones"
        >
          <ArrowDown size={14} />
          12
        </button>
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onTransposeClip(-1)}
          disabled={disabled}
          aria-label="Transpose clip down 1 semitone"
          title="Transpose clip down 1 semitone"
        >
          <ArrowDown size={14} />
          1
        </button>
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onTransposeClip(1)}
          disabled={disabled}
          aria-label="Transpose clip up 1 semitone"
          title="Transpose clip up 1 semitone"
        >
          <ArrowUp size={14} />
          1
        </button>
        <button
          type="button"
          className="mini-tool-button"
          onClick={() => onTransposeClip(12)}
          disabled={disabled}
          aria-label="Transpose clip up 12 semitones"
          title="Transpose clip up 12 semitones"
        >
          <ArrowUp size={14} />
          12
        </button>
      </div>
    </div>
  );
}

function NotePill({
  note,
  isEditing,
  onEdit,
  onRemove,
}: {
  readonly note: Note;
  readonly isEditing: boolean;
  readonly onEdit: (noteId: string) => void;
  readonly onRemove: (noteId: string) => void;
}) {
  return (
    <span className={isEditing ? "note-row editing" : "note-row"}>
      <button
        type="button"
        className="note-pill"
        onClick={() => onEdit(note.id)}
        aria-label={`Edit note ${note.pitch} at beat ${note.startBeat}`}
      >
        <CircleDot size={14} />
        {note.pitch}
        <small>{note.startBeat}</small>
      </button>
      <button
        type="button"
        className="mini-icon danger"
        onClick={() => onRemove(note.id)}
        aria-label={`Remove note ${note.pitch} at beat ${note.startBeat}`}
        title="Remove note"
      >
        <Trash2 size={14} />
      </button>
    </span>
  );
}

type NoteEditorProps = {
  readonly disabled: boolean;
  readonly draft: NoteDraft;
  readonly isEditing: boolean;
  readonly onDraftChange: (draft: Partial<NoteDraft>) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
};

function NoteEditor({
  disabled,
  draft,
  isEditing,
  onDraftChange,
  onCommit,
  onCancel,
}: NoteEditorProps) {
  return (
    <div className="note-editor" aria-label="Note editor">
      <NumberField
        label="Pitch"
        ariaLabel="Note pitch"
        value={draft.pitch}
        min={0}
        max={127}
        step={1}
        disabled={disabled}
        onChange={(pitch) => onDraftChange({ pitch })}
      />
      <NumberField
        label="Beat"
        ariaLabel="Note beat"
        value={draft.startBeat}
        min={0}
        step={0.25}
        disabled={disabled}
        onChange={(startBeat) => onDraftChange({ startBeat })}
      />
      <NumberField
        label="Len"
        ariaLabel="Note length"
        value={draft.lengthBeats}
        min={0.25}
        step={0.25}
        disabled={disabled}
        onChange={(lengthBeats) => onDraftChange({ lengthBeats })}
      />
      <NumberField
        label="Vel"
        ariaLabel="Note velocity"
        value={draft.velocity}
        min={0}
        max={127}
        step={1}
        disabled={disabled}
        onChange={(velocity) => onDraftChange({ velocity })}
      />
      <div className="note-editor-actions">
        <button
          type="button"
          className="icon-button"
          onClick={onCommit}
          disabled={disabled}
          aria-label={isEditing ? "Save note" : "Add note"}
          title={isEditing ? "Save note (N)" : "Add note (N)"}
        >
          {isEditing ? <Save size={18} /> : <Plus size={18} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onCancel}
          disabled={disabled || !isEditing}
          aria-label="Cancel note edit"
          title="Cancel note edit (Esc)"
        >
          <RotateCcw size={18} />
        </button>
      </div>
    </div>
  );
}

type NumberFieldProps = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
};

function NumberField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: NumberFieldProps) {
  return (
    <label className="note-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

type CommandDockProps = {
  readonly events: readonly { readonly type: string }[];
  readonly messages: readonly { readonly id: string; readonly role: string; readonly text: string }[];
  readonly draft: string;
  readonly songJsonDraft: string;
  readonly persistence: PersistenceState;
  readonly lastError: string | null;
  readonly onDraftChange: (draft: string) => void;
  readonly onSubmitDraft: () => void;
  readonly onSongJsonDraftChange: (draft: string) => void;
  readonly onSaveSong: () => void;
  readonly onLoadSavedSong: () => void;
  readonly onExportSong: () => void;
  readonly onImportSong: () => void;
  readonly onClearSavedSong: () => void;
};

function CommandDock({
  events,
  messages,
  draft,
  songJsonDraft,
  persistence,
  lastError,
  onDraftChange,
  onSubmitDraft,
  onSongJsonDraftChange,
  onSaveSong,
  onLoadSavedSong,
  onExportSong,
  onImportSong,
  onClearSavedSong,
}: CommandDockProps) {
  return (
    <section className="command-dock" aria-label="Command log">
      <div className="surface-title">
        <MessageSquareText size={18} />
        <h2>Commands</h2>
      </div>

      <div className="event-log">
        {events.slice(-8).map((event, index) => (
          <span className="event-chip" key={`${event.type}-${index}`}>
            {event.type}
          </span>
        ))}
        {messages.map((message) => (
          <span className={`message-chip ${message.role}`} key={message.id}>
            {message.text}
          </span>
        ))}
        {lastError ? <span className="error-chip">{lastError}</span> : null}
      </div>

      <form
        className="command-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitDraft();
        }}
      >
        <input
          aria-label="Command draft"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          placeholder="Draft command"
        />
        <button type="submit" className="icon-button send" aria-label="Send command">
          <Send size={18} />
        </button>
      </form>

      <div className="storage-panel" aria-label="Song storage">
        <div
          className={`storage-status ${persistence.phase}`}
          role="status"
          aria-live="polite"
        >
          <span>{persistence.label}</span>
          {persistence.detail ? <small>{persistence.detail}</small> : null}
        </div>
        <div className="storage-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onSaveSong}
            aria-label="Save song locally"
            title="Save song locally"
          >
            <Save size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onLoadSavedSong}
            disabled={!persistence.hasSavedSong}
            aria-label="Load local song"
            title="Load local song"
          >
            <FolderOpen size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onExportSong}
            aria-label="Export song JSON"
            title="Export song JSON"
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onImportSong}
            aria-label="Import song JSON"
            title="Import song JSON"
          >
            <Upload size={18} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            onClick={onClearSavedSong}
            disabled={!persistence.hasSavedSong}
            aria-label="Clear local song"
            title="Clear local song"
          >
            <Trash2 size={18} />
          </button>
        </div>
        <textarea
          aria-label="Song JSON"
          value={songJsonDraft}
          onChange={(event) => onSongJsonDraftChange(event.currentTarget.value)}
          placeholder="Song JSON"
        />
      </div>
    </section>
  );
}

export default App;
