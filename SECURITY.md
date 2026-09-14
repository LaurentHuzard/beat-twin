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
- The relay binds only 127.0.0.1 on ports 8888 and 8889. The controller opens no listening port and connects only to 127.0.0.1:8889. Do not forward these ports. Any local process can use or impersonate this trusted-local bridge.
- The dual-target Gateway pairs local browsers without a password, requiring a loopback peer, loopback Host and exact allowed Origin. Temporary tokens and exact per-target confirmations remain required. These gates do not isolate mutually untrusted local processes.

## Reporting Issues

Please open a GitHub issue for security-relevant behavior such as:

- a write tool callable without the expected policy gate;
- unexpected DAW mutation from a read-only tool;
- unsafe default configuration;
- sensitive local paths or credentials appearing in public files.

Do not include private project files, unreleased music, credentials, or session data in public reports.
