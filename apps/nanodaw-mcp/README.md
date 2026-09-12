# NanoDAW MCP application

This application is the composition root for the standalone NanoDAW MCP
process. It owns pairing, plans, Gateway HTTP delivery, the authenticated
browser WebSocket proxy, the NanoDAW adapter, MCP stdio, startup, and clean
shutdown.

Reusable MCP schemas, service behavior, and server construction remain in
`@beat-twin/nanodaw-mcp`. The browser remains the only owner of song state.
