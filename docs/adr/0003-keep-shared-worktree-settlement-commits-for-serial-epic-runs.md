# Keep Shared-Worktree Settlement Commits for Serial Epic Runs

Serial epic runs should keep the current shared-worktree settlement behavior: when a worker closes its assigned issue and leaves dirty worktree changes, T3 Code commits those changes before marking the issue execution complete and moving to the next issue. This preserves the current epic-run flow while worker behavior remains unconfigurable; future isolated/background execution can introduce review artifacts and explicit approval without changing this shared-worktree baseline.
