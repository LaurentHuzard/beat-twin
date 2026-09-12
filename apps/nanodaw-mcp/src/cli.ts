import { fileURLToPath } from "node:url";

import { createNanoDawMcpRuntime } from "./runtime.ts";

export async function runNanoDawMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const operatorSecret = env.NANODAW_MCP_OPERATOR_SECRET;
  if (!operatorSecret || operatorSecret.length < 16) {
    throw new Error("NANODAW_MCP_OPERATOR_SECRET must contain at least 16 characters");
  }
  const allowedOrigins = parseOrigins(env.NANODAW_MCP_ALLOWED_ORIGINS);
  const port = parsePort(env.NANODAW_MCP_PORT);
  const runtime = await createNanoDawMcpRuntime({ operatorSecret, allowedOrigins, port });

  const shutdown = () => {
    void runtime.close().finally(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await runtime.startStdio();
  console.error(`NanoDAW MCP ready; browser gateway: ${runtime.baseUrl}`);
}

function parseOrigins(value: string | undefined): readonly string[] {
  const origins = (value ?? "http://127.0.0.1:5173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || new Set(origins).size !== origins.length) {
    throw new Error("NANODAW_MCP_ALLOWED_ORIGINS must contain unique HTTP origins");
  }
  for (const origin of origins) {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
      throw new Error("NANODAW_MCP_ALLOWED_ORIGINS must contain origins without paths");
    }
  }
  return Object.freeze(origins);
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8787;
  if (!/^\d+$/.test(value)) throw new Error("NANODAW_MCP_PORT must be an integer");
  const port = Number(value);
  if (port < 1 || port > 65_535) throw new Error("NANODAW_MCP_PORT must be from 1 to 65535");
  return port;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  runNanoDawMcp().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
