import net, { type Socket, type Server } from "node:net";
import { pathToFileURL } from "node:url";

// Both sides are fixed IPv4 loopback listeners. Never accept a host override.
// The controller connects out to controllerPort; existing clients use clientPort.
export async function startLocalBitwigRelay({ clientPort = 8888, controllerPort = 8889,
  timeoutMs = 30_000, maxFrameBytes = 1_048_576 } = {}) {
  let controller: Socket | undefined;
  let sequence = 0;
  const clients = new Set<Socket>();
  const pending = new Map<number, { socket: Socket; id: unknown; timer: NodeJS.Timeout }>();
  const reply = (socket: Socket, value: unknown) => {
    if (!socket.destroyed) socket.write(JSON.stringify(value) + "\n");
  };
  const fail = (id: number, message: string) => {
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(id);
    reply(item.socket, { jsonrpc: "2.0", id: item.id, error: { code: -32000, message } });
  };
  const controllerServer = net.createServer(socket => {
    if (controller || socket.remoteAddress !== "127.0.0.1") { socket.destroy(); return; }
    controller = socket;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => socket.destroy());
    socket.on("data", data => {
      buffer += data;
      if (Buffer.byteLength(buffer) > maxFrameBytes) { socket.destroy(); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          const item = pending.get(response.id);
          if (!item) continue;
          clearTimeout(item.timer); pending.delete(response.id);
          reply(item.socket, { ...response, id: item.id });
        } catch { socket.destroy(); return; }
      }
    });
    socket.on("close", () => {
      if (controller === socket) controller = undefined;
      for (const id of pending.keys()) fail(id, "Bitwig controller disconnected; request not retried");
    });
  });
  const clientServer = net.createServer(socket => {
    if (socket.remoteAddress !== "127.0.0.1") { socket.destroy(); return; }
    clients.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clients.delete(socket);
      for (const [id, item] of pending) if (item.socket === socket) {
        clearTimeout(item.timer); pending.delete(id);
      }
    });
    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0 || length > maxFrameBytes) { socket.destroy(); return; }
        if (buffer.length < length + 4) return;
        const body = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
        try {
          const request = JSON.parse(body.toString("utf8"));
          if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string" ||
              !(typeof request.id === "number" || typeof request.id === "string")) {
            socket.destroy(); return;
          }
          if (!controller) {
            reply(socket, { jsonrpc: "2.0", id: request.id, error: { code: -32000,
              message: "Bitwig controller is not connected to the local relay" } });
            continue;
          }
          if (pending.size >= 256) {
            reply(socket, { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Local bridge is busy" } });
            continue;
          }
          const id = ++sequence;
          pending.set(id, { socket, id: request.id,
            timer: setTimeout(() => fail(id, "Bitwig response timed out; request not retried"), timeoutMs) });
          const output = Buffer.from(JSON.stringify({ ...request, id }));
          const header = Buffer.alloc(4); header.writeUInt32BE(output.length);
          controller.write(Buffer.concat([header, output]));
        } catch { socket.destroy(); return; }
      }
    });
  });
  const listen = (server: Server, port: number) => new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const closeServer = (server: Server) => new Promise<void>(resolve => {
    if (!server.listening) { resolve(); return; }
    server.close(() => resolve());
  });
  const close = async () => {
    controller?.destroy();
    for (const socket of clients) socket.destroy();
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    await Promise.all([closeServer(clientServer), closeServer(controllerServer)]);
  };
  try {
    await listen(controllerServer, controllerPort);
    await listen(clientServer, clientPort);
  } catch (error) { await close(); throw error; }
  return { clientAddress: clientServer.address() as net.AddressInfo,
    controllerAddress: controllerServer.address() as net.AddressInfo, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await startLocalBitwigRelay();
  console.error("Bitwig local relay ready: 127.0.0.1:8888; controller connects to 127.0.0.1:8889");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    void relay.close().then(() => process.exit(0));
  });
}
