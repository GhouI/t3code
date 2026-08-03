# Agent Orchestration

T3 Code can let a Claude Code thread delegate a bounded task to another configured coding agent,
such as Codex. The worker runs in a normal T3 Code thread, so its conversation, tool activity, and
changes stay visible while Claude waits for the result.

## Requirements

- Configure and authenticate Claude Code.
- Configure and authenticate at least one other provider. Codex is the default worker when it is
  available.
- Start the task from a Claude thread. T3 Code currently exposes its orchestration tools through the
  Claude provider's built-in MCP connection.

## Delegate A Task

Ask Claude to delegate explicitly. For example:

```text
Use T3 Code orchestration to ask Codex to implement the parser and run its focused tests. Review the
result before continuing.
```

Claude can use `orchestration_list_agents` to discover the available provider instances and models,
then call `orchestration_delegate`. If Claude omits the provider, T3 Code selects the first runnable
Codex instance and falls back to another runnable provider when Codex is unavailable.

The delegation tool returns:

- the worker thread ID
- the provider instance and model used
- the worker's final response

## Workspace And Permissions

The worker inherits the parent thread's project, branch, worktree, and runtime permission mode. The
parent waits during delegation, so the two agents do not edit the workspace concurrently. The worker
has its own conversation and does not receive the parent's chat history; Claude must include all
necessary task context in the delegated prompt.

Delegated work may still request approval or user input. Open the delegated thread in T3 Code to
respond. A timed-out delegation leaves its visible worker thread available for inspection or manual
continuation.

## Current Limits

- Orchestration starts from Claude Code sessions; other provider adapters do not yet attach the T3
  Code MCP toolkit.
- One delegation call starts one worker thread and waits for one final response.
- Attachments and conversation history are not copied into the worker prompt.
- Delegation uses the current workspace rather than creating another worktree.
