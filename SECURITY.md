# Security Policy

Beat Twin is an experimental local MCP bridge for Bitwig Studio. It should be treated as a local development tool, not as an internet-facing service.

## Supported Surface

- Local MCP server process.
- Local TCP bridge to the Bitwig controller.
- Read-only MCP tools enabled by default.
- Write tools enabled only through explicit environment variables.

## Reporting Issues

Please open a GitHub issue for security-relevant behavior such as:

- a write tool callable without the expected policy gate;
- unexpected DAW mutation from a read-only tool;
- unsafe default configuration;
- sensitive local paths or credentials appearing in public files.

Do not include private project files, unreleased music, credentials, or session data in public reports.
