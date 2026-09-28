/** Explicitly operated Pulse/PipeWire output-monitor capture. Never starts on import. */
import { spawn } from "node:child_process";
import { createServer } from "node:http";

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
const MAX_PCM_BYTES = SAMPLE_RATE * CHANNELS * 2 * 10;
const SCHEMA = "beat-twin-ear-pcm-v1";

export class LocalEarError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type RunOptions = { maxBytes: number; timeoutMs: number; signal?: AbortSignal };
export type CommandRunner = (command: string, args: string[], options: RunOptions) => Promise<Buffer>;

/** Fixed command names, argv only, bounded output/deadline, child killed on cancellation. */
export const runBounded: CommandRunner = (command, args, options) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) return reject(new LocalEarError("capture_aborted", "Request was cancelled.", 499));
  const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let bytes = 0;
  let stderrBytes = 0;
  let failure: LocalEarError | undefined;
  const fail = (error: LocalEarError) => { failure ??= error; child.kill("SIGKILL"); };
  const abort = () => fail(new LocalEarError("capture_aborted", "Request was cancelled.", 499));
  const timer = setTimeout(() => fail(new LocalEarError("capture_timeout", "Audio command exceeded its deadline.", 504)), options.timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > options.maxBytes) fail(new LocalEarError("capture_too_large", "Audio command exceeded its byte bound."));
    else if (!failure) chunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 16384) fail(new LocalEarError("capture_failed", "Audio command produced excessive diagnostics."));
  });
  const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
  child.on("error", () => { cleanup(); reject(new LocalEarError("dependency_unavailable", "Required local audio command could not start.")); });
  child.on("close", (code) => {
    cleanup();
    if (failure) reject(failure);
    else if (code !== 0) reject(new LocalEarError("capture_failed", "Audio command failed; verify the selected monitor and local audio service."));
    else resolve(Buffer.concat(chunks));
  });
});

function validSource(source: unknown): source is string {
  return typeof source === "string" && source.length <= 256 && /^[A-Za-z0-9_.:-]+\.monitor$/.test(source);
}

/** Monitor source identity is checked independently of the supplied name. */
export function parseMonitors(data: Buffer) {
  let sources: unknown;
  try { sources = JSON.parse(data.toString("utf8")); } catch { throw new LocalEarError("invalid_devices", "pactl returned invalid JSON."); }
  if (!Array.isArray(sources)) throw new LocalEarError("invalid_devices", "pactl did not return a source list.");
  return sources.filter((source) => {
    if (!source || !validSource(source.name) || !Number.isInteger(source.index) || source.index < 0) return false;
    const sink = source.monitor_of_sink;
    return (Number.isInteger(sink) && sink >= 0 && sink < 4294967295)
      || (typeof sink === "string" && sink.length > 0 && sink !== "n/a" && sink !== "4294967295")
      || source.properties?.["device.class"] === "monitor";
  }).map((source) => ({ index: source.index as number, name: source.name as string, kind: "output-monitor" }));
}

export function analyzePcm(pcm: Buffer) {
  if (!pcm.length || pcm.length % (CHANNELS * 2) !== 0 || pcm.length > MAX_PCM_BYTES) {
    throw new LocalEarError("invalid_pcm", "Capture returned empty, misaligned or excessive PCM data.");
  }
  const sums = [0, 0];
  const peaks = [0, 0];
  let clippedSamples = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const raw = pcm.readInt16LE(offset);
    const sample = raw / 32768;
    const channel = (offset / 2) % CHANNELS;
    sums[channel] += sample * sample;
    peaks[channel] = Math.max(peaks[channel], Math.abs(sample));
    if (raw === -32768 || raw === 32767) clippedSamples++;
  }
  const frames = pcm.length / (CHANNELS * 2);
  const rms = Math.sqrt((sums[0] + sums[1]) / (frames * CHANNELS));
  const peak = Math.max(...peaks);
  const db = (value: number) => value === 0 ? null : 20 * Math.log10(value);
  return {
    sampleRateHz: SAMPLE_RATE, channels: CHANNELS, frames, durationSeconds: frames / SAMPLE_RATE,
    rms, peak, rmsDbfs: db(rms), peakDbfs: db(peak),
    silenceDbfsRepresentation: "null means negative infinity",
    clippedSamples, digitalSilence: peak === 0,
    perChannel: sums.map((sum, channel) => ({ channel, rms: Math.sqrt(sum / frames), peak: peaks[channel] })),
    musicalAnalysis: { bpm: null, key: null, supported: false },
  };
}

export function pcmToWav(pcm: Buffer): Buffer {
  analyzePcm(pcm);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  header.writeUInt16LE(CHANNELS * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

type Request = { method: string; path: string; signal?: AbortSignal };
type Reply = { status: number; body: Record<string, unknown> };

export function createLocalEarProvider(options: { source: string; run?: CommandRunner }) {
  if (!validSource(options.source)) throw new LocalEarError("invalid_configuration", "Set an explicit Pulse output source name ending in .monitor.", 400);
  const run = options.run ?? runBounded;
  let selected = options.source;
  let busy = false;
  let latest: Record<string, unknown> | null = null;
  const monitors = (signal?: AbortSignal) => run("pactl", ["--format=json", "list", "sources"], { maxBytes: 1024 * 1024, timeoutMs: 1500, signal }).then(parseMonitors);
  async function request(input: Request): Promise<Reply> {
    let captureAttempted = false;
    try {
      if (input.path.length > 256 || !input.path.startsWith("/") || input.path.startsWith("//")) throw new LocalEarError("invalid_request", "Invalid request path.", 400);
      const url = new URL(input.path, "http://127.0.0.1");
      const path = url.pathname;
      if (input.method === "GET" && path === "/levels" && !url.search) {
        return { status: 200, body: { schema: SCHEMA, source: selected, captureInProgress: busy, audioCaptured: false, levels: latest, observation: latest ? "last-completed-capture" : "not-yet-captured" } };
      }
      const isDevices = input.method === "GET" && path === "/devices" && !url.search;
      const deviceMatch = input.method === "POST" && !url.search ? /^\/device\/(0|[1-9][0-9]{0,9})$/.exec(path) : null;
      const capture = input.method === "GET" && (path === "/listen" || path === "/analyze");
      if (!isDevices && !deviceMatch && !capture) throw new LocalEarError("not_found", "Unknown Ear endpoint or method.", 404);
      if (busy) throw new LocalEarError("capture_busy", "One audio operation is already in progress.", 409);
      busy = true;
      try {
        // Validate request duration before any local process is started.
        let seconds = 0;
        if (capture) {
          const values = url.searchParams.getAll("seconds");
          if ([...url.searchParams.keys()].some((key) => key !== "seconds") || values.length > 1) throw new LocalEarError("invalid_duration", "Only one seconds argument is allowed.", 400);
          const raw = values[0] ?? (path === "/listen" ? "5" : "1");
          seconds = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
          if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 10 || (path === "/listen" && !Number.isInteger(seconds))) throw new LocalEarError("invalid_duration", "listen requires 1–10 integer seconds; analyze requires 0.1–10 seconds.", 400);
        }
        const devices = await monitors(input.signal);
        if (isDevices) return { status: 200, body: { schema: SCHEMA, devices, selectedSource: selected, audioCaptured: false } };
        if (deviceMatch) {
          const device = devices.find((entry) => entry.index === Number(deviceMatch[1]));
          if (!device) throw new LocalEarError("device_unavailable", "Requested index is not an available output monitor.", 404);
          selected = device.name;
          latest = null;
          return { status: 200, body: { schema: SCHEMA, selectedSource: selected, audioCaptured: false } };
        }
        if (!devices.some((device) => device.name === selected)) throw new LocalEarError("device_unavailable", "The explicitly selected output monitor is unavailable.");
        captureAttempted = true;
        const pcm = await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "pulse", "-i", selected, "-t", String(seconds), "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE), "-af", `aresample=${SAMPLE_RATE},atrim=end_sample=${Math.ceil(seconds * SAMPLE_RATE)},asetpts=N/SR/TB`, "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], {
          maxBytes: Math.ceil(seconds * SAMPLE_RATE) * CHANNELS * 2, timeoutMs: Math.ceil(seconds * 1000) + 2000, signal: input.signal,
        });
        const analysis = analyzePcm(pcm);
        if (analysis.durationSeconds < seconds - 0.02 || analysis.durationSeconds > seconds + 1 / SAMPLE_RATE) throw new LocalEarError("incomplete_capture", "Capture duration did not match the bounded request.");
        latest = { ...analysis, source: selected, capturedAt: new Date().toISOString() };
        return { status: 200, body: {
          schema: SCHEMA, audioCaptured: true, requestedSeconds: seconds, ...latest,
          ...(path === "/listen" ? { audio: { mimeType: "audio/wav", encoding: "base64", data: pcmToWav(pcm).toString("base64") } } : {}),
        } };
      } finally { busy = false; }
    } catch (error) {
      const failure = error instanceof LocalEarError ? error : new LocalEarError("provider_failed", "Local Ear request could not complete.");
      return { status: failure.status, body: { schema: SCHEMA, error: { code: failure.code, message: failure.message }, captureAttempted, audioCaptured: captureAttempted ? null : false } };
    }
  }
  return { request };
}

/** Loopback only; reject browser origins/foreign hosts, bodies and upgrade paths. */
export function createLocalEarHttpServer(provider: ReturnType<typeof createLocalEarProvider>) {
  const server = createServer(async (req, res) => {
    const address = server.address();
    const expectedHost = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
    if (req.socket.localAddress !== "127.0.0.1" || req.socket.remoteAddress !== "127.0.0.1" || req.headers.host !== expectedHost || req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined || req.headers["transfer-encoding"] !== undefined || (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0")) {
      res.writeHead(403, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ error: { code: "request_forbidden", message: "Only direct local requests without a body are accepted." } }));
      return;
    }
    const abort = new AbortController();
    const cancel = () => { if (!res.writableEnded) abort.abort(); };
    res.on("close", cancel);
    const reply = await provider.request({ method: req.method ?? "", path: req.url ?? "", signal: abort.signal });
    res.removeListener("close", cancel);
    if (res.destroyed) return;
    res.writeHead(reply.status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify(reply.body));
  });
  server.maxConnections = 8;
  server.headersTimeout = 3000;
  server.requestTimeout = 15000;
  server.timeout = 16000;
  server.keepAliveTimeout = 1000;
  return server;
}
