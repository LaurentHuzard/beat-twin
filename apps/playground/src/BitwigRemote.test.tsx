import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BitwigRemote } from "./BitwigRemote";
import type { BitwigControllerClient, BitwigWebSnapshot } from "./bitwigControllerClient";

afterEach(cleanup);

const connectedSnapshot: BitwigWebSnapshot = {
  bridge: {
    scope: "loopback",
    sessionTool: "bitwig_session_inspect",
  },
  commands: [
    { name: "transport_restart", policy: "transport" },
    { name: "transport_play", policy: "transport" },
    { name: "transport_stop", policy: "transport" },
  ],
  session: {
    connected: true,
    scope: "read-only",
    transport: {
      tempo: 126,
      position: 32,
      isPlaying: false,
      isRecording: false,
    },
    trackBank: [{ index: 0, name: "Drums" }, { index: 1, name: "Bass" }],
    selectedTrack: { name: "Drums" },
    selectedDevice: { name: "Drum Machine" },
  },
};

const disconnectedSnapshot: BitwigWebSnapshot = {
  bridge: {
    scope: "loopback",
    sessionTool: "bitwig_session_inspect",
  },
  commands: [],
  session: {
    connected: false,
    error: "Could not connect to Bitwig.",
    setup_hint: "Start Bitwig Studio and enable the Beat Twin controller, then refresh.",
  },
};

function createClient(snapshot: BitwigWebSnapshot): BitwigControllerClient {
  return {
    inspect: vi.fn().mockResolvedValue(snapshot),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("Bitwig Remote", () => {
  it("reports an honest disconnected and policy-locked state", async () => {
    const client = createClient(disconnectedSnapshot);
    render(<BitwigRemote client={client} onClose={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: /bitwig is not connected/i }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Bridge security")).toHaveTextContent("Secrets stay server-side");
    expect(screen.getByText(/transport writes are locked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("does not execute a transport write before explicit one-shot confirmation", async () => {
    const client = createClient(connectedSnapshot);
    render(<BitwigRemote client={client} onClose={vi.fn()} />);

    const play = await screen.findByRole("button", { name: "Play" });
    fireEvent.click(play);

    const confirmation = screen.getByRole("dialog", { name: /confirm play in bitwig/i });
    expect(client.execute).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(within(confirmation).getByRole("button", { name: /confirm once/i })).toHaveFocus(),
    );

    fireEvent.click(within(confirmation).getByRole("button", { name: /confirm once/i }));

    await waitFor(() => expect(client.execute).toHaveBeenCalledWith("transport_play"));
    expect(await screen.findByText(/play acknowledged by bitwig/i)).toBeInTheDocument();
    expect(client.inspect).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending command without touching the client", async () => {
    const client = createClient(connectedSnapshot);
    render(<BitwigRemote client={client} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.execute).not.toHaveBeenCalled();
  });
});
