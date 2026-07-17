import { API_VERSION } from "../contracts/types.js";
import type {
  CapabilityContract,
  ConformanceCheck,
  ConformanceProfile,
  ConformanceReport,
  RunBundle,
  TraceEvent,
  ValidationIssue
} from "../contracts/types.js";
import { validateAs } from "../contracts/registry.js";
import {
  budgetIsAttenuated,
  validateChildGrant,
  validateDelegation
} from "../core/authority.js";
import { digestValue, verifySeal } from "../core/canonical.js";
import { validateCompositeFingerprint } from "../core/fingerprint.js";
import { evidenceIndex, verifyTraceChain } from "../core/receipts.js";
import {
  loadProfileConfiguration,
  resolveProfileRules,
  type ProfileConfiguration
} from "./config.js";
import { lintManifest } from "./manifest.js";

export interface ConformanceOptions {
  configuration?: ProfileConfiguration;
  generatedAt?: string;
}

type Rule = (bundle: RunBundle) => ConformanceCheck;

function check(
  id: string,
  passed: boolean,
  success: string,
  failure: string,
  evidenceRefs: string[] = []
): ConformanceCheck {
  return {
    id,
    status: passed ? "pass" : "fail",
    severity: passed ? "info" : "error",
    message: passed ? success : failure,
    evidenceRefs
  };
}

function capabilityFor(bundle: RunBundle, event: TraceEvent): CapabilityContract | undefined {
  const id = event.attributes.capabilityId;
  return typeof id === "string"
    ? bundle.capabilities.find((capability) => capability.capabilityId === id)
    : undefined;
}

function referenceSealIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  const sealed = [
    bundle.outcome,
    bundle.budgetUsage,
    ...bundle.authorityGrants,
    ...bundle.approvals,
    ...bundle.delegations,
    ...bundle.capabilities,
    ...bundle.decisions,
    ...bundle.attestations
  ];
  for (const record of sealed) {
    if (!verifySeal(record)) {
      issues.push(record.contractType);
    }
  }
  for (const artifact of bundle.artifacts) {
    if (digestValue(artifact.payload) !== artifact.digest) {
      issues.push(`RuntimeArtifact:${artifact.artifactRef}`);
    }
  }
  for (const attestation of bundle.attestations) {
    const artifact = bundle.artifacts.find((item) => item.artifactRef === attestation.artifactRef);
    if (artifact === undefined || artifact.digest !== attestation.artifactDigest) {
      issues.push(`ArtifactAttestation:${attestation.attestationId}`);
    }
  }
  const known = evidenceIndex(bundle);
  for (const attestation of bundle.attestations) {
    if (attestation.provenanceRefs.some((reference) => !known.has(reference))) {
      issues.push(`ArtifactAttestation:${attestation.attestationId}:provenance`);
    }
    if (
      attestation.provenanceRefs.includes(
        `urn:agentic-strata:artifact:${attestation.attestationId}`
      )
    ) {
      issues.push(`ArtifactAttestation:${attestation.attestationId}:self-reference`);
    }
  }
  for (const artifact of bundle.artifacts) {
    if (!bundle.attestations.some((item) => item.artifactRef === artifact.artifactRef)) {
      issues.push(`RuntimeArtifact:${artifact.artifactRef}:unattested`);
    }
  }
  return issues;
}

function fingerprintBindingsValid(bundle: RunBundle): boolean {
  const fingerprint = bundle.intent.fingerprint;
  const operational = fingerprint.operational;
  return (
    validateCompositeFingerprint(bundle.intent).valid &&
    operational.outcomeDigest === bundle.outcome.digest &&
    operational.policyBundleDigest === bundle.manifest.policies.policyBundleDigest &&
    operational.capabilitySetDigest === bundle.manifest.capabilitySetDigest &&
    operational.tenantPartitionDigest === bundle.execution.tenantPartitionDigest &&
    operational.privacyPartition === bundle.execution.privacyPartition &&
    bundle.manifest.capabilitySetDigest ===
      digestValue(bundle.capabilities.map((capability) => capability.digest).sort())
  );
}

function identityLineageIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  if (bundle.execution.intentId !== bundle.intent.intentId) {
    issues.push("execution:intent");
  }
  if (bundle.execution.outcomeId !== bundle.outcome.outcomeId) {
    issues.push("execution:outcome");
  }
  if (bundle.budgetUsage.runId !== bundle.execution.runId) {
    issues.push("budget-usage:run");
  }
  for (const approval of bundle.approvals) {
    if (!bundle.authorityGrants.some((grant) => grant.grantId === approval.authorityGrantId)) {
      issues.push(`approval:${approval.approvalId}:authority`);
    }
  }
  for (const event of bundle.traceEvents) {
    if (event.runId !== bundle.execution.runId) {
      issues.push(`event:${event.eventId}:run`);
    }
    if (
      event.eventType.startsWith("capability.") &&
      capabilityFor(bundle, event) === undefined
    ) {
      issues.push(`event:${event.eventId}:capability`);
    }
  }

  const identifierGroups: Array<[string, string[]]> = [
    ["authority", bundle.authorityGrants.map((item) => item.grantId)],
    ["approval", bundle.approvals.map((item) => item.approvalId)],
    ["delegation", bundle.delegations.map((item) => item.delegationId)],
    ["capability", bundle.capabilities.map((item) => item.capabilityId)],
    ["decision", bundle.decisions.map((item) => item.decisionId)],
    ["artifact", bundle.artifacts.map((item) => item.artifactRef)],
    ["attestation", bundle.attestations.map((item) => item.attestationId)],
    ["event", bundle.traceEvents.map((item) => item.eventId)]
  ];
  for (const [kind, identifiers] of identifierGroups) {
    if (new Set(identifiers).size !== identifiers.length) {
      issues.push(`${kind}:duplicate-id`);
    }
  }
  return issues;
}

function externalSpecificationIssues(bundle: RunBundle): string[] {
  const references = bundle.manifest.architecture.externalAgentSpecifications;
  const refs = new Set<string>();
  const issues: string[] = [];
  for (const external of references) {
    if (refs.has(external.ref)) {
      issues.push(`${external.ref}:duplicate`);
    }
    refs.add(external.ref);
    if (Object.keys(external).some((key) => !["ref", "digest", "mediaType"].includes(key))) {
      issues.push(`${external.ref}:embedded-definition`);
    }
  }
  return issues;
}

function authorityBoundaryIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  const authorityEventTypes = new Set(["authority.checked", "approval.recorded"]);
  for (const event of bundle.traceEvents) {
    if (authorityEventTypes.has(event.eventType) && event.stratum === "model-compute") {
      issues.push(`${event.eventId}:model-authority`);
    }
  }

  const untrustedTokens = new Set(
    bundle.intent.context
      .filter((item) => item.trust === "untrusted")
      .flatMap((item) => [item.ref, item.digest])
  );
  for (const event of bundle.traceEvents.filter((item) => authorityEventTypes.has(item.eventType))) {
    const values = [...event.evidenceRefs, ...Object.values(event.attributes)].filter(
      (value): value is string => typeof value === "string"
    );
    if (values.some((value) => untrustedTokens.has(value))) {
      issues.push(`${event.eventId}:untrusted-authority`);
    }
  }
  return issues;
}

function highRiskApprovalIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  for (const event of bundle.traceEvents.filter((item) => item.eventType === "capability.committed")) {
    const capability = capabilityFor(bundle, event);
    if (capability === undefined) {
      issues.push(`${event.eventId}:unknown-capability`);
      continue;
    }
    if (capability.riskClass !== "high" && capability.riskClass !== "critical") {
      continue;
    }
    const grantId = event.attributes.authorityGrantId;
    const approvalId = event.attributes.approvalReceiptId;
    const actionDigest = event.attributes.actionDigest;
    const actorId = event.attributes.actorId;
    const resource = event.attributes.resource;
    const grant =
      typeof grantId === "string"
        ? bundle.authorityGrants.find((candidate) => candidate.grantId === grantId)
        : undefined;
    const approval =
      typeof approvalId === "string"
        ? bundle.approvals.find((candidate) => candidate.approvalId === approvalId)
        : undefined;
    const occurredAt = Date.parse(event.occurredAt);
    const grantValid =
      grant !== undefined &&
      actorId === grant.subject &&
      typeof resource === "string" &&
      grant.resourcePatterns.includes(resource) &&
      capability.authorityScopes.every((scope) => grant.scopes.includes(scope)) &&
      occurredAt >= Date.parse(grant.validFrom) &&
      occurredAt <= Date.parse(grant.expiresAt);
    const approvalValid =
      approval !== undefined &&
      approval.decision === "approved" &&
      approval.authorityGrantId === grantId &&
      approval.actionDigest === actionDigest &&
      approval.scope === capability.capabilityId &&
      occurredAt >= Date.parse(approval.issuedAt) &&
      occurredAt <= Date.parse(approval.expiresAt) &&
      event.evidenceRefs.includes(`urn:agentic-strata:authority:${grantId}`) &&
      event.evidenceRefs.includes(`urn:agentic-strata:approval:${approvalId}`);
    if (!grantValid || !approvalValid) {
      issues.push(event.eventId);
    }
  }
  return issues;
}

function sideEffectIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  const knownEvidence = evidenceIndex(bundle);
  const effectful = bundle.capabilities.filter((capability) =>
    ["write", "external", "destructive"].includes(capability.effectClass)
  );
  for (const capability of effectful) {
    const operations = new Set(capability.operations);
    const policy = capability.sideEffectPolicy;
    if (
      !policy.idempotencyRequired ||
      !policy.verificationRequired ||
      !operations.has("prepare") ||
      !operations.has("commit") ||
      !operations.has("verify") ||
      ((capability.riskClass === "high" || capability.riskClass === "critical") &&
        (!policy.compensationRequired || !operations.has("compensate")))
    ) {
      issues.push(`${capability.capabilityId}:contract`);
    }
  }

  const committedKeys = new Map<string, string>();
  for (const commit of bundle.traceEvents.filter((event) => event.eventType === "capability.committed")) {
    const capability = capabilityFor(bundle, commit);
    if (capability === undefined) {
      continue;
    }
    if (!effectful.includes(capability)) {
      issues.push(`${commit.eventId}:commit-on-non-effectful-capability`);
      continue;
    }
    const prepared = bundle.traceEvents.some(
      (event) =>
        event.eventType === "capability.prepared" &&
        event.sequence < commit.sequence &&
        event.attributes.actionDigest === commit.attributes.actionDigest
    );
    const terminal = bundle.traceEvents.some(
      (event) =>
        ((event.eventType === "capability.verified" && event.attributes.verified === true) ||
          event.eventType === "capability.compensated") &&
        event.sequence > commit.sequence &&
        event.attributes.actionDigest === commit.attributes.actionDigest &&
        event.evidenceRefs.some(
          (reference) =>
            reference.startsWith("urn:agentic-strata:artifact:") &&
            knownEvidence.has(reference)
        )
    );
    const idempotencyKey = commit.attributes.idempotencyKey;
    if (!prepared || !terminal || typeof idempotencyKey !== "string") {
      issues.push(`${commit.eventId}:runtime`);
      continue;
    }
    if (committedKeys.has(idempotencyKey)) {
      issues.push(`${commit.eventId}:duplicate-commit`);
    } else if (typeof commit.attributes.actionDigest === "string") {
      committedKeys.set(idempotencyKey, commit.attributes.actionDigest);
    }
  }
  return issues;
}

function budgetIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  const usage = bundle.budgetUsage;
  const limit = bundle.execution.budget;
  if (
    usage.steps > limit.maxSteps ||
    usage.durationMs > limit.maxDurationMs ||
    usage.costMicros > limit.maxCostMicros ||
    usage.tokens > limit.maxTokens
  ) {
    issues.push("execution:consumption");
  }
  for (const grant of bundle.authorityGrants) {
    if (!budgetIsAttenuated(grant.budget, bundle.execution.budget)) {
      issues.push(grant.grantId);
    }
    if (grant.parentGrantId !== undefined) {
      const parent = bundle.authorityGrants.find(
        (candidate) => candidate.grantId === grant.parentGrantId
      );
      if (parent === undefined || !validateChildGrant(grant, parent).valid) {
        issues.push(`${grant.grantId}:parent`);
      }
    }
  }
  for (const delegation of bundle.delegations) {
    if (!budgetIsAttenuated(delegation.budget, bundle.execution.budget)) {
      issues.push(`${delegation.delegationId}:execution`);
    }
  }
  return issues;
}

function delegationIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  for (const delegation of bundle.delegations) {
    const parent = bundle.authorityGrants.find((grant) => grant.grantId === delegation.parentGrantId);
    if (parent === undefined) {
      issues.push(`${delegation.delegationId}:missing-parent`);
      continue;
    }
    if (!validateDelegation(delegation, parent).valid) {
      issues.push(delegation.delegationId);
    }
  }
  return issues;
}

const rules: Record<string, Rule> = {
  "schema.bundle": (bundle) => {
    const result = validateAs("RunBundle", bundle);
    return check(
      "schema.bundle",
      result.valid,
      "Manifest and runtime contracts satisfy the versioned JSON Schema.",
      `Schema validation failed with ${result.issues.length} issue(s).`
    );
  },
  "architecture.complete-strata": (bundle) => {
    const relevant = lintManifest(bundle.manifest).issues.filter((issue) =>
      ["missing-stratum", "duplicate-strata", "stratum-ordinal", "missing-plane"].includes(issue.code)
    );
    return check(
      "architecture.complete-strata",
      relevant.length === 0,
      "All seven strata and three cross-cutting planes are declared once.",
      "The manifest does not declare the complete layered architecture."
    );
  },
  "architecture.dependency-direction": (bundle) => {
    const relevant = lintManifest(bundle.manifest).issues.filter((issue) =>
      ["unknown-dependency", "dependency-direction"].includes(issue.code)
    );
    return check(
      "architecture.dependency-direction",
      relevant.length === 0,
      "Stratum dependencies only point toward lower execution strata.",
      "At least one stratum dependency violates the direction rule."
    );
  },
  "fingerprint.operational-bindings": (bundle) =>
    check(
      "fingerprint.operational-bindings",
      fingerprintBindingsValid(bundle),
      "The composite fingerprint binds semantic and operational cache partitions.",
      "The composite fingerprint is incomplete, stale, or bound to different runtime policy."
    ),
  "lineage.contract-bindings": (bundle) => {
    const issues = identityLineageIssues(bundle);
    return check(
      "lineage.contract-bindings",
      issues.length === 0,
      "Intent, outcome, execution, capability, approval, and receipt identifiers form a complete lineage.",
      `Contract lineage is incomplete at: ${issues.join(", ")}.`
    );
  },
  "lineage.external-specifications": (bundle) => {
    const issues = externalSpecificationIssues(bundle);
    return check(
      "lineage.external-specifications",
      issues.length === 0,
      "External agent specifications are imported only by immutable reference, digest, and media type.",
      `External agent specification import is invalid at: ${issues.join(", ")}.`
    );
  },
  "lineage.runtime-artifacts": (bundle) => {
    const issues = referenceSealIssues(bundle);
    return check(
      "lineage.runtime-artifacts",
      issues.length === 0,
      "Runtime artifacts, attestations, and digest-sealed contract records have matching digests.",
      `Runtime artifact or contract digest mismatch: ${issues.join(", ") || "unknown"}.`
    );
  },
  "lineage.receipt-chain": (bundle) => {
    const result = verifyTraceChain(bundle.traceEvents, evidenceIndex(bundle));
    return check(
      "lineage.receipt-chain",
      result.valid,
      `Replayed ${result.eventsReplayed} hash-linked runtime receipts without gaps.`,
      `Runtime receipt replay found ${result.issues.length} integrity issue(s).`
    );
  },
  "authority.budget-monotonicity": (bundle) => {
    const issues = budgetIssues(bundle);
    return check(
      "authority.budget-monotonicity",
      issues.length === 0,
      "Authority budgets and observed consumption stay within the execution envelope.",
      `Authority budgets expand or observed consumption exceeds the envelope at: ${issues.join(", ")}.`
    );
  },
  "authority.delegation-attenuation": (bundle) => {
    const issues = delegationIssues(bundle);
    return check(
      "authority.delegation-attenuation",
      issues.length === 0,
      "Delegations attenuate scope, resources, time, and budget.",
      `Delegation attenuation failed at: ${issues.join(", ")}.`
    );
  },
  "authority.runtime-boundary": (bundle) => {
    const issues = authorityBoundaryIssues(bundle);
    return check(
      "authority.runtime-boundary",
      issues.length === 0,
      "Authority is issued outside model compute and untrusted context is never treated as authority.",
      `Authority boundary failed at: ${issues.join(", ")}.`
    );
  },
  "capability.side-effect-safety": (bundle) => {
    const issues = sideEffectIssues(bundle);
    return check(
      "capability.side-effect-safety",
      issues.length === 0,
      "Every side effect is prepared, idempotent, and followed by verification or compensation.",
      `Unsafe side-effect lifecycle found at: ${issues.join(", ")}.`
    );
  },
  "evidence.summary-only": (bundle) => {
    const known = evidenceIndex(bundle);
    const valid = bundle.decisions.every(
      (decision) =>
        decision.reasoningDisclosure === "summary-only" &&
        decision.evidenceRefs.every((reference) => known.has(reference))
    );
    return check(
      "evidence.summary-only",
      valid,
      "Decision records expose concise summaries and resolvable evidence references only.",
      "A decision record discloses an unsupported representation or missing evidence."
    );
  },
  "privacy.local-boundary": (bundle) => {
    const policy = bundle.manifest.policies;
    const valid =
      policy.defaultDataBoundary === "local" &&
      policy.allowedModelHosting.length === 1 &&
      policy.allowedModelHosting[0] === "local" &&
      bundle.execution.profile === "privacy";
    return check(
      "privacy.local-boundary",
      valid,
      "Data, compute, and execution profile are confined to the local boundary.",
      "The local-private profile requires local data, local model hosting, and the privacy execution profile."
    );
  },
  "authority.high-risk-approval": (bundle) => {
    const issues = highRiskApprovalIssues(bundle);
    return check(
      "authority.high-risk-approval",
      issues.length === 0,
      "Every high-risk commit is bound to external authority and a matching approval receipt.",
      `High-risk commit lacks valid authority or approval: ${issues.join(", ")}.`
    );
  },
  "policy.enterprise-controls": (bundle) => {
    const policy = bundle.manifest.policies;
    const valid =
      policy.authorityEnforcedOutsideModel &&
      policy.approvalRequiredForHighRisk &&
      policy.artifactAttestationRequired &&
      policy.receiptChainRequired &&
      policy.retentionDays >= 30;
    return check(
      "policy.enterprise-controls",
      valid,
      "Enterprise authority, approval, attestation, receipt, and retention controls are enabled.",
      "The manifest does not enable the complete enterprise control set."
    );
  },
  "policy.regulated-controls": (bundle) => {
    const policy = bundle.manifest.policies;
    const valid = policy.retentionDays >= 365 && bundle.execution.privacyPartition === "restricted";
    return check(
      "policy.regulated-controls",
      valid,
      "Regulated retention and restricted privacy partition controls are declared.",
      "The regulated profile requires at least 365 days retention and a restricted privacy partition."
    );
  },
  "runtime.distributed-attribution": (bundle) => {
    const valid =
      bundle.manifest.architecture.deploymentMode === "distributed" &&
      bundle.traceEvents.every((event) => typeof event.attributes.nodeId === "string");
    return check(
      "runtime.distributed-attribution",
      valid,
      "Every distributed runtime receipt is attributed to a node.",
      "Distributed conformance requires distributed deployment and node attribution on every receipt."
    );
  }
};

export function runConformance(
  bundle: RunBundle,
  profile: ConformanceProfile,
  options: ConformanceOptions = {}
): ConformanceReport {
  const configuration = options.configuration ?? loadProfileConfiguration();
  const selectedRules = resolveProfileRules(profile, configuration);
  const checks = selectedRules.map((ruleId) => {
    const rule = rules[ruleId];
    if (rule === undefined) {
      throw new Error(`Unknown conformance rule: ${ruleId}`);
    }
    return rule(bundle);
  });
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const unsigned: Omit<ConformanceReport, "digest"> = {
    contractType: "ConformanceReport",
    apiVersion: API_VERSION,
    reportId: `report-${profile}-${bundle.execution.runId}`,
    profile,
    status: checks.every((item) => item.status !== "fail") ? "pass" : "fail",
    manifestDigest: digestValue(bundle.manifest),
    runBundleDigest: digestValue(bundle),
    generatedAt,
    checks
  };
  return { ...unsigned, digest: digestValue(unsigned) };
}

export function reportIssues(report: ConformanceReport): ValidationIssue[] {
  return report.checks
    .filter((item) => item.status === "fail")
    .map((item) => ({ path: `/checks/${item.id}`, code: item.id, message: item.message }));
}
