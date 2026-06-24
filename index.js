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

function getToolDefinitions() {
  return [
      {
        name: "bitwig_session_inspect",
        description: "Read-only inspection of Bitwig transport, tracks, scenes, selected device, and remote controls",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "transport_play",
        description: "Start playback in Bitwig",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "transport_stop",
        description: "Stop playback in Bitwig",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "transport_restart",
        description: "Restart playback from the beginning",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "transport_record",
        description: "Toggle recording",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "transport_get_tempo",
        description: "Get the current tempo (BPM)",
        inputSchema: { type: "object", properties: {} },
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
      },
      {
        name: "transport_get_position",
        description: "Get current playhead position in beats",
        inputSchema: { type: "object", properties: {} },
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
      },
      {
        name: "transport_playing_status",
        description: "Check if transport is currently playing",
        inputSchema: { type: "object", properties: {} },
      },
      // --- Track Bank Tools ---
      {
        name: "track_bank_get_status",
        description: "Get status (vol/pan/mute/solo) of all 8 tracks in the current bank window",
        inputSchema: { type: "object", properties: {} },
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
      },
      {
        name: "track_bank_set_pan",
        description: "Set pan for a track in the bank 0-7",
        inputSchema: {
          type: "object",
          properties: {
            index: { type: "number", description: "Track index 0-7" },
            value: { type: "number", description: "Pan value 0.0 to 1.0 (0.5 is center)" },
          },
          required: ["index", "value"],
        },
      },
      {
        name: "track_bank_set_mute",
        description: "Set mute for a track in the bank 0-7",
        inputSchema: {
          type: "object",
          properties: {
            index: { type: "number", description: "Track index 0-7" },
            state: { type: "boolean", description: "True to mute, False to unmute" },
          },
          required: ["index", "state"],
        },
      },
      {
        name: "track_bank_set_solo",
        description: "Set solo for a track in the bank 0-7",
        inputSchema: {
          type: "object",
          properties: {
            index: { type: "number", description: "Track index 0-7" },
            state: { type: "boolean", description: "True to solo, False to unsolo" },
          },
          required: ["index", "state"],
        },
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
      },
      // --- Clip & Scene Tools ---
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
      },
      {
        name: "scene_list",
        description: "List available scenes in the current bank",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "scene_create",
        description: "Create a new empty scene",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "clip_create",
        description: "Create an empty clip in a track slot",
        inputSchema: {
          type: "object",
          properties: {
            trackIndex: { type: "number", description: "Track index 0-7" },
            slotIndex: { type: "number", description: "Slot index 0-7" },
            lengthBeats: { type: "number", description: "Length of clip in beats (e.g., 4, 8, 16)" },
          },
          required: ["trackIndex", "slotIndex", "lengthBeats"],
        },
      },
      // --- Selected Track Tools ---
      {
        name: "track_selected_get_status",
        description: "Get status of the currently selected track",
        inputSchema: { type: "object", properties: {} },
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
      },
      // --- Application Tools ---
      {
        name: "application_create_instrument_track",
        description: "Create a new instrument track",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "application_create_audio_track",
        description: "Create a new audio track",
        inputSchema: { type: "object", properties: {} },
      },
      // --- Device Tools ---
      {
        name: "device_get_status",
        description: "Get status of the currently selected device",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "device_toggle_window",
        description: "Toggle the device window",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "device_toggle_expanded",
        description: "Toggle the device expanded view",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "device_get_remote_controls",
        description: "Get the 8 remote control parameters for the current page",
        inputSchema: { type: "object", properties: {} },
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
      },
      {
        name: "device_page_next",
        description: "Select next remote controls page",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "device_page_previous",
        description: "Select previous remote controls page",
        inputSchema: { type: "object", properties: {} },
      },
    ];
}

async function handleToolCall(request) {
  try {
    const { name, arguments: args } = request.params;
    let result;

    switch (name) {
      case "bitwig_session_inspect":
        result = await inspectBitwigSession();
        break;
      case "transport_play":
        result = await callBitwig("transport.play");
        break;
      case "transport_stop":
        result = await callBitwig("transport.stop");
        break;
      case "transport_restart":
        result = await callBitwig("transport.restart");
        break;
      case "transport_record":
        result = await callBitwig("transport.record");
        break;
      case "transport_get_tempo":
        result = await callBitwig("transport.getTempo");
        break;
      case "transport_set_tempo":
        result = await callBitwig("transport.setTempo", [args.bpm]);
        break;
      case "transport_get_position":
        result = await callBitwig("transport.getPosition");
        break;
      case "transport_set_position":
        result = await callBitwig("transport.setPosition", [args.beats]);
        break;
      case "transport_playing_status":
        result = await callBitwig("transport.getIsPlaying");
        break;

      // --- Track Bank Tools ---
      case "track_bank_get_status":
        result = await callBitwig("track.bank.get_status");
        break;
      case "track_bank_set_volume":
        result = await callBitwig("track.bank.volume", [args.index, args.value]);
        break;
      case "track_bank_set_pan":
        result = await callBitwig("track.bank.pan", [args.index, args.value]);
        break;
      case "track_bank_set_mute":
        result = await callBitwig("track.bank.mute", [args.index, args.state]);
        break;
      case "track_bank_set_solo":
        result = await callBitwig("track.bank.solo", [args.index, args.state]);
        break;
      case "track_bank_select":
        result = await callBitwig("track.bank.select", [args.index]);
        break;

      // --- Clip & Scene Tools ---
      case "clip_launch":
        result = await callBitwig("clip.launch", [args.trackIndex, args.slotIndex]);
        break;
      case "clip_record":
        result = await callBitwig("clip.record", [args.trackIndex, args.slotIndex]);
        break;
      case "clip_stop":
        result = await callBitwig("clip.stop", [args.trackIndex]);
        break;
      case "scene_launch":
        result = await callBitwig("scene.launch", [args.sceneIndex]);
        break;
      case "scene_list":
        result = await callBitwig("scene.list");
        break;
      case "scene_create":
        result = await callBitwig("scene.create");
        break;
      case "clip_create":
        result = await callBitwig("clip.create", [args.trackIndex, args.slotIndex, args.lengthBeats]);
        break;

      // --- Selected Track Tools ---
      case "track_selected_get_status":
        result = await callBitwig("track.selected.get_status");
        break;
      case "track_selected_set_volume":
        result = await callBitwig("track.selected.volume", [args.value]);
        break;
      case "track_selected_set_pan":
        result = await callBitwig("track.selected.pan", [args.value]);
        break;
      case "track_selected_set_mute":
        result = await callBitwig("track.selected.mute", [args.state]);
        break;
      case "track_selected_set_solo":
        result = await callBitwig("track.selected.solo", [args.state]);
        break;
      case "track_selected_set_arm":
        result = await callBitwig("track.selected.arm", [args.state]);
        break;

      // --- Application Tools ---
      case "application_create_instrument_track":
        result = await callBitwig("application.createInstrumentTrack");
        break;
      case "application_create_audio_track":
        result = await callBitwig("application.createAudioTrack");
        break;

      // --- Device Tools ---
      case "device_get_status":
        result = await callBitwig("device.get_status");
        break;
      case "device_toggle_window":
        result = await callBitwig("device.toggle_window");
        break;
      case "device_toggle_expanded":
        result = await callBitwig("device.toggle_expanded");
        break;
      case "device_get_remote_controls":
        result = await callBitwig("device.get_remote_controls");
        break;
      case "device_set_remote_control":
        result = await callBitwig("device.set_remote_control", [args.index, args.value]);
        break;
      case "device_page_next":
        result = await callBitwig("device.page_next");
        break;
      case "device_page_previous":
        result = await callBitwig("device.page_previous");
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
}

export async function createMcpServer() {
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
    tools: getToolDefinitions(),
  }));
  server.setRequestHandler(CallToolRequestSchema, handleToolCall);

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
