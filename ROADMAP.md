# Beat Twin Roadmap

Beat Twin should stay focused on a small, inspectable MCP-to-Bitwig control loop before expanding into broader music-production automation.

## Now

- Keep README, status, and setup instructions aligned with the current code.
- Maintain protocol smoke tests for the local MCP-to-controller bridge.
- Verify transport and selected-track workflows manually inside Bitwig Studio.
- Keep the public MCP tool surface conservative.

## Next

- Separate read-only inspection tools from mutating tools in the documentation and implementation.
- Add clearer permission metadata for each MCP tool.
- Add a small controller-installation troubleshooting guide.
- Add more protocol tests around errors, reconnect behavior, and malformed messages.
- Rename remaining `POC` internals once the Bitwig controller surface stabilizes.

## Later

- Explore device and clip inspection after transport and track tools are stable.
- Add session recipes that keep the human as the creative owner.
- Investigate arrangement workflows only after stronger preview, undo, and permission boundaries exist.
- Decide whether Beat Twin remains a lab or becomes a maintained Bitwig integration.

## Non-goals for now

- No network-exposed bridge.
- No unattended destructive DAW operations.
- No broad arbitrary control surface.
- No claim of production readiness.