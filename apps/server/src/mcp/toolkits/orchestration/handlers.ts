import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationDelegationBroker from "../../OrchestrationDelegationBroker.ts";
import { OrchestrationDelegationError } from "./schemas.ts";
import { OrchestrationToolkit } from "./tools.ts";

const requireOrchestrationCapability = Effect.fn("OrchestrationToolkit.requireCapability")(
  function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (!invocation.capabilities.has("orchestration")) {
      return yield* new OrchestrationDelegationError({
        reason: "capability_denied",
        detail: "This provider session is not allowed to orchestrate other agents.",
      });
    }
    return invocation;
  },
);

export const OrchestrationToolkitHandlersLive = OrchestrationToolkit.toLayer({
  orchestration_list_agents: () =>
    Effect.gen(function* () {
      const invocation = yield* requireOrchestrationCapability();
      const broker = yield* OrchestrationDelegationBroker.OrchestrationDelegationBroker;
      return { agents: yield* broker.listAgents(invocation) };
    }),
  orchestration_delegate: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireOrchestrationCapability();
      const broker = yield* OrchestrationDelegationBroker.OrchestrationDelegationBroker;
      return yield* broker.delegate(invocation, input);
    }),
});
