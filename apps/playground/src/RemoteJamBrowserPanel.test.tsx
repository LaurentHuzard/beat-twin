import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteJamBrowserPanel } from "./RemoteJamBrowserPanel";
import { joinBrowserRemoteJam } from "./remoteJamBrowserPeer";

vi.mock("./remoteJamBrowserPeer", () => ({
  joinBrowserRemoteJam: vi.fn(async (config: {
    onStatus: (phase: "connected", detail: string) => void;
  }) => {
    config.onStatus("connected", "fake channel, no sound");
    return {
      sendNote: vi.fn(),
      close: vi.fn(),
      stats: () => ({
        receivedMidi: 0, dispatchedNotes: 0, lastEvent: "none",
        rttP95Ms: null, rttSamples: 0, clockSync: "not_measured", audioProof: "not_measured",
      }),
    };
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Remote Jam browser join controls", () => {
  it("does not connect without an explicit click and key; secret is never displayed as plain text", async () => {
    render(<RemoteJamBrowserPanel />);
    expect(joinBrowserRemoteJam).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Remote Jam room secret") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: /Join room and enable sound/ })).toBeDisabled();
    fireEvent.change(input, { target: { value: "abcdef".repeat(11) } });
    const join = screen.getByRole("button", { name: /Join room and enable sound/ });
    expect(join).toBeEnabled();
    fireEvent.click(join);
    await waitFor(() => expect(joinBrowserRemoteJam).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText(/fake channel, no sound/)).toBeInTheDocument());
    const config = vi.mocked(joinBrowserRemoteJam).mock.calls[0]![0];
    expect(config.secret).toBe("abcdef".repeat(11));
    expect(config.role).toBe("answer");
    expect(config.localPeerId).toBe("browser-b");
    expect(config.remotePeerId).toBe("beat-a");
    expect(document.body.textContent).not.toContain("abcdef".repeat(11));
    fireEvent.click(screen.getByRole("button", { name: /Leave \/ release all notes/ }));
    expect(config.signal.aborted).toBe(true);
  });
});
