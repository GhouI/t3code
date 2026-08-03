import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { __testing } from "./OrchestrationDelegationBroker.ts";

const parentThreadId = ThreadId.make("parent-thread");
const parentThread = {
  id: parentThreadId,
  projectId: ProjectId.make("project-1"),
  title: "Parent Claude thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("claude"),
    model: "claude-opus-4-6",
  },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "feature/orchestration",
  worktreePath: "C:/repo/worktree",
  latestTurn: null,
  createdAt: "2026-08-03T10:00:00.000Z",
  updatedAt: "2026-08-03T10:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
} satisfies OrchestrationThread;

const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: parentThreadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

it.effect("delegates a Claude task to the default Codex provider in a visible child thread", () =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<OrchestrationEvent>();
    const commands: Array<OrchestrationCommand> = [];
    const engine = OrchestrationEngineService.of({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.gen(function* () {
          commands.push(command);
          if (command.type === "thread.turn.start") {
            yield* PubSub.publish(events, {
              sequence: 3,
              eventId: EventId.make("assistant-complete"),
              aggregateKind: "thread",
              aggregateId: command.threadId,
              occurredAt: command.createdAt,
              commandId: CommandId.make("assistant-command"),
              causationEventId: null,
              correlationId: null,
              metadata: {},
              type: "thread.message-sent",
              payload: {
                threadId: command.threadId,
                messageId: command.message.messageId,
                role: "assistant",
                text: "Codex completed the delegated task.",
                turnId: null,
                streaming: false,
                createdAt: command.createdAt,
                updatedAt: command.createdAt,
              },
            });
            yield* PubSub.publish(events, {
              sequence: 4,
              eventId: EventId.make("session-ready"),
              aggregateKind: "thread",
              aggregateId: command.threadId,
              occurredAt: command.createdAt,
              commandId: CommandId.make("session-ready-command"),
              causationEventId: null,
              correlationId: null,
              metadata: {},
              type: "thread.session-set",
              payload: {
                threadId: command.threadId,
                session: {
                  threadId: command.threadId,
                  status: "ready",
                  providerName: "codex",
                  providerInstanceId: ProviderInstanceId.make("codex"),
                  runtimeMode: "approval-required",
                  activeTurnId: null,
                  lastError: null,
                  updatedAt: command.createdAt,
                },
              },
            });
          }
          return { sequence: commands.length };
        }),
      streamDomainEvents: Stream.fromPubSub(events),
      latestSequence: Effect.succeed(0),
    });
    const projections = ProjectionSnapshotQuery.of({
      getThreadDetailById: () => Effect.succeed(Option.some(parentThread)),
    } as unknown as ProjectionSnapshotQuery["Service"]);
    const providerRegistry = ProviderRegistry.of({
      getProviders: Effect.succeed([
        {
          instanceId: ProviderInstanceId.make("claude"),
          driver: "claudeAgent",
          displayName: "Claude",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-08-03T10:00:00.000Z",
          models: [
            {
              slug: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              isCustom: false,
              isDefault: true,
              capabilities: null,
            },
          ],
          slashCommands: [],
          skills: [],
        },
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-08-03T10:00:00.000Z",
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
    } as unknown as ProviderRegistry["Service"]);
    const broker = yield* __testing.make.pipe(
      Effect.provideService(OrchestrationEngineService, engine),
      Effect.provideService(ProjectionSnapshotQuery, projections),
      Effect.provideService(ProviderRegistry, providerRegistry),
    );

    const targets = yield* broker.listAgents(invocation);
    expect(targets.map((target) => target.providerInstanceId)).toEqual(["claude", "codex"]);

    const result = yield* broker.delegate(invocation, {
      prompt: "Implement the parser and run its focused tests.",
      timeoutSeconds: 10,
    });

    expect(result).toMatchObject({
      providerInstanceId: "codex",
      driver: "codex",
      model: "gpt-5.6-sol",
      response: "Codex completed the delegated task.",
    });
    expect(commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
    expect(commands[0]).toMatchObject({
      type: "thread.create",
      threadId: result.threadId,
      projectId: parentThread.projectId,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "approval-required",
      branch: parentThread.branch,
      worktreePath: parentThread.worktreePath,
    });
    expect(commands[1]).toMatchObject({
      type: "thread.turn.start",
      threadId: result.threadId,
      message: { text: "Implement the parser and run its focused tests." },
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "approval-required",
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);
