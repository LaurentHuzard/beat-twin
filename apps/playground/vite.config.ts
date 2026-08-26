import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import {
  BitwigWebBridgeError,
  createBitwigWebBridge,
} from "./bitwigWebBridge.ts";

function sendJson(
  response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void },
  status: number,
  payload: unknown,
) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function hasTrustedMutationOrigin(request: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;

  try {
    const url = new URL(origin);
    const isLoopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost");
    return isLoopback && url.host === host;
  } catch {
    return false;
  }
}

function hasJsonContentType(request: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readJsonBody(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 16_384) {
      throw new BitwigWebBridgeError(413, "request_too_large", "Command payload is too large.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BitwigWebBridgeError(400, "invalid_json", "Command payload must be valid JSON.");
  }
}

function bitwigWebBridgePlugin() {
  const bridge = createBitwigWebBridge();

  return {
    name: "beat-twin-bitwig-web-bridge",
    configureServer(server: {
      middlewares: {
        use(
          handler: (
            request: AsyncIterable<Uint8Array> & {
              readonly method?: string;
              readonly url?: string;
              readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
            },
            response: {
              statusCode: number;
              setHeader(name: string, value: string): void;
              end(body: string): void;
            },
            next: () => void,
          ) => void,
        ): void;
      };
    }) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split("?", 1)[0];
        const isInspection = request.method === "GET" && path === "/api/bitwig/session";
        const isCommand = request.method === "POST" && path === "/api/bitwig/command";

        if (!isInspection && !isCommand) {
          next();
          return;
        }

        try {
          if (isInspection) {
            sendJson(response, 200, await bridge.inspect());
            return;
          }

          if (!hasTrustedMutationOrigin(request)) {
            throw new BitwigWebBridgeError(
              403,
              "untrusted_origin",
              "Bitwig web commands require an exact loopback same-origin request.",
            );
          }

          if (!hasJsonContentType(request)) {
            throw new BitwigWebBridgeError(
              415,
              "unsupported_media_type",
              "Bitwig web commands require an application/json payload.",
            );
          }

          sendJson(response, 200, await bridge.execute(await readJsonBody(request)));
        } catch (error) {
          const status = error instanceof BitwigWebBridgeError ? error.status : 500;
          const code = error instanceof BitwigWebBridgeError ? error.code : "bridge_failed";
          const message = error instanceof Error ? error.message : "Bitwig web bridge failed.";
          sendJson(response, status, { error: code, message });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), bitwigWebBridgePlugin()],
  resolve: {
    alias: {
      "@beat-twin/audio-tone": fileURLToPath(
        new URL("../../packages/audio-tone/src/index.ts", import.meta.url),
      ),
      "@beat-twin/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@beat-twin/commands": fileURLToPath(
        new URL("../../packages/commands/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: "./src/test/setup.ts",
  },
});
