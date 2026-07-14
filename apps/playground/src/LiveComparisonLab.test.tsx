import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveComparisonLab } from "./LiveComparisonLab";
import type { LivePrototypeAudioEngine } from "./livePrototypeAudio";

describe("LiveComparisonLab", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("runs the Session Deck scenario on the shared next-bar clock", async () => {
    const harness = renderLab();
    await harness.startClock();

    fireEvent.click(screen.getByRole("button", { name: "Pulse Anchor" }));
    fireEvent.click(screen.getByRole("button", { name: "Glass Anchor" }));
    fireEvent.click(screen.getByRole("button", { name: "Pulse Lift" }));

    const pulse = within(screen.getByRole("article", { name: "Pulse live track" }));
    const glass = within(screen.getByRole("article", { name: "Glass live track" }));
    expect(pulse.getByRole("status")).toHaveTextContent("pendingLift · bar 2");
    expect(glass.getByRole("status")).toHaveTextContent("pendingAnchor · bar 2");

    await harness.advanceTo(2);
    expect(pulse.getByRole("status")).toHaveTextContent("scheduledLift · bar 2");
    expect(glass.getByRole("status")).toHaveTextContent("scheduledAnchor · bar 2");

    await harness.advanceTo(2.2);
    expect(pulse.getByText("Observed").parentElement).toHaveTextContent("Lift");
    expect(glass.getByText("Observed").parentElement).toHaveTextContent("Anchor");

    fireEvent.click(pulse.getByRole("button", { name: "Pulse stop" }));
    await harness.advanceTo(4.4);

    expect(pulse.getByText("Observed").parentElement).toHaveTextContent("Stopped");
    expect(glass.getByText("Observed").parentElement).toHaveTextContent("Anchor");
    expect(harness.engine.setTrackState).toHaveBeenCalledTimes(3);
  });

  it("runs mutation, cancellation, restore, and independent stop without persistence", async () => {
    const harness = renderLab();
    fireEvent.click(screen.getByRole("button", { name: "Mutation Instrument" }));
    await harness.startClock();

    const pulse = within(screen.getByRole("article", { name: "Pulse live track" }));
    const glass = within(screen.getByRole("article", { name: "Glass live track" }));
    fireEvent.click(pulse.getByRole("button", { name: "Pulse start anchor" }));
    fireEvent.click(glass.getByRole("button", { name: "Glass start anchor" }));
    await harness.advanceTo(2.2);

    fireEvent.click(pulse.getByRole("button", { name: "Pulse transpose" }));
    fireEvent.click(glass.getByRole("button", { name: "Glass rotate" }));
    fireEvent.click(glass.getByRole("button", { name: "Glass cancel pending change" }));

    expect(pulse.getByRole("status")).toHaveTextContent("pendingTranspose +5 · bar 3");
    expect(glass.getByRole("status")).toHaveTextContent("No pending change");

    await harness.advanceTo(4.4);
    expect(pulse.getByText("Observed").parentElement).toHaveTextContent("+5");
    expect(glass.getByText("Observed").parentElement).toHaveTextContent("Anchor");

    fireEvent.click(pulse.getByRole("button", { name: "Pulse restore anchor" }));
    await harness.advanceTo(6.5);
    expect(pulse.getByText("Observed").parentElement).toHaveTextContent("Anchor");

    fireEvent.click(glass.getByRole("button", { name: "Glass stop" }));
    await harness.advanceTo(8.7);
    expect(glass.getByText("Observed").parentElement).toHaveTextContent("Stopped");
    expect(pulse.getByText("Observed").parentElement).toHaveTextContent("Anchor");
    expect(localStorage.getItem("beat-twin.playground.song.v1")).toBeNull();
  });

  it("does not compete with the editor preview for Tone transport ownership", () => {
    const audioEngineFactory = vi.fn();
    render(
      <LiveComparisonLab
        externalAudioActive
        audioEngineFactory={audioEngineFactory}
      />,
    );

    const startButton = screen.getByRole("button", { name: "Preview active" });
    expect(startButton).toBeDisabled();
    fireEvent.click(startButton);
    expect(audioEngineFactory).not.toHaveBeenCalled();
  });
});

function renderLab() {
  let now = 0;
  const engine: LivePrototypeAudioEngine = {
    setTrackState: vi.fn(),
    stop: vi.fn(),
  };
  const audioEngineFactory = vi.fn().mockResolvedValue(engine);

  render(
    <LiveComparisonLab
      audioEngineFactory={audioEngineFactory}
      nowSeconds={() => now}
    />,
  );

  return {
    engine,
    async startClock() {
      fireEvent.click(screen.getByRole("button", { name: "Start clock" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Clock running")).toBeInTheDocument();
    },
    async advanceTo(seconds: number) {
      now = seconds;
      await act(async () => {
        vi.advanceTimersByTime(80);
        await Promise.resolve();
      });
    },
  };
}
