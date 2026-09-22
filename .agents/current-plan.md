# BT-DUO-001: TwinPilot Duo Android ↔ MUE collaboration spike

User authorized this spike and pull request on 2026-09-22.
Branch: `spike/twinpilot-duo-android-mue`, created from `main`.
GitHub search returned no open pull requests in the repository before the branch
was created.

## Orbit Ready

BT-DUO-001 is the sole authorized implementation item for this branch.

Build one local-first, read-only collaboration harness that lets two distinct
OpenAI-compatible model endpoints work on the same bounded task while preserving
their asymmetry:

- MUE acts as analyst and starts without Android-only witness evidence;
- Android acts as witness/scout and receives private evidence;
- both answer independently before seeing the peer response;
- both then challenge the peer response;
- MUE produces a final synthesis from the explicit transcript;
- the harness records auditable phase outputs and latency without granting either
  model DAW, Gateway-confirmation, merge, deployment, or destructive authority.

The spike must be runnable without Bitwig or NanoDAW and must not widen existing
agent, MCP, Gateway, or DAW permissions.

## Planned loop

1. Add a dependency-free two-endpoint collaboration core around
   `/v1/chat/completions`.
2. Add a CLI scenario runner with configurable MUE/Android URLs, models and
   optional bearer tokens.
3. Ship one private-evidence scenario that demonstrates independent answers,
   cross-examination and belief revision.
4. Add deterministic offline tests using fake providers; no live model success is
   claimed by those tests.
5. Document the Android llama.cpp + MUE wiring and one exact live command to play.
6. Publish one draft PR for review. Merge and live device validation remain human
   gates.

## Implementation status\n\nImplementation is complete for review on this branch. The focused and workspace\ntests were authored but could not be executed in this environment because DNS\nprevented cloning github.com. Live Android/MUE validation remains separate.\nReport: .agents/reports/feature-20260922-twinpilot-duo.md.\n\n## Safety / evidence boundaries

- No DAW writes or browser state mutations.
- No model receives confirmation/execution tools.
- API keys are read from environment variables and never included in transcripts.
- Offline fixtures prove orchestration only, not real Android/MUE inference.
- Live outputs are evidence only when the operator actually runs the documented
  two-device scenario.
- No merge, deployment, branch deletion or publication beyond the requested PR.
