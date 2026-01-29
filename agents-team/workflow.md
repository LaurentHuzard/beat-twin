# Multi-Agent Team Workflow

This document defines the standard operating procedures for the Bitwig MCP Agent Team.

## Core Loop

1.  **User Request** -> **Orchestrator**
    -   Orchestrator analyzes the request.
    -   Updates `task.md`.

2.  **Phase 1: Planning**
    -   **Orchestrator** -> **Planner**
    -   **Planner** checks `roadmap.md` and feature inventory.
    -   **Planner** creates `implementation_plan.md`.
    -   **Planner** requests User Review (via Orchestrator).

3.  **Phase 2: Implementation**
    -   **Orchestrator** (upon plan approval) -> **Implementer**
    -   **Implementer** writes code.
    -   **Implementer** notifies when done.

4.  **Phase 3: Verification**
    -   **Orchestrator** -> **Tester**
    -   **Tester** runs scripts.
    -   If Fail -> Loop back to **Implementer**.
    -   If Pass -> **Tester** creates `walkthrough.md`.

5.  **Phase 4: Documentation & Maintenance**
    -   **Orchestrator** -> **Tech Writer** (updates Docs).
    -   (Optional) **Orchestrator** -> **Refactorer** (if code quality needs bump).
    -   (Optional) **Orchestrator** -> **Journalist** (if milestone reached).

6.  **Done** -> **Orchestrator** notifies User.

## Special Modes

### Refactoring Sprint
-   **Orchestrator** assigns **Refactorer** and **Tester** in a tight loop.
-   **Implementer** is paused to avoid merge conflicts.

### Release Mode
-   **Orchestrator** creates a "Release" task.
-   **Tester** runs full regression suite.
-   **Tech Writer** finalizes release notes.
-   **Journalist** writes the release announcement.
