# Beat Twin Adapters

Host integrations implement the versioned `DawAdapter` contract while keeping
target-specific inspection, preflight, execution, and readback outside the
Gateway core.

- `nanodaw` proxies one atomic command batch to the browser-owned runtime and
  never owns a second `Song`.
- `bitwig` translates a bounded portable plan into authenticated, target-bound
  controller operations and reports success only after exact readback.

The historical 57-tool Bitwig MCP server remains in root `index.js` for
compatibility. It is not the portable command language and must stay read-only
by default throughout future modularization.
