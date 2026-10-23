import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteJamLocalAudition } from "./RemoteJamLocalAudition";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Remote Jam local acoustic developer audition", () => {
  it("requires a button before unlocking and releases the synth on leave", async () => {
    const on = vi.fn();
    const off = vi.fn();
    const panic = vi.fn();
    const dispose = vi.fn();
    const acquireAudio = vi.fn(async () => ({
      noteOn: on, noteOff: off, panic, dispose,
    }));
    const view = render(<RemoteJamLocalAudition acquireAudio={acquireAudio} />);
    expect(acquireAudio).not.toHaveBeenCalled();
    expect(screen.getByText(/No network peer is connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play C4/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Enable local synth/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Play C4/ })).toBeEnabled());
    expect(acquireAudio).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Play C4/ }));
    expect(panic).toHaveBeenCalledOnce();
    expect(on).toHaveBeenCalledWith(60, 96);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(off).toHaveBeenCalledWith(60);
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("reports browser audio unlock failure and does not become ready", async () => {
    render(<RemoteJamLocalAudition acquireAudio={async () => { throw new Error("permission denied"); }} />);
    fireEvent.click(screen.getByRole("button", { name: /Enable local synth/ }));
    await waitFor(() => expect(screen.getByText(/permission denied/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Play C4/ })).toBeDisabled();
  });
});
