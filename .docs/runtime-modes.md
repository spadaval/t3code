# Runtime modes

T3 Code has a global runtime mode switch in the chat toolbar:

- **Full access**: starts sessions with `approvalPolicy: never` and `sandboxMode: danger-full-access`.
- **Auto-accept edits**: starts sessions with `approvalPolicy: on-request` and `sandboxMode: workspace-write`.
- **Supervised**: starts sessions with `approvalPolicy: untrusted` and `sandboxMode: read-only`.

These are current provider runtime access modes, not the broader future
"Supervised Execution" workflow language used in planning discussions. The
rebuild branch ships runtime-mode selection for individual threads and sessions,
while larger supervised orchestration flows should still be described as future
work until that end-to-end execution model exists.
