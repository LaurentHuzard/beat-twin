# BT-WEB-001 — Secure React Bitwig Remote

Date: 2026-08-26
Branch: `agent/bt-web-001-react-bitwig-controller`
Base: published `main` at `306fb23`
State: complete, reviewed, and locally committed; unpublished

## Product Outcome

The existing Beat Twin playground now exposes a dedicated Bitwig Remote from
both the calm first-run surface and the advanced NanoDAW transport. The remote
reports the real session/dependency state and renders transport, selected
channel, selected device, and track-bank summaries without creating a second
Bitwig protocol catalog.

The first bounded command surface contains restart, play, and stop only. A
command is available only when the current MCP registry exposes its `transport`
policy, Bitwig is connected, and the musician confirms that exact action once.

## Architecture And Security Contract

- the Vite development server owns a loopback same-origin bridge;
- the bridge delegates discovery to `getToolDefinitions()` and execution to
  `handleToolCall()` from the current root MCP implementation;
- GET inspection calls `bitwig_session_inspect` and remains read-only;
- browser commands are restricted to three explicit transport tool names;
- POST requires an exact loopback same-origin `Origin` and a confirmation equal
  to the requested tool name;
- the MCP policy is checked before dispatch and again by `handleToolCall()`;
- mutating Bitwig calls keep `requiresAuthentication: true`;
- the bridge secret, provider keys, and raw environment values never enter the
  client bundle, browser storage, command payload, or response;
- the archived `llm2Bitwig` catalog is not presented as a current capability;
- NanoDAW remains independently usable and its browser-owned song state is not
  read or changed by Bitwig Remote.

## Changes

- added `apps/playground/bitwigWebBridge.ts` and Vite middleware for session
  inspection and bounded commands;
- added the typed browser client and `BitwigRemote` React surface;
- added entry/return navigation without changing the existing NanoDAW store;
- added responsive desktop/mobile styling and honest offline/policy states;
- added synthetic component, bridge policy, and Playwright coverage;
- documented startup, security, supported commands, and archive-derived limits
  in `docs/BITWIG_WEB_REMOTE.md`, the docs index, and the root README;
- included the bridge tests in the root unit suite.

## Verification

- focused bridge file: four cases passed for read-only inspection, exact
  confirmation, policy refusal, and authenticated enabled transport dispatch;
- focused React file: 3 tests passed;
- full NanoDAW Vitest suite: 16 files and 148 tests passed;
- full package/Gateway/MCP unit suite: 177 tests passed when loopback sockets
  were permitted;
- Playground TypeScript and Vite build passed; 2,570 modules transformed;
- full Playwright suite: 10 tests passed across Chromium 1440 x 900 and 390 x
  844, including 4 Bitwig Remote/security cases;
- browser proof: offline state visible, transport disabled, policy explanation
  visible, return to NanoDAW successful, no horizontal overflow, no console
  errors, and zero command POSTs;
- desktop and mobile screenshots were captured as ignored Playwright artifacts
  and inspected at original detail; no clipping, overlap, unreadable control, or
  mobile overflow was observed;
- `http://beat-twin.localhost/api/bitwig/session` returned the current real
  read-only state: loopback bridge active, no write policy, Bitwig disconnected;
- a direct POST without `Origin` returned `untrusted_origin` before policy or
  Bitwig dispatch;
- production bundle search returned no `BITWIG_BRIDGE_SECRET`, `OPENAI_API_KEY`,
  `BITWIG_MCP_ENABLE_WRITES`, or `BITWIG_MCP_WRITE_POLICY` occurrence;
- `git diff --check`: passed.

The Browser plugin was not available, so repository Playwright was used as the
documented fallback. The first browser attempt could not bind its loopback port
inside the sandbox; the authorized rerun passed. The first full unit run hit the
same sandbox restriction in two Gateway socket files; those 12 cases passed
independently, then the complete authorized suite passed 177/177. Node 26.4.0
is outside the declared Node 22/24 range and emitted the known engine warning.

## Adversarial Review

- a forged or unsupported browser tool name is rejected before MCP dispatch;
- confirmation for another action cannot authorize the requested action;
- default/read-only policy produces no transport command definitions;
- enabling the global MCP write flag still exposes only the three web-whitelisted
  transport tools through this surface;
- same-origin validation compares exact host and port and accepts only loopback
  hostnames;
- command requests require JSON and are limited to 16 KiB before parsing;
- the browser cannot supply or override MCP policy or Bitwig credentials;
- disconnected UI cannot arm a command even if a transport policy is present;
- refresh clears stale confirmation and command feedback through component
  lifecycle/state transitions;
- no new dependency or generated artifact is included in the worktree.

## Evidence Boundary

The current bridge contract, policy behavior, authenticated dispatch metadata,
responsive UI, actual disconnected runtime, builds, and deterministic tests are
proven. Bitwig Studio was not started. No live transport action, controller UI
activation, physical audio, mixer/clip/device write, deployment, or archived
feature parity is claimed.

The web endpoints currently belong to the local Vite development server. A
static production build contains the UI but does not package a standalone API
server; that remains a separate packaging slice.

## Next Gate

Publication, live Bitwig validation in a disposable project, merge, deployment,
and branch deletion remain separate human gates.
