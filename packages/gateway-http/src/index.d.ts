import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type { DawAdapter } from "@beat-twin/daw-contract";
import type { GatewayPlanStore, PairingAuthority } from "@beat-twin/gateway-core";
import type { LiteRtProvider } from "@beat-twin/litert-provider";

export * from "./browser-nanodaw-websocket.js";

export const DEFAULT_BODY_LIMIT_BYTES: number;
export const DEFAULT_PAIRING_TTL_MS: number;
export const DEFAULT_PAIRING_MAX_REQUESTS: number;
export const DEFAULT_ADAPTER_EXECUTION_TIMEOUT_MS: number;
export const DEFAULT_PAIRING_SCOPES: readonly string[];

export type GatewayHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export type GatewayProviderPort = Pick<LiteRtProvider, "listModels" | "runAgent">;
export type GatewayPairingPort = Pick<PairingAuthority, "issue" | "authorize">;
export type GatewayPlanStorePort = Pick<
  GatewayPlanStore,
  | "createPlan"
  | "confirm"
  | "consumeExecution"
  | "recordExecution"
  | "recordExecutionUncertainty"
  | "getExecutionStatus"
>;
export type GatewayAdapterPort = DawAdapter;

export type GatewayRequestHandlerOptions = {
  readonly operatorSecret: string;
  readonly provider: GatewayProviderPort;
  readonly pairing: GatewayPairingPort;
  readonly planStore: GatewayPlanStorePort;
  readonly adapters: Map<string, GatewayAdapterPort>;
  readonly bodyLimitBytes?: number;
  readonly pairingTtlMs?: number;
  readonly pairingMaxRequests?: number;
  readonly pairingScopes?: readonly string[];
  readonly maxAgentRequestCharacters?: number;
  readonly adapterExecutionTimeoutMs?: number;
  readonly corsOrigins?: readonly string[];
  readonly idGenerator?: () => string;
};

export type GatewayListenOptions = {
  readonly host?: "127.0.0.1" | "::1";
  readonly port?: number;
};

export class GatewayHttpError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status?: number, options?: { readonly cause?: unknown });
}

export function createGatewayRequestHandler(options: GatewayRequestHandlerOptions): GatewayHandler;
export function createGatewayHttpServer(options: GatewayRequestHandlerOptions): Server;
export function listenGatewayHttp(
  options: GatewayRequestHandlerOptions,
  listen?: GatewayListenOptions,
): Promise<Server>;
export function assertAllowedListenHost(host: string): void;
