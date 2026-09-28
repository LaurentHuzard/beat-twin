import { createLocalEarHttpServer, createLocalEarProvider } from "../lib/ear-local-provider.ts";

const source = process.env.BITWIG_EAR_MONITOR_SOURCE;
const rawPort = process.env.BITWIG_EAR_PORT ?? "8765";
if (!source || !/^[1-9][0-9]{0,4}$/.test(rawPort) || Number(rawPort) > 65535) {
  throw new Error("Set BITWIG_EAR_MONITOR_SOURCE to an explicit output monitor and BITWIG_EAR_PORT to a valid port (default 8765).");
}
const server = createLocalEarHttpServer(createLocalEarProvider({ source }));
server.on("error", (error) => { console.error(`Local Ear server failed: ${error.message}`); process.exitCode = 1; });
server.listen(Number(rawPort), "127.0.0.1", () => {
  console.error(`Local Ear ready at http://127.0.0.1:${rawPort}; output monitor ${source}. Capture occurs only on /listen or /analyze.`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.closeAllConnections(); // response cancellation kills any running capture child
  server.close(() => { process.exitCode = 0; });
});
