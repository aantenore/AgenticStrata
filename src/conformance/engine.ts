import {
  API_VERSION,
  EVALUATOR_NAME,
  EVALUATOR_REVISION,
  EVALUATOR_VERSION
} from "../contracts/types.js";
import type {
  ArtifactAttestation,
  AuthorityGrant,
  CapabilityContract,
  ConformanceCheck,
  ConformanceProfile,
  ConformanceReport,
  RunBundle,
  RuntimeArtifact,
  TraceEvent,
  ValidationIssue
} from "../contracts/types.js";
import { validateAs, validateCapabilitySchemas } from "../contracts/registry.js";
import {
  budgetIsAttenuated,
  validateChildGrant,
  validateDelegation
} from "../core/authority.js";
import { digestValue, verifySeal } from "../core/canonical.js";
import { validateCompositeFingerprint } from "../core/fingerprint.js";
import { evidenceIndex, verifyTraceChain } from "../core/receipts.js";
import {
  extendProfileConfiguration,
  loadProfileConfiguration,
  resolveProfileRules,
  type ProfileConfiguration
} from "./config.js";
import { lintManifest } from "./manifest.js";

export interface ConformanceOptions {
  configuration?: ProfileConfiguration;
  generatedAt?: string;
}

type Rule = (bundle: RunBundle, profile: ConformanceProfile) => ConformanceCheck;

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

const digestPattern = /^[a-f0-9]{64}$/u;

function isDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function authorityForCommit(
  bundle: RunBundle,
  capability: CapabilityContract,
  event: TraceEvent
): AuthorityGrant | undefined {
  const grantId = event.attributes.authorityGrantId;
  const actorId = event.attributes.actorId;
  const resource = event.attributes.resource;
  const occurredAt = Date.parse(event.occurredAt);
  if (
    typeof grantId !== "string" ||
    typeof actorId !== "string" ||
    typeof resource !== "string" ||
    !Number.isFinite(occurredAt)
  ) {
    return undefined;
  }
  const grant = bundle.authorityGrants.find((candidate) => candidate.grantId === grantId);
  if (grant === undefined) {
    return undefined;
  }
  const validFrom = Date.parse(grant.validFrom);
  const expiresAt = Date.parse(grant.expiresAt);
  const valid =
    actorId === grant.subject &&
    grant.resourcePatterns.includes(resource) &&
    capability.authorityScopes.every((scope) => grant.scopes.includes(scope)) &&
    Number.isFinite(validFrom) &&
    Number.isFinite(expiresAt) &&
    occurredAt >= validFrom &&
    occurredAt <= expiresAt &&
    event.evidenceRefs.includes(`urn:agentic-strata:authority:${grantId}`);
  return valid ? grant : undefined;
}

interface AttestedArtifact {
  attestation: ArtifactAttestation;
  artifact: RuntimeArtifact;
}

function resolveAttestedArtifact(
  bundle: RunBundle,
  reference: string
): AttestedArtifact | undefined {
  const prefix = "urn:agentic-strata:artifact:";
  if (!reference.startsWith(prefix)) {
    return undefined;
  }
  const attestation = bundle.attestations.find(
    (candidate) => candidate.attestationId === reference.slice(prefix.length)
  );
  if (attestation === undefined || !verifySeal(attestation)) {
    return undefined;
  }
  const artifact = bundle.artifacts.find(
    (candidate) => candidate.artifactRef === attestation.artifactRef
  );
  if (
    artifact === undefined ||
    artifact.digest !== attestation.artifactDigest ||
    digestValue(artifact.payload) !== artifact.digest
  ) {
    return undefined;
  }
  return { attestation, artifact };
}

function evidenceBindsAction(
  bundle: RunBundle,
  reference: string,
  capabilityId: string,
  actionDigest: string,
  evidenceRole: NonNullable<ArtifactAttestation["evidenceRole"]>
): boolean {
  const resolved = resolveAttestedArtifact(bundle, reference);
  return (
    resolved !== undefined &&
    resolved.attestation.capabilityId === capabilityId &&
    resolved.attestation.subjectDigest === actionDigest &&
    resolved.attestation.evidenceRole === evidenceRole
  );
}

function lifecycleEvidenceBindsAction(
  bundle: RunBundle,
  reference: string,
  capabilityId: string,
  actionDigest: string,
  evidenceRole: NonNullable<ArtifactAttestation["evidenceRole"]>,
  event: TraceEvent
): boolean {
  if (!evidenceBindsAction(bundle, reference, capabilityId, actionDigest, evidenceRole)) {
    return false;
  }
  const resolved = resolveAttestedArtifact(bundle, reference);
  if (resolved === undefined) {
    return false;
  }
  const evidenceAt = Date.parse(resolved.attestation.createdAt);
  const eventAt = Date.parse(event.occurredAt);
  if (!Number.isFinite(evidenceAt) || !Number.isFinite(eventAt) || evidenceAt > eventAt) {
    return false;
  }
  if (evidenceRole === "prepared-action") {
    return true;
  }

  const precedingCommits = bundle.traceEvents.filter(
    (candidate) =>
      candidate.eventType === "capability.committed" &&
      candidate.sequence < event.sequence &&
      candidate.attributes.capabilityId === capabilityId &&
      candidate.attributes.actionDigest === actionDigest
  );
  if (precedingCommits.length !== 1) {
    return false;
  }
  const commit = precedingCommits[0];
  if (commit === undefined) {
    return false;
  }
  const commitAt = Date.parse(commit.occurredAt);
  return (
    Number.isFinite(commitAt) &&
    evidenceAt >= commitAt &&
    resolved.attestation.provenanceRefs.includes(
      `urn:agentic-strata:event:${commit.eventId}`
    )
  );
}

function criterionRequirementSatisfied(
  bundle: RunBundle,
  reference: string,
  requirement: RunBundle["outcome"]["acceptanceCriteria"][number]["evidenceRequirements"][number],
  resultObservedAt: string
): boolean {
  const resultAt = Date.parse(resultObservedAt);
  if (!Number.isFinite(resultAt)) {
    return false;
  }
  return bundle.traceEvents.some((event) => {
    const expectedEventType =
      requirement.evidenceRole === "observed-result"
        ? "capability.verified"
        : "capability.compensated";
    return (
      event.eventType === expectedEventType &&
      event.attributes.capabilityId === requirement.capabilityId &&
      event.attributes.actionDigest === requirement.subjectDigest &&
      event.evidenceRefs.includes(reference) &&
      Date.parse(event.occurredAt) <= resultAt &&
      lifecycleEvidenceBindsAction(
        bundle,
        reference,
        requirement.capabilityId,
        requirement.subjectDigest,
        requirement.evidenceRole,
        event
      )
    );
  });
}

function referenceSealIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  const sealed = [
    bundle.outcome,
    bundle.budgetUsage,
    ...bundle.runtimeBoundaries,
    ...bundle.criterionResults,
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
  for (const result of bundle.criterionResults) {
    if (
      result.runId !== bundle.execution.runId ||
      result.outcomeId !== bundle.outcome.outcomeId
    ) {
      issues.push(`criterion:${result.resultId}:run-outcome`);
    }
  }
  for (const boundary of bundle.runtimeBoundaries) {
    if (boundary.runId !== bundle.execution.runId) {
      issues.push(`boundary:${boundary.boundaryEvidenceId}:run`);
    }
    const observationStartedAt = Date.parse(boundary.observationStartedAt);
    const observedAt = Date.parse(boundary.observedAt);
    if (
      !Number.isFinite(observationStartedAt) ||
      !Number.isFinite(observedAt) ||
      observationStartedAt > observedAt
    ) {
      issues.push(`boundary:${boundary.boundaryEvidenceId}:observation-window`);
    }
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
    ["boundary", bundle.runtimeBoundaries.map((item) => item.boundaryEvidenceId)],
    ["criterion-result", bundle.criterionResults.map((item) => item.resultId)],
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

function grantLineageIssues(bundle: RunBundle): string[] {
  const issues = new Set<string>();
  const grants = new Map(bundle.authorityGrants.map((grant) => [grant.grantId, grant]));
  let roots = 0;

  for (const grant of bundle.authorityGrants) {
    const validFrom = Date.parse(grant.validFrom);
    const expiresAt = Date.parse(grant.expiresAt);
    if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt) || expiresAt <= validFrom) {
      issues.add(`${grant.grantId}:invalid-window`);
    }
    if (grant.parentGrantId === undefined) {
      roots += 1;
      if (grant.issuer.type === "service-policy") {
        issues.add(`${grant.grantId}:untrusted-root`);
      }
      continue;
    }
    const parent = grants.get(grant.parentGrantId);
    if (parent === undefined || !validateChildGrant(grant, parent).valid) {
      issues.add(`${grant.grantId}:invalid-parent`);
    }
  }

  for (const approval of bundle.approvals) {
    const issuedAt = Date.parse(approval.issuedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      issues.add(`${approval.approvalId}:invalid-window`);
    }
  }

  if (bundle.authorityGrants.length > 0 && roots === 0) {
    issues.add("authority:no-trust-root");
  }

  for (const grant of bundle.authorityGrants) {
    const visited = new Set<string>();
    let cursor: AuthorityGrant | undefined = grant;
    let depth = 0;
    while (cursor?.parentGrantId !== undefined) {
      if (visited.has(cursor.grantId) || depth >= bundle.authorityGrants.length) {
        issues.add(`${grant.grantId}:cycle`);
        break;
      }
      visited.add(cursor.grantId);
      cursor = grants.get(cursor.parentGrantId);
      depth += 1;
      if (cursor === undefined) {
        issues.add(`${grant.grantId}:missing-root`);
        break;
      }
    }
    if (cursor !== undefined && cursor.parentGrantId === undefined && cursor.issuer.type === "service-policy") {
      issues.add(`${grant.grantId}:untrusted-root`);
    }
  }
  return [...issues];
}

interface EvidenceNode {
  reference: string;
  timestamp: number;
  dependencies: string[];
}

function evidenceCausalityIssues(bundle: RunBundle): string[] {
  const nodes: EvidenceNode[] = [
    ...bundle.authorityGrants.map((grant) => ({
      reference: `urn:agentic-strata:authority:${grant.grantId}`,
      timestamp: Date.parse(grant.validFrom),
      dependencies: []
    })),
    ...bundle.approvals.map((approval) => ({
      reference: `urn:agentic-strata:approval:${approval.approvalId}`,
      timestamp: Date.parse(approval.issuedAt),
      dependencies: [`urn:agentic-strata:authority:${approval.authorityGrantId}`]
    })),
    ...bundle.runtimeBoundaries.map((boundary) => ({
      reference: `urn:agentic-strata:boundary:${boundary.boundaryEvidenceId}`,
      timestamp: Date.parse(boundary.observedAt),
      dependencies: []
    })),
    ...bundle.criterionResults.map((result) => ({
      reference: `urn:agentic-strata:criterion:${result.resultId}`,
      timestamp: Date.parse(result.observedAt),
      dependencies: result.evidenceRefs
    })),
    ...bundle.decisions.map((decision) => ({
      reference: `urn:agentic-strata:decision:${decision.decisionId}`,
      timestamp: Date.parse(decision.createdAt),
      dependencies: decision.evidenceRefs
    })),
    ...bundle.attestations.map((attestation) => ({
      reference: `urn:agentic-strata:artifact:${attestation.attestationId}`,
      timestamp: Date.parse(attestation.createdAt),
      dependencies: attestation.provenanceRefs
    })),
    ...bundle.traceEvents.map((event) => ({
      reference: `urn:agentic-strata:event:${event.eventId}`,
      timestamp: Date.parse(event.occurredAt),
      dependencies: event.evidenceRefs
    }))
  ];
  const byReference = new Map(nodes.map((node) => [node.reference, node]));
  const issues = new Set<string>();

  for (const node of nodes) {
    if (!Number.isFinite(node.timestamp)) {
      issues.add(`${node.reference}:invalid-time`);
    }
    for (const dependency of node.dependencies) {
      const evidence = byReference.get(dependency);
      if (evidence === undefined) {
        issues.add(`${node.reference}:missing:${dependency}`);
      } else if (
        Number.isFinite(node.timestamp) &&
        Number.isFinite(evidence.timestamp) &&
        evidence.timestamp > node.timestamp
      ) {
        issues.add(`${node.reference}:future:${dependency}`);
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const visit = (reference: string): void => {
    const current = state.get(reference);
    if (current === "visiting") {
      issues.add(`${reference}:cycle`);
      return;
    }
    if (current === "visited") {
      return;
    }
    state.set(reference, "visiting");
    for (const dependency of byReference.get(reference)?.dependencies ?? []) {
      if (byReference.has(dependency)) {
        visit(dependency);
      }
    }
    state.set(reference, "visited");
  };
  for (const reference of byReference.keys()) {
    visit(reference);
  }
  return [...issues];
}

function terminalReceiptIssues(bundle: RunBundle): string[] {
  const terminalEvents = bundle.traceEvents.filter((event) =>
    event.eventType === "run.completed" || event.eventType === "run.failed"
  );
  if (terminalEvents.length !== 1) {
    return [`terminal-count:${terminalEvents.length}`];
  }
  return terminalEvents[0] === bundle.traceEvents.at(-1) ? [] : ["terminal-not-last"];
}

function runStatus(bundle: RunBundle): "completed" | "failed" | "incomplete" {
  if (terminalReceiptIssues(bundle).length > 0) {
    return "incomplete";
  }
  return bundle.traceEvents.at(-1)?.eventType === "run.completed" ? "completed" : "failed";
}

function outcomeEvidenceIssues(bundle: RunBundle): string[] {
  const issues: string[] = [];
  const known = evidenceIndex(bundle);
  const terminal = bundle.traceEvents.at(-1);
  const terminalStatus = runStatus(bundle);
  const declaredCriterionIds = bundle.outcome.acceptanceCriteria.map((criterion) => criterion.id);
  const criterionIds = new Set(declaredCriterionIds);
  if (criterionIds.size !== declaredCriterionIds.length) {
    issues.push("outcome:duplicate-criterion-id");
  }

  for (const result of bundle.criterionResults) {
    if (!criterionIds.has(result.criterionId)) {
      issues.push(`${result.resultId}:unknown-criterion`);
    }
    if (
      result.evidenceRefs.some((reference) => !known.has(reference)) ||
      !verifySeal(result)
    ) {
      issues.push(`${result.resultId}:invalid-evidence`);
    }
    if (!terminal?.evidenceRefs.includes(`urn:agentic-strata:criterion:${result.resultId}`)) {
      issues.push(`${result.resultId}:not-terminally-bound`);
    }
  }

  for (const criterion of bundle.outcome.acceptanceCriteria) {
    const matches = bundle.criterionResults.filter(
      (result) => result.criterionId === criterion.id
    );
    if (matches.length !== 1) {
      issues.push(`${criterion.id}:result-count-${matches.length}`);
      continue;
    }
    const result = matches[0];
    if (result === undefined) {
      continue;
    }
    if (
      criterion.evidenceRequired &&
      (criterion.evidenceRequirements.length === 0 ||
        criterion.evidenceRequirements.some(
          (requirement) =>
            !result.evidenceRefs.some((reference) =>
              criterionRequirementSatisfied(
                bundle,
                reference,
                requirement,
                result.observedAt
              )
            )
        ))
    ) {
      issues.push(`${criterion.id}:unsatisfied-evidence-requirement`);
    }
    if (terminalStatus === "completed" && result.status !== "passed") {
      issues.push(`${criterion.id}:completed-without-pass`);
    }
  }

  if (
    terminalStatus === "failed" &&
    bundle.criterionResults.length > 0 &&
    bundle.criterionResults.every((result) => result.status === "passed")
  ) {
    issues.push("failed-run-with-all-criteria-passed");
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
    const approval =
      typeof approvalId === "string"
        ? bundle.approvals.find((candidate) => candidate.approvalId === approvalId)
        : undefined;
    const occurredAt = Date.parse(event.occurredAt);
    const grantValid = authorityForCommit(bundle, capability, event) !== undefined;
    const approvalValid =
      approval !== undefined &&
      isDigest(actionDigest) &&
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

  for (const event of bundle.traceEvents.filter((candidate) =>
    ["capability.prepared", "capability.verified", "capability.compensated"].includes(
      candidate.eventType
    )
  )) {
    const capability = capabilityFor(bundle, event);
    const actionDigest = event.attributes.actionDigest;
    if (capability === undefined) {
      issues.push(`${event.eventId}:unknown-capability`);
      continue;
    }
    if (!effectful.includes(capability)) {
      if (event.eventType === "capability.compensated") {
        issues.push(`${event.eventId}:compensation-on-non-effectful-capability`);
      }
      continue;
    }
    if (
      event.eventType === "capability.compensated" &&
      !capability.operations.includes("compensate")
    ) {
      issues.push(`${event.eventId}:undeclared-compensation-operation`);
      continue;
    }
    if (!isDigest(actionDigest)) {
      issues.push(`${event.eventId}:invalid-action-binding`);
      continue;
    }

    if (event.eventType === "capability.prepared") {
      if (
        !event.evidenceRefs.some((reference) =>
          lifecycleEvidenceBindsAction(
            bundle,
            reference,
            capability.capabilityId,
            actionDigest,
            "prepared-action",
            event
          )
        )
      ) {
        issues.push(`${event.eventId}:invalid-prepare-evidence`);
      }
      continue;
    }

    const expectedRole =
      event.eventType === "capability.verified"
        ? "observed-result"
        : "compensation-result";
    const evidenceValid = event.evidenceRefs.some((reference) =>
      lifecycleEvidenceBindsAction(
        bundle,
        reference,
        capability.capabilityId,
        actionDigest,
        expectedRole,
        event
      )
    );
    const authorityValid =
      event.eventType !== "capability.compensated" ||
      authorityForCommit(bundle, capability, event) !== undefined;
    if (!evidenceValid || !authorityValid) {
      issues.push(`${event.eventId}:orphan-or-unproven-terminal`);
    }
  }

  const committedKeys = new Set<string>();
  const committedActions = new Set<string>();
  for (const commit of bundle.traceEvents.filter((event) => event.eventType === "capability.committed")) {
    const capability = capabilityFor(bundle, commit);
    if (capability === undefined) {
      continue;
    }
    if (!effectful.includes(capability)) {
      issues.push(`${commit.eventId}:commit-on-non-effectful-capability`);
      continue;
    }
    const actionDigest = commit.attributes.actionDigest;
    const idempotencyKey = commit.attributes.idempotencyKey;
    const bindingValid =
      isDigest(actionDigest) &&
      typeof idempotencyKey === "string" &&
      idempotencyKey.length > 0;
    const preparedEvents = bindingValid
      ? bundle.traceEvents.filter(
          (event) =>
            event.eventType === "capability.prepared" &&
            event.sequence < commit.sequence &&
            event.attributes.capabilityId === capability.capabilityId &&
            event.attributes.actionDigest === actionDigest &&
            event.evidenceRefs.some((reference) =>
              lifecycleEvidenceBindsAction(
                bundle,
                reference,
                capability.capabilityId,
                actionDigest,
                "prepared-action",
                event
              )
            )
          )
      : [];
    const terminalEvents = bindingValid
      ? bundle.traceEvents.filter(
          (event) =>
            ((event.eventType === "capability.verified" &&
              event.attributes.verified === true) ||
              event.eventType === "capability.compensated") &&
            event.sequence > commit.sequence &&
            event.attributes.capabilityId === capability.capabilityId &&
            event.attributes.actionDigest === actionDigest &&
            event.evidenceRefs.some(
              (reference) =>
                reference.startsWith("urn:agentic-strata:artifact:") &&
                knownEvidence.has(reference) &&
                lifecycleEvidenceBindsAction(
                  bundle,
                  reference,
                  capability.capabilityId,
                  actionDigest,
                  event.eventType === "capability.verified"
                    ? "observed-result"
                    : "compensation-result",
                  event
                )
            )
          )
      : [];
    const prepared = preparedEvents.length === 1;
    const terminal = terminalEvents.length === 1;
    const authorized = authorityForCommit(bundle, capability, commit) !== undefined;
    if (!bindingValid || !prepared || !terminal || !authorized) {
      issues.push(`${commit.eventId}:runtime`);
      continue;
    }
    const keyBinding = `${capability.capabilityId}:${idempotencyKey}`;
    const actionBinding = `${capability.capabilityId}:${actionDigest}`;
    if (committedKeys.has(keyBinding)) {
      issues.push(`${commit.eventId}:duplicate-idempotency-key`);
    }
    if (committedActions.has(actionBinding)) {
      issues.push(`${commit.eventId}:duplicate-action`);
    }
    committedKeys.add(keyBinding);
    committedActions.add(actionBinding);
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
  const observedAt = Date.parse(usage.observedAt);
  const firstEventAt = Date.parse(bundle.traceEvents[0]?.occurredAt ?? "");
  const lastEventAt = Date.parse(bundle.traceEvents.at(-1)?.occurredAt ?? "");
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(firstEventAt) ||
    !Number.isFinite(lastEventAt) ||
    observedAt < firstEventAt ||
    observedAt > lastEventAt
  ) {
    issues.push("execution:usage-time");
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
  "outcome.acceptance-evidence": (bundle) => {
    const issues = outcomeEvidenceIssues(bundle);
    return check(
      "outcome.acceptance-evidence",
      issues.length === 0,
      "Every acceptance criterion has one terminally bound, evidence-backed result.",
      `Outcome evidence is missing, contradictory, or unbound at: ${issues.join(", ")}.`,
      bundle.criterionResults.map(
        (result) => `urn:agentic-strata:criterion:${result.resultId}`
      )
    );
  },
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
  "lineage.evidence-causality": (bundle) => {
    const issues = evidenceCausalityIssues(bundle);
    return check(
      "lineage.evidence-causality",
      issues.length === 0,
      "Every evidence reference resolves backward through one acyclic causal graph.",
      `Evidence is missing, cyclic, or from the future at: ${issues.join(", ")}.`
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
  "authority.grant-lineage": (bundle) => {
    const issues = grantLineageIssues(bundle);
    return check(
      "authority.grant-lineage",
      issues.length === 0,
      "Every authority grant reaches an acyclic human or identity-provider trust root.",
      `Authority grant lineage is cyclic, unrooted, or temporally invalid at: ${issues.join(", ")}.`
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
  "capability.schema-contracts": (bundle) => {
    const issues = bundle.capabilities.flatMap(
      (capability) => validateCapabilitySchemas(capability).issues
    );
    return check(
      "capability.schema-contracts",
      issues.length === 0,
      "Every capability input and output contract compiles as JSON Schema 2020-12.",
      `A capability schema is invalid or uses an unsupported dialect: ${issues
        .map((issue) => issue.path)
        .join(", ")}.`
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
  "runtime.terminal-receipt": (bundle) => {
    const issues = terminalReceiptIssues(bundle);
    return check(
      "runtime.terminal-receipt",
      issues.length === 0,
      `The run records one final ${runStatus(bundle)} terminal receipt.`,
      `The run terminal receipt is missing, duplicated, or not final: ${issues.join(", ")}.`
    );
  },
  "policy.profile-declared": (bundle, profile) =>
    check(
      "policy.profile-declared",
      bundle.manifest.conformanceProfiles.includes(profile),
      `The application manifest declares the selected ${profile} profile.`,
      `The application manifest does not declare the selected ${profile} profile.`
    ),
  "privacy.local-boundary": (bundle) => {
    const policy = bundle.manifest.policies;
    const terminal =
      terminalReceiptIssues(bundle).length === 0 ? bundle.traceEvents.at(-1) : undefined;
    const firstEvent = bundle.traceEvents[0];
    const firstEventAt = Date.parse(firstEvent?.occurredAt ?? "");
    const terminalAt = Date.parse(terminal?.occurredAt ?? "");
    const boundaryReferences = bundle.runtimeBoundaries.map(
      (boundary) => `urn:agentic-strata:boundary:${boundary.boundaryEvidenceId}`
    );
    const runtimeEvidenceValid =
      terminal !== undefined &&
      Number.isFinite(firstEventAt) &&
      Number.isFinite(terminalAt) &&
      bundle.runtimeBoundaries.length > 0 &&
      bundle.runtimeBoundaries.every(
        (boundary, index) =>
          boundary.runId === bundle.execution.runId &&
          boundary.modelHosting === "local" &&
          boundary.dataBoundary === "local" &&
          boundary.networkEgressObserved === false &&
          Date.parse(boundary.observationStartedAt) <= firstEventAt &&
          Date.parse(boundary.observedAt) >= terminalAt &&
          verifySeal(boundary) &&
          terminal.evidenceRefs.includes(boundaryReferences[index] ?? "")
      );
    const valid =
      policy.defaultDataBoundary === "local" &&
      policy.allowedModelHosting.length === 1 &&
      policy.allowedModelHosting[0] === "local" &&
      bundle.execution.profile === "privacy" &&
      runtimeEvidenceValid;
    return check(
      "privacy.local-boundary",
      valid,
      "Runtime evidence covers the full receipt window and attests local data, local model hosting, no observed egress, and the privacy execution profile.",
      "The local-private profile requires every sealed boundary observation to cover the full run and be linked by its terminal receipt.",
      boundaryReferences
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
  const baseline = loadProfileConfiguration();
  const configuration =
    options.configuration === undefined
      ? baseline
      : extendProfileConfiguration(baseline, options.configuration);
  const selectedRules = resolveProfileRules(profile, configuration);
  const checks = selectedRules.map((ruleId) => {
    const rule = rules[ruleId];
    if (rule === undefined) {
      throw new Error(`Unknown conformance rule: ${ruleId}`);
    }
    return rule(bundle, profile);
  });
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runBundleDigest = digestValue(bundle);
  const profileConfigurationDigest = digestValue(configuration);
  const rulesDigest = digestValue(selectedRules);
  const evaluatorUnsigned = {
    name: EVALUATOR_NAME,
    version: EVALUATOR_VERSION,
    revision: EVALUATOR_REVISION
  };
  const evaluator = { ...evaluatorUnsigned, digest: digestValue(evaluatorUnsigned) };
  const evaluationDigest = digestValue({
    profile,
    runBundleDigest,
    profileConfigurationDigest,
    rulesDigest,
    evaluatorDigest: evaluator.digest,
    generatedAt
  });
  const unsigned: Omit<ConformanceReport, "digest"> = {
    contractType: "ConformanceReport",
    apiVersion: API_VERSION,
    reportId: `report-${profile}-${evaluationDigest.slice(0, 24)}`,
    profile,
    status: checks.every((item) => item.status !== "fail") ? "pass" : "fail",
    runStatus: runStatus(bundle),
    evaluator,
    manifestDigest: digestValue(bundle.manifest),
    runBundleDigest,
    profileConfigurationDigest,
    rulesDigest,
    generatedAt,
    checks
  };
  const report: ConformanceReport = { ...unsigned, digest: digestValue(unsigned) };
  const validation = validateAs("ConformanceReport", report);
  if (!validation.valid) {
    throw new Error(
      `Generated conformance report is invalid: ${validation.issues
        .map((issue) => `${issue.path} ${issue.code}`)
        .join(", ")}`
    );
  }
  return report;
}

export function reportIssues(report: ConformanceReport): ValidationIssue[] {
  return report.checks
    .filter((item) => item.status === "fail")
    .map((item) => ({ path: `/checks/${item.id}`, code: item.id, message: item.message }));
}
