#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dgram from "dgram";

const server = new McpServer({ name: "bitwig-poc", version: "0.0.1" });

// Create UDP socket for sending to Bitwig
const udpClient = dgram.createSocket("udp4");

function sendToBitwig(method, params = {}) {
  const message = JSON.stringify({ method, params }) + "\n";
  const buffer = Buffer.from(message);

  udpClient.send(buffer, 0, buffer.length, 19561, "127.0.0.1", (err) => {
    if (err) {
      console.error("UDP send error:", err);
    } else {
      console.error("Sent to Bitwig:", message.trim());
    }
  });
}

// --- Tools ---

server.registerTool(
  "bitwig_add_track",
  {
    description: "Add an instrument track in Bitwig",
    inputSchema: {}
  },
  async () => {
    sendToBitwig("tracks.create", { type: "instrument" });
    return {
      content: [{ type: "text", text: "Requested track creation." }]
    };
  }
);

server.registerTool(
  "bitwig_play",
  {
    description: "Start playback transport",
    inputSchema: {}
  },
  async () => {
    sendToBitwig("transport.play");
    return {
      content: [{ type: "text", text: "Transport started." }]
    };
  }
);

server.registerTool(
  "bitwig_stop",
  {
    description: "Stop playback transport",
    inputSchema: {}
  },
  async () => {
    sendToBitwig("transport.stop");
    return {
      content: [{ type: "text", text: "Transport stopped." }]
    };
  }
);

server.registerTool(
  "bitwig_restart",
  {
    description: "Restart playback from beginning",
    inputSchema: {}
  },
  async () => {
    sendToBitwig("transport.restart");
    return {
      content: [{ type: "text", text: "Transport restarted." }]
    };
  }
);

await server.connect(new StdioServerTransport());
console.error("Bitwig MCP Server ready (using UDP)");

// Test loop: send track creation every 10 seconds
while (true) {
  console.log("Creating track or not ...");
  // sendToBitwig("tracks.create", { type: "instrument" });
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log("Waiting...");
}