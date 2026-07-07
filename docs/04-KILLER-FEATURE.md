# Future Direction: Arrangement Assistance

This note replaces an earlier over-ambitious feature pitch. The goal is to keep the idea useful without making the repository look like a product promise.

## Context

Beat Twin currently focuses on a small MCP surface for Bitwig transport and track control.

A possible future direction is arrangement assistance: using structured DAW inspection and conservative editing tools to help a producer explore arrangement ideas.

This is not implemented yet.

## Why this could matter

Arrangement is often where loops become real tracks. A useful assistant could help with:

- reading the current project structure;
- identifying tracks, clips, scenes, and tempo;
- suggesting arrangement sections;
- preparing non-destructive drafts;
- helping the producer compare variations.

The important constraint is that the human producer keeps creative ownership.

## Required foundations first

Before arrangement assistance becomes realistic, Beat Twin needs stronger basics:

1. **Read-only project inspection**
   - track names and types;
   - clip and scene metadata;
   - device chain inspection;
   - selected-track and selected-clip state.

2. **Permission-aware write tools**
   - each mutating tool should declare its risk level;
   - destructive or broad operations should require explicit confirmation;
   - write operations should stay narrow and reversible where possible.

3. **Preview and rollback model**
   - describe intended changes before applying them;
   - keep a record of applied operations;
   - support manual rollback instructions at minimum.

4. **Testing and manual verification**
   - protocol tests for request/response behavior;
   - manual Bitwig verification recipes;
   - fixtures or mocked state for pure logic where possible.

## Possible tool groups

### Project inspection

```text
project_get_summary
track_list
track_get_details
scene_list
clip_get_summary
device_chain_get_summary
```

### Arrangement planning

```text
arrangement_suggest_structure
arrangement_create_plan
arrangement_preview_changes
```

### Conservative editing

```text
scene_create
scene_duplicate
track_duplicate
clip_duplicate
clip_move
```

These should only be considered after read-only inspection is stable.

## Non-goals

- No unattended full-track generation.
- No destructive project-wide rewrites.
- No claim that the assistant can replace musical judgment.
- No broad DAW automation without preview and permission boundaries.

## Success criteria

A future arrangement feature would be useful if it can:

- explain what it sees in the session;
- propose a clear arrangement plan;
- preview the exact operations it wants to apply;
- apply small reversible changes;
- leave the producer in control at each decision point.

Until those conditions are met, this remains a research direction, not a shipped feature.