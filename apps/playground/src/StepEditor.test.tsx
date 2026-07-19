import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StepEditor } from "./StepEditor";
import { usePlaygroundStore } from "./store";

beforeEach(() => {
  localStorage.clear();
  const initial = usePlaygroundStore.getInitialState();
  usePlaygroundStore.setState({
    commandState: initial.commandState,
    performanceState: initial.performanceState,
    undoStack: [],
    redoStack: [],
    messages: [],
    draft: "",
    songJsonDraft: "",
    persistence: { phase: "idle", label: "No saved song", hasSavedSong: false },
    noteDraft: initial.noteDraft,
    editingNoteId: null,
    selectedTrackId: null,
    selectedClipId: null,
    preview: initial.preview,
    lastError: null,
  });
  const store = usePlaygroundStore.getState();
  store.dispatch({ type: "CreateSong", id: "song-step", title: "Step song", bpm: 120 });
  store.dispatch({
    type: "CreateTrack",
    id: "track-step",
    name: "Drums",
    kind: "instrument",
    instrumentId: "drums",
    color: "#111",
  });
  store.dispatch({
    type: "CreateClip",
    id: "clip-step",
    trackId: "track-step",
    name: "Verse",
    lengthBeats: 4,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  usePlaygroundStore.setState({
    dispatch: usePlaygroundStore.getInitialState().dispatch,
    duplicateSelectedClipToNextLauncherSlot:
      usePlaygroundStore.getInitialState().duplicateSelectedClipToNextLauncherSlot,
  });
});

describe("StepEditor", () => {
  it("adds, accents, removes, and restores a drum step through commands", () => {
    render(<StepEditor />);
    expect(screen.getByText(/Verse · 4 beats · 16 steps · 0.25 beat\/step/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kick, step 1, beat 0, empty" }));
    let note = selectedClip().pattern.notes[0]!;
    expect(note).toMatchObject({
      pitch: 36,
      velocity: 96,
      startBeat: 0,
      lengthBeats: 0.25,
    });

    fireEvent.click(screen.getByRole("button", { name: "Accent 120" }));
    fireEvent.click(screen.getByRole("button", { name: "Set velocity" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Kick, step 1, beat 0, active at velocity 96" }),
    );
    expect(selectedClip().pattern.notes[0]?.velocity).toBe(120);

    usePlaygroundStore.getState().undo();
    expect(selectedClip().pattern.notes[0]?.velocity).toBe(96);
    usePlaygroundStore.getState().redo();
    expect(selectedClip().pattern.notes[0]?.velocity).toBe(120);

    fireEvent.click(screen.getByRole("button", { name: "Add / remove" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Kick, step 1, beat 0, active at velocity 120" }),
    );
    expect(selectedClip().pattern.notes).toEqual([]);
  });

  it("uses one atomic batch when a cell contains multiple notes", () => {
    const store = usePlaygroundStore.getState();
    store.dispatch({
      type: "AddNote",
      id: "note-one",
      trackId: "track-step",
      clipId: "clip-step",
      pitch: 36,
      velocity: 80,
      startBeat: 0,
      lengthBeats: 0.25,
    });
    store.dispatch({
      type: "AddNote",
      id: "note-two",
      trackId: "track-step",
      clipId: "clip-step",
      pitch: 36,
      velocity: 100,
      startBeat: 0.1,
      lengthBeats: 0.25,
    });
    const revisionBefore = usePlaygroundStore.getState().commandState.revision;
    const undoBefore = usePlaygroundStore.getState().undoStack.length;
    render(<StepEditor />);

    fireEvent.click(
      screen.getByRole("button", { name: "Kick, step 1, beat 0, active at velocity 100" }),
    );
    expect(selectedClip().pattern.notes).toEqual([]);
    expect(usePlaygroundStore.getState().commandState.revision).toBe(revisionBefore + 1);
    expect(usePlaygroundStore.getState().undoStack).toHaveLength(undoBefore + 1);
    usePlaygroundStore.getState().undo();
    expect(selectedClip().pattern.notes).toHaveLength(2);
  });

  it("duplicates to the next empty slot with fresh IDs and blocks overwrite", () => {
    const store = usePlaygroundStore.getState();
    store.dispatch({
      type: "AddNote",
      id: "source-note",
      trackId: "track-step",
      clipId: "clip-step",
      pitch: 36,
      velocity: 96,
      startBeat: 0,
      lengthBeats: 0.25,
    });
    render(<StepEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate to next empty slot" }));

    const clips = usePlaygroundStore.getState().commandState.song!.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[1]).toMatchObject({ startBeat: 4, lengthBeats: 4 });
    expect(clips[1]!.id).not.toBe(clips[0]!.id);
    expect(clips[1]!.pattern.notes[0]!.id).not.toBe(clips[0]!.pattern.notes[0]!.id);
    expect(screen.getByRole("button", { name: "Duplicate to next empty slot" })).toBeDisabled();
    expect(screen.getByText(/will not be overwritten/)).toBeInTheDocument();
  });

  it("keeps fallback clip and note IDs unique inside one duplicate batch", () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const store = usePlaygroundStore.getState();
    for (const [id, pitch] of [["source-one", 36], ["source-two", 38]] as const) {
      store.dispatch({
        type: "AddNote",
        id,
        trackId: "track-step",
        clipId: "clip-step",
        pitch,
        startBeat: 0,
        lengthBeats: 0.25,
      });
    }

    store.duplicateSelectedClipToNextLauncherSlot();

    const clips = usePlaygroundStore.getState().commandState.song!.tracks[0]!.clips;
    const allIds = clips.flatMap((clip) => [clip.id, ...clip.pattern.notes.map((note) => note.id)]);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(clips[1]?.pattern.notes).toHaveLength(2);
    expect(usePlaygroundStore.getState().lastError).toBeNull();
  });

  it("reports a duplicate command failure instead of announcing success", () => {
    usePlaygroundStore.setState({
      duplicateSelectedClipToNextLauncherSlot: () =>
        usePlaygroundStore.setState({ lastError: "Duplicate command was rejected." }),
    });
    render(<StepEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate to next empty slot" }));

    expect(screen.getByRole("status")).toHaveTextContent("Duplicate command was rejected.");
    expect(screen.queryByText(/Variation duplicated/)).not.toBeInTheDocument();
  });

  it("reports a rejected step command instead of announcing an edit", () => {
    usePlaygroundStore.setState({
      dispatch: () => usePlaygroundStore.setState({ lastError: "Step command was rejected." }),
    });
    render(<StepEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Kick, step 1, beat 0, empty" }));

    expect(screen.getByRole("status")).toHaveTextContent("Step command was rejected.");
    expect(screen.queryByText(/Step 1 added/)).not.toBeInTheDocument();
  });

  it("offers bounded pitched entry with keyboard-native controls and ARIA state", () => {
    render(<StepEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Pitched" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Pitched step note" }), {
      target: { value: "84" },
    });
    const step = screen.getByRole("button", { name: "C6, step 16, beat 3.75, empty" });
    step.focus();
    fireEvent.keyDown(step, { key: "Enter" });
    expect(selectedClip().pattern.notes[0]).toMatchObject({ pitch: 84, startBeat: 3.75 });
    fireEvent.keyDown(step, { key: " " });
    expect(selectedClip().pattern.notes).toEqual([]);
  });
});

function selectedClip() {
  const state = usePlaygroundStore.getState();
  const track = state.commandState.song!.tracks.find(
    (candidate) => candidate.id === state.selectedTrackId,
  )!;
  return track.clips.find((candidate) => candidate.id === state.selectedClipId)!;
}
