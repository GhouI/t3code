import { Tool, Toolkit } from "effect/unstable/ai";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationDelegationBroker from "../../OrchestrationDelegationBroker.ts";
import {
  OrchestrationDelegateInput,
  OrchestrationDelegateResult,
  OrchestrationDelegationError,
  OrchestrationListAgentsResult,
} from "./schemas.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationDelegationBroker.OrchestrationDelegationBroker,
];

export const OrchestrationListAgentsTool = Tool.make("orchestration_list_agents", {
  description:
    "List the coding-agent provider instances that T3 Code can run as delegated workers, including their models. Use this before delegation when a specific provider or model matters.",
  parameters: Schema.Struct({}),
  success: OrchestrationListAgentsResult,
  failure: OrchestrationDelegationError,
  dependencies,
})
  .annotate(Tool.Title, "List delegated agents")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const OrchestrationDelegateTool = Tool.make("orchestration_delegate", {
  description:
    "Delegate one bounded task to another T3 Code agent and wait for its final response. The worker runs in a visible child thread with the parent thread's workspace and permission mode. Codex is selected by default; pass providerInstanceId and model to target a different configured agent. Include all task context the worker needs because it does not receive this conversation.",
  parameters: OrchestrationDelegateInput,
  success: OrchestrationDelegateResult,
  failure: OrchestrationDelegationError,
  dependencies,
})
  .annotate(Tool.Title, "Delegate to coding agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const OrchestrationToolkit = Toolkit.make(
  OrchestrationListAgentsTool,
  OrchestrationDelegateTool,
);
