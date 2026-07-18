import test from "node:test";
import assert from "node:assert/strict";
import net from "net";
import { EventEmitter } from "node:events";

import {
  BitwigProtocolClient,
  diagnoseBitwigConnection,
} from "../index.js";
import {
  BITWIG_BRIDGE_PROTOCOL_VERSION,
  createRpcBitwigBridgePort,
} from "../packages/adapters/bitwig/dist/index.js";

function createSilentLogger() {
  return {
    error() {},
  };
}

class FakeSocket extends EventEmitter {
  constructor(connectBehavior) {
    super();
    this.connectBehavior = connectBehavior;
    this.destroyed = false;
  }

  setTimeout() {}

  connect(port, host) {
    this.connectBehavior(this, { port, host });
  }

  destroy() {
    this.destroyed = true;
  }
}

function readLengthPrefixedRequest(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) {
        return;
      }

      const expectedLength = buffer.readUInt32BE(0);
      if (buffer.length < expectedLength + 4) {
        return;
      }

      socket.off("data", onData);
      const body = buffer.slice(4, 4 + expectedLength);
      resolve({
        raw: Buffer.from(buffer.slice(0, 4 + expectedLength)),
        headerLength: expectedLength,
        request: JSON.parse(body.toString("utf8")),
      });
    };

    socket.on("data", onData);
    socket.once("error", (error) => {
      socket.off("data", onData);
      reject(error);
    });
  });
}

async function withMockServer(onConnection, run) {
  const server = net.createServer((socket) => {
    void onConnection(socket);
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve mock server address");
  }

  try {
    return await run({
      host: "127.0.0.1",
      port: address.port,
      server,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("read request uses 4-byte big-endian framing and parses newline-delimited response", async () => {
  await withMockServer(async (socket) => {
    const { request, headerLength, raw } = await readLengthPrefixedRequest(socket);
    assert.equal(headerLength, raw.length - 4);
    assert.deepEqual(request, {
      jsonrpc: "2.0",
      method: "transport.getTempo",
      params: [],
      id: 0,
    });

    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: 128.5,
    });
    socket.write(`${response.slice(0, 14)}`);
    socket.write(`${response.slice(14)}\n`);
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 200,
      logger: createSilentLogger(),
    });

    const result = await client.send("transport.getTempo");
    assert.equal(result, 128.5);
    client.destroy();
  });
});

test("write request preserves params and accepts OK response", async () => {
  await withMockServer(async (socket) => {
    const { request } = await readLengthPrefixedRequest(socket);
    assert.deepEqual(request, {
      jsonrpc: "2.0",
      method: "track.bank.volume",
      params: [2, 0.75],
      id: 0,
    });

    socket.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "OK" })}\n`,
    );
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 200,
      logger: createSilentLogger(),
    });

    const result = await client.send("track.bank.volume", [2, 0.75]);
    assert.equal(result, "OK");
    client.destroy();
  });
});

test("authenticated writes send the bridge secret once per connection", async () => {
  await withMockServer(async (socket) => {
    const authentication = await readLengthPrefixedRequest(socket);
    assert.deepEqual(authentication.request, {
      jsonrpc: "2.0",
      method: "bridge.authenticate",
      params: ["bridge secret value"],
      id: 0,
    });
    socket.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: authentication.request.id,
      result: { authenticated: true },
    })}\n`);

    const firstWrite = await readLengthPrefixedRequest(socket);
    assert.equal(firstWrite.request.method, "transport.setTempo");
    socket.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: firstWrite.request.id,
      result: "OK",
    })}\n`);

    const secondWrite = await readLengthPrefixedRequest(socket);
    assert.equal(secondWrite.request.method, "target.set_track_name");
    socket.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: secondWrite.request.id,
      result: "OK",
    })}\n`);
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 200,
      bridgeSecret: "bridge secret value",
      logger: createSilentLogger(),
    });

    assert.equal(
      await client.send("transport.setTempo", [112], { requiresAuthentication: true }),
      "OK",
    );
    assert.equal(
      await client.send(
        "target.set_track_name",
        [{ controllerInstanceId: "one" }, "Bass"],
        { requiresAuthentication: true },
      ),
      "OK",
    );
    client.destroy();
  });
});

test("Bitwig adapter port and protocol client share one authenticated connection", async () => {
  const observedMethods = [];
  await withMockServer(async (socket) => {
    const authentication = await readLengthPrefixedRequest(socket);
    observedMethods.push(authentication.request.method);
    socket.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: authentication.request.id,
      result: { authenticated: true },
    })}\n`);

    const inspection = await readLengthPrefixedRequest(socket);
    observedMethods.push(inspection.request.method);
    socket.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: inspection.request.id,
      result: {
        protocolVersion: BITWIG_BRIDGE_PROTOCOL_VERSION,
        controllerInstanceId: "controller-1",
        projectName: "Disposable",
        writeAuthenticated: true,
        target: {
          available: true,
          binding: {
            controllerInstanceId: "controller-1",
            projectName: "Disposable",
            trackPosition: 0,
            slotSceneIndex: 0,
            targetGeneration: 1,
          },
          trackName: "Instrument 1",
          slotName: "",
          hasContent: false,
          clipExists: false,
          clipLengthBeats: null,
        },
        transport: { tempoBpm: 120, positionBeats: 0, isPlaying: false },
        grid: { stepSizeBeats: 0.25, maxSteps: 64 },
        notes: [],
      },
    })}\n`);

    const mutation = await readLengthPrefixedRequest(socket);
    observedMethods.push(mutation.request.method);
    socket.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: mutation.request.id,
      result: "OK",
    })}\n`);
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 200,
      logger: createSilentLogger(),
    });
    const adapterPort = createRpcBitwigBridgePort({
      bridgeSecret: "single shared secret",
      call: (method, params, options) => client.send(method, params, options),
    });

    await adapterPort.authenticate();
    await adapterPort.mutate("target.set_tempo", [
      {
        controllerInstanceId: "controller-1",
        projectName: "Disposable",
        trackPosition: 0,
        slotSceneIndex: 0,
        targetGeneration: 1,
      },
      112,
    ]);
    client.destroy();
  });
  assert.deepEqual(observedMethods, [
    "bridge.authenticate",
    "target.inspect",
    "target.set_tempo",
  ]);
});

test("timeout rejects when Bitwig stays silent", async () => {
  await withMockServer(async (socket) => {
    await readLengthPrefixedRequest(socket);
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 50,
      logger: createSilentLogger(),
    });

    await assert.rejects(
      client.send("scene.list"),
      /Timeout waiting for Bitwig response/,
    );
    client.destroy();
  });
});

test("malformed response rejects the pending request", async () => {
  await withMockServer(async (socket) => {
    await readLengthPrefixedRequest(socket);
    socket.write("not-json\n");
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 200,
      logger: createSilentLogger(),
    });

    await assert.rejects(
      client.send("device.get_status"),
      /Malformed Bitwig response/,
    );
    client.destroy();
  });
});

test("client reconnects after remote close", async () => {
  let connectionCount = 0;

  await withMockServer(async (socket) => {
    connectionCount += 1;
    const { request } = await readLengthPrefixedRequest(socket);

    socket.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: connectionCount === 1 ? "first" : "second",
      })}\n`,
    );

    socket.end();
  }, async ({ host, port }) => {
    const client = new BitwigProtocolClient({
      host,
      port,
      connectDelayMs: 0,
      responseTimeoutMs: 200,
      logger: createSilentLogger(),
    });

    assert.equal(await client.send("ping"), "first");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(await client.send("ping"), "second");
    assert.equal(connectionCount, 2);
    client.destroy();
  });
});

test("diagnostic reports when the Bitwig bridge accepts TCP connections", async () => {
  const result = await diagnoseBitwigConnection({
    host: "127.0.0.1",
    port: 8888,
    timeoutMs: 200,
    createSocket: () =>
      new FakeSocket((socket) => {
        setImmediate(() => socket.emit("connect"));
      }),
  });

  assert.equal(result.connected, true);
  assert.equal(result.scope, "tcp-connectivity");
  assert.equal(result.status, "listening");
  assert.equal(result.target, "127.0.0.1:8888");
  assert.match(result.hint, /accepting TCP connections/);
});

test("diagnostic explains a refused Bitwig bridge connection", async () => {
  const result = await diagnoseBitwigConnection({
    host: "127.0.0.1",
    port: 8888,
    timeoutMs: 200,
    createSocket: () =>
      new FakeSocket((socket) => {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:8888");
        error.code = "ECONNREFUSED";
        setImmediate(() => socket.emit("error", error));
      }),
  });

  assert.equal(result.connected, false);
  assert.equal(result.scope, "tcp-connectivity");
  assert.equal(result.status, "error");
  assert.equal(result.error_code, "ECONNREFUSED");
  assert.match(result.hint, /Beat Twin controller is not listening/);
});
