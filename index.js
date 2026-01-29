#!/usr/bin/env node

/**
 * Bitwig MCP Server
 * Connects to Bitwig Studio via TCP (JSON-RPC) and exposes tools to an LLM.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import net from "net";

// --- Bitwig Connection Configuration ---
const BITWIG_HOST = "127.0.0.1";
const BITWIG_PORT = 8888;
let client = null;
let requestId = 0;
const pendingRequests = new Map();

// --- TCP Client Setup ---
function connectToBitwig() {
  return new Promise((resolve, reject) => {
    client = new net.Socket();

    client.connect(BITWIG_PORT, BITWIG_HOST, () => {
      console.error(`Connected to Bitwig at ${BITWIG_HOST}:${BITWIG_PORT}`);
      // Give Bitwig a moment to register callbacks
      setTimeout(resolve, 500);
    });

    client.on("data", (data) => {
      // Handle incoming data (stream handling needed for robust impl, simplistic for now)
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.id !== undefined && pendingRequests.has(response.id)) {
            const { resolve, reject } = pendingRequests.get(response.id);
            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result);
            }
            pendingRequests.delete(response.id);
          }
        } catch (err) {
          console.error("Error parsing response from Bitwig:", err);
        }
      }
    });

    client.on("close", () => {
      console.error("Connection to Bitwig closed");
      client = null;
    });

    client.on("error", (err) => {
      console.error("Bitwig connection error:", err);
    });
  });
}

// --- JSON-RPC Helper ---
function callBitwig(method, params = []) {
  return new Promise(async (resolve, reject) => {
    if (!client) {
      try {
        await connectToBitwig();
      } catch (err) {
        return reject(new Error("Could not connect to Bitwig. Is it running?"));
      }
    }

    const id = requestId++;
    const request = {
      jsonrpc: "2.0",
      method,
      params,
      id
    };

    pendingRequests.set(id, { resolve, reject });

    const msg = JSON.stringify(request);
    const msgBuf = Buffer.from(msg, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(msgBuf.length, 0);
    client.write(Buffer.concat([header, msgBuf]));

    // Timeout
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.get(id).reject(new Error("Timeout waiting for Bitwig response"));
        pendingRequests.delete(id);
      }
    }, 5000);
  });
}


// --- MCP Server Setup ---
const server = new Server(
  {
    name: "bitwig-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    let result;

    switch (name) {
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
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bitwig MCP Server running on stdio");
}

runServer().catch(console.error);