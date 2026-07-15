import { describe, expect, it, vi } from "vitest";
import type { CommandBatchResult } from "@beat-twin/commands";

import {
  BROWSER_NANODAW_PROTOCOL,
  createAgentGatewaySession,
  encodeBrowserPairingProtocol,
} from "./agentGateway";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly CONNECTING = FakeWebSocket.CONNECTING;
  readonly OPEN = FakeWebSocket.OPEN;
  readonly CLOSING = FakeWebSocket.CLOSING;
  readonly CLOSED = FakeWebSocket.CLOSED;
  readonly url: string;
  readonly protocols: readonly string[];
  readonly sent: unknown[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL, protocols: string | string[] = []) {
    super();
    this.url = String(url);
    this.protocols = Array.isArray(protocols) ? protocols : [protocols];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  receive(value: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Agent Gateway browser client", () => {
  it("pairs explicitly, previews before confirmation, and serves the browser port", async () => {
    FakeWebSocket.instances = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: "btp_browser-secret" }, 201))
      .mockResolvedValueOnce(jsonResponse({
        runId: "request-1",
        dawId: "nanodaw",
        model: "gemma-s25",
        steps: 2,
        patch: {},
        preview: { summary: ["Create song", "Add a bass clip"], commands: [{ type: "CreateSong" }] },
        plan: {
          planId: "plan-1",
          adapterId: "nanodaw",
          baseRevision: 0,
          requiredScopes: ["song.write"],
          expiresAt: "2026-07-15T09:02:00.000Z",
          commands: [{ type: "CreateSong" }],
        },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({ confirmationToken: "confirm-1" }))
      .mockResolvedValueOnce(jsonResponse({
        report: {
          ok: true,
          status: "succeeded",
          planId: "plan-1",
          finalSnapshot: { song: null, revision: 1 },
        },
      }));
    const port = {
      inspect: vi.fn(() => ({ song: null, revision: 0 })),
      executeCommandBatch: vi.fn((): CommandBatchResult => ({
        ok: false as const,
        requestId: "request-1",
        state: { song: null, revision: 0, selection: null, log: [] },
        snapshot: { song: null, revision: 0 },
        commands: [],
        results: [],
        events: [],
        errorCode: "invalid_command" as const,
        error: "fixture",
      })),
    };
    const connectionChanges: boolean[] = [];
    const session = createAgentGatewaySession({
      baseUrl: "http://127.0.0.1:8787",
      operatorSecret: "operator secret value",
      port,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      onConnectionChange: (connected) => connectionChanges.push(connected),
    });

    await session.connect();
    expect(session.isConnected()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const socket = FakeWebSocket.instances[0];
    expect(socket.protocols).toEqual([
      BROWSER_NANODAW_PROTOCOL,
      encodeBrowserPairingProtocol("btp_browser-secret"),
    ]);
    expect(socket.url).toBe("ws://127.0.0.1:8787/v1/browser/nanodaw");

    socket.receive({ v: 1, id: "inspect-1", method: "inspect", params: {} });
    await Promise.resolve();
    expect(port.inspect).toHaveBeenCalledTimes(1);
    expect(socket.sent).toContainEqual({
      v: 1,
      id: "inspect-1",
      ok: true,
      result: { song: null, revision: 0 },
    });

    const preview = await session.run("Make a bass loop");
    expect(preview.plan.planId).toBe("plan-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.some(([url]) => String(url).includes("/confirm")),
    ).toBe(false);

    const execution = await session.confirmAndExecute(preview.plan.planId);
    expect(execution.report.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(String(fetchImpl.mock.calls[2][0])).toContain("/confirm");
    expect(String(fetchImpl.mock.calls[3][0])).toContain("/execute");
    expect(localStorage.length).toBe(0);

    session.disconnect();
    expect(connectionChanges.at(-1)).toBe(false);
  });

  it("rejects non-loopback gateway origins before pairing", () => {
    expect(() => createAgentGatewaySession({
      baseUrl: "https://gateway.example",
      operatorSecret: "secret",
      port: { inspect: () => ({ song: null, revision: 0 }), executeCommandBatch: vi.fn() },
    })).toThrow(/loopback/i);
  });
});
