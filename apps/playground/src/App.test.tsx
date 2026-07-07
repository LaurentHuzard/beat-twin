import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("adds tracks through the command bus", () => {
    mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /add track/i }));
    fireEvent.click(screen.getByRole("button", { name: /add track/i }));

    expect(screen.getAllByTestId("track-row")).toHaveLength(2);
    expect(screen.getByLabelText("Command log")).toHaveTextContent("TrackCreated");
  });

  it("auditions the selected clip through the preview audio boundary", async () => {
    const engine = mockPreviewAudioEngine();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /create demo/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /stop preview/i }));

    await waitFor(() => expect(engine.stop).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Preview idle")).toBeInTheDocument();
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
});
