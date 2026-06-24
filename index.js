#!/usr/bin/env node

/**
 * Bitwig MCP Server
 * Connects to Bitwig Studio via TCP (JSON-RPC) and exposes tools to an LLM.
 */

import net from "net";
import { fileURLToPath } from "url";

const BITWIG_HOST = process.env.BITWIG_HOST ?? "127.0.0.1";
const BITWIG_PORT = Number.parseInt(process.env.BITWIG_PORT ?? "8888", 10);
const BITWIG_CONNECT_DELAY_MS = Number.parseInt(
  process.env.BITWIG_CONNECT_DELAY_MS ?? "500",
  10,
);
const BITWIG_RESPONSE_TIMEOUT_MS = Number.parseInt(
  process.env.BITWIG_RESPONSE_TIMEOUT_MS ?? "5000",
  10,
);

export class BitwigProtocolClient {
  constructor({
    host = BITWIG_HOST,
    port = BITWIG_PORT,
    connectDelayMs = BITWIG_CONNECT_DELAY_MS,
    responseTimeoutMs = BITWIG_RESPONSE_TIMEOUT_MS,
    createSocket = () => new net.Socket(),
    logger = console,
  } = {}) {
    this.host = host;
    this.port = port;
    this.connectDelayMs = connectDelayMs;
    this.responseTimeoutMs = responseTimeoutMs;
    this.createSocket = createSocket;
    this.logger = logger;
    this.socket = null;
    this.connectPromise = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.responseBuffer = "";
  }

  async connect() {
    if (this.socket && !this.socket.destroyed) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.responseBuffer = "";
    this.connectPromise = new Promise((resolve, reject) => {
      const socket = this.createSocket();
      this.socket = socket;

      let settled = false;
      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.connectPromise = null;
        resolve();
      };
      const settleReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.connectPromise = null;
        this.socket = null;
        reject(error);
      };

      socket.on("data", (data) => {
        this.handleData(data);
      });

      socket.on("close", () => {
        this.logger.error("Connection to Bitwig closed");
        this.socket = null;
        this.responseBuffer = "";
        this.rejectPending(new Error("Connection to Bitwig closed"));
      });

      socket.on("error", (error) => {
        this.logger.error("Bitwig connection error:", error);
        if (!settled) {
          settleReject(error);
        }
      });

      socket.connect(this.port, this.host, () => {
        this.logger.error(`Connected to Bitwig at ${this.host}:${this.port}`);
        setTimeout(settleResolve, this.connectDelayMs);
      });
    });

    return this.connectPromise;
  }

  async send(method, params = []) {
    if (!this.socket || this.socket.destroyed) {
      try {
        await this.connect();
      } catch (error) {
        throw new Error("Could not connect to Bitwig. Is it running?");
      }
    }

    const id = this.requestId++;
    const request = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    const msg = JSON.stringify(request);
    const msgBuf = Buffer.from(msg, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(msgBuf.length, 0);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pendingRequests.has(id)) {
          return;
        }
        this.pendingRequests.delete(id);
        reject(new Error("Timeout waiting for Bitwig response"));
      }, this.responseTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.socket.write(Buffer.concat([header, msgBuf]));
    });
  }

  handleData(data) {
    this.responseBuffer += data.toString("utf8");

    while (true) {
      const newlineIndex = this.responseBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.responseBuffer.slice(0, newlineIndex).trim();
      this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        const parseError = new Error(`Malformed Bitwig response: ${error.message}`);
        this.logger.error(parseError.message);
        this.destroy(parseError);
        return;
      }

      if (response.id === undefined || !this.pendingRequests.has(response.id)) {
        continue;
      }

      const pending = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  rejectPending(error) {
    for (const { reject } of this.pendingRequests.values()) {
      reject(error);
    }
    this.pendingRequests.clear();
  }

  destroy(error = new Error("Bitwig protocol client destroyed")) {
    this.rejectPending(error);
    this.responseBuffer = "";
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
    this.connectPromise = null;
  }
}

const protocolClient = new BitwigProtocolClient();

export function callBitwig(method, params = []) {
  return protocolClient.send(method, params);
}

async function readInspectionValue(call, method, params = []) {
  try {
    return { ok: true, value: await call(method, params) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function inspectBitwigSession(call = callBitwig) {
  const ping = await readInspectionValue(call, "ping");
  if (!ping.ok) {
    return {
      connected: false,
      setup_hint:
        "Start the MCP server, open Bitwig Studio, enable the BitwigPOC controller, then retry inspection.",
      error: ping.error,
    };
  }

  const [
    tempo,
    position,
    playing,
    recording,
    trackBank,
    selectedTrack,
    scenes,
    selectedDevice,
    remoteControls,
  ] = await Promise.all([
    readInspectionValue(call, "transport.getTempo"),
    readInspectionValue(call, "transport.getPosition"),
    readInspectionValue(call, "transport.getIsPlaying"),
    readInspectionValue(call, "transport.getIsRecording"),
    readInspectionValue(call, "track.bank.get_status"),
    readInspectionValue(call, "track.selected.get_status"),
    readInspectionValue(call, "scene.list"),
    readInspectionValue(call, "device.get_status"),
    readInspectionValue(call, "device.get_remote_controls"),
  ]);

  return {
    connected: true,
    scope: "read-only",
    transport: {
      tempo: tempo.ok ? tempo.value : null,
      position: position.ok ? position.value : null,
      isPlaying: playing.ok ? playing.value : null,
      isRecording: recording.ok ? recording.value : null,
    },
    trackBank: trackBank.ok ? trackBank.value : null,
    selectedTrack: selectedTrack.ok ? selectedTrack.value : null,
    scenes: scenes.ok ? scenes.value : null,
    selectedDevice: selectedDevice.ok ? selectedDevice.value : null,
    remoteControls: remoteControls.ok ? remoteControls.value : null,
    read_errors: {
      tempo: tempo.ok ? null : tempo.error,
      position: position.ok ? null : position.error,
      isPlaying: playing.ok ? null : playing.error,
      isRecording: recording.ok ? null : recording.error,
      trackBank: trackBank.ok ? null : trackBank.error,
      selectedTrack: selectedTrack.ok ? null : selectedTrack.error,
      scenes: scenes.ok ? null : scenes.error,
      selectedDevice: selectedDevice.ok ? null : selectedDevice.error,
      remoteControls: remoteControls.ok ? null : remoteControls.error,
    },
  };
}

const WRITE_POLICY_ENV = "BITWIG_MCP_WRITE_POLICY";
const ENABLE_WRITES_ENV = "BITWIG_MCP_ENABLE_WRITES";
const WRITE_POLICIES = Object.freeze([
  "transport",
  "mixer_write",
  "clip_write",
  "scene_write",
  "device_write",
  "application_write",
]);

export const TOOL_SPECS = Object.freeze([
  {
    name: "bitwig_session_inspect",
    description:
      "Read-only inspection of Bitwig transport, tracks, scenes, selected device, and remote controls",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    execute: ({ call }) => inspectBitwigSession(call),
  },
  {
    name: "transport_play",
    description: "Start playback in Bitwig",
    inputSchema: { type: "object", properties: {} },
    policy: "transport",
    method: "transport.play",
  },
  {
    name: "transport_stop",
    description: "Stop playback in Bitwig",
    inputSchema: { type: "object", properties: {} },
    policy: "transport",
    method: "transport.stop",
  },
  {
    name: "transport_restart",
    description: "Restart playback from the beginning",
    inputSchema: { type: "object", properties: {} },
    policy: "transport",
    method: "transport.restart",
  },
  {
    name: "transport_record",
    description: "Toggle recording",
    inputSchema: { type: "object", properties: {} },
    policy: "transport",
    method: "transport.record",
  },
  {
    name: "transport_get_tempo",
    description: "Get the current tempo (BPM)",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "transport.getTempo",
  },
  {
    name: "transport_set_tempo",
    description: "Set the tempo (BPM)",
    inputSchema: {
      type: "object",
      properties: {
        bpm: { type: "number", description: "Tempo in Beats Per Minute" },
      },
      required: ["bpm"],
    },
    policy: "transport",
    method: "transport.setTempo",
    mapArgs: (args) => [args.bpm],
  },
  {
    name: "transport_get_position",
    description: "Get current playhead position in beats",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "transport.getPosition",
  },
  {
    name: "transport_set_position",
    description: "Set playhead position in beats",
    inputSchema: {
      type: "object",
      properties: {
        beats: { type: "number", description: "Position in beats" },
      },
      required: ["beats"],
    },
    policy: "transport",
    method: "transport.setPosition",
    mapArgs: (args) => [args.beats],
  },
  {
    name: "transport_playing_status",
    description: "Check if transport is currently playing",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "transport.getIsPlaying",
  },
  {
    name: "track_bank_get_status",
    description: "Get status (vol/pan/mute/solo) of all 8 tracks in the current bank window",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "track.bank.get_status",
  },
  {
    name: "track_bank_set_volume",
    description: "Set volume for a track in the bank 0-7",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Track index 0-7" },
        value: { type: "number", description: "Volume value 0.0 to 1.0" },
      },
      required: ["index", "value"],
    },
    policy: "mixer_write",
    method: "track.bank.volume",
    mapArgs: (args) => [args.index, args.value],
  },
  {
    name: "track_bank_set_pan",
    description: "Set pan for a track in the bank 0-7",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Track index 0-7" },
        value: {
          type: "number",
          description: "Pan value 0.0 to 1.0 (0.5 is center)",
        },
      },
      required: ["index", "value"],
    },
    policy: "mixer_write",
    method: "track.bank.pan",
    mapArgs: (args) => [args.index, args.value],
  },
  {
    name: "track_bank_set_mute",
    description: "Set mute for a track in the bank 0-7",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Track index 0-7" },
        state: {
          type: "boolean",
          description: "True to mute, False to unmute",
        },
      },
      required: ["index", "state"],
    },
    policy: "mixer_write",
    method: "track.bank.mute",
    mapArgs: (args) => [args.index, args.state],
  },
  {
    name: "track_bank_set_solo",
    description: "Set solo for a track in the bank 0-7",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Track index 0-7" },
        state: {
          type: "boolean",
          description: "True to solo, False to unsolo",
        },
      },
      required: ["index", "state"],
    },
    policy: "mixer_write",
    method: "track.bank.solo",
    mapArgs: (args) => [args.index, args.state],
  },
  {
    name: "track_bank_select",
    description: "Select a track in the bank 0-7",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Track index 0-7" },
      },
      required: ["index"],
    },
    policy: "mixer_write",
    method: "track.bank.select",
    mapArgs: (args) => [args.index],
  },
  {
    name: "clip_launch",
    description: "Launch a clip in a track's slot",
    inputSchema: {
      type: "object",
      properties: {
        trackIndex: { type: "number", description: "Track index 0-7" },
        slotIndex: { type: "number", description: "Slot index 0-7" },
      },
      required: ["trackIndex", "slotIndex"],
    },
    policy: "clip_write",
    method: "clip.launch",
    mapArgs: (args) => [args.trackIndex, args.slotIndex],
  },
  {
    name: "clip_record",
    description: "Trigger record on a clip slot",
    inputSchema: {
      type: "object",
      properties: {
        trackIndex: { type: "number", description: "Track index 0-7" },
        slotIndex: { type: "number", description: "Slot index 0-7" },
      },
      required: ["trackIndex", "slotIndex"],
    },
    policy: "clip_write",
    method: "clip.record",
    mapArgs: (args) => [args.trackIndex, args.slotIndex],
  },
  {
    name: "clip_stop",
    description: "Stop clips playing on a track",
    inputSchema: {
      type: "object",
      properties: {
        trackIndex: { type: "number", description: "Track index 0-7" },
      },
      required: ["trackIndex"],
    },
    policy: "clip_write",
    method: "clip.stop",
    mapArgs: (args) => [args.trackIndex],
  },
  {
    name: "scene_launch",
    description: "Launch a scene (horizontal row of clips)",
    inputSchema: {
      type: "object",
      properties: {
        sceneIndex: { type: "number", description: "Scene index 0-7" },
      },
      required: ["sceneIndex"],
    },
    policy: "scene_write",
    method: "scene.launch",
    mapArgs: (args) => [args.sceneIndex],
  },
  {
    name: "scene_list",
    description: "List available scenes in the current bank",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "scene.list",
  },
  {
    name: "scene_create",
    description: "Create a new empty scene",
    inputSchema: { type: "object", properties: {} },
    policy: "scene_write",
    method: "scene.create",
  },
  {
    name: "clip_create",
    description: "Create an empty clip in a track slot",
    inputSchema: {
      type: "object",
      properties: {
        trackIndex: { type: "number", description: "Track index 0-7" },
        slotIndex: { type: "number", description: "Slot index 0-7" },
        lengthBeats: {
          type: "number",
          description: "Length of clip in beats (e.g., 4, 8, 16)",
        },
      },
      required: ["trackIndex", "slotIndex", "lengthBeats"],
    },
    policy: "clip_write",
    method: "clip.create",
    mapArgs: (args) => [args.trackIndex, args.slotIndex, args.lengthBeats],
  },
  {
    name: "track_selected_get_status",
    description: "Get status of the currently selected track",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "track.selected.get_status",
  },
  {
    name: "track_selected_set_volume",
    description: "Set volume for the selected track",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Volume value 0.0 to 1.0" },
      },
      required: ["value"],
    },
    policy: "mixer_write",
    method: "track.selected.volume",
    mapArgs: (args) => [args.value],
  },
  {
    name: "track_selected_set_pan",
    description: "Set pan for the selected track",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Pan value 0.0 to 1.0" },
      },
      required: ["value"],
    },
    policy: "mixer_write",
    method: "track.selected.pan",
    mapArgs: (args) => [args.value],
  },
  {
    name: "track_selected_set_mute",
    description: "Set mute for the selected track",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "boolean", description: "True to mute" },
      },
      required: ["state"],
    },
    policy: "mixer_write",
    method: "track.selected.mute",
    mapArgs: (args) => [args.state],
  },
  {
    name: "track_selected_set_solo",
    description: "Set solo for the selected track",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "boolean", description: "True to solo" },
      },
      required: ["state"],
    },
    policy: "mixer_write",
    method: "track.selected.solo",
    mapArgs: (args) => [args.state],
  },
  {
    name: "track_selected_set_arm",
    description: "Set arm (record enable) for the selected track",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "boolean", description: "True to arm" },
      },
      required: ["state"],
    },
    policy: "mixer_write",
    method: "track.selected.arm",
    mapArgs: (args) => [args.state],
  },
  {
    name: "application_create_instrument_track",
    description: "Create a new instrument track",
    inputSchema: { type: "object", properties: {} },
    policy: "application_write",
    method: "application.createInstrumentTrack",
  },
  {
    name: "application_create_audio_track",
    description: "Create a new audio track",
    inputSchema: { type: "object", properties: {} },
    policy: "application_write",
    method: "application.createAudioTrack",
  },
  {
    name: "device_get_status",
    description: "Get status of the currently selected device",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "device.get_status",
  },
  {
    name: "device_toggle_window",
    description: "Toggle the device window",
    inputSchema: { type: "object", properties: {} },
    policy: "device_write",
    method: "device.toggle_window",
  },
  {
    name: "device_toggle_expanded",
    description: "Toggle the device expanded view",
    inputSchema: { type: "object", properties: {} },
    policy: "device_write",
    method: "device.toggle_expanded",
  },
  {
    name: "device_get_remote_controls",
    description: "Get the 8 remote control parameters for the current page",
    inputSchema: { type: "object", properties: {} },
    policy: "read",
    method: "device.get_remote_controls",
  },
  {
    name: "device_set_remote_control",
    description: "Set value for a remote control parameter",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Parameter index 0-7" },
        value: { type: "number", description: "Value 0.0 to 1.0" },
      },
      required: ["index", "value"],
    },
    policy: "device_write",
    method: "device.set_remote_control",
    mapArgs: (args) => [args.index, args.value],
  },
  {
    name: "device_page_next",
    description: "Select next remote controls page",
    inputSchema: { type: "object", properties: {} },
    policy: "device_write",
    method: "device.page_next",
  },
  {
    name: "device_page_previous",
    description: "Select previous remote controls page",
    inputSchema: { type: "object", properties: {} },
    policy: "device_write",
    method: "device.page_previous",
  },
]);

const TOOL_SPEC_MAP = new Map(TOOL_SPECS.map((tool) => [tool.name, tool]));

function parseEnabledWritePolicies(env = process.env) {
  const allowAllWrites = String(env[ENABLE_WRITES_ENV] ?? "")
    .trim()
    .toLowerCase();

  if (["1", "true", "yes", "on", "all"].includes(allowAllWrites)) {
    return new Set(WRITE_POLICIES);
  }

  return new Set(
    String(env[WRITE_POLICY_ENV] ?? "")
      .split(",")
      .map((policy) => policy.trim().toLowerCase())
      .filter((policy) => WRITE_POLICIES.includes(policy)),
  );
}

function isPolicyEnabled(policy, env = process.env) {
  return policy === "read" || parseEnabledWritePolicies(env).has(policy);
}

function serializeToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

function serializeToolError(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(error, null, 2),
      },
    ],
  };
}

function buildPolicyBlockedError(tool) {
  return {
    error: "policy_blocked",
    tool: tool.name,
    policy: tool.policy,
    message: `Tool ${tool.name} requires the ${tool.policy} write policy before it can call Bitwig.`,
    required_config: {
      anyOf: [
        {
          env: WRITE_POLICY_ENV,
          value: tool.policy,
        },
        {
          env: ENABLE_WRITES_ENV,
          value: "1",
        },
      ],
    },
  };
}

function buildToolDefinition(tool) {
  return {
    name: tool.name,
    description: `[policy:${tool.policy}] ${tool.description}`,
    inputSchema: tool.inputSchema,
  };
}

export function getToolDefinitions({ env = process.env } = {}) {
  return TOOL_SPECS.filter((tool) => isPolicyEnabled(tool.policy, env)).map(
    buildToolDefinition,
  );
}

export async function handleToolCall(
  request,
  { call = callBitwig, env = process.env } = {},
) {
  try {
    const { name, arguments: args = {} } = request.params;
    const tool = TOOL_SPEC_MAP.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!isPolicyEnabled(tool.policy, env)) {
      return serializeToolError(buildPolicyBlockedError(tool));
    }

    if (tool.execute) {
      return serializeToolResult(await tool.execute({ args, call }));
    }

    const params = tool.mapArgs ? tool.mapArgs(args) : [];
    const result = await call(tool.method, params);

    if (tool.policy === "read") {
      return serializeToolResult(result);
    }

    return serializeToolResult({
      tool: tool.name,
      policy: tool.policy,
      method: tool.method,
      params,
      result,
    });
  } catch (error) {
    return serializeToolError({
      error: "tool_call_failed",
      message: error.message,
    });
  }
}

export async function createMcpServer({ env = process.env, call = callBitwig } = {}) {
  const [
    { Server },
    { StdioServerTransport },
    { CallToolRequestSchema, ListToolsRequestSchema },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const server = new Server(
    {
      name: "bitwig-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions({ env }),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    handleToolCall(request, { call, env }),
  );

  return { server, StdioServerTransport };
}

async function runServer() {
  const { server, StdioServerTransport } = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bitwig MCP Server running on stdio");
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  runServer().catch(console.error);
}
