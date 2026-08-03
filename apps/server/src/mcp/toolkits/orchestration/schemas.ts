import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const OrchestrationAgentModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isDefault: Schema.Boolean,
});

export const OrchestrationAgentTarget = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: TrimmedNonEmptyString,
  isCurrent: Schema.Boolean,
  defaultModel: TrimmedNonEmptyString,
  models: Schema.Array(OrchestrationAgentModel),
});

export const OrchestrationListAgentsResult = Schema.Struct({
  agents: Schema.Array(OrchestrationAgentTarget),
});

export const OrchestrationDelegateInput = Schema.Struct({
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  model: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  timeoutSeconds: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(10), Schema.isLessThanOrEqualTo(3_600)),
  ),
});
export type OrchestrationDelegateInput = typeof OrchestrationDelegateInput.Type;

export const OrchestrationDelegateResult = Schema.Struct({
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  model: TrimmedNonEmptyString,
  response: Schema.String,
});
export type OrchestrationDelegateResult = typeof OrchestrationDelegateResult.Type;

export const OrchestrationDelegationFailureReason = Schema.Literals([
  "capability_denied",
  "parent_thread_not_found",
  "provider_not_found",
  "provider_unavailable",
  "model_not_found",
  "dispatch_failed",
  "provider_failed",
  "timeout",
]);

export class OrchestrationDelegationError extends Schema.TaggedErrorClass<OrchestrationDelegationError>()(
  "OrchestrationDelegationError",
  {
    reason: OrchestrationDelegationFailureReason,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
