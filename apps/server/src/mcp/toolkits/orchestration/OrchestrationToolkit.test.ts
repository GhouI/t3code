import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  OrchestrationDelegationBroker,
  type OrchestrationDelegationBrokerShape,
} from "../../OrchestrationDelegationBroker.ts";

const parentThreadId = ThreadId.make("parent-thread");
const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: parentThreadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  initializePayload: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "orchestration-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const broker = OrchestrationDelegationBroker.of({
  listAgents: () =>
    Effect.succeed([
      {
        providerInstanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        isCurrent: false,
        defaultModel: "gpt-5.6-sol",
        models: [{ slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", isDefault: true }],
      },
    ]),
  delegate: (_invocation, input) =>
    Effect.succeed({
      threadId: ThreadId.make("delegated-thread"),
      providerInstanceId: input.providerInstanceId ?? ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      model: input.model ?? "gpt-5.6-sol",
      response: "Delegated result",
    }),
} satisfies OrchestrationDelegationBrokerShape);

const TestLayer = McpHttpServer.OrchestrationToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(Layer.succeed(OrchestrationDelegationBroker, broker)),
);

it.effect("registers discovery and cross-provider delegation tools for Claude sessions", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const listTool = server.tools.find(({ tool }) => tool.name === "orchestration_list_agents");
    const delegateTool = server.tools.find(({ tool }) => tool.name === "orchestration_delegate");

    expect(listTool?.tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(delegateTool?.tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });

    const listed = yield* server
      .callTool({ name: "orchestration_list_agents", arguments: {} })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(listed.isError).toBe(false);
    expect(listed.structuredContent).toMatchObject({
      agents: [{ providerInstanceId: "codex", defaultModel: "gpt-5.6-sol" }],
    });

    const delegated = yield* server
      .callTool({
        name: "orchestration_delegate",
        arguments: { prompt: "Review the parser", providerInstanceId: "codex" },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(delegated.isError).toBe(false);
    expect(delegated.structuredContent).toMatchObject({
      threadId: "delegated-thread",
      providerInstanceId: "codex",
      model: "gpt-5.6-sol",
      response: "Delegated result",
    });
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects delegation when the MCP credential lacks orchestration capability", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const denied = yield* server
      .callTool({ name: "orchestration_list_agents", arguments: {} })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...invocation,
          capabilities: new Set(["preview"] as const),
        }),
        Effect.provideService(McpSchema.McpServerClient, client),
      );

    expect(denied.isError).toBe(true);
    expect(denied.content).toEqual([
      {
        type: "text",
        text: "This provider session is not allowed to orchestrate other agents.",
      },
    ]);
  }).pipe(Effect.provide(TestLayer)),
);
