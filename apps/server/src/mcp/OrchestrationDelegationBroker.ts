import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
  isProviderAvailable,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import {
  OrchestrationDelegationError,
  type OrchestrationDelegateInput,
  type OrchestrationDelegateResult,
} from "./toolkits/orchestration/schemas.ts";

const DEFAULT_DELEGATION_TIMEOUT_SECONDS = 900;

const providerIsRunnable = (provider: ServerProvider): boolean =>
  provider.enabled &&
  provider.installed &&
  isProviderAvailable(provider) &&
  provider.status !== "error" &&
  provider.status !== "disabled" &&
  provider.auth.status !== "unauthenticated" &&
  provider.models.length > 0;

const defaultModelForProvider = (provider: ServerProvider): string =>
  provider.models.find((model) => model.isDefault)?.slug ??
  provider.models[0]?.slug ??
  DEFAULT_MODEL_BY_PROVIDER[provider.driver] ??
  DEFAULT_MODEL;

export interface OrchestrationAgentTarget {
  readonly providerInstanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
  readonly isCurrent: boolean;
  readonly defaultModel: string;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly isDefault: boolean;
  }>;
}

export interface OrchestrationDelegationBrokerShape {
  readonly listAgents: (
    invocation: McpInvocationScope,
  ) => Effect.Effect<ReadonlyArray<OrchestrationAgentTarget>>;
  readonly delegate: (
    invocation: McpInvocationScope,
    input: OrchestrationDelegateInput,
  ) => Effect.Effect<OrchestrationDelegateResult, OrchestrationDelegationError>;
}

export class OrchestrationDelegationBroker extends Context.Service<
  OrchestrationDelegationBroker,
  OrchestrationDelegationBrokerShape
>()("t3/mcp/OrchestrationDelegationBroker") {}

type DelegationCompletion =
  | { readonly _tag: "Completed"; readonly response: string }
  | { readonly _tag: "Failed"; readonly detail: string };

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry;

  const randomId = crypto.randomUUIDv4.pipe(Effect.orDie);
  const listAgents: OrchestrationDelegationBrokerShape["listAgents"] = Effect.fn(
    "OrchestrationDelegationBroker.listAgents",
  )(function* (invocation) {
    const snapshots = yield* providers.getProviders;
    return snapshots.filter(providerIsRunnable).map(
      (provider): OrchestrationAgentTarget => ({
        providerInstanceId: provider.instanceId,
        driver: provider.driver,
        displayName: provider.displayName ?? provider.driver,
        isCurrent: provider.instanceId === invocation.providerInstanceId,
        defaultModel: defaultModelForProvider(provider),
        models: provider.models.map((model) => ({
          slug: model.slug,
          name: model.name,
          isDefault: model.isDefault === true,
        })),
      }),
    );
  });

  const delegate: OrchestrationDelegationBrokerShape["delegate"] = Effect.fn(
    "OrchestrationDelegationBroker.delegate",
  )(function* (invocation, input) {
    const parent = yield* projections.getThreadDetailById(invocation.threadId).pipe(
      Effect.mapError(
        (error) =>
          new OrchestrationDelegationError({
            reason: "dispatch_failed",
            detail: `Could not load the parent thread: ${String(error)}`,
          }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            new OrchestrationDelegationError({
              reason: "parent_thread_not_found",
              detail: `Parent thread '${invocation.threadId}' was not found.`,
            }),
          onSome: Effect.succeed,
        }),
      ),
    );

    const snapshots = yield* providers.getProviders;
    const requestedProvider = input.providerInstanceId
      ? snapshots.find((provider) => provider.instanceId === input.providerInstanceId)
      : snapshots.find(
          (provider) =>
            provider.driver === ProviderDriverKind.make("codex") &&
            provider.instanceId !== invocation.providerInstanceId &&
            providerIsRunnable(provider),
        );
    const targetProvider =
      requestedProvider ??
      (input.providerInstanceId
        ? undefined
        : snapshots.find(
            (provider) =>
              provider.instanceId !== invocation.providerInstanceId && providerIsRunnable(provider),
          ));
    if (!targetProvider) {
      return yield* new OrchestrationDelegationError({
        reason: "provider_not_found",
        detail: input.providerInstanceId
          ? `Provider instance '${input.providerInstanceId}' was not found.`
          : "No runnable Codex or alternate provider instance is configured.",
      });
    }
    if (!providerIsRunnable(targetProvider)) {
      return yield* new OrchestrationDelegationError({
        reason: "provider_unavailable",
        detail: `Provider instance '${targetProvider.instanceId}' is not ready to run delegated work.`,
      });
    }

    const model = input.model ?? defaultModelForProvider(targetProvider);
    if (!targetProvider.models.some((candidate) => candidate.slug === model)) {
      return yield* new OrchestrationDelegationError({
        reason: "model_not_found",
        detail: `Model '${model}' is not available on provider instance '${targetProvider.instanceId}'.`,
      });
    }

    const threadId = ThreadId.make(yield* randomId);
    const modelSelection: ModelSelection = {
      instanceId: targetProvider.instanceId,
      model,
    };
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const title =
      input.title ?? `Delegated: ${input.prompt.replace(/\s+/g, " ").trim().slice(0, 90)}`;

    const assistantTextByMessageId = new Map<string, string>();
    let terminal = false;
    let completedAssistantMessage = false;
    let lastResponse = "";
    let failureDetail: string | null = null;
    const completionFiber = yield* engine.streamDomainEvents.pipe(
      Stream.filterMap((event): Result.Result<DelegationCompletion, void> => {
        if (event.aggregateKind !== "thread" || event.aggregateId !== threadId) {
          return Result.failVoid;
        }
        if (event.type === "thread.message-sent" && event.payload.role === "assistant") {
          const messageId = String(event.payload.messageId);
          if (event.payload.streaming) {
            assistantTextByMessageId.set(
              messageId,
              `${assistantTextByMessageId.get(messageId) ?? ""}${event.payload.text}`,
            );
          } else {
            completedAssistantMessage = true;
            lastResponse = assistantTextByMessageId.get(messageId) ?? event.payload.text;
          }
        }
        if (event.type === "thread.session-set") {
          if (event.payload.session.status === "error") {
            failureDetail =
              event.payload.session.lastError ?? "The delegated provider session failed.";
          } else if (
            event.payload.session.status === "starting" ||
            event.payload.session.status === "running"
          ) {
            terminal = false;
          } else if (
            event.payload.session.status === "ready" ||
            event.payload.session.status === "stopped"
          ) {
            terminal = true;
          }
        }
        if (failureDetail !== null) {
          return Result.succeed({ _tag: "Failed", detail: failureDetail });
        }
        if (terminal && completedAssistantMessage) {
          return Result.succeed({ _tag: "Completed", response: lastResponse });
        }
        return Result.failVoid;
      }),
      Stream.runHead,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.die("Delegation completion stream ended unexpectedly."),
          onSome: Effect.succeed,
        }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.yieldNow;

    const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
      engine.dispatch(command).pipe(
        Effect.mapError(
          (error) =>
            new OrchestrationDelegationError({
              reason: "dispatch_failed",
              detail: `Could not start delegated work: ${String(error)}`,
            }),
        ),
      );

    yield* dispatch({
      type: "thread.create",
      commandId: CommandId.make(yield* randomId),
      threadId,
      projectId: parent.projectId,
      title,
      modelSelection,
      runtimeMode: parent.runtimeMode,
      interactionMode: "default",
      branch: parent.branch,
      worktreePath: parent.worktreePath,
      createdAt,
    });
    yield* dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(yield* randomId),
      threadId,
      message: {
        messageId: MessageId.make(yield* randomId),
        role: "user",
        text: input.prompt,
        attachments: [],
      },
      modelSelection,
      runtimeMode: parent.runtimeMode,
      interactionMode: "default",
      createdAt,
    });

    const completed = yield* Fiber.join(completionFiber).pipe(
      Effect.timeoutOption(
        Duration.seconds(input.timeoutSeconds ?? DEFAULT_DELEGATION_TIMEOUT_SECONDS),
      ),
    );
    if (Option.isNone(completed)) {
      return yield* new OrchestrationDelegationError({
        reason: "timeout",
        detail: `Delegated thread '${threadId}' did not finish within ${input.timeoutSeconds ?? DEFAULT_DELEGATION_TIMEOUT_SECONDS} seconds.`,
      });
    }
    if (completed.value._tag === "Failed") {
      return yield* new OrchestrationDelegationError({
        reason: "provider_failed",
        detail: completed.value.detail,
      });
    }

    return {
      threadId,
      providerInstanceId: targetProvider.instanceId,
      driver: targetProvider.driver,
      model,
      response: completed.value.response,
    };
  }, Effect.scoped);

  return OrchestrationDelegationBroker.of({ listAgents, delegate });
});

export const layer = Layer.effect(OrchestrationDelegationBroker, make);

export const __testing = { make };
