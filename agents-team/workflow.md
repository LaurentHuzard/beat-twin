# Beat Twin Agent Workflow

This document describes the lightweight agent-assisted workflow used to evolve Beat Twin.

It is safe to keep in a public repository. Do not add private prompts, credentials, local machine paths, or personal memory references here.

## Trigger

A user intent, issue, or concrete task request related to the Bitwig MCP bridge.

## Phase 1: Planning

**Owner:** `@orchestrator`

1. Read the request and identify the affected area.
2. Inspect relevant files:
   - MCP server code;
   - Bitwig controller script;
   - protocol tests;
   - documentation.
3. Create a short implementation plan for non-trivial changes.
4. Define verification steps before coding starts.

## Phase 2: Implementation

**Owner:** `@implementer`

Guidelines:

- keep MCP tools explicit and narrow;
- keep Bitwig operations behind named tool boundaries;
- preserve local-only assumptions unless a stronger permission layer exists;
- keep protocol changes covered by tests;
- do not delete or overwrite files unless the plan explicitly requires it.

## Phase 3: Verification

**Owner:** `@tester`

Run the smallest useful verification set:

- protocol smoke tests for transport changes;
- manual Bitwig checks for controller-script behavior;
- command/client checks for MCP tool exposure;
- documentation review when tool behavior changes.

Failures should include reproduction steps and relevant logs.

## Phase 4: Documentation and cleanup

**Owner:** `@tech-writer`

Update public docs when behavior changes:

- `README.md` for setup, usage, and tool surface;
- `ROADMAP.md` for future work;
- inline comments only for non-obvious protocol or controller constraints.

Optional cleanup can be handled by `@refactorer` when the code works but needs a clearer structure.

## Public-release guardrails

Before publishing, check that agent-related files do not contain:

- private prompts;
- API keys or tokens;
- personal memory references;
- local machine paths;
- unpublished customer/client context;
- instructions that only make sense in one private chat session.