# `@beat-twin/gateway-http`

Typed loopback-only delivery for Gateway HTTP routes and the authenticated
browser-owned NanoDAW WebSocket proxy.

The package owns transport and protocol behavior only. Providers, pairing,
plans, adapters, clocks, and lifecycle are supplied through typed ports by an
application composition root. It never owns NanoDAW song state and never
retries a DAW mutation after dispatch.

`apps/gateway` is a temporary compatibility facade over this package.
