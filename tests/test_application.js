import { TestClient } from "./TestClient.js";
import assert from "assert";

async function run() {
    console.log("=== Starting Application Tools Tests ===");
    const client = new TestClient();
    
    try {
        await client.connect();
        console.log("Connected.");

        // 1. Create Instrument Track
        console.log("Testing application_create_instrument_track...");
        const instRes = await client.callTool("application_create_instrument_track");
        assert.strictEqual(instRes, "OK");

        // 2. Create Audio Track
        console.log("Testing application_create_audio_track...");
        const audioRes = await client.callTool("application_create_audio_track");
        assert.strictEqual(audioRes, "OK");

        console.log("=== Application Tools Tests Passed ===");

    } catch (error) {
        console.error("Test Failed:", error);
        process.exit(1);
    } finally {
        await client.disconnect();
    }
}

run();
