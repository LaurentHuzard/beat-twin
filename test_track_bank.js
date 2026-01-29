import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
    console.log("Starting MCP Track Test...");

    const transport = new StdioClientTransport({
        command: "node",
        args: ["index.js"],
    });

    const client = new Client(
        {
            name: "bitwig-mcp-test-track",
            version: "0.1.0",
        },
        {
            capabilities: {},
        }
    );

    try {
        await client.connect(transport);
        console.log("Connected to MCP Server.");

        // --- Test 1: Get Bank Status ---
        console.log("Testing track_bank_get_status...");
        const bankStatus = await client.callTool({
            name: "track_bank_get_status",
            arguments: {},
        });
        console.log("Bank Status:", JSON.stringify(bankStatus.content[0].text, null, 2));

        // --- Test 2: Set Volume on Track 0 ---
        console.log("Testing track_bank_set_volume (Track 0 -> 0.75)...");
        await client.callTool({
            name: "track_bank_set_volume",
            arguments: {
                index: 0,
                value: 0.75
            },
        });
        console.log("Volume set.");

        // --- Test 3: Mute Track 0 ---
        console.log("Testing track_bank_set_mute (Track 0 -> true)...");
        await client.callTool({
            name: "track_bank_set_mute",
            arguments: {
                index: 0,
                state: true
            },
        });
        console.log("Mute set.");

        // --- Test 4: Select Track 1 ---
        console.log("Testing track_bank_select (Track 1)...");
        await client.callTool({
            name: "track_bank_select",
            arguments: {
                index: 1
            },
        });
        console.log("Track 1 selected.");

        // Give it a moment for selection to update
        await new Promise(r => setTimeout(r, 200));

        // --- Test 5: Get Selected Track Status ---
        console.log("Testing track_selected_get_status...");
        const selectedStatus = await client.callTool({
            name: "track_selected_get_status",
            arguments: {},
        });
        console.log("Selected Track Status:", JSON.stringify(selectedStatus.content[0].text, null, 2));

    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        transport.close();
    }
}

main();
