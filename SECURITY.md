# Security Policy

Beat Twin is an experimental local MCP bridge for Bitwig Studio. It should be treated as a local development tool, not as an internet-facing service.

## Supported Surface

- Local MCP server process.
- Local TCP bridge to the Bitwig controller.
- Read-only MCP tools enabled by default.
- Write tools enabled only through explicit environment variables.

## Known Limitations

- The TCP bridge between the MCP server and the Bitwig controller is unauthenticated.
- The write-policy gate is not defense-in-depth: it lives in the MCP server, not in the controller. Anything that can reach the bridge port can drive Bitwig regardless of the MCP write policy.
- Run Beat Twin only on a trusted machine and firewall the bridge port. Do not expose it to untrusted networks.

## Reporting Issues

Please open a GitHub issue for security-relevant behavior such as:

- a write tool callable without the expected policy gate;
- unexpected DAW mutation from a read-only tool;
- unsafe default configuration;
- sensitive local paths or credentials appearing in public files.

Do not include private project files, unreleased music, credentials, or session data in public reports.
