# T3 Code

T3 Code is a cockpit for planning, executing, and supervising coding-agent work across software projects. This context defines the product language for issue-backed agent execution.

## Language

**Issue**:
A beads-backed unit of project work that may be viewed, edited, linked to threads, and selected for agent execution.
_Avoid_: Bead, work item, task

**Epic**:
An issue that groups and sequences child issues into a larger body of project work.
_Avoid_: Swarm, molecule

**Epic Run**:
A serial execution attempt that works through an epic's executable child issues under T3 Code orchestration.
_Avoid_: Parallel run, swarm run

**Issue Execution**:
One agent attempt to complete one issue within an epic run.
_Avoid_: Worker task, subagent task

**Plan Implementation Launch**:
An operator-approved transition from a proposed plan into an agent execution thread.
_Avoid_: Auto-implementation, plan run

**Backlog Grooming**:
A tracker-only workflow for making issues more executable before agent execution begins.
_Avoid_: Planning workflow, code cleanup

**Supervised Execution**:
A future capability where completed issue executions produce reviewable artifacts and require explicit operator judgment before code lands.
_Avoid_: Current epic run execution

## Relationships

- An **Epic** contains zero or more child **Issues**.
- An **Epic Run** targets exactly one **Epic**.
- An **Epic Run** creates zero or more **Issue Executions**.
- An **Issue Execution** targets exactly one **Issue**.
- A **Plan Implementation Launch** may create an agent thread linked to one **Issue** or proposed plan.
- **Backlog Grooming** changes issue tracker state and should not change code.

## Example Dialogue

> **Dev:** "Can an **Epic Run** execute several **Issues** in parallel?"
> **Domain expert:** "No, not in this rebuild. An **Epic Run** is serial for now, though background worktree execution remains part of the direction."

## Flagged Ambiguities

- "bead" and "beads issue" were both used for the same user-facing object. Resolved: the product term is **Issue**; beads is the backing tracker.
- "Supervised Execution" was used to describe both the current branch and the future milestone. Resolved: **Supervised Execution** is future-facing and requires reviewable artifacts plus operator judgment before code lands.
- "parallel work" was considered for epic execution. Resolved: **Epic Runs** are serial in this rebuild; future concurrency investigation remains outside current code and docs.
- T3 Code cannot assume exclusive ownership of issue state because agents may mutate beads directly. Resolved: beads is the source of truth for **Issue** state; T3 Code may use short-lived or optimistic caches only.
