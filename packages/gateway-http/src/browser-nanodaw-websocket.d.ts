import type { Server } from "node:http";

import type { PairingAuthority } from "@beat-twin/gateway-core";
import type { BrowserNanoDawPort } from "@beat-twin/nanodaw-adapter";

export const BROWSER_NANODAW_PROTOCOL: "beat-twin.nanodaw.v1";

export type BrowserNanoDawProxyStatus =
  | Readonly<{ state: "disconnected"; connected: false }>
  | Readonly<{
      state: "connected";
      connected: true;
      sessionId: string;
      connectedAt: string;
      actorId: string;
      pendingRequests: number;
    }>;

export type BrowserNanoDawWebSocketProxyOptions = {
  readonly pairing: Pick<PairingAuthority, "authorize">;
  readonly allowedOrigins: readonly string[];
  readonly path?: string;
  readonly requestTimeoutMs?: number;
  readonly maxPayloadBytes?: number;
  readonly maxPendingRequests?: number;
  readonly idGenerator?: () => string;
  readonly now?: () => number;
};

export type BrowserNanoDawWebSocketProxy = Readonly<{
  port: BrowserNanoDawPort;
  status: () => BrowserNanoDawProxyStatus;
  attach: (server: Server) => BrowserNanoDawWebSocketProxy;
  close: () => Promise<void>;
}>;

export class BrowserNanoDawProxyError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { readonly cause?: unknown });
}

export function encodeBrowserPairingProtocol(token: string): string;
export function createBrowserNanoDawWebSocketProxy(
  options: BrowserNanoDawWebSocketProxyOptions,
): BrowserNanoDawWebSocketProxy;
