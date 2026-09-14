import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentModePanel, resetAgentGatewaySessionFactory, setAgentGatewaySessionFactory } from "./AgentModePanel";
import type { AgentExecution, AgentGatewaySessionOptions, AgentPlanPreview, McpPlanInbox } from "./agentGateway";
import { usePlaygroundStore } from "./store";

const proposal: AgentPlanPreview = {
  runId: "connection-test", dawId: "nanodaw", model: "offline-test", steps: 1, patch: {},
  preview: { summary: ["A fresh bass proposal"], commands: [] },
  plan: {
    planId: "connection-test-plan", adapterId: "nanodaw", baseRevision: 0,
    requiredScopes: ["song.write"], expiresAt: "2099-01-01T00:00:00Z",
    commands: [{ type: "CreateTrack", id: "bass", name: "Fresh Bass", instrumentId: "bass" }],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function sessionHarness(first: {
  pairing?: Promise<void>;
  run?: Promise<AgentPlanPreview>;
  inbox?: Promise<McpPlanInbox | null>;
  execution?: Promise<AgentExecution>;
} = {}) {
  const records: Array<{
    options: AgentGatewaySessionOptions;
    disconnect: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    loseConnection: () => void;
  }> = [];
  const factory = vi.fn((options: AgentGatewaySessionOptions) => {
    const initial = records.length === 0;
    let connected = false;
    const disconnect = vi.fn(() => {
      connected = false;
      options.onConnectionChange?.(false);
    });
    const confirm = vi.fn(() => initial && first.execution
      ? first.execution
      : Promise.reject(new Error("Offline execution is not authorized")));
    records.push({ options, disconnect, confirm, loseConnection: disconnect });
    return {
      connect: vi.fn(async () => {
        // The real session reports a disconnect before pairing starts.
        options.onConnectionChange?.(false);
        if (initial && first.pairing) await first.pairing;
        connected = true;
        options.onConnectionChange?.(true);
      }),
      disconnect,
      isConnected: () => connected,
      run: vi.fn(() => initial && first.run ? first.run : Promise.resolve(proposal)),
      loadMcpPlan: vi.fn(async () => proposal),
      listMcpPlans: vi.fn(() => initial && first.inbox ? first.inbox : Promise.resolve(null)),
      confirmAndExecute: confirm,
    };
  });
  setAgentGatewaySessionFactory(factory);
  return { factory, records };
}

async function mount(autoConnect = true) {
  const view = render(<AgentModePanel autoConnect={autoConnect} />);
  if (!autoConnect) fireEvent.click(screen.getByRole("button", { name: "Enable Agent mode" }));
  await act(async () => {});
  return view;
}

function edit() {
  fireEvent.click(screen.getByRole("button", { name: "Edit connection" }));
}

async function reconnect(url = "http://127.0.0.1:9797") {
  fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Gateway" }));
  await act(async () => {});
}

async function propose() {
  fireEvent.change(screen.getByLabelText("Agent musical request"), { target: { value: "Create a bass" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  resetAgentGatewaySessionFactory();
  vi.useRealTimers();
  vi.restoreAllMocks();
  usePlaygroundStore.setState(usePlaygroundStore.getInitialState(), true);
  localStorage.clear();
});

describe("TWIN connection reconfiguration", () => {
  it.each([false, true])("edits and reconnects explicitly with autoConnect=%s without changing the song", async (autoConnect) => {
    vi.useFakeTimers();
    const { factory, records } = sessionHarness();
    usePlaygroundStore.getState().createDemo();
    const before = usePlaygroundStore.getState().commandState;
    await mount(autoConnect);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByLabelText("Gateway URL")).toBeDisabled();
    edit();
    expect(screen.getByLabelText("Gateway URL")).toBeVisible();
    expect(screen.getByLabelText("Gateway URL")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disable Agent mode" })).toBeEnabled();
    expect(screen.getByText(/Connection is paused/)).toBeVisible();
    expect(records[0].disconnect).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(factory).toHaveBeenCalledOnce();
    await reconnect();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(records[1].options.baseUrl).toBe("http://127.0.0.1:9797");
    expect(records[1].options).not.toHaveProperty("operatorSecret");
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(usePlaygroundStore.getState().commandState).toBe(before);
    for (const record of records) expect(record.confirm).not.toHaveBeenCalled();
  });

  it("does not create overlapping pairings after the session's initial disconnect callback", async () => {
    vi.useFakeTimers();
    const pairing = deferred<void>();
    const { factory } = sessionHarness({ pairing: pairing.promise });
    await mount();
    expect(screen.getByText("Pairing")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(factory).toHaveBeenCalledOnce();
    await act(async () => { pairing.resolve(undefined); });
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it.each(["resolve", "reject"] as const)("ignores a cancelled pairing that later %ss after connecting elsewhere", async (outcome) => {
    vi.useFakeTimers();
    const pairing = deferred<void>();
    const { factory, records } = sessionHarness({ pairing: pairing.promise });
    await mount();
    edit();
    expect(records[0].disconnect).toHaveBeenCalledOnce();
    await reconnect();
    await act(async () => {
      if (outcome === "resolve") pairing.resolve(undefined);
      else pairing.reject(new Error("Old gateway failed"));
    });
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText("Old gateway failed")).toBeNull();
    expect(records[1].disconnect).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("cancels a queued retry while editing and resumes retries with the new settings after Connect", async () => {
    vi.useFakeTimers();
    const pairing = deferred<void>();
    const { factory, records } = sessionHarness({ pairing: pairing.promise });
    await mount();
    await act(async () => { pairing.reject(new Error("Gateway unavailable")); });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    edit();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(factory).toHaveBeenCalledOnce();
    await reconnect();
    act(() => records[1].loseConnection());
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(factory).toHaveBeenCalledTimes(3);
    expect(records[2].options.baseUrl).toBe("http://127.0.0.1:9797");
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("ignores late proposals, inbox results and connection callbacks from the previous gateway", async () => {
    const run = deferred<AgentPlanPreview>();
    const inbox = deferred<McpPlanInbox | null>();
    const { records } = sessionHarness({ run: run.promise, inbox: inbox.promise });
    await mount();
    await propose();
    edit();
    await reconnect();
    await act(async () => {
      run.resolve(proposal);
      inbox.resolve({ agentAvailable: true, plans: [{
        planId: "old-inbox", name: "Old Gateway", instrumentId: "bass", expiresAt: proposal.plan.expiresAt,
      }] });
      records[0].options.onConnectionChange?.(false);
      records[0].options.onConnectionChange?.(true);
    });
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Agent plan preview")).toBeNull();
    expect(screen.queryByRole("button", { name: /Review Old Gateway/ })).toBeNull();
    expect(records[1].disconnect).not.toHaveBeenCalled();
    for (const record of records) expect(record.confirm).not.toHaveBeenCalled();
  });

  it("discards a reviewed proposal on edit and never confirms it on the replacement session", async () => {
    const { records } = sessionHarness();
    await mount();
    await propose();
    expect(screen.getByLabelText("Agent plan preview")).toBeInTheDocument();
    edit();
    expect(screen.queryByLabelText("Agent plan preview")).toBeNull();
    await reconnect();
    expect(screen.queryByRole("button", { name: "Confirm and apply once" })).toBeNull();
    for (const record of records) expect(record.confirm).not.toHaveBeenCalled();
    await propose();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and apply once" }));
    await act(async () => {});
    expect(records[0].confirm).not.toHaveBeenCalled();
    expect(records[1].confirm).toHaveBeenCalledExactlyOnceWith(proposal.plan.planId);
  });

  it("clears secrets on edit and URL changes and does not persist them", async () => {
    const { records } = sessionHarness();
    await mount();
    edit();
    fireEvent.click(screen.getByRole("checkbox", { name: "This gateway requires an operator secret" }));
    fireEvent.change(screen.getByLabelText("Operator secret"), { target: { value: "first-secret" } });
    fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: "http://127.0.0.1:9797" } });
    expect(screen.getByLabelText("Operator secret")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Operator secret"), { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Gateway" }));
    await act(async () => {});
    expect(records[1].options.operatorSecret).toBe("replacement-secret");
    edit();
    expect(screen.getByLabelText("Operator secret")).toHaveValue("");
    expect(JSON.stringify(localStorage)).not.toContain("replacement-secret");
    expect(JSON.stringify(sessionStorage)).not.toContain("replacement-secret");
    fireEvent.click(screen.getByRole("button", { name: "Disable Agent mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable Agent mode" }));
    await act(async () => {});
    expect(records[2].options).not.toHaveProperty("operatorSecret");
  });

  it("blocks editing and reconnection during confirmed execution, including after a dropped socket", async () => {
    vi.useFakeTimers();
    const execution = deferred<AgentExecution>();
    const { factory, records } = sessionHarness({ execution: execution.promise });
    await mount();
    await propose();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and apply once" }));
    expect(screen.getByRole("button", { name: "Edit connection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable Agent mode" })).toBeDisabled();
    act(() => records[0].loseConnection());
    expect(screen.getByLabelText("Gateway URL")).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(factory).toHaveBeenCalledOnce();
    await act(async () => { execution.reject(new Error("Readback unavailable")); });
    expect(screen.getByText(/Execution could not be verified/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit connection" })).toBeEnabled();
    edit();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(factory).toHaveBeenCalledOnce();
    expect(records[0].confirm).toHaveBeenCalledExactlyOnceWith(proposal.plan.planId);
  });

  it.each(["disable", "unmount"] as const)("does not revive an in-flight pairing after %s", async (action) => {
    vi.useFakeTimers();
    const pairing = deferred<void>();
    const { factory, records } = sessionHarness({ pairing: pairing.promise });
    const view = await mount();
    if (action === "disable") fireEvent.click(screen.getByRole("button", { name: "Disable Agent mode" }));
    else view.unmount();
    await act(async () => { pairing.resolve(undefined); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(factory).toHaveBeenCalledOnce();
    expect(records[0].disconnect).toHaveBeenCalled();
    expect(screen.queryByText("Connected")).toBeNull();
  });
});
