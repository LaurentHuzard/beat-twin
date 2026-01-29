
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
    console.log("Starting MCP Client Test...");

    const transport = new StdioClientTransport({
        command: "node",
        args: ["index.js"]
    });

    const client = new Client(
        {
            name: "example-client",
            version: "1.0.0",
        },
        {
            capabilities: {},
        }
    );

    await client.connect(transport);
    console.log("Connected to MCP Server.");

    try {
        console.log("Listing tools...");
        const tools = await client.listTools();
        console.log("Tools found:", tools.tools.map(t => t.name));

        console.log("Testing transport.get_tempo...");
        const tempo = await client.callTool({
            name: "transport_get_tempo",
            arguments: {}
        });
        console.log("Current Tempo:", tempo.content[0].text);

        console.log("Testing transport.play...");
        await client.callTool({
            name: "transport_play",
            arguments: {}
        });
        console.log("Play command sent.");

        // Wait a bit
        await new Promise(r => setTimeout(r, 2000));

        console.log("Testing transport.get_position...");
        const pos = await client.callTool({
            name: "transport_get_position",
            arguments: {}
        });
        console.log("Position:", pos.content[0].text);

        console.log("Testing transport.stop...");
        await client.callTool({
            name: "transport_stop",
            arguments: {}
        });
        console.log("Stop command sent.");

    } catch (e) {
        console.error("Test failed:", e);
        // Print the error details if it's an object
        if (e.message) console.error("Error Message:", e.message);
    } finally {
        await client.close();
    }
}

main();
