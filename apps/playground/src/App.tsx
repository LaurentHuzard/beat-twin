import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Clock3,
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
} from "lucide-react";

import type { Clip, Note, Song, Track } from "@beat-twin/core";

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

  const selectedTrack =
    song?.tracks.find((track) => track.id === selectedTrackId) ?? song?.tracks[0] ?? null;
  const selectedClip =
    selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ??
    selectedTrack?.clips[0] ??
    null;
  const canPreview = Boolean(buildPreviewAudition(song, selectedTrackId, selectedClipId));

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
      />

      <section className="workspace-grid" aria-label="Beat Twin workspace">
        <Timeline song={song} selectedClipId={selectedClip?.id ?? null} />
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
    </main>
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
          title="Undo"
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo"
        >
          <Redo2 size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            void onPlayPreview();
          }}
          disabled={!canPreview || isPlayingPreview}
          aria-label="Play preview"
          title="Play preview"
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
          title="Stop preview"
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
  readonly selectedClipId: string | null;
};

function Timeline({ song, selectedClipId }: TimelineProps) {
  const tracks = song?.tracks ?? [];
  const selectTrack = usePlaygroundStore((state) => state.selectTrack);
  const selectClip = usePlaygroundStore((state) => state.selectClip);

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
      </div>

      <div className="track-lanes">
        {tracks.length === 0 ? (
          <div className="empty-lane">Create Demo</div>
        ) : (
          tracks.map((track) => (
            <button
              type="button"
              className="track-row"
              key={track.id}
              onClick={() => selectTrack(track.id)}
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
                    {clip.name}
                  </span>
                ))}
              </span>
            </button>
          ))
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
        title="Duplicate clip"
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
          title="Quantize clip to quarter beat"
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
          title={isEditing ? "Save note" : "Add note"}
        >
          {isEditing ? <Save size={18} /> : <Plus size={18} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onCancel}
          disabled={disabled || !isEditing}
          aria-label="Cancel note edit"
          title="Cancel note edit"
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
