import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class TestClient {
    constructor() {
        this.client = null;
        this.transport = null;
    }

    async connect() {
        this.transport = new StdioClientTransport({
            command: "node",
            args: ["index.js"],
        });

        this.client = new Client(
            {
                name: "bitwig-mcp-test-suite",
                version: "0.1.0",
            },
            {
                capabilities: {},
            }
        );

        await this.client.connect(this.transport);
    }

    async disconnect() {
        if (this.transport) {
            await this.transport.close();
        }
    }

    async callTool(name, args = {}) {
        if (!this.client) throw new Error("Client not connected");
        
        try {
            const result = await this.client.callTool({
                name: name,
                arguments: args,
            });
            
            // Helper: parse content if it looks like JSON
            if (result.content && result.content[0] && result.content[0].text) {
                try {
                    return JSON.parse(result.content[0].text);
                } catch (e) {
                    return result.content[0].text;
                }
            }
            return result;
        } catch (error) {
            console.error(`Error calling ${name}:`, error);
            throw error;
        }
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
