import test from "node:test";
import assert from "node:assert/strict";
import net from "net";

import { BitwigProtocolClient } from "../index.js";

function createSilentLogger() {
  return {
    error() {},
  };
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
