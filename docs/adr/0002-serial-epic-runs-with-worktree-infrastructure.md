# Serial Epic Runs With Worktree Infrastructure

Epic runs execute issues serially in this rebuild because serial workflows reduce coordination complexity and align with the current product need for predictable supervised execution foundations. Worktree and background execution infrastructure remains in scope because it is valuable for isolated agent work and future review/integration flows, but parallel issue execution should stay out of current code and product docs until it is deliberately reintroduced.
