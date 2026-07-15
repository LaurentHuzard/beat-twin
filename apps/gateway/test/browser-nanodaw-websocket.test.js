import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createCommandRuntime, createCommandState } from "@beat-twin/commands";
import { PairingAuthority } from "@beat-twin/gateway-core";
import { WebSocket } from "ws";

import {
  BROWSER_NANODAW_PROTOCOL,
  createBrowserNanoDawWebSocketProxy,
  encodeBrowserPairingProtocol,
} from "../src/browser-nanodaw-websocket.js";

const ORIGIN = "http://127.0.0.1:5173";

function tokenSequence(prefix) {
  let count = 0;
  return () => `${prefix}-${++count}`;
}

async function fixture(options = {}) {
  const pairing = new PairingAuthority({ audit: () => {}, tokenGenerator: tokenSequence("pair") });
  const grant = await pairing.issue({
    actorId: "browser-user",
    scopes: ["daw.inspect", "song.write"],
    ttlMs: 60_000,
    maxRequests: 20,
  });
  const proxy = createBrowserNanoDawWebSocketProxy({
    pairing,
    allowedOrigins: [ORIGIN],
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    idGenerator: tokenSequence("id"),
    now: () => Date.parse("2026-07-15T08:00:00.000Z"),
  });
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  proxy.attach(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/v1/browser/nanodaw`;

  async function cleanup() {
    await proxy.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  return { grant, pairing, proxy, server, url, cleanup };
}

function openBrowser(url, token, onRequest) {
  const webSocket = new WebSocket(
    url,
    [BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol(token)],
    { origin: ORIGIN },
  );
  if (onRequest) {
    webSocket.on("message", (data) => onRequest(JSON.parse(data.toString("utf8")), webSocket));
  }
  return new Promise((resolve, reject) => {
    webSocket.once("open", () => resolve(webSocket));
    webSocket.once("error", reject);
  });
}

test("requires a paired token and an allowed browser Origin", async () => {
  const current = await fixture();
  try {
    const missingTokenStatus = await new Promise((resolve, reject) => {
      const webSocket = new WebSocket(current.url, [BROWSER_NANODAW_PROTOCOL], { origin: ORIGIN });
      webSocket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      webSocket.once("error", reject);
    });
    assert.equal(missingTokenStatus, 401);

    const wrongOriginStatus = await new Promise((resolve, reject) => {
      const webSocket = new WebSocket(
        current.url,
        [BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol(current.grant.token)],
        { origin: "https://evil.example" },
      );
      webSocket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      webSocket.once("error", reject);
    });
    assert.equal(wrongOriginStatus, 401);
    assert.deepEqual(current.proxy.status(), { state: "disconnected", connected: false });
  } finally {
    await current.cleanup();
  }
});

test("proxies inspection and one CAS batch to the browser-owned runtime", async () => {
  const current = await fixture();
  const runtime = createCommandRuntime(createCommandState());
  let executeCount = 0;
  const browser = await openBrowser(current.url, current.grant.token, (message, socket) => {
    let result;
    if (message.method === "inspect") {
      result = runtime.inspect();
    } else {
      executeCount += 1;
      result = runtime.executeCommandBatch(message.params.request);
    }
    socket.send(JSON.stringify({ v: 1, id: message.id, ok: true, result }));
  });

  try {
    assert.deepEqual(await current.proxy.port.inspect(), { song: null, revision: 0 });
    const batch = await current.proxy.port.executeCommandBatch({
      requestId: "request-create",
      expectedRevision: 0,
      commands: [{ type: "CreateSong", id: "song-1", title: "Browser owned" }],
    });
    assert.equal(batch.ok, true);
    assert.equal(batch.snapshot.revision, 1);
    assert.equal(executeCount, 1);
    assert.equal(runtime.inspect().song?.title, "Browser owned");
    assert.deepEqual(current.proxy.status(), {
      state: "connected",
      connected: true,
      sessionId: "browser-id-1",
      connectedAt: "2026-07-15T08:00:00.000Z",
      actorId: "browser-user",
      pendingRequests: 0,
    });
    assert.equal(JSON.stringify(current.proxy.status()).includes(current.grant.token), false);

    const secondStatus = await new Promise((resolve, reject) => {
      const second = new WebSocket(
        current.url,
        [BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol(current.grant.token)],
        { origin: ORIGIN },
      );
      second.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      second.once("error", reject);
    });
    assert.equal(secondStatus, 409);
    assert.equal(runtime.inspect().revision, 1);
  } finally {
    browser.close();
    await current.cleanup();
  }
});

test("reports an unknown mutation outcome when the browser disconnects after dispatch", async () => {
  const current = await fixture();
  const browser = await openBrowser(current.url, current.grant.token, (message, socket) => {
    if (message.method === "executeCommandBatch") socket.terminate();
  });
  try {
    await assert.rejects(
      current.proxy.port.executeCommandBatch({
        requestId: "request-uncertain",
        expectedRevision: 0,
        commands: [{ type: "CreateSong", id: "song-1" }],
      }),
      (error) => error?.code === "outcome_unknown" && /mutation state is unknown/.test(error.message),
    );
    assert.deepEqual(current.proxy.status(), { state: "disconnected", connected: false });
  } finally {
    browser.terminate();
    await current.cleanup();
  }
});
