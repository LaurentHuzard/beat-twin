import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import test from "node:test";
import { startLocalBitwigRelay } from "../apps/gateway/src/local-bitwig-relay.ts";
import { BitwigProtocolClient } from "../index.js";

function frame(request: unknown) {
  const body = Buffer.from(JSON.stringify(request));
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
async function connect(port: number) {
  const socket = net.connect(port, "127.0.0.1");
  await once(socket, "connect"); return socket;
}
function requests(socket: net.Socket) {
  let buffer = Buffer.alloc(0);
  const queued: any[] = []; const waiters: ((request: any) => void)[] = [];
  socket.on("data", data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE(0) + 4) {
      const size = buffer.readUInt32BE(0);
      const value = JSON.parse(buffer.subarray(4, 4 + size).toString());
      buffer = buffer.subarray(4 + size);
      const waiter = waiters.shift(); if (waiter) waiter(value); else queued.push(value);
    }
  });
  return () => queued.length ? Promise.resolve(queued.shift()) : new Promise<any>(resolve => waiters.push(resolve));
}

test("loopback relay multiplexes identical IDs without secrets and never retries disconnected writes", async t => {
  const relay = await startLocalBitwigRelay({ clientPort: 0, controllerPort: 0, timeoutMs: 500 });
  t.after(() => relay.close());
  assert.equal(relay.clientAddress.address, "127.0.0.1");
  assert.equal(relay.controllerAddress.address, "127.0.0.1");
  const controller = await connect(relay.controllerAddress.port);
  const next = requests(controller);
  const clients = [0, 1].map(() => new BitwigProtocolClient({ host: "127.0.0.1",
    port: relay.clientAddress.port, connectDelayMs: 0, responseTimeoutMs: 1500,
    logger: { error() {} } }));
  t.after(() => clients.forEach(client => client.destroy()));
  const first = clients[0].send("ping"); const second = clients[1].send("bridge.identity");
  const a = await next(), b = await next(); assert.notEqual(a.id, b.id);
  controller.write(JSON.stringify({ id: b.id, result: b.method }) + "\n");
  controller.write(JSON.stringify({ id: a.id, result: a.method }) + "\n");
  assert.deepEqual(await Promise.all([first, second]), ["ping", "bridge.identity"]);
  const write = clients[0].send("transport.setTempo", [110], { requiresAuthentication: true });
  const auth = await next(); assert.equal(auth.method, "bridge.authenticate"); assert.deepEqual(auth.params, []);
  controller.write(JSON.stringify({ id: auth.id, result: { authenticated: true } }) + "\n");
  const mutation = await next(); assert.equal(mutation.method, "transport.setTempo");
  const rejection = assert.rejects(write, /disconnected; request not retried/);
  controller.destroy(); await rejection;
  await assert.rejects(clients[0].send("ping"), /not connected to the local relay/);
  const replacement = await connect(relay.controllerAddress.port);
  const replacementNext = requests(replacement);
  const read = clients[0].send("ping"); const fresh = await replacementNext();
  assert.equal(fresh.method, "ping");
  replacement.write(JSON.stringify({ id: fresh.id, result: "ready" }) + "\n");
  assert.equal(await read, "ready");
});

test("relay handles fragmented frames, rejects oversized frames and a second controller", async t => {
  const relay = await startLocalBitwigRelay({ clientPort: 0, controllerPort: 0, maxFrameBytes: 1024 });
  t.after(() => relay.close());
  const controller = await connect(relay.controllerAddress.port); const next = requests(controller);
  const second = await connect(relay.controllerAddress.port); await once(second, "close");
  const client = await connect(relay.clientAddress.port);
  const message = frame({ jsonrpc: "2.0", method: "ping", id: "client-id" });
  client.write(message.subarray(0, 2)); client.write(message.subarray(2));
  const request = await next(); assert.equal(request.method, "ping");
  const oversized = Buffer.alloc(4); oversized.writeUInt32BE(1025);
  client.write(oversized); await once(client, "close");
});

test("startup rolls back the controller listener when client port is occupied", async () => {
  const occupied = net.createServer(); occupied.listen(0, "127.0.0.1"); await once(occupied, "listening");
  const port = (occupied.address() as net.AddressInfo).port;
  await assert.rejects(startLocalBitwigRelay({ clientPort: port, controllerPort: 0 }), { code: "EADDRINUSE" });
  occupied.close();
});
