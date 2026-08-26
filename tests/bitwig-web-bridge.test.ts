import assert from "node:assert/strict";
import test from "node:test";

import {
  BitwigWebBridgeError,
  bitwigWebTransportTools,
  createBitwigWebBridge,
} from "../apps/playground/bitwigWebBridge.ts";

function connectedReadCall(calls: unknown[]) {
  const responses = new Map<string, unknown>([
    ["ping", "pong"],
    ["transport.getTempo", 126],
    ["transport.getPosition", 32],
    ["transport.getIsPlaying", false],
    ["transport.getIsRecording", false],
    ["track.bank.get_status", [{ index: 0, name: "Drums" }]],
    ["track.selected.get_status", { name: "Drums" }],
    ["scene.list", []],
    ["device.get_status", { name: "Drum Machine" }],
    ["device.get_remote_controls", []],
  ]);

  return async (
    method: string,
    params: readonly unknown[] = [],
    options: { readonly requiresAuthentication?: boolean } = {},
  ) => {
    calls.push({ method, params, options });
    if (!responses.has(method)) throw new Error(`Unexpected method ${method}`);
    return responses.get(method);
  };
}

test("web inspection delegates to the current read-only MCP session tool", async () => {
  const calls: unknown[] = [];
  const bridge = createBitwigWebBridge({ env: {}, call: connectedReadCall(calls) });

  const result = await bridge.inspect();

  assert.equal(result.bridge.scope, "loopback");
  assert.equal(result.bridge.sessionTool, "bitwig_session_inspect");
  assert.equal(result.session.connected, true);
  assert.deepEqual(result.commands, []);
  assert.equal(calls.length, 10);
  assert.ok(
    calls.every((entry) =>
      (entry as { options: { requiresAuthentication?: boolean } }).options
        .requiresAuthentication !== true,
    ),
  );
});

test("web commands require a fresh exact action confirmation", async () => {
  let callCount = 0;
  const bridge = createBitwigWebBridge({
    env: { BITWIG_MCP_WRITE_POLICY: "transport" },
    call: async () => {
      callCount += 1;
      return "OK";
    },
  });

  await assert.rejects(
    bridge.execute({ tool: "transport_play", arguments: {} }),
    (error: unknown) =>
      error instanceof BitwigWebBridgeError &&
      error.status === 409 &&
      error.code === "confirmation_required",
  );
  assert.equal(callCount, 0);
});

test("web commands cannot bypass the current MCP policy", async () => {
  let callCount = 0;
  const bridge = createBitwigWebBridge({
    env: {},
    call: async () => {
      callCount += 1;
      return "OK";
    },
  });

  await assert.rejects(
    bridge.execute({
      tool: "transport_play",
      arguments: {},
      confirmation: "transport_play",
    }),
    (error: unknown) =>
      error instanceof BitwigWebBridgeError &&
      error.status === 403 &&
      error.code === "policy_blocked",
  );
  assert.equal(callCount, 0);
});

test("enabled bounded transport commands use authenticated Bitwig calls", async () => {
  const calls: unknown[] = [];
  const bridge = createBitwigWebBridge({
    env: { BITWIG_MCP_WRITE_POLICY: "transport" },
    call: async (method, params, options) => {
      calls.push({ method, params, options });
      return "OK";
    },
  });

  const result = await bridge.execute({
    tool: "transport_stop",
    arguments: {},
    confirmation: "transport_stop",
  });

  assert.deepEqual(bitwigWebTransportTools, [
    "transport_restart",
    "transport_play",
    "transport_stop",
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    method: "transport.stop",
    params: [],
    options: { requiresAuthentication: true },
  }]);
});
