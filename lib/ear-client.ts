/** Optional client for the separately operated local Ear HTTP service. */
type EarOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  authorize?: () => boolean;
};

export const EAR_BASE_URL_ENV = "BITWIG_EAR_BASE_URL";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 15000;

export class EarClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EarClientError";
    this.code = code;
  }
}

export function getEarBaseUrl(env: Record<string, string | undefined> = process.env): URL | null {
  const configured = env[EAR_BASE_URL_ENV];
  if (configured === undefined || configured.trim() === "") return null;
  const raw = configured.trim();
  // Match the literal authority before URL normalization can reinterpret other
  // host notations as loopback. No credentials, DNS, paths, query or fragment.
  if (!/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?\/?$/.test(raw)) {
    throw new EarClientError("ear_invalid_configuration", "Ear URL must be an HTTP(S) literal-loopback origin (127.0.0.1 or [::1]) without credentials, path, query or fragment.");
  }
  try {
    return new URL(raw);
  } catch {
    throw new EarClientError("ear_invalid_configuration", "Ear URL is invalid.");
  }
}

function endpoint(name: string, args: Record<string, unknown>): { path: string; method: string } {
  const keys = Object.keys(args);
  const only = (permitted: string[]) => {
    if (keys.some((key) => !permitted.includes(key))) throw new EarClientError("ear_invalid_arguments", "Unknown Ear argument.");
  };
  if (["ear_status", "ear_get_levels", "ear_list_devices"].includes(name)) {
    only([]);
    return { path: name === "ear_list_devices" ? "/devices" : "/levels", method: "GET" };
  }
  if (name === "ear_set_device") {
    only(["index"]);
    const index = args.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 2147483647) throw new EarClientError("ear_invalid_arguments", "Ear device index must be an integer from 0 to 2147483647.");
    return { path: `/device/${index}`, method: "POST" };
  }
  if (name === "ear_listen" || name === "ear_analyze") {
    only(["seconds"]);
    const seconds = args.seconds === undefined ? (name === "ear_listen" ? 5 : 1) : args.seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0.1 || seconds > 10 || (name === "ear_listen" && !Number.isInteger(seconds))) {
      throw new EarClientError("ear_invalid_arguments", "Ear listen duration must be an integer from 1 to 10 seconds; analyze duration must be finite from 0.1 to 10 seconds.");
    }
    return { path: `/${name === "ear_listen" ? "listen" : "analyze"}?seconds=${seconds}`, method: "GET" };
  }
  throw new EarClientError("ear_unknown_tool", "Unknown Ear operation.");
}

export async function callEar(name: string, args: Record<string, unknown> = {}, options: EarOptions = {}) {
  const env = options.env ?? process.env;
  const authorize = options.authorize ?? (() => true);
  if (!authorize()) throw new EarClientError("policy_blocked", "Ear audio_capture policy is not enabled.");
  if (!args || Array.isArray(args) || typeof args !== "object") throw new EarClientError("ear_invalid_arguments", "Ear arguments must be an object.");
  const target = endpoint(name, args);
  const base = getEarBaseUrl(env);
  if (base === null) {
    if (name === "ear_status") return { configured: false, connected: false, externalService: true, audioCaptured: false };
    throw new EarClientError("ear_unconfigured", "Set BITWIG_EAR_BASE_URL to an explicitly operated local Ear service. No service was started or contacted.");
  }
  const timeoutMs = options.timeoutMs ?? (name === "ear_listen" || name === "ear_analyze" ? MAX_TIMEOUT_MS : 3000);
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RESPONSE_BYTES) {
    throw new EarClientError("ear_invalid_configuration", "Ear timeout and response byte bounds are invalid.");
  }
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new EarClientError("ear_timeout", "Local Ear service exceeded the bounded response deadline."));
    }, timeoutMs);
  });
  const operation = async () => {
    if (!authorize()) throw new EarClientError("policy_blocked", "Ear audio_capture policy was revoked before dispatch.");
    const response = await (options.fetch ?? globalThis.fetch)(new URL(target.path, base), {
      method: target.method, signal: abort.signal, redirect: "error", headers: { Accept: "application/json" },
    });
    if (abort.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw new EarClientError("ear_timeout", "Local Ear service exceeded the bounded response deadline.");
    }
    if (!authorize()) {
      void response.body?.cancel().catch(() => {});
      throw new EarClientError("policy_blocked", "Ear audio_capture policy was revoked while awaiting the response.");
    }
    if (response.redirected) throw new EarClientError("ear_redirect_forbidden", "Ear redirects are not permitted.");
    if (!response.ok) throw new EarClientError("ear_http_error", `Local Ear service returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(contentType)) throw new EarClientError("ear_invalid_response", "Local Ear service must return JSON.");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new EarClientError("ear_response_too_large", "Ear response exceeds the configured byte limit.");
    if (!response.body) throw new EarClientError("ear_invalid_response", "Local Ear service returned an empty body.");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (!authorize()) throw new EarClientError("policy_blocked", "Ear audio_capture policy was revoked while reading the response.");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new EarClientError("ear_response_too_large", "Ear response exceeds the configured byte limit.");
      chunks.push(part.value);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new EarClientError("ear_invalid_response", "Local Ear service returned invalid JSON or UTF-8.");
    }
    if (!authorize()) throw new EarClientError("policy_blocked", "Ear audio_capture policy was revoked before returning the response.");
    // This adapter cannot establish the external service's DSP or audio schema.
    // Preserve its bounded JSON without inventing units, BPM/key or WAV claims.
    return { configured: true, connected: true, externalService: true, operation: name, payloadSchema: "external-unverified", payload };
  };
  try {
    return await Promise.race([operation(), timeout]);
  } catch (error) {
    if (error instanceof EarClientError) throw error;
    throw new EarClientError("ear_connection_error", "The configured local Ear service could not complete this request. No automatic retry was made.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    abort.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
