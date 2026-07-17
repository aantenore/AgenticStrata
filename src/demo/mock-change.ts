import type { ApprovalReceipt, AuthorityGrant, Digest, JsonValue } from "../contracts/types.js";
import { digestValue } from "../core/canonical.js";

export interface ChangeRequest {
  resource: string;
  key: string;
  value: JsonValue;
}

export interface PreparedChange {
  resource: string;
  key: string;
  before: JsonValue;
  after: JsonValue;
  actionDigest: Digest;
}

export interface CommitContext {
  actorId: string;
  idempotencyKey: string;
  occurredAt: string;
  authority: AuthorityGrant;
  approval: ApprovalReceipt;
}

export interface ChangeReceipt {
  actionDigest: Digest;
  idempotencyKey: string;
  before: JsonValue;
  after: JsonValue;
  committedAt: string;
  duplicate: boolean;
}

export interface VerificationResult {
  expected: JsonValue;
  observed: JsonValue;
  verified: boolean;
}

export interface CompensationReceipt {
  actionDigest: Digest;
  restored: JsonValue;
  compensatedAt: string;
}

export class MockChangeCapability {
  readonly #state = new Map<string, JsonValue>();
  readonly #receipts = new Map<string, ChangeReceipt>();

  seed(resource: string, key: string, value: JsonValue): void {
    this.#state.set(`${resource}#${key}`, value);
  }

  prepare(request: ChangeRequest): PreparedChange {
    const storageKey = `${request.resource}#${request.key}`;
    const before = this.#state.get(storageKey) ?? null;
    const action = {
      resource: request.resource,
      key: request.key,
      before,
      after: request.value
    };
    return { ...action, actionDigest: digestValue(action) };
  }

  commit(prepared: PreparedChange, context: CommitContext): ChangeReceipt {
    const existing = this.#receipts.get(context.idempotencyKey);
    if (existing !== undefined) {
      if (existing.actionDigest !== prepared.actionDigest) {
        throw new Error("An idempotency key cannot be reused for a different action.");
      }
      return { ...existing, duplicate: true };
    }

    const instant = Date.parse(context.occurredAt);
    const grantValid =
      context.actorId === context.authority.subject &&
      context.authority.scopes.includes("change:commit") &&
      context.authority.resourcePatterns.includes(prepared.resource) &&
      instant >= Date.parse(context.authority.validFrom) &&
      instant <= Date.parse(context.authority.expiresAt);
    const approvalValid =
      context.approval.decision === "approved" &&
      context.approval.actionDigest === prepared.actionDigest &&
      context.approval.authorityGrantId === context.authority.grantId &&
      context.approval.scope === "generic-change" &&
      instant >= Date.parse(context.approval.issuedAt) &&
      instant <= Date.parse(context.approval.expiresAt);
    if (!grantValid || !approvalValid) {
      throw new Error("Commit denied: authority and approval must both bind the exact action.");
    }

    this.#state.set(`${prepared.resource}#${prepared.key}`, prepared.after);
    const receipt: ChangeReceipt = {
      actionDigest: prepared.actionDigest,
      idempotencyKey: context.idempotencyKey,
      before: prepared.before,
      after: prepared.after,
      committedAt: context.occurredAt,
      duplicate: false
    };
    this.#receipts.set(context.idempotencyKey, receipt);
    return receipt;
  }

  readBack(resource: string, key: string): JsonValue {
    return this.#state.get(`${resource}#${key}`) ?? null;
  }

  verify(prepared: PreparedChange): VerificationResult {
    const observed = this.readBack(prepared.resource, prepared.key);
    return {
      expected: prepared.after,
      observed,
      verified: digestValue(observed) === digestValue(prepared.after)
    };
  }

  compensate(
    prepared: PreparedChange,
    receipt: ChangeReceipt,
    context: CommitContext
  ): CompensationReceipt {
    const instant = Date.parse(context.occurredAt);
    const authorized =
      context.actorId === context.authority.subject &&
      context.authority.scopes.includes("change:compensate") &&
      context.authority.resourcePatterns.includes(prepared.resource) &&
      receipt.actionDigest === prepared.actionDigest &&
      instant >= Date.parse(context.authority.validFrom) &&
      instant <= Date.parse(context.authority.expiresAt);
    if (!authorized) {
      throw new Error("Compensation denied: bounded compensation authority is required.");
    }
    this.#state.set(`${prepared.resource}#${prepared.key}`, prepared.before);
    return {
      actionDigest: prepared.actionDigest,
      restored: prepared.before,
      compensatedAt: context.occurredAt
    };
  }
}
