import { StrictMode } from "react";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYGROUND_SONG_STORAGE_KEY } from "./persistence";
import { LiveLauncher, type LiveAudioControllerFactory } from "./LiveLauncher";
import type {
  LiveAudioController,
  LiveAudioControllerHost,
} from "./liveAudioController";
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
    persistence: {
      phase: "idle",
      label: "No saved song",
      hasSavedSong: false,
    },
    noteDraft: initial.noteDraft,
    editingNoteId: null,
    selectedTrackId: null,
    selectedClipId: null,
    preview: initial.preview,
    lastError: null,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("LiveLauncher", () => {
  it("projects an honest unavailable 2 x 2 surface without a Song", () => {
    const harness = createControllerHarness();
    render(<LiveLauncher controllerFactory={harness.factory} />);

    expect(screen.getByRole("heading", { name: "2 × 2 launcher" })).toBeInTheDocument();
    expect(screen.getByText("No song available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start live" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /track \d slot \d, empty/i })).toHaveLength(4);
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it("keeps queued, observed active, replacement, and independent stop states exact", async () => {
    usePlaygroundStore.getState().createDemo();
    const before = usePlaygroundStore.getState();
    const commandStateBefore = before.commandState;
    const undoBefore = before.undoStack;
    const storageBefore = localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY);
    const harness = createControllerHarness();
    render(<LiveLauncher controllerFactory={harness.factory} />);

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());

    const drums = within(screen.getByRole("article", { name: "Drums launcher track" }));
    const bass = within(screen.getByRole("article", { name: "Bass launcher track" }));
    fireEvent.click(drums.getByRole("button", { name: "Drums launch Hat Current, idle" }));

    await waitFor(() => {
      expect(drums.getByRole("status")).toHaveTextContent("queued");
      expect(drums.getByRole("button", { name: "Drums launch Hat Current, queued" })).toHaveAttribute(
        "data-status",
        "queued",
      );
    });
    expect(usePlaygroundStore.getState().performanceState.tracks[trackId("Drums")]?.activeClipId)
      .toBeNull();

    observeTrackTransition("Drums");
    await waitFor(() => expect(drums.getByRole("status")).toHaveTextContent("playing"));
    expect(drums.getByRole("button", { name: "Drums stop Hat Current, playing" })).toHaveAttribute(
      "data-status",
      "playing",
    );

    fireEvent.click(bass.getByRole("button", { name: "Bass launch Root Pulse, idle" }));
    await waitFor(() => expect(bass.getByRole("status")).toHaveTextContent("queued"));
    observeTrackTransition("Bass");
    await waitFor(() => expect(bass.getByRole("status")).toHaveTextContent("playing"));

    fireEvent.click(drums.getByRole("button", { name: "Drums launch Kick Ladder, idle" }));
    await waitFor(() => expect(drums.getByRole("status")).toHaveTextContent("queued"));
    expect(drums.getByRole("button", { name: "Drums stop Hat Current, playing" })).toHaveAttribute(
      "data-status",
      "playing",
    );
    observeTrackTransition("Drums");

    await waitFor(() => {
      expect(drums.getByRole("button", { name: "Drums stop Kick Ladder, playing" })).toHaveAttribute(
        "data-status",
        "playing",
      );
      expect(bass.getByRole("button", { name: "Bass stop Root Pulse, playing" })).toHaveAttribute(
        "data-status",
        "playing",
      );
    });

    fireEvent.click(drums.getByRole("button", { name: "Drums stop Kick Ladder, playing" }));
    await waitFor(() => expect(drums.getByRole("status")).toHaveTextContent("stop-queued"));
    expect(drums.getByRole("button", { name: "Drums stop Kick Ladder, stop-queued" })).toHaveAttribute(
      "data-status",
      "stop-queued",
    );
    observeTrackTransition("Drums");

    await waitFor(() => {
      expect(drums.getByRole("status")).toHaveTextContent("idle");
      expect(bass.getByRole("status")).toHaveTextContent("playing");
    });
    const after = usePlaygroundStore.getState();
    expect(after.commandState).toBe(commandStateBefore);
    expect(after.undoStack).toBe(undoBefore);
    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).toBe(storageBefore);
  });

  it("surfaces an engine failure without painting the slot active", async () => {
    usePlaygroundStore.getState().createDemo();
    const harness = createControllerHarness();
    harness.failNext = true;
    render(<LiveLauncher controllerFactory={harness.factory} />);

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Drums launch Kick Ladder, idle" }));

    const drums = within(screen.getByRole("article", { name: "Drums launcher track" }));
    await waitFor(() => expect(drums.getByRole("status")).toHaveTextContent("error"));
    expect(drums.getByText("schedule_failed: test engine refused material")).toBeInTheDocument();
    expect(drums.getByRole("button", { name: "Drums launch Kick Ladder, idle" })).not.toHaveAttribute(
      "data-status",
      "playing",
    );
  });

  it("queues both tracks as one exact atomic scene", async () => {
    usePlaygroundStore.getState().createDemo();
    const harness = createControllerHarness();
    render(<LiveLauncher controllerFactory={harness.factory} />);

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Launch Scene 2, idle" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Launch Scene 2, queued" })).toHaveAttribute(
        "data-status",
        "queued",
      );
    });
    const state = usePlaygroundStore.getState().performanceState;
    const transitions = state.tracks;
    const drumsTransition = transitions[trackId("Drums")]?.pendingTransition;
    const bassTransition = transitions[trackId("Bass")]?.pendingTransition;
    expect(drumsTransition).toMatchObject({
      status: "scheduled",
      sceneId: "launcher-scene-2",
      kind: "launch",
    });
    expect(bassTransition).toMatchObject({
      status: "scheduled",
      sceneId: "launcher-scene-2",
      kind: "launch",
    });
    expect(drumsTransition?.groupId).toBe(bassTransition?.groupId);
    expect(drumsTransition?.targetBeat).toBe(4);
    expect(bassTransition?.targetBeat).toBe(4);

    observeTrackTransition("Drums");
    observeTrackTransition("Bass");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Launch Scene 2, playing" })).toHaveAttribute(
        "data-status",
        "playing",
      );
    });
  });

  it("keeps Preview and live transport mutually unavailable", () => {
    usePlaygroundStore.getState().createDemo();
    const harness = createControllerHarness();
    render(<LiveLauncher controllerFactory={harness.factory} externalAudioActive />);

    expect(screen.getByText("Preview owns audio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start live" })).toBeDisabled();
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it("starts normally when React replays effects in StrictMode", async () => {
    usePlaygroundStore.getState().createDemo();
    const harness = createControllerHarness();
    render(
      <StrictMode>
        <LiveLauncher controllerFactory={harness.factory} />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());
    expect(harness.factory).toHaveBeenCalledTimes(1);
  });

  it("disposes a controller whose factory resolves after unmount without starting audio", async () => {
    usePlaygroundStore.getState().createDemo();
    let resolveFactory: ((controller: LiveAudioController) => void) | null = null;
    const start = vi.fn(async () => undefined);
    const emergencyStop = vi.fn();
    const dispose = vi.fn();
    const controller: LiveAudioController = {
      start,
      syncClock: vi.fn(),
      syncPending: vi.fn(async () => undefined),
      reconcileMaterial: vi.fn(),
      cancelTrackTransition: vi.fn(),
      cancelScene: vi.fn(),
      cancelTransportStop: vi.fn(),
      emergencyStop,
      dispose,
    };
    const factory = vi.fn<LiveAudioControllerFactory>(() =>
      new Promise((resolve) => {
        resolveFactory = resolve;
      }),
    );
    const view = render(<LiveLauncher controllerFactory={factory} />);

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      resolveFactory?.(controller);
      await Promise.resolve();
    });

    expect(start).not.toHaveBeenCalled();
    expect(emergencyStop).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("absorbs a late sync failure after unmount", async () => {
    usePlaygroundStore.getState().createDemo();
    let rejectSync: ((error: Error) => void) | null = null;
    const dispose = vi.fn();
    const factory = vi.fn<LiveAudioControllerFactory>(async (host) => ({
      async start() {
        host.dispatchPerformance({ type: "StartTransport", atBeat: 0 });
      },
      syncClock: vi.fn(),
      syncPending: () =>
        new Promise<void>((_resolve, reject) => {
          rejectSync = reject;
        }),
      reconcileMaterial: vi.fn(),
      cancelTrackTransition: vi.fn(),
      cancelScene: vi.fn(),
      cancelTransportStop: vi.fn(),
      emergencyStop: vi.fn(() => host.dispatchPerformance({ type: "ResetPerformance" })),
      dispose,
    }));
    const view = render(<LiveLauncher controllerFactory={factory} />);

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Drums launch Kick Ladder, idle" }));
    await waitFor(() => expect(rejectSync).not.toBeNull());
    view.unmount();
    await act(async () => {
      rejectSync?.(new Error("late sync failure"));
      await Promise.resolve();
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("subscribes live material sync directly to Song mutations", async () => {
    usePlaygroundStore.getState().createDemo();
    const syncPending = vi.fn(async () => undefined);
    const reconcileMaterial = vi.fn();
    const factory = vi.fn<LiveAudioControllerFactory>(async (host) => ({
      async start() {
        host.dispatchPerformance({ type: "StartTransport", atBeat: 0 });
      },
      syncClock: vi.fn(),
      syncPending,
      reconcileMaterial,
      cancelTrackTransition: vi.fn(),
      cancelScene: vi.fn(),
      cancelTransportStop: vi.fn(),
      emergencyStop: vi.fn(() => host.dispatchPerformance({ type: "ResetPerformance" })),
      dispose: vi.fn(),
    }));
    render(<LiveLauncher controllerFactory={factory} />);
    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());
    await waitFor(() => expect(syncPending).toHaveBeenCalled());
    syncPending.mockClear();
    reconcileMaterial.mockClear();
    const state = usePlaygroundStore.getState();
    const track = state.commandState.song!.tracks[0]!;
    const clip = track.clips[0]!;

    act(() => {
      usePlaygroundStore.getState().dispatch({
        type: "AddNote",
        trackId: track.id,
        clipId: clip.id,
        pitch: 36,
        velocity: 96,
        startBeat: 0.25,
        lengthBeats: 0.25,
      });
      expect(reconcileMaterial).toHaveBeenCalledTimes(1);
      expect(syncPending).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => expect(syncPending).toHaveBeenCalledTimes(1));
  });

  it("surfaces a structured controller fail-safe reason after a Song mutation", async () => {
    usePlaygroundStore.getState().createDemo();
    let failSafe = false;
    const factory = vi.fn<LiveAudioControllerFactory>(async (host) => ({
      async start() {
        host.dispatchPerformance({ type: "StartTransport", atBeat: 0 });
      },
      syncClock: vi.fn(),
      syncPending: vi.fn(async () => undefined),
      reconcileMaterial: vi.fn(() => {
        if (!failSafe) return;
        host.dispatchPerformance({ type: "ResetPerformance" });
        host.reportError?.({
          code: "invalid_state",
          message: "song tempo changed; restart live audio",
        });
      }),
      cancelTrackTransition: vi.fn(),
      cancelScene: vi.fn(),
      cancelTransportStop: vi.fn(),
      emergencyStop: vi.fn(() => host.dispatchPerformance({ type: "ResetPerformance" })),
      dispose: vi.fn(),
    }));
    render(<LiveLauncher controllerFactory={factory} />);
    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());

    failSafe = true;
    act(() => usePlaygroundStore.getState().setTempo(132));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "invalid_state: song tempo changed; restart live audio",
      ),
    );
    expect(usePlaygroundStore.getState().performanceState.phase).toBe("idle");
  });

  it("queues a quantized transport stop and releases the controller only after observation", async () => {
    usePlaygroundStore.getState().createDemo();
    const harness = createControllerHarness();
    render(<LiveLauncher controllerFactory={harness.factory} />);

    fireEvent.click(screen.getByRole("button", { name: "Start live" }));
    await waitFor(() => expect(screen.getByText("Live audio running")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Launch quantization"), {
      target: { value: "beat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop live" }));

    await waitFor(() => expect(screen.getByText("Stop queued")).toBeInTheDocument());
    expect(harness.dispose).not.toHaveBeenCalled();
    const stop = usePlaygroundStore.getState().performanceState.transportStop;
    expect(stop).toMatchObject({ status: "scheduled", targetBeat: 1 });

    act(() => {
      harness.host?.dispatchPerformance({
        type: "ObserveTransportStopped",
        transitionId: stop!.id,
        observedAtBeat: stop!.targetBeat,
      });
    });
    await waitFor(() => expect(screen.getByText("Live audio idle")).toBeInTheDocument());
    expect(harness.dispose).toHaveBeenCalledTimes(1);
  });
});

function createControllerHarness() {
  const harness = {
    host: null as LiveAudioControllerHost | null,
    failNext: false,
    factory: vi.fn<LiveAudioControllerFactory>(),
    dispose: vi.fn(),
  };

  harness.factory.mockImplementation(async (host) => {
    harness.host = host;
    return {
      async start() {
        host.dispatchPerformance({ type: "StartTransport", atBeat: 0 });
      },
      syncClock: vi.fn(),
      async syncPending() {
        const state = host.getPerformanceState();
        if (state.transportStop?.status === "pending") {
          host.dispatchPerformance({
            type: "MarkTransportStopScheduled",
            transitionId: state.transportStop.id,
          });
        }
        const scheduledGroups = new Set<string>();
        for (const [currentTrackId, track] of Object.entries(state.tracks)) {
          const transition = track.pendingTransition;
          if (!transition || transition.status !== "pending") continue;
          if (transition.groupId) {
            if (!scheduledGroups.has(transition.groupId)) {
              scheduledGroups.add(transition.groupId);
              host.dispatchPerformance({
                type: "MarkSceneScheduled",
                groupId: transition.groupId,
              });
            }
          } else {
            host.dispatchPerformance({
              type: "MarkTransitionScheduled",
              trackId: currentTrackId,
              transitionId: transition.id,
            });
          }
          if (harness.failNext) {
            harness.failNext = false;
            host.dispatchPerformance({
              type: "ObserveTransitionFailed",
              trackId: currentTrackId,
              transitionId: transition.id,
              observedAtBeat: transition.requestedAtBeat,
              error: "schedule_failed: test engine refused material",
            });
          }
        }
      },
      reconcileMaterial: vi.fn(),
      cancelTrackTransition: vi.fn(),
      cancelScene: vi.fn(),
      cancelTransportStop: vi.fn(),
      emergencyStop: vi.fn(() => {
        host.dispatchPerformance({ type: "ResetPerformance" });
      }),
      dispose: harness.dispose,
    };
  });

  return harness;
}

function observeTrackTransition(trackName: string): void {
  const currentTrackId = trackId(trackName);
  const transition = usePlaygroundStore.getState().performanceState.tracks[currentTrackId]
    ?.pendingTransition;
  expect(transition).toBeTruthy();
  act(() => {
    usePlaygroundStore.getState().dispatchPerformance({
      type: "ObserveTransitionExecuted",
      trackId: currentTrackId,
      transitionId: transition!.id,
      observedAtBeat: transition!.targetBeat,
    });
  });
}

function trackId(name: string): string {
  const track = usePlaygroundStore.getState().commandState.song?.tracks.find(
    (candidate) => candidate.name === name,
  );
  if (!track) throw new Error(`missing test track ${name}`);
  return track.id;
}
