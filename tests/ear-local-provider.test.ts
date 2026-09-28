import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { analyzePcm, createLocalEarProvider, createLocalEarHttpServer, parseMonitors, pcmToWav, runBounded, SAMPLE_RATE } from "../lib/ear-local-provider.ts";
import { callEar } from "../lib/ear-client.ts";
import type { CommandRunner } from "../lib/ear-local-provider.ts";

const source = "test.output.monitor";
const devices = Buffer.from(JSON.stringify([
  { index: 1, name: source, monitor_of_sink: 0 },
  { index: 2, name: "mic", monitor_of_sink: 4294967295 },
  { index: 3, name: "pretend.monitor", monitor_of_sink: "n/a" },
  { index: 4, name: "second.output.monitor", properties: { "device.class": "monitor" } },
]));
const pcm = (seconds: number, sample = 0) => {
  const buffer = Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 4);
  for (let offset = 0; offset < buffer.length; offset += 2) buffer.writeInt16LE(sample, offset);
  return buffer;
};
const fixture = () => {
  const calls: { command: string; args: string[]; options: unknown }[] = [];
  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    return command === "pactl" ? devices : pcm(Number(args[args.indexOf("-t") + 1]), 16384);
  };
  return { calls, provider: createLocalEarProvider({ source, run }) };
};

test("local Ear is inert on construction and status, requires an explicit monitor", async () => {
  for (const value of ["", "default", "microphone", "$(capture).monitor", "-f pulse.monitor", "/tmp/a.monitor"]) {
    assert.throws(() => createLocalEarProvider({ source: value }));
  }
  const { provider, calls } = fixture();
  assert.deepEqual(calls, []);
  const reply = await provider.request({ method: "GET", path: "/levels" });
  assert.equal(reply.body.audioCaptured, false);
  assert.equal(reply.body.observation, "not-yet-captured");
  assert.deepEqual(calls, []);
});

test("device discovery excludes microphones and unverified monitor-like names", async () => {
  assert.deepEqual(parseMonitors(devices).map((device) => device.index), [1, 4]);
  assert.throws(() => parseMonitors(Buffer.from("invalid")));
  const { provider } = fixture();
  assert.equal((await provider.request({ method: "GET", path: "/devices" })).status, 200);
  assert.equal((await provider.request({ method: "POST", path: "/device/2" })).status, 404);
  const selected = await provider.request({ method: "POST", path: "/device/4" });
  assert.equal(selected.body.selectedSource, "second.output.monitor");
  assert.equal(selected.body.audioCaptured, false);
});

test("PCM analysis and WAV bytes have explicit units and do not invent musical analysis", () => {
  const input = pcm(0.1, 16384);
  const analysis = analyzePcm(input);
  assert.equal(analysis.rms, 0.5);
  assert.equal(analysis.peak, 0.5);
  assert.ok(Math.abs(analysis.rmsDbfs! + 6.020599913) < 1e-8);
  assert.equal(analysis.durationSeconds, 0.1);
  assert.equal(analysis.musicalAnalysis.supported, false);
  assert.equal(analyzePcm(pcm(0.1)).rmsDbfs, null);
  assert.equal(analyzePcm(pcm(0.1)).digitalSilence, true);
  assert.equal(analyzePcm(pcm(0.1, -32768)).clippedSamples, 9600);
  const wav = pcmToWav(input);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(wav.readUInt32LE(40), input.length);
  assert.deepEqual(wav.subarray(44), input);
  for (const bad of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(1920004)]) assert.throws(() => analyzePcm(bad));
});

test("capture returns bounded WAV or analysis and caches only completed levels", async () => {
  const { provider, calls } = fixture();
  const listen = await provider.request({ method: "GET", path: "/listen?seconds=1" });
  assert.equal(listen.status, 200);
  assert.equal(listen.body.audioCaptured, true);
  assert.equal((listen.body.audio as { mimeType: string }).mimeType, "audio/wav");
  assert.equal(calls[1].command, "ffmpeg");
  assert.equal(calls[1].args[calls[1].args.indexOf("-i") + 1], source);
  assert.deepEqual(calls[1].options, { maxBytes: 192000, timeoutMs: 3000, signal: undefined });
  const analysis = await provider.request({ method: "GET", path: "/analyze?seconds=0.1" });
  assert.equal(analysis.status, 200);
  assert.equal(Object.hasOwn(analysis.body, "audio"), false);
  const before = calls.length;
  const levels = await provider.request({ method: "GET", path: "/levels" });
  assert.equal(calls.length, before);
  assert.equal(levels.body.audioCaptured, false);
  assert.equal(levels.body.observation, "last-completed-capture");
  assert.equal((levels.body.levels as { peak: number }).peak, 0.5);
});

test("invalid operations/durations reject before starting any subprocess", async () => {
  const { provider, calls } = fixture();
  for (const path of ["/analyze?seconds=0", "/analyze?seconds=11", "/analyze?seconds=NaN", "/listen?seconds=.1", "/listen?seconds=1.1", "/listen?seconds=1&seconds=2", "/analyze?source=mic", "//foreign/analyze", "/devices?x=1", "/unknown"]) {
    assert.ok((await provider.request({ method: "GET", path })).status >= 400, path);
  }
  assert.deepEqual(calls, []);
});

test("capture is single-flight, unavailable monitor never captures, incomplete capture is explicit", async () => {
  let release!: (value: Buffer) => void;
  let count = 0;
  const provider = createLocalEarProvider({ source, run: async () => ++count === 1 ? new Promise((resolve) => { release = resolve; }) : pcm(0.1) });
  const first = provider.request({ method: "GET", path: "/analyze?seconds=0.1" });
  assert.equal((await provider.request({ method: "GET", path: "/analyze?seconds=0.1" })).status, 409);
  assert.equal((await provider.request({ method: "POST", path: "/device/4" })).status, 409);
  release(devices);
  assert.equal((await first).status, 200);
  let captures = 0;
  const missing = createLocalEarProvider({ source, run: async () => { captures++; return Buffer.from("[]"); } });
  assert.equal((await missing.request({ method: "GET", path: "/analyze" })).status, 503);
  assert.equal(captures, 1);
  const incomplete = createLocalEarProvider({ source, run: async (command) => command === "pactl" ? devices : pcm(0.1) });
  const reply = await incomplete.request({ method: "GET", path: "/analyze?seconds=1" });
  assert.equal(reply.status, 503);
  assert.equal(reply.body.audioCaptured, null);
  assert.equal(reply.body.captureAttempted, true);
});

test("bounded runner kills synthetic processes on bytes/deadline/cancellation without audio capture", async () => {
  const options = { maxBytes: 16, timeoutMs: 2000 };
  assert.equal((await runBounded(process.execPath, ["-e", "process.stdout.write('ok')"], options)).toString(), "ok");
  await assert.rejects(runBounded(process.execPath, ["-e", "process.stdout.write('x'.repeat(32));setInterval(()=>{},1000)"], options), { code: "capture_too_large" });
  await assert.rejects(runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], { ...options, timeoutMs: 50 }), { code: "capture_timeout" });
  const controller = new AbortController();
  const pending = runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], { ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "capture_aborted" });
  await assert.rejects(runBounded(process.execPath, ["-e", "process.exit(1)"], options), { code: "capture_failed" });
});

test("loopback HTTP interoperates with EarClient and rejects browser/body/foreign-host requests", async () => {
  const { provider, calls } = fixture();
  const server = createLocalEarHttpServer(provider);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const result = await callEar("ear_listen", { seconds: 1 }, { env: { BITWIG_EAR_BASE_URL: base } });
    assert.equal(result.connected, true);
    assert.equal((result as { payload: { schema: string } }).payload.schema, "beat-twin-ear-pcm-v1");
    const count = calls.length;
    for (const init of [
      { headers: { origin: "https://other.example" } },
      { headers: { "sec-fetch-site": "cross-site" } },
      { method: "POST", body: "x" },
    ] as RequestInit[]) {
      const response = await fetch(`${base}/analyze?seconds=1`, init);
      assert.equal(response.status, 403, JSON.stringify(init));
      await response.arrayBuffer();
    }
    // fetch normalizes Host; raw HTTP is needed to exercise the foreign-host guard.
    const foreignStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${base}/analyze`, { headers: { host: "other.example" } }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(foreignStatus, 403);
    assert.equal(calls.length, count);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("HTTP disconnect cancels an in-flight synthetic capture", async () => {
  let capturing!: () => void;
  const started = new Promise<void>((resolve) => { capturing = resolve; });
  let cancelled!: () => void;
  const stopped = new Promise<void>((resolve) => { cancelled = resolve; });
  const provider = createLocalEarProvider({ source, run: async (command, _args, options) => {
    if (command === "pactl") return devices;
    capturing();
    return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => { cancelled(); reject(new Error("cancelled")); }, { once: true }));
  } });
  const server = createLocalEarHttpServer(provider);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${address.port}/analyze`, { signal: controller.signal });
  try {
    await started;
    controller.abort();
    await assert.rejects(pending);
    await stopped;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
