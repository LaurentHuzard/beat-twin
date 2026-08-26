export type BitwigTransportState = {
  readonly tempo: unknown;
  readonly position: unknown;
  readonly isPlaying: unknown;
  readonly isRecording: unknown;
};

export type BitwigSessionSnapshot = {
  readonly connected: boolean;
  readonly scope?: string;
  readonly setup_hint?: string;
  readonly error?: string;
  readonly transport?: BitwigTransportState;
  readonly trackBank?: unknown;
  readonly selectedTrack?: unknown;
  readonly scenes?: unknown;
  readonly selectedDevice?: unknown;
  readonly remoteControls?: unknown;
  readonly read_errors?: Readonly<Record<string, unknown>>;
};

export type BitwigWebSnapshot = {
  readonly bridge: {
    readonly scope: string;
    readonly sessionTool: string;
  };
  readonly commands: readonly {
    readonly name: string;
    readonly policy: string;
  }[];
  readonly session: BitwigSessionSnapshot;
};

export type BitwigControllerClient = {
  inspect(signal?: AbortSignal): Promise<BitwigWebSnapshot>;
  execute(tool: string): Promise<unknown>;
};

async function readResponse(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Bitwig bridge request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export const bitwigControllerClient: BitwigControllerClient = {
  async inspect(signal) {
    const response = await fetch("/api/bitwig/session", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    return (await readResponse(response)) as BitwigWebSnapshot;
  },

  async execute(tool) {
    const response = await fetch("/api/bitwig/command", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool, arguments: {}, confirmation: tool }),
    });
    return readResponse(response);
  },
};
