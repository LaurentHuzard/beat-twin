import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentModePanel, resetAgentGatewaySessionFactory, setAgentGatewaySessionFactory } from "./AgentModePanel";
import type { AgentPlanPreview } from "./agentGateway";

const proposal: AgentPlanPreview = {
  runId: "run-test", dawId: "nanodaw", model: "offline-test", steps: 1, patch: {},
  preview: { summary: ["A darker bass line"], commands: [] },
  plan: {
    planId: "exact-reviewed-plan", adapterId: "nanodaw", baseRevision: 17,
    requiredScopes: ["song.write"], expiresAt: "2099-01-01T00:00:00Z",
    commands: [{ type: "CreateSong", title: "Night Jam", bpm: 124 }, { type: "CreateTrack", id: "bass", name: "Night Bass", instrumentId: "bass" }],
  },
};

afterEach(() => { cleanup(); resetAgentGatewaySessionFactory(); });

function mockSession() {
  const confirm = vi.fn().mockRejectedValue(new Error("offline verification unavailable"));
  const disconnect = vi.fn();
  setAgentGatewaySessionFactory(() => ({
    connect: async () => {}, disconnect,
    isConnected: () => true,
    run: async () => proposal,
    loadMcpPlan: async () => proposal,
    confirmAndExecute: confirm,
  }));
  return { confirm, disconnect };
}

async function connect() {
  fireEvent.click(screen.getByRole("button", { name: "Enable Agent mode" }));
  fireEvent.click(screen.getByText("Connection settings"));
  fireEvent.change(screen.getByLabelText("Operator secret"), { target: { value: "test-only" } });
  fireEvent.click(screen.getByRole("button", { name: "Pair Gateway" }));
  await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
}

async function propose() {
  fireEvent.change(screen.getByLabelText("Agent musical request"), { target: { value: "Give me a bass sketch" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => expect(screen.getByLabelText("Agent plan preview")).toBeInTheDocument());
}

describe("Twin progressive disclosure", () => {
  it("keeps infrastructure behind settings and shows actual musical effects before confirmation", async () => {
    const { confirm } = mockSession();
    render(<AgentModePanel />);
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    await connect();
    expect(screen.queryByLabelText("MCP plan id")).toBeNull();
    await propose();
    expect(screen.getByText(/Replace the current song with/)).toHaveTextContent("Night Jam");
    expect(screen.getByText(/Add track/)).toHaveTextContent("Night Bass");
    expect(screen.queryByText(/revision 17/)).toBeNull();
    expect(screen.queryByText("Technical plan details")).toBeNull();
    expect(screen.queryByRole("button", { name: /listen|create variation/i })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard proposal" }));
    expect(screen.queryByLabelText("Agent plan preview")).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    await propose();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and apply once" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledExactlyOnceWith("exact-reviewed-plan"));
    expect(screen.queryByLabelText("Agent plan preview")).toBeNull();
    await waitFor(() => expect(screen.getByText(/Execution could not be verified/)).toBeInTheDocument());
  });

  it("reveals MCP and the exact plan only in developer mode without reconnecting", async () => {
    const { disconnect } = mockSession();
    const view = render(<AgentModePanel />);
    await connect();
    await propose();
    view.rerender(<AgentModePanel developerMode />);
    expect(screen.getByLabelText("MCP plan id")).toBeInTheDocument();
    expect(screen.getByText(/revision 17/)).toBeInTheDocument();
    expect(screen.getByText("Technical plan details")).toBeInTheDocument();
    view.rerender(<AgentModePanel />);
    expect(screen.queryByLabelText("MCP plan id")).toBeNull();
    expect(screen.getByLabelText("Agent plan preview")).toBeInTheDocument();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
