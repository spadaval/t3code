# Planning & Task Decomposition

## Our Current State

T3 Code has the most developed planning infrastructure of the systems reviewed, directly supporting the "humans plan, agents execute" vision.

### Plan mode

Threads have an `interactionMode` field: `"default"` or `"plan"`. In plan mode, the agent generates a structured plan rather than executing code directly.

- Agents emit `turn.proposed.delta` (streaming plan text) and `turn.proposed.completed` (final plan markdown).
- Plans are ingested into `OrchestrationProposedPlan` objects on the thread (capped at 200 per thread).
- Plans have an `intent`: `code-implementation` or `tracker-refinement`.
- Plans have a `followUpOutcome`: `implement-code` or `convert-to-tracker`.

### Plan implementation workflow

**File:** `apps/server/src/orchestration/Layers/PlanImplementationWorkflow.ts` (858 lines)

When the user clicks "implement" on a proposed plan:

1. `PlanImplementationLaunchRequest` command dispatched
2. Worktree created (dedicated git worktree with unique branch)
3. Optional setup script (e.g., `npm install`)
4. New thread created in the worktree
5. Plan sent as user message: `"PLEASE IMPLEMENT THIS PLAN:\n{plan}"` (from `packages/shared/src/plan.ts`)
6. Lifecycle: `requested` -> `prepared` -> `started` -> (or `failed`/`cancelled`)
7. Cleanup on failure/cancellation

### Plan-to-tracker conversion

`buildPlanToBeadsPrompt(planMarkdown)` produces: "PLEASE CONVERT THIS PLAN INTO BEADS ISSUES." This converts a plan into concrete beads issues rather than implementing it directly.

### What's missing

- No plan refinement loop (human reviews plan, provides feedback, agent revises)
- No plan decomposition into sub-plans
- No plan versioning (new plan replaces old; no diff or history)
- No automated plan-to-epic-run pipeline (plan -> issues -> epic run is manual)
- No plan validation (does the plan cover all requirements? Is it feasible?)
- Plans are text blobs -- no structured representation that could be machine-validated

## How Each Tool Solves It

### Symphony

- **No planning by the system.** Symphony is a scheduler. Task decomposition is entirely a human responsibility.
- **Humans create issues in Linear** with descriptions and acceptance criteria. Each issue = one agent run.
- **Scope expansion handling**: WORKFLOW.md instructs agents to file separate issues for out-of-scope discoveries rather than expanding scope.
- **Philosophy**: Planning is a human skill. Execution is an agent skill. Keep them separate.

### Gas Town

- **Mayor decomposes**: When told what to build, the Mayor creates beads (issues) and convoys (work batches). The Mayor is an AI agent but acts in a planning role.
- **Formula checklists**: 47 embedded TOML formulas define step-by-step workflows. Each formula is a pre-defined plan for a class of work (e.g., `mol-polecat-work`, `shiny-enterprise`, `mol-idea-to-plan`).
- **`mol-idea-to-plan` formula**: A structured PRD pipeline:
  1. Generate structured PRD
  2. 6-leg parallel review (different review perspectives as parallel convoy legs)
  3. Human gate (review before implementation)
  4. Plan review
- **Formula overlays**: Operators customize plans per-rig or per-town via TOML overlays. Three modes: replace, append, skip individual steps.
- **Three-tier formula resolution**: Project > Town > System (embedded). Plans compose hierarchically.

### Hermes Agent

- **No formal planning framework.** Planning emerges from:
  - LLM's natural reasoning (with optional `<think>` tags)
  - `todo` tool for explicit task tracking
  - `delegate_task` for parallel decomposition
  - `/plan` skill that generates markdown plans saved to `.hermes/plans/`
- **Skills as reusable plans**: Agent-created skill files describe how to perform specific tasks. Self-improving via patch.
- **Delegation-based decomposition**: Complex tasks split into parallel subtasks via `delegate_task`. Each subtask has explicit `goal` + `context`. Parent synthesizes results.

## Proposed Direction

### 1. Plan refinement loop (Phase 1 -- high priority)

The current flow is linear: agent generates plan -> human reviews -> human clicks implement. Add a feedback cycle:

- Human reviews proposed plan in the UI
- Human provides feedback ("split step 3 into two parts", "add error handling for X", "this should use library Y")
- Agent revises the plan based on feedback
- Repeat until human approves

**Implementation:** This is largely a UI concern. The plan interaction mode already supports multiple `turn.proposed.completed` events per thread. Add a "request revision" action alongside "implement" that sends the human's feedback as a new turn in plan mode.

### 2. Plan-to-epic pipeline (Phase 1 -- high priority)

Automate the flow from approved plan to running epic:

1. Human approves plan
2. Agent converts plan to beads issues (existing `buildPlanToBeadsPrompt`)
3. Agent creates epic in beads linking all issues
4. System validates the epic (existing `validateEpicRun`)
5. User confirms and system starts epic run

Currently steps 2-5 are manual. Connecting them into a single flow triggered by plan approval would dramatically reduce friction.

### 3. Structured plan representation (Phase 2 -- medium priority)

Move plans from freeform markdown to a structured format:

```typescript
interface Plan {
  goal: string;
  steps: PlanStep[];
  acceptanceCriteria: string[];
  estimatedComplexity: "low" | "medium" | "high";
}

interface PlanStep {
  id: string;
  title: string;
  description: string;
  dependencies: string[]; // step IDs
  estimatedScope: "small" | "medium" | "large";
}
```

**Benefits:**

- Machine-parseable: can validate dependency graphs, detect missing steps
- Maps naturally to beads issues (one step = one issue)
- Enables plan diff/versioning
- Enables progress tracking against plan (step completed = issue closed)

**Risk:** Over-structuring plans may reduce quality. LLMs are better at generating natural language than filling rigid schemas. Consider a hybrid: natural language plan with structured metadata extracted.

### 4. Plan templates / formulas (Phase 3 -- future)

Inspired by Gas Town's formula system: pre-defined plan templates for common work patterns.

- "Add a new API endpoint" -> standard steps (schema, handler, validation, tests, docs)
- "Fix a bug" -> standard steps (reproduce, root cause, fix, test, verify)
- "Refactor module X" -> standard steps (understand current, design new, migrate, test, cleanup)

Templates could be project-level (in the repo) or user-level. Combined with skills/procedural memory if that's implemented.

## Pros and Cons

### Plan refinement loop

| Pro                                                   | Con                                |
| ----------------------------------------------------- | ---------------------------------- |
| Directly supports "humans plan, agents execute"       | UI design effort for feedback flow |
| Higher quality plans through iteration                | Multiple round-trips add latency   |
| Low implementation cost (leverage existing plan mode) | Human must be available for review |

### Plan-to-epic pipeline

| Pro                                    | Con                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Dramatically reduces friction          | Complex end-to-end flow with many failure points                               |
| Connects the full plan -> execute loop | Each step can fail independently                                               |
| Unique differentiator                  | Need good UX for partial failures (e.g., issues created but epic start failed) |

### Structured plan representation

| Pro                                              | Con                                              |
| ------------------------------------------------ | ------------------------------------------------ |
| Enables machine validation and progress tracking | LLMs may produce lower quality structured output |
| Natural mapping to beads issues                  | Schema design is hard to get right               |
| Enables plan versioning and diff                 | Migration cost for existing plan mode            |

### Plan templates

| Pro                                       | Con                                    |
| ----------------------------------------- | -------------------------------------- |
| Reduces planning time for common patterns | Template maintenance burden            |
| Encodes team best practices               | May constrain creative problem-solving |
| Composable with formula overlays          | Over-engineering risk for early stage  |
