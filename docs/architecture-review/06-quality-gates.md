# Quality Gates

## Our Current State

T3 Code has **no automated quality verification** of agent output. When an agent completes a turn or an epic issue execution, there is no automated check that the code compiles, passes lint, or passes tests. The only verification is the human reviewing the result in the UI.

### What exists

- **Approval system**: `ProviderApprovalPolicy` (`untrusted`, `on-failure`, `on-request`, `never`) controls whether the agent needs human approval for commands and file changes. This is a permission gate, not a quality gate.
- **Checkpoints**: Turn-level checkpoint capture records which files changed. `CheckpointReactor` captures git refs. But checkpoints are snapshots, not verification -- they tell you _what_ changed, not whether the change is correct.
- **Turn diffs**: `getTurnDiff` and `getFullThreadDiff` RPCs surface diffs. Again, visibility, not verification.
- **AGENTS.md gates**: The project's own `AGENTS.md` instructs agents to run `bun fmt`, `bun lint`, `bun typecheck` before considering tasks done. But this relies on the agent following instructions -- there is no enforcement.

### Impact of this gap

- Agent output may not compile, lint, or pass tests.
- Epic runs can mark issues as "completed" when the code is broken.
- The human reviewer must manually verify every change.
- No feedback loop: agents don't learn from quality gate failures.

## How Each Tool Solves It

### Symphony

- **WORKFLOW.md defines validation gates**: The reference WORKFLOW.md instructs agents to run tests, lint, and build as part of their execution protocol. Agents report results on the Linear issue workpad.
- **No built-in enforcement**: Like T3 Code, validation depends on the agent following the workflow prompt. But because Symphony's WORKFLOW.md is extremely detailed (it defines a complete status-driven execution protocol), compliance is higher in practice.
- **Status-driven feedback**: If a PR review finds issues, the human moves the ticket to `Rework` state. The agent's next session picks up the rework instructions.

### Gas Town

- **5-command build pipeline**: Per-rig configurable: setup -> typecheck -> lint -> test -> build. Auto-injected into formula template variables so every formula step can reference `{{ .pipeline.test }}`.
- **Refinery verification gate**: The Refinery's `handle-failures` step is explicitly a GATE:
  - Tests PASSED -> proceed to merge
  - Tests FAILED and branch caused it -> Abort, reopen source, notify witness, close MR, delete branch
  - Tests FAILED but pre-existing -> File a bead (`bd create --type=bug --priority=1`), then proceed
  - **Cannot proceed to merge without fix OR bead filed** ("The Scotty Test": you don't walk past a warp core leak because it existed before your shift)
- **Formula step enforcement**: Deacon patrol must execute all 25 steps with audit. Skipping steps is visible in the ledger.
- **Doctor checks**: Automated health diagnostics with auto-fix for environment, settings, Dolt, and legacy issues.

### Hermes Agent

- **Checkpoint manager**: Shadow git repos for pre-edit snapshots. `/rollback` restores files AND undoes conversation turns so context matches filesystem.
- **Dangerous command approval**: 30+ regex patterns for destructive operations. Three modes: `manual` (always prompt), `smart` (LLM risk assessment), `off`. Container environments bypass (container IS the boundary).
- **Tirith pre-exec scanning**: Content-level command scanning for homograph URLs, pipe-to-interpreter, terminal injection. Auto-installs with SHA-256 verification.
- **No build pipeline enforcement**: Hermes doesn't run project-level quality gates. It trusts the agent to follow instructions.

## Proposed Direction

### 1. Configurable quality gate framework

Add a per-project quality gate configuration that defines verification commands:

```json
{
  "qualityGates": {
    "commands": [
      { "name": "typecheck", "command": "bun typecheck", "required": true },
      { "name": "lint", "command": "bun lint", "required": true },
      { "name": "format", "command": "bun fmt --check", "required": false },
      { "name": "test", "command": "bun run test", "required": true }
    ],
    "runOn": ["turn.completed", "epic-issue.completed"],
    "failurePolicy": "block-completion"
  }
}
```

**Execution points:**

- After a turn completes (optional -- may be too aggressive for iterative work)
- Before marking an epic issue execution as completed (recommended)
- On demand via UI button or `t3 quality check`

**Failure policies:**

- `block-completion`: Don't mark the issue as complete. Surface failures to the agent in its next turn with specific error output.
- `warn`: Mark complete but flag in the UI. Surface in the fleet dashboard.
- `report-only`: Run gates, log results, but don't block.

### 2. The Scotty Test (pre-existing failure tracking)

Adopt Gas Town's principle: if quality gates fail but the failure is pre-existing (existed before the agent's changes), the agent must file a beads issue tracking the pre-existing failure rather than silently proceeding.

**Implementation:**

- Run quality gates on the base branch before the agent starts (baseline).
- Run quality gates after the agent completes.
- Diff the results. New failures block. Pre-existing failures must be tracked.

### 3. Gate results as agent context

Feed quality gate results back into the agent's context:

- On failure: inject gate output into the next turn's prompt so the agent can fix the issue.
- On success: include in the turn's activity log for the human reviewer.
- Aggregate: track pass/fail rates per model, per project, per issue type.

### 4. Checkpoint + rollback with context undo (from Hermes)

When quality gates fail, the agent should be able to rollback to a known-good state:

- Server-side git snapshots before each turn (already partially implemented via checkpoints).
- Rollback command that restores both files AND the conversation context to the pre-turn state.
- This prevents the agent from building on broken state.

## Pros and Cons

### Quality gate framework

| Pro                                    | Con                                               |
| -------------------------------------- | ------------------------------------------------- |
| Catches broken code before it's "done" | Adds latency to turn completion                   |
| Configurable per project               | Some projects don't have test suites              |
| Provides feedback loop to agent        | May over-trigger on iterative work-in-progress    |
| Essential for unattended epic runs     | Gate commands must be fast enough to be practical |

### Scotty Test (pre-existing tracking)

| Pro                                     | Con                                           |
| --------------------------------------- | --------------------------------------------- |
| Prevents ignoring pre-existing problems | Requires baseline capture (adds startup cost) |
| Creates accountability                  | Baseline can change during parallel execution |
| Agents track debt, not just new work    | Needs careful diff logic                      |

### Gate results as agent context

| Pro                               | Con                                    |
| --------------------------------- | -------------------------------------- |
| Agents self-correct from failures | Consumes context window budget         |
| Closes the feedback loop          | Agent may thrash on unfixable failures |
| Enables quality tracking metrics  |                                        |

### Checkpoint + rollback

| Pro                                  | Con                                        |
| ------------------------------------ | ------------------------------------------ |
| Safety net for broken changes        | Storage cost for snapshots                 |
| Context undo prevents confused state | Rollback across multiple turns is complex  |
| Proven pattern (Hermes)              | Needs integration with event-sourced state |
