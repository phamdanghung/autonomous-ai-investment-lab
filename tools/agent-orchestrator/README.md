# Antigravity Agent Orchestrator

This tool provides a highly secure, offline-verified polling daemon that bridges a remote GitHub Issue to a local Google Antigravity Agent instance.

## Architecture & Security (Stage 1 Hardening R3)

- **Read-Only Capability Boundary**: The Agent is explicitly restricted at the SDK level to `BuiltinTools.read_only()`.
- **Sensitive Path Policy**: File content access to sensitive materials (`.env`, `.pem`, `credentials`, etc.) is proactively intercepted and denied using an injected SDK `policy.deny` hook, which fails closed on traversal attempts and Windows path variants.
- **Repository Path Pinning**: Execution workspaces are pinned locally. The Git repository is validated explicitly using `git rev-parse --is-inside-work-tree` and `git rev-parse --show-toplevel`.
- **Remote Identity Validation**: The daemon actively queries `git remote get-url origin` and guarantees it exactly matches the configured `phamdanghung/autonomous-ai-investment-lab` identity.
- **Strict Clean-Tree Requirement**: The orchestrator enforces a strictly clean working tree (`git status --short` must be completely empty) prior to accepting any commands.
- **Bot Identity Requirement**: The tool ensures strict separation of identity; the command author (`allowed_github_user_id`) cannot share the identity of the polling daemon (Bot identity). Bot-authored reports strictly correlate with command IDs to provide exact idempotency and recovery state.
- **External Runtime State**: No application directories or state paths are generated as import side-effects. The orchestrator isolates state dynamically using `%LOCALAPPDATA%` (or an override path).
- **Crash Recovery Model**: Commands advance through a state machine: `DISCOVERED` -> `VALIDATED` -> `RUNNING` -> `REPORT_PENDING` -> `COMPLETED`. An Agent failure yields a safe `FAILED` report, bypassing `READY`.
- **Dry-Run State**: Testing offline bypasses GitHub and SDK calls, finalizing safely at `DRY_RUN_COMPLETED` without side effects.

## Usage

Stage 1 remains strictly `PLAN_ONLY` and `READ_ONLY`.

Set the required environment variables:
- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY_PATH`

Optional overrides:
- `GITHUB_ALLOWED_BRANCH`
- `ORCHESTRATOR_DRY_RUN` (set to `true` to run locally safely)
- `ORCHESTRATOR_STATE_PATH`

(Ensure no PAT values are committed anywhere in the repository or config files).
