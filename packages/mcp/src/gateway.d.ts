declare module "@beat-twin/gateway" {
  import type { IncomingMessage, Server, ServerResponse } from "node:http";
  import type { BrowserNanoDawPort } from "@beat-twin/nanodaw-adapter";

  export type GatewayHandler = (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>;

  export function createGatewayRequestHandler(options: unknown): GatewayHandler;

  export function createBrowserNanoDawWebSocketProxy(options: {
    readonly pairing: unknown;
    readonly allowedOrigins: readonly string[];
  }): {
    readonly port: BrowserNanoDawPort;
    readonly status: () => Readonly<Record<string, unknown>>;
    readonly attach: (server: Server) => unknown;
    readonly close: () => Promise<void>;
  };
}
