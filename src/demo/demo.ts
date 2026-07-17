import { API_VERSION, PLANES, STRATA } from "../contracts/types.js";
import type {
  ApplicationManifest,
  ApprovalReceipt,
  ArtifactAttestation,
  AuthorityGrant,
  BudgetUsage,
  CapabilityContract,
  DecisionEvidence,
  DelegationEnvelope,
  IntentEnvelope,
  OutcomeContract,
  RunBundle,
  RuntimeArtifact,
  TraceEvent
} from "../contracts/types.js";
import { digestValue, seal } from "../core/canonical.js";
import { createCompositeFingerprint } from "../core/fingerprint.js";
import { appendTraceEvent, type TraceEventDraft } from "../core/receipts.js";
import { MockChangeCapability } from "./mock-change.js";

export interface DemoResult {
  bundle: RunBundle;
  readBack: unknown;
  duplicateWasSuppressed: boolean;
}

function addEvent(events: TraceEvent[], draft: TraceEventDraft): void {
  events.push(appendTraceEvent(events.at(-1), draft));
}

export function runDemo(now = "2026-07-17T12:00:00.000Z"): DemoResult {
  const runId = "run-change-demo-001";
  const resource = "configuration://workspace/sample-feature";
  const policyBundleDigest = digestValue({ id: "policy/default-enterprise", version: "1.0.0" });
  const tenantPartitionDigest = digestValue("tenant/demo-partition");
  const contextDigest = digestValue({ revision: 7, currentValue: false });

  const capability: CapabilityContract = seal({
    contractType: "CapabilityContract",
    apiVersion: API_VERSION,
    capabilityId: "generic-change",
    version: "1.0.0",
    description: "Prepare, commit, verify, and compensate a typed configuration change.",
    riskClass: "high",
    effectClass: "write",
    operations: ["prepare", "commit", "verify", "compensate"],
    authorityScopes: ["change:commit"],
    inputSchema: {
      type: "object",
      required: ["resource", "key", "value"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      required: ["actionDigest", "committedAt"],
      additionalProperties: true
    },
    sideEffectPolicy: {
      idempotencyRequired: true,
      verificationRequired: true,
      compensationRequired: true
    }
  });
  const capabilitySetDigest = digestValue([capability.digest]);

  const manifest: ApplicationManifest = {
    contractType: "ApplicationManifest",
    apiVersion: API_VERSION,
    metadata: {
      name: "generic-enterprise-change",
      version: "1.0.0",
      description: "A neutral, approval-gated enterprise change application."
    },
    architecture: {
      deploymentMode: "modular-monolith",
      strata: STRATA.map((id, ordinal) => ({
        id,
        ordinal,
        moduleRef: `modules/${id}`,
        dependsOn: ordinal < STRATA.length - 1 ? [STRATA[ordinal + 1] as (typeof STRATA)[number]] : []
      })),
      planes: [...PLANES],
      externalAgentSpecifications: []
    },
    policies: {
      policyBundleDigest,
      authorityEnforcedOutsideModel: true,
      approvalRequiredForHighRisk: true,
      artifactAttestationRequired: true,
      receiptChainRequired: true,
      retentionDays: 365,
      defaultDataBoundary: "tenant",
      allowedModelHosting: ["local", "private-cloud", "managed"]
    },
    capabilitySetDigest,
    conformanceProfiles: ["core", "enterprise"]
  };

  const outcome: OutcomeContract = seal({
    contractType: "OutcomeContract",
    apiVersion: API_VERSION,
    outcomeId: "outcome-change-001",
    objective: "Apply one approved configuration change and prove the observed result.",
    acceptanceCriteria: [
      { id: "criterion-value", assertion: "Read-back equals the approved target value.", evidenceRequired: true },
      { id: "criterion-once", assertion: "The action is committed at most once.", evidenceRequired: true }
    ],
    forbiddenOutcomes: ["Commit without external authority", "Treat untrusted context as authority"]
  });

  const fingerprint = createCompositeFingerprint({
    canonicalIntent: "set configuration sample-feature enabled to true",
    constraints: { expectedRevision: 7, requiresReadBack: true },
    authoritativeContextDigests: [contextDigest],
    outcomeDigest: outcome.digest,
    policyBundleDigest,
    capabilitySetDigest,
    tenantPartitionDigest,
    privacyPartition: "tenant"
  });
  const intent: IntentEnvelope = {
    contractType: "IntentEnvelope",
    apiVersion: API_VERSION,
    intentId: "intent-change-001",
    canonicalIntent: "set configuration sample-feature enabled to true",
    constraints: { expectedRevision: 7, requiresReadBack: true },
    ambiguity: 0.02,
    confidence: 0.98,
    context: [
      { ref: "state://workspace/sample-feature/revision-7", digest: contextDigest, trust: "authoritative" },
      {
        ref: "message://external/suggestion",
        digest: digestValue("Untrusted suggestion is retained only as data."),
        trust: "untrusted"
      }
    ],
    fingerprint
  };

  const execution = {
    contractType: "ExecutionEnvelope" as const,
    apiVersion: API_VERSION,
    runId,
    intentId: intent.intentId,
    outcomeId: outcome.outcomeId,
    profile: "balanced" as const,
    budget: { maxSteps: 12, maxDurationMs: 30_000, maxCostMicros: 100_000, maxTokens: 16_000 },
    sla: { deadline: "2026-07-17T12:05:00.000Z", availabilityClass: "standard" as const },
    tenantPartitionDigest,
    privacyPartition: "tenant" as const
  };
  const budgetUsage: BudgetUsage = seal({
    contractType: "BudgetUsage",
    apiVersion: API_VERSION,
    runId,
    steps: 3,
    durationMs: 25,
    costMicros: 0,
    tokens: 0,
    observedAt: now
  });

  const authority: AuthorityGrant = seal({
    contractType: "AuthorityGrant",
    apiVersion: API_VERSION,
    grantId: "grant-change-001",
    issuer: { type: "human", id: "principal-change-owner" },
    subject: "agent-change-coordinator",
    scopes: ["change:prepare", "change:commit", "change:verify", "change:compensate"],
    resourcePatterns: [resource],
    budget: { maxSteps: 10, maxDurationMs: 20_000, maxCostMicros: 80_000, maxTokens: 12_000 },
    validFrom: "2026-07-17T11:55:00.000Z",
    expiresAt: "2026-07-17T12:10:00.000Z"
  });
  const delegation: DelegationEnvelope = seal({
    contractType: "DelegationEnvelope",
    apiVersion: API_VERSION,
    delegationId: "delegation-verify-001",
    parentGrantId: authority.grantId,
    delegator: authority.subject,
    delegate: "agent-change-verifier",
    scopes: ["change:verify"],
    resourcePatterns: [resource],
    budget: { maxSteps: 2, maxDurationMs: 5_000, maxCostMicros: 10_000, maxTokens: 2_000 },
    validFrom: "2026-07-17T11:59:00.000Z",
    expiresAt: "2026-07-17T12:05:00.000Z"
  });

  const adapter = new MockChangeCapability();
  adapter.seed(resource, "enabled", false);
  const prepared = adapter.prepare({ resource, key: "enabled", value: true });
  const approval: ApprovalReceipt = seal({
    contractType: "ApprovalReceipt",
    apiVersion: API_VERSION,
    approvalId: "approval-change-001",
    actionDigest: prepared.actionDigest,
    authorityGrantId: authority.grantId,
    decision: "approved",
    approvedBy: { type: "human", id: "principal-change-owner" },
    scope: capability.capabilityId,
    issuedAt: "2026-07-17T11:59:30.000Z",
    expiresAt: "2026-07-17T12:04:00.000Z"
  });
  const commitContext = {
    actorId: authority.subject,
    idempotencyKey: "idempotency-change-001",
    occurredAt: now,
    authority,
    approval
  };
  const receipt = adapter.commit(prepared, commitContext);
  const duplicateReceipt = adapter.commit(prepared, commitContext);
  const verification = adapter.verify(prepared);
  const readBack = verification.observed;

  const preparedArtifact: RuntimeArtifact = {
    contractType: "RuntimeArtifact",
    apiVersion: API_VERSION,
    artifactRef: "artifact://change/prepared-001",
    mediaType: "application/json",
    payload: {
      resource: prepared.resource,
      key: prepared.key,
      before: prepared.before,
      after: prepared.after,
      actionDigest: prepared.actionDigest
    },
    digest: digestValue(prepared)
  };
  const resultArtifact: RuntimeArtifact = {
    contractType: "RuntimeArtifact",
    apiVersion: API_VERSION,
    artifactRef: "artifact://change/result-001",
    mediaType: "application/json",
    payload: {
      receipt: {
        actionDigest: receipt.actionDigest,
        idempotencyKey: receipt.idempotencyKey,
        before: receipt.before,
        after: receipt.after,
        committedAt: receipt.committedAt,
        duplicate: receipt.duplicate
      },
      readBack
    },
    digest: digestValue({ receipt, readBack })
  };
  const preparedAttestation: ArtifactAttestation = seal({
    contractType: "ArtifactAttestation",
    apiVersion: API_VERSION,
    attestationId: "attestation-prepared-001",
    artifactRef: preparedArtifact.artifactRef,
    artifactDigest: preparedArtifact.digest,
    producer: "capability-generic-change",
    createdAt: now,
    provenanceRefs: [`urn:agentic-strata:authority:${authority.grantId}`]
  });
  const resultAttestation: ArtifactAttestation = seal({
    contractType: "ArtifactAttestation",
    apiVersion: API_VERSION,
    attestationId: "attestation-result-001",
    artifactRef: resultArtifact.artifactRef,
    artifactDigest: resultArtifact.digest,
    producer: "capability-generic-change",
    createdAt: now,
    provenanceRefs: [
      `urn:agentic-strata:authority:${authority.grantId}`,
      `urn:agentic-strata:approval:${approval.approvalId}`
    ]
  });
  const decision: DecisionEvidence = seal({
    contractType: "DecisionEvidence",
    apiVersion: API_VERSION,
    decisionId: "decision-path-001",
    decisionType: "execution",
    summary: "Selected the approval-gated prepare/commit/verify path for a high-risk write.",
    selectedOption: "prepare-commit-verify",
    rejectedOptions: [
      { option: "direct-write", reason: "The capability risk contract requires preparation and approval." }
    ],
    evidenceRefs: [`urn:agentic-strata:authority:${authority.grantId}`],
    confidence: 1,
    reasoningDisclosure: "summary-only",
    createdAt: now
  });

  const common = { runId, occurredAt: now, attributes: { nodeId: "local-demo" } };
  const events: TraceEvent[] = [];
  addEvent(events, {
    ...common,
    eventId: "event-intent-accepted",
    sequence: 0,
    eventType: "intent.accepted",
    stratum: "intent-outcome",
    summary: "Canonical intent accepted with explicit ambiguity and confidence.",
    evidenceRefs: []
  });
  addEvent(events, {
    ...common,
    eventId: "event-outcome-bound",
    sequence: 1,
    eventType: "outcome.bound",
    stratum: "intent-outcome",
    summary: "Outcome and acceptance evidence requirements bound to the run.",
    evidenceRefs: []
  });
  addEvent(events, {
    ...common,
    eventId: "event-decision-recorded",
    sequence: 2,
    eventType: "decision.recorded",
    stratum: "control-orchestration",
    summary: decision.summary,
    evidenceRefs: [`urn:agentic-strata:decision:${decision.decisionId}`]
  });
  addEvent(events, {
    ...common,
    eventId: "event-authority-checked",
    sequence: 3,
    eventType: "authority.checked",
    stratum: "control-orchestration",
    summary: "External authority grant matched actor, scope, resource, time, and budget.",
    evidenceRefs: [`urn:agentic-strata:authority:${authority.grantId}`]
  });
  addEvent(events, {
    ...common,
    eventId: "event-approval-recorded",
    sequence: 4,
    eventType: "approval.recorded",
    stratum: "control-orchestration",
    summary: "Approval receipt matched the exact prepared action digest.",
    evidenceRefs: [
      `urn:agentic-strata:authority:${authority.grantId}`,
      `urn:agentic-strata:approval:${approval.approvalId}`
    ]
  });
  addEvent(events, {
    ...common,
    eventId: "event-delegation-created",
    sequence: 5,
    eventType: "delegation.created",
    stratum: "collaboration",
    summary: "Verification authority was delegated with narrower scope, time, and budget.",
    evidenceRefs: [`urn:agentic-strata:authority:${authority.grantId}`]
  });
  addEvent(events, {
    ...common,
    eventId: "event-capability-prepared",
    sequence: 6,
    eventType: "capability.prepared",
    stratum: "capability",
    summary: "Change prepared without applying a side effect.",
    attributes: {
      ...common.attributes,
      capabilityId: capability.capabilityId,
      actionDigest: prepared.actionDigest
    },
    evidenceRefs: [`urn:agentic-strata:artifact:${preparedAttestation.attestationId}`]
  });
  addEvent(events, {
    ...common,
    eventId: "event-capability-committed",
    sequence: 7,
    eventType: "capability.committed",
    stratum: "capability",
    summary: "Approved change committed once through the typed capability boundary.",
    attributes: {
      ...common.attributes,
      capabilityId: capability.capabilityId,
      actionDigest: prepared.actionDigest,
      authorityGrantId: authority.grantId,
      approvalReceiptId: approval.approvalId,
      actorId: authority.subject,
      resource,
      idempotencyKey: commitContext.idempotencyKey
    },
    evidenceRefs: [
      `urn:agentic-strata:authority:${authority.grantId}`,
      `urn:agentic-strata:approval:${approval.approvalId}`,
      `urn:agentic-strata:artifact:${preparedAttestation.attestationId}`
    ]
  });
  addEvent(events, {
    ...common,
    eventId: "event-capability-verified",
    sequence: 8,
    eventType: "capability.verified",
    stratum: "knowledge-state",
    summary: "Independent read-back matched the approved target value.",
    attributes: {
      ...common.attributes,
      capabilityId: capability.capabilityId,
      actionDigest: prepared.actionDigest,
      verificationId: "verification-readback-001",
      verified: verification.verified
    },
    evidenceRefs: [
      `urn:agentic-strata:artifact:${resultAttestation.attestationId}`
    ]
  });
  addEvent(events, {
    ...common,
    eventId: "event-artifact-attested",
    sequence: 9,
    eventType: "artifact.attested",
    stratum: "knowledge-state",
    summary: "Prepared and observed runtime artifacts were attested by digest.",
    evidenceRefs: [
      `urn:agentic-strata:artifact:${preparedAttestation.attestationId}`,
      `urn:agentic-strata:artifact:${resultAttestation.attestationId}`
    ]
  });
  addEvent(events, {
    ...common,
    eventId: "event-run-completed",
    sequence: 10,
    eventType: "run.completed",
    stratum: "interaction",
    summary: "Outcome criteria passed with verified runtime evidence.",
    evidenceRefs: [`urn:agentic-strata:artifact:${resultAttestation.attestationId}`]
  });

  return {
    bundle: {
      contractType: "RunBundle",
      apiVersion: API_VERSION,
      manifest,
      intent,
      outcome,
      execution,
      budgetUsage,
      authorityGrants: [authority],
      approvals: [approval],
      delegations: [delegation],
      capabilities: [capability],
      decisions: [decision],
      artifacts: [preparedArtifact, resultArtifact],
      attestations: [preparedAttestation, resultAttestation],
      traceEvents: events
    },
    readBack,
    duplicateWasSuppressed: duplicateReceipt.duplicate
  };
}
