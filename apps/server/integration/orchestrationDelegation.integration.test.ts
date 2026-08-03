// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { __testing as OrchestrationDelegationBrokerTesting } from "../src/mcp/OrchestrationDelegationBroker.ts";
import type { McpInvocationScope } from "../src/mcp/McpInvocationContext.ts";
import { OrchestrationEngineService } from "../src/orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../src/provider/Services/ProviderRegistry.ts";
import { makeProviderRegistryMock } from "../src/provider/testUtils/providerRegistryMock.ts";
import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const PROJECT_ID = ProjectId.make("orchestration-delegation-project");
const PARENT_THREAD_ID = ThreadId.make("orchestration-delegation-parent");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claude");
const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CREATED_AT = "2026-08-03T10:00:00.000Z";

const withHarness = <A, E>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>,
) =>
  Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: CODEX_DRIVER }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));

const seedParentThread = (harness: OrchestrationIntegrationHarness) =>
  Effect.gen(function* () {
    yield* harness.engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("orchestration-delegation-project-create"),
      projectId: PROJECT_ID,
      title: "Agent orchestration integration",
      workspaceRoot: harness.workspaceDir,
      defaultModelSelection: {
        instanceId: CLAUDE_INSTANCE_ID,
        model: "claude-opus-4-6",
      },
      createdAt: CREATED_AT,
    });
    yield* harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("orchestration-delegation-parent-create"),
      threadId: PARENT_THREAD_ID,
      projectId: PROJECT_ID,
      title: "Claude orchestrator",
      modelSelection: {
        instanceId: CLAUDE_INSTANCE_ID,
        model: "claude-opus-4-6",
      },
      interactionMode: "default",
      runtimeMode: "approval-required",
      branch: "agent/orchestrated-work",
      worktreePath: harness.workspaceDir,
      createdAt: CREATED_AT,
    });
    yield* harness.waitForThread(PARENT_THREAD_ID, () => true);
  });

const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("orchestration-delegation-environment"),
  threadId: PARENT_THREAD_ID,
  providerSessionId: "claude-provider-session",
  providerInstanceId: CLAUDE_INSTANCE_ID,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

it.live("delegates work through the engine and returns the visible child thread response", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* seedParentThread(harness);
      yield* harness.adapterHarness!.queueTurnResponseForNextSession({
        events: [
          {
            type: "turn.started",
            eventId: EventId.make("orchestration-delegation-turn-started"),
            provider: CODEX_DRIVER,
            createdAt: "2026-08-03T10:00:01.000Z",
            threadId: "assigned-by-adapter",
            turnId: "assigned-by-adapter",
          },
          {
            type: "message.delta",
            eventId: EventId.make("orchestration-delegation-message"),
            provider: CODEX_DRIVER,
            createdAt: "2026-08-03T10:00:02.000Z",
            threadId: "assigned-by-adapter",
            turnId: "assigned-by-adapter",
            delta: "Codex completed the delegated engine task.",
          },
          {
            type: "turn.completed",
            eventId: EventId.make("orchestration-delegation-turn-completed"),
            provider: CODEX_DRIVER,
            createdAt: "2026-08-03T10:00:03.000Z",
            threadId: "assigned-by-adapter",
            turnId: "assigned-by-adapter",
            status: "completed",
          },
        ],
      });

      const broker = yield* OrchestrationDelegationBrokerTesting.make.pipe(
        Effect.provideService(OrchestrationEngineService, harness.engine),
        Effect.provideService(ProjectionSnapshotQuery, harness.snapshotQuery),
        Effect.provideService(
          ProviderRegistry,
          ProviderRegistry.of(
            makeProviderRegistryMock([
              {
                instanceId: CODEX_INSTANCE_ID,
                driver: CODEX_DRIVER,
                displayName: "Codex",
                enabled: true,
                installed: true,
                version: "1.0.0",
                status: "ready",
                auth: { status: "authenticated" },
                checkedAt: CREATED_AT,
                models: [
                  {
                    slug: "gpt-5.6-sol",
                    name: "GPT-5.6 Sol",
                    isCustom: false,
                    isDefault: true,
                    capabilities: null,
                  },
                ],
                slashCommands: [],
                skills: [],
              },
            ]),
          ),
        ),
        Effect.provide(NodeServices.layer),
      );

      const result = yield* broker.delegate(invocation, {
        prompt: "Implement the parser and report the focused test result.",
        timeoutSeconds: 10,
      });

      assert.equal(result.providerInstanceId, CODEX_INSTANCE_ID);
      assert.equal(result.driver, CODEX_DRIVER);
      assert.equal(result.model, "gpt-5.6-sol");
      assert.equal(result.response, "Codex completed the delegated engine task.");

      const child = yield* harness.waitForThread(result.threadId, (thread) =>
        thread.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.text === "Codex completed the delegated engine task.",
        ),
      );
      assert.equal(child.projectId, PROJECT_ID);
      assert.deepEqual(child.modelSelection, {
        instanceId: CODEX_INSTANCE_ID,
        model: "gpt-5.6-sol",
      });
      assert.equal(child.runtimeMode, "approval-required");
      assert.equal(child.branch, "agent/orchestrated-work");
      assert.equal(child.worktreePath, harness.workspaceDir);
    }),
  ),
);
