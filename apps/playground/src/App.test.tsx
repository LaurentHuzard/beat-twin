import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { PLAYGROUND_SONG_STORAGE_KEY } from "./persistence";
import type { PreviewAudioEngine } from "./previewAudio";
import { setPreviewAudioEngine, usePlaygroundStore } from "./store";

afterEach(() => {
  cleanup();
  localStorage.clear();
  const initialState = usePlaygroundStore.getInitialState();
  usePlaygroundStore.setState({
    commandState: initialState.commandState,
    undoStack: [],
    redoStack: [],
    messages: [],
    draft: "",
    songJsonDraft: "",
    persistence: {
      phase: "idle",
      label: "No saved song",
      hasSavedSong: false,
    },
    noteDraft: initialState.noteDraft,
    editingNoteId: null,
    selectedTrackId: null,
    selectedClipId: null,
    preview: initialState.preview,
    lastError: null,
  });
});

function mockPreviewAudioEngine(): PreviewAudioEngine {
  const engine: PreviewAudioEngine = {
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  setPreviewAudioEngine(engine);
  return engine;
}

describe("Playground", () => {
  it("renders the transport and can create demo material", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));

    expect(screen.getAllByText("Playground Sketch").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Drums").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kick Ladder").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder");
  });

  it("shows selected timeline density and note markers", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));

    const timelineSummary = screen.getByLabelText("Timeline summary");
    expect(timelineSummary).toHaveTextContent("1 track");
    expect(timelineSummary).toHaveTextContent("1 clip");
    expect(timelineSummary).toHaveTextContent("3 notes");
    expect(timelineSummary).toHaveTextContent("Kick Ladder");
    expect(screen.getByTestId("track-row")).toHaveClass("selected");
    expect(
      screen.getByRole("button", {
        name: /kick ladder, 3 notes, starts at beat 0/i,
      }),
    ).toHaveClass("selected");
    expect(screen.getAllByTestId("clip-note-marker")).toHaveLength(3);
  });

  it("adds tracks through the command bus", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /add track/i }));
    fireEvent.click(screen.getByRole("button", { name: /add track/i }));

    expect(screen.getAllByTestId("track-row")).toHaveLength(2);
    expect(screen.getByLabelText("Command log")).toHaveTextContent("TrackCreated");
  });

  it("opens the command palette and runs filtered actions", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));

    const dialog = screen.getByRole("dialog", { name: /command palette/i });
    fireEvent.change(within(dialog).getByLabelText("Command palette search"), {
      target: { value: "demo" },
    });
    fireEvent.click(within(dialog).getByRole("option", { name: /create demo/i }));

    expect(screen.queryByRole("dialog", { name: /command palette/i })).toBeNull();
    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("SongCreated");
  });

  it("opens the command palette from the keyboard and executes the active action", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const dialog = screen.getByRole("dialog", { name: /command palette/i });
    const search = within(dialog).getByLabelText("Command palette search");
    fireEvent.change(search, { target: { value: "add track" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(screen.getAllByTestId("track-row")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: /command palette/i })).toBeNull();
    expect(screen.getByLabelText("Command log")).toHaveTextContent("TrackCreated");
  });

  it("keeps unavailable command palette actions disabled", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }));

    const dialog = screen.getByRole("dialog", { name: /command palette/i });
    fireEvent.change(within(dialog).getByLabelText("Command palette search"), {
      target: { value: "duplicate" },
    });

    expect(within(dialog).getByRole("option", { name: /duplicate clip/i })).toBeDisabled();
  });

  it("executes recognized command drafts through local actions", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.change(screen.getByLabelText("Command draft"), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send command/i }));

    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder");
    expect(screen.getByLabelText("Command log")).toHaveTextContent(
      "Executed: Create Demo.",
    );

    fireEvent.change(screen.getByLabelText("Command draft"), {
      target: { value: "tempo 132" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send command/i }));

    expect(screen.getByText("132 BPM")).toBeInTheDocument();
    expect(screen.getByLabelText("Command log")).toHaveTextContent("TempoSet");
    expect(screen.getByLabelText("Command log")).toHaveTextContent(
      "Executed: Set Tempo 132 BPM.",
    );
  });

  it("executes contextual command drafts against the selected clip", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Command draft"), {
      target: { value: "duplicate clip" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send command/i }));

    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder Copy");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("ClipDuplicated");
    expect(screen.getByLabelText("Command log")).toHaveTextContent(
      "Executed: Duplicate Clip.",
    );
  });

  it("reports unrecognized command drafts without mutating song state", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.change(screen.getByLabelText("Command draft"), {
      target: { value: "summon bass fog" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send command/i }));

    expect(screen.getByText("No song loaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Command log")).toHaveTextContent(
      "Command not recognized.",
    );
  });

  it("auditions the selected clip through the preview audio boundary", async () => {
    const engine = mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    const durableStateBeforePreview = usePlaygroundStore.getState();
    fireEvent.click(screen.getByRole("button", { name: /play preview/i }));

    await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    expect(engine.play).toHaveBeenCalledWith(
      expect.objectContaining({
        bpm: 124,
        clipName: "Kick Ladder",
        notes: expect.arrayContaining([
          expect.objectContaining({ pitch: 36, startBeat: 0 }),
        ]),
      }),
    );
    expect(screen.getByText("Auditioning Kick Ladder")).toBeInTheDocument();
    expect(usePlaygroundStore.getState().commandState.song?.transport.isPlaying).toBe(false);
    expect(usePlaygroundStore.getState().undoStack).toHaveLength(
      durableStateBeforePreview.undoStack.length,
    );

    fireEvent.click(screen.getByRole("button", { name: /stop preview/i }));

    await waitFor(() => expect(engine.stop).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Preview idle")).toBeInTheDocument();
    expect(usePlaygroundStore.getState().commandState.song?.transport.isPlaying).toBe(false);
    expect(usePlaygroundStore.getState().undoStack).toHaveLength(
      durableStateBeforePreview.undoStack.length,
    );
  });

  it("reports preview engine failures without touching Web Audio", async () => {
    const engine: PreviewAudioEngine = {
      play: vi.fn().mockRejectedValue(new Error("Mock engine offline")),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    setPreviewAudioEngine(engine);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.click(screen.getByRole("button", { name: /play preview/i }));

    await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(screen.getByText("Mock engine offline")).toBeInTheDocument();
  });

  it("autosaves demo material and loads it from browser storage", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));

    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).toContain(
      "Playground Sketch",
    );

    act(() => {
      usePlaygroundStore.setState({
        commandState: usePlaygroundStore.getInitialState().commandState,
        selectedTrackId: null,
        selectedClipId: null,
        songJsonDraft: "",
        persistence: {
          phase: "idle",
          label: "Stored song ready",
          hasSavedSong: true,
        },
      });
    });

    expect(screen.getByText("No song loaded")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load local song/i }));

    expect(screen.getAllByText("Playground Sketch").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder");
    expect(screen.getByText("Loaded local song")).toBeInTheDocument();
  });

  it("applies a multi-command demo as one revision and one undo checkpoint", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));

    const applied = usePlaygroundStore.getState();
    expect(applied.commandState.revision).toBe(1);
    expect(applied.undoStack).toHaveLength(1);
    expect(applied.commandState.song?.tracks[0]?.clips[0]?.pattern.notes).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));

    const undone = usePlaygroundStore.getState();
    expect(undone.commandState.song).toBeNull();
    expect(undone.commandState.revision).toBe(2);
    expect(undone.undoStack).toHaveLength(0);
  });

  it("keeps revisions monotonic across undo, redo, and load", () => {
    usePlaygroundStore.getState().createDemo();
    expect(usePlaygroundStore.getState().commandState.revision).toBe(1);

    usePlaygroundStore.getState().undo();
    expect(usePlaygroundStore.getState().commandState.revision).toBe(2);

    usePlaygroundStore.getState().redo();
    expect(usePlaygroundStore.getState().commandState.revision).toBe(3);

    usePlaygroundStore.getState().loadSavedSong();
    expect(usePlaygroundStore.getState().commandState.revision).toBe(4);
  });

  it("exports and imports song JSON through the storage panel", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.click(screen.getByRole("button", { name: /export song json/i }));

    const songJsonField = screen.getByLabelText("Song JSON") as HTMLTextAreaElement;
    const exportedSong = JSON.parse(songJsonField.value) as {
      title: string;
      tracks: Array<{ name: string }>;
    };
    exportedSong.title = "Imported Sketch";
    exportedSong.tracks[0].name = "Imported Drums";

    fireEvent.change(songJsonField, { target: { value: JSON.stringify(exportedSong) } });
    fireEvent.click(screen.getByRole("button", { name: /import song json/i }));

    expect(screen.getAllByText("Imported Sketch").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Imported Drums");
    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).toContain(
      "Imported Sketch",
    );
  });

  it("reports invalid imported song JSON without replacing the current song", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Song JSON"), {
      target: { value: "{\"schemaVersion\":999}" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import song json/i }));

    expect(screen.getByText("Import failed")).toBeInTheDocument();
    expect(screen.getAllByText("Playground Sketch").length).toBeGreaterThan(0);
  });

  it("adds and removes notes through the inspector editor", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Note pitch"), { target: { value: "48" } });
    fireEvent.change(screen.getByLabelText("Note beat"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Note length"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    expect(screen.getByLabelText("Inspector")).toHaveTextContent("48");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("NoteAdded");

    fireEvent.click(screen.getByRole("button", { name: /remove note 48 at beat 1/i }));

    expect(screen.getByLabelText("Inspector")).not.toHaveTextContent("48");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("NoteRemoved");
  });

  it("updates notes through the inspector editor", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.click(screen.getByRole("button", { name: /edit note 36 at beat 0/i }));
    fireEvent.change(screen.getByLabelText("Note pitch"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Note beat"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(screen.getByLabelText("Inspector")).toHaveTextContent("40");
    expect(screen.getByRole("button", { name: /edit note 40 at beat 1.5/i })).toBeEnabled();
    expect(screen.getByLabelText("Command log")).toHaveTextContent("NoteUpdated");
  });

  it("runs pattern tools through commands and autosaves the result", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Note pitch"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Note beat"), { target: { value: "1.37" } });
    fireEvent.change(screen.getByLabelText("Note length"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    fireEvent.click(screen.getByRole("button", { name: /quantize clip to 1 beat/i }));
    expect(screen.getByRole("button", { name: /edit note 50 at beat 1/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /transpose clip up 1 semitone/i }));
    expect(screen.getByRole("button", { name: /edit note 51 at beat 1/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /duplicate clip/i }));

    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder Copy");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("ClipQuantized");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("ClipTransposed");
    expect(screen.getByLabelText("Command log")).toHaveTextContent("ClipDuplicated");
    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).toContain(
      "Kick Ladder Copy",
    );
  });

  it("undos and redos local command history", () => {
    mockPreviewAudioEngine();
    render(<App />);

    expect(screen.getByRole("button", { name: /^undo$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^redo$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Note pitch"), { target: { value: "48" } });
    fireEvent.change(screen.getByLabelText("Note beat"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Note length"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    expect(screen.getByRole("button", { name: /edit note 48 at beat 1/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));

    expect(screen.queryByRole("button", { name: /edit note 48 at beat 1/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^redo$/i })).toBeEnabled();
    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).not.toContain("\"pitch\": 48");

    fireEvent.click(screen.getByRole("button", { name: /^redo$/i }));

    expect(screen.getByRole("button", { name: /edit note 48 at beat 1/i })).toBeEnabled();
    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).toContain("\"pitch\": 48");

    fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));
    fireEvent.change(screen.getByLabelText("Note pitch"), { target: { value: "52" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    expect(screen.getByRole("button", { name: /^redo$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /edit note 52 at beat 0/i })).toBeEnabled();
  });

  it("runs keyboard shortcuts for edit history and preview actions", async () => {
    const engine = mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Note pitch"), { target: { value: "55" } });
    fireEvent.change(screen.getByLabelText("Note beat"), { target: { value: "1.37" } });
    fireEvent.change(screen.getByLabelText("Note length"), { target: { value: "0.5" } });

    fireEvent.keyDown(window, { key: "n" });

    expect(screen.getByRole("button", { name: /edit note 55 at beat 1.37/i })).toBeEnabled();

    fireEvent.keyDown(window, { key: "q" });
    expect(screen.getByRole("button", { name: /edit note 55 at beat 1.25/i })).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("button", { name: /edit note 55 at beat 1.37/i })).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.queryByRole("button", { name: /edit note 55 at beat 1.37/i })).toBeNull();

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByRole("button", { name: /edit note 55 at beat 1.37/i })).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("button", { name: /edit note 55 at beat 1.25/i })).toBeEnabled();

    fireEvent.keyDown(window, { key: "d" });
    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder Copy");

    vi.mocked(engine.stop).mockClear();
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Auditioning Kick Ladder Copy")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await waitFor(() => expect(engine.stop).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Preview idle")).toBeInTheDocument();
  });

  it("does not trigger keyboard shortcuts while editing text fields", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
    fireEvent.change(screen.getByLabelText("Command draft"), {
      target: { value: "n dq z" },
    });
    fireEvent.keyDown(screen.getByLabelText("Command draft"), { key: "n" });
    fireEvent.keyDown(screen.getByLabelText("Command draft"), { key: "d" });
    fireEvent.keyDown(screen.getByLabelText("Command draft"), { key: "z", ctrlKey: true });

    expect(screen.queryByRole("button", { name: /edit note 60 at beat 0/i })).toBeNull();
    expect(screen.getByLabelText("Inspector")).toHaveTextContent("Kick Ladder");
    expect(screen.getByLabelText("Inspector")).not.toHaveTextContent("Kick Ladder Copy");
  });
});
