import { describe, expect, it } from "vitest";

import {
  API_VERSION,
  EVALUATOR_NAME,
  EVALUATOR_REVISION,
  EVALUATOR_VERSION,
  appendTraceEvent,
  createCompositeFingerprint,
  digestValue,
  omitDigest,
  reportIssues,
  runConformance,
  seal,
  validateAs
} from "../src/index.js";
import type {
  ConformanceProfile,
  ProfileConfiguration,
  RunBundle,
  RuntimeBoundaryEvidence,
  TraceEvent
} from "../src/index.js";
import { runDemo } from "../src/demo/demo.js";

function bundle(): RunBundle {
  return structuredClone(runDemo().bundle);
}

function failedChecks(value: RunBundle, profile: ConformanceProfile = "enterprise"): string[] {
  return runConformance(value, profile, { generatedAt: "2026-07-17T12:01:00.000Z" }).checks
    .filter((item) => item.status === "fail")
    .map((item) => item.id);
}

function resealTrace(events: TraceEvent[]): TraceEvent[] {
  let previous: TraceEvent | undefined;
  return events.map((event) => {
    const draft = {
      eventId: event.eventId,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      stratum: event.stratum,
      summary: event.summary,
      attributes: event.attributes,
      evidenceRefs: event.evidenceRefs,
      occurredAt: event.occurredAt
    };
    const next = appendTraceEvent(previous, draft);
    previous = next;
    return next;
  });
}

describe("runtime conformance", () => {
  it("passes the enterprise demo using actual receipts and artifacts", () => {
    const report = runConformance(bundle(), "enterprise", {
      generatedAt: "2026-07-17T12:01:00.000Z"
    });
    expect(report.status).toBe("pass");
    expect(report.checks.every((item) => item.status === "pass")).toBe(true);
    expect(report.runStatus).toBe("completed");
    expect(report.evaluator).toEqual({
      name: EVALUATOR_NAME,
      version: EVALUATOR_VERSION,
      revision: EVALUATOR_REVISION,
      digest: digestValue({
        name: EVALUATOR_NAME,
        version: EVALUATOR_VERSION,
        revision: EVALUATOR_REVISION
      })
    });
    expect(validateAs("ConformanceReport", report).valid).toBe(true);
    expect(reportIssues(report)).toEqual([]);
  });

  it("detects observed budget consumption beyond the envelope", () => {
    const value = bundle();
    value.budgetUsage = seal({
      ...omitDigest(value.budgetUsage),
      steps: value.execution.budget.maxSteps + 1
    });
    expect(failedChecks(value)).toContain("authority.budget-monotonicity");
  });

  it("detects a high-risk commit with detached approval evidence", () => {
    const value = bundle();
    const index = value.traceEvents.findIndex((event) => event.eventType === "capability.committed");
    const event = value.traceEvents[index];
    if (event === undefined) throw new Error("demo commit event missing");
    value.traceEvents[index] = {
      ...event,
      evidenceRefs: event.evidenceRefs.filter((reference) => !reference.includes(":approval:"))
    };
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining(["lineage.receipt-chain", "authority.high-risk-approval"])
    );
  });

  it("requires attested terminal evidence after a side effect", () => {
    const value = bundle();
    const index = value.traceEvents.findIndex((event) => event.eventType === "capability.verified");
    const event = value.traceEvents[index];
    if (event === undefined) throw new Error("demo verification event missing");
    value.traceEvents[index] = { ...event, evidenceRefs: [] };
    expect(failedChecks(value)).toContain("capability.side-effect-safety");
  });

  it("rejects commit receipts emitted by a non-effectful capability", () => {
    const value = bundle();
    const capability = value.capabilities[0];
    if (capability === undefined) throw new Error("demo capability missing");
    value.capabilities[0] = seal({ ...omitDigest(capability), effectClass: "read" });
    expect(failedChecks(value)).toContain("capability.side-effect-safety");
  });

  it("rejects capability contracts that do not compile as JSON Schema 2020-12", () => {
    const value = bundle();
    const capability = value.capabilities[0];
    if (capability === undefined) throw new Error("demo capability missing");
    value.capabilities[0] = seal({
      ...omitDigest(capability),
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "not-a-json-schema-type"
      }
    });
    expect(failedChecks(value)).toContain("capability.schema-contracts");
  });

  it("rejects self-referential artifact provenance", () => {
    const value = bundle();
    const attestation = value.attestations[0];
    if (attestation === undefined) throw new Error("demo attestation missing");
    value.attestations[0] = seal({
      ...omitDigest(attestation),
      provenanceRefs: [`urn:agentic-strata:artifact:${attestation.attestationId}`]
    });
    expect(failedChecks(value)).toContain("lineage.runtime-artifacts");
  });

  it("detects duplicate lineage identifiers", () => {
    const value = bundle();
    const decision = value.decisions[0];
    if (decision === undefined) throw new Error("demo decision missing");
    value.decisions.push(structuredClone(decision));
    expect(failedChecks(value)).toContain("lineage.contract-bindings");
  });

  it("detects semantic cache partitions bound to a different runtime", () => {
    const value = bundle();
    value.intent.fingerprint = createCompositeFingerprint({
      canonicalIntent: value.intent.canonicalIntent,
      constraints: value.intent.constraints,
      authoritativeContextDigests: value.intent.context
        .filter((item) => item.trust === "authoritative")
        .map((item) => item.digest),
      outcomeDigest: value.outcome.digest,
      policyBundleDigest: digestValue("other-policy"),
      capabilitySetDigest: value.manifest.capabilitySetDigest,
      tenantPartitionDigest: value.execution.tenantPartitionDigest,
      privacyPartition: value.execution.privacyPartition
    });
    expect(failedChecks(value)).toContain("fingerprint.operational-bindings");
  });

  it("supports local-private and distributed profiles without changing the runtime", () => {
    const local = bundle();
    local.manifest.policies.defaultDataBoundary = "local";
    local.manifest.policies.allowedModelHosting = ["local"];
    local.manifest.conformanceProfiles.push("local-private");
    local.execution.profile = "privacy";
    const boundary: RuntimeBoundaryEvidence = seal({
      contractType: "RuntimeBoundaryEvidence",
      apiVersion: API_VERSION,
      boundaryEvidenceId: "boundary-local-001",
      runId: local.execution.runId,
      modelHosting: "local",
      dataBoundary: "local",
      networkEgressObserved: false,
      endpointDigest: digestValue("local-runtime-endpoint"),
      producer: "runtime-boundary-observer",
      observationStartedAt: "2026-07-17T12:00:00.000Z",
      observedAt: "2026-07-17T12:00:00.000Z"
    });
    local.runtimeBoundaries = [boundary];
    const terminal = local.traceEvents.at(-1);
    if (terminal === undefined) throw new Error("demo terminal missing");
    terminal.evidenceRefs.push(
      `urn:agentic-strata:boundary:${boundary.boundaryEvidenceId}`
    );
    local.traceEvents = resealTrace(local.traceEvents);
    expect(runConformance(local, "local-private").status).toBe("pass");

    const stale = structuredClone(local);
    const staleBoundary = stale.runtimeBoundaries[0];
    if (staleBoundary === undefined) throw new Error("local boundary missing");
    stale.runtimeBoundaries[0] = seal({
      ...omitDigest(staleBoundary),
      observationStartedAt: "2020-01-01T00:00:00.000Z",
      observedAt: "2020-01-01T00:00:01.000Z"
    });
    expect(failedChecks(stale, "local-private")).toContain("privacy.local-boundary");

    const earlyOnly = structuredClone(local);
    const boundaryReference = `urn:agentic-strata:boundary:${boundary.boundaryEvidenceId}`;
    const earlyEvent = earlyOnly.traceEvents[0];
    const earlyTerminal = earlyOnly.traceEvents.at(-1);
    if (earlyEvent === undefined || earlyTerminal === undefined) {
      throw new Error("local trace missing");
    }
    earlyTerminal.evidenceRefs = earlyTerminal.evidenceRefs.filter(
      (reference) => reference !== boundaryReference
    );
    earlyEvent.evidenceRefs.push(boundaryReference);
    earlyOnly.traceEvents = resealTrace(earlyOnly.traceEvents);
    expect(failedChecks(earlyOnly, "local-private")).toContain("privacy.local-boundary");

    const contradictoryBoundary: RuntimeBoundaryEvidence = seal({
      contractType: "RuntimeBoundaryEvidence",
      apiVersion: API_VERSION,
      boundaryEvidenceId: "boundary-managed-contradiction",
      runId: local.execution.runId,
      modelHosting: "managed",
      dataBoundary: "global",
      networkEgressObserved: true,
      endpointDigest: digestValue("managed-runtime-endpoint"),
      producer: "runtime-boundary-observer",
      observationStartedAt: "2026-07-17T12:00:00.000Z",
      observedAt: "2026-07-17T12:00:00.000Z"
    });
    local.runtimeBoundaries.push(contradictoryBoundary);
    const currentTerminal = local.traceEvents.at(-1);
    if (currentTerminal === undefined) throw new Error("demo terminal missing");
    currentTerminal.evidenceRefs.push(
      `urn:agentic-strata:boundary:${contradictoryBoundary.boundaryEvidenceId}`
    );
    local.traceEvents = resealTrace(local.traceEvents);
    expect(failedChecks(local, "local-private")).toContain("privacy.local-boundary");

    const distributed = bundle();
    distributed.manifest.architecture.deploymentMode = "distributed";
    distributed.manifest.conformanceProfiles.push("distributed");
    expect(runConformance(distributed, "distributed").status).toBe("pass");
  });

  it("fails regulated controls until restricted handling is bound", () => {
    expect(failedChecks(bundle(), "regulated")).toContain("policy.regulated-controls");
  });

  it("fails closed on an unknown configured conformance rule", () => {
    const value = bundle();
    expect(() =>
      runConformance(value, "core", {
        configuration: {
          apiVersion: "agenticstrata.dev/v1",
          profiles: {
            core: { extends: [], rules: ["unknown.rule"] },
            "local-private": { extends: ["core"], rules: [] },
            enterprise: { extends: ["core"], rules: [] },
            regulated: { extends: ["enterprise"], rules: [] },
            distributed: { extends: ["enterprise"], rules: [] }
          }
        }
      })
    ).toThrow("Unknown conformance rule");
  });

  it("keeps the packaged baseline when a custom profile removes every rule", () => {
    const value = bundle();
    value.traceEvents = [];
    const emptyProfiles: ProfileConfiguration = {
      apiVersion: "agenticstrata.dev/v1",
      profiles: {
        core: { extends: [], rules: [] },
        "local-private": { extends: [], rules: [] },
        enterprise: { extends: [], rules: [] },
        regulated: { extends: [], rules: [] },
        distributed: { extends: [], rules: [] }
      }
    };
    const report = runConformance(value, "enterprise", {
      configuration: emptyProfiles,
      generatedAt: "2026-07-17T12:01:00.000Z"
    });
    expect(report.status).toBe("fail");
    expect(report.checks.length).toBeGreaterThan(10);
    expect(report.checks.map((item) => item.id)).toContain("lineage.receipt-chain");
    expect(validateAs("ConformanceReport", report).valid).toBe(true);
  });

  it("rejects effectful commits without an action digest or authority", () => {
    const value = bundle();
    const capability = value.capabilities[0];
    if (capability === undefined) throw new Error("demo capability missing");
    value.capabilities[0] = seal({ ...omitDigest(capability), riskClass: "medium" });
    value.authorityGrants = [];
    for (const event of value.traceEvents.filter((candidate) =>
      candidate.eventType.startsWith("capability.")
    )) {
      Reflect.deleteProperty(event.attributes, "actionDigest");
    }
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining(["schema.bundle", "capability.side-effect-safety"])
    );
  });

  it("rejects an attestation that is not bound to the exact capability action", () => {
    const value = bundle();
    const result = value.attestations.find(
      (attestation) => attestation.attestationId === "attestation-result-001"
    );
    if (result === undefined) throw new Error("demo result attestation missing");
    Object.assign(result, seal({ ...omitDigest(result), subjectDigest: digestValue("other-action") }));
    expect(failedChecks(value)).toContain("capability.side-effect-safety");
  });

  it("does not reuse prepared-action evidence as post-effect verification", () => {
    const value = bundle();
    const preparedReference = "urn:agentic-strata:artifact:attestation-prepared-001";
    value.artifacts = value.artifacts.filter(
      (artifact) => artifact.artifactRef !== "artifact://change/result-001"
    );
    value.attestations = value.attestations.filter(
      (attestation) => attestation.attestationId !== "attestation-result-001"
    );
    for (const result of value.criterionResults) {
      Object.assign(
        result,
        seal({ ...omitDigest(result), evidenceRefs: [preparedReference] })
      );
    }
    const verification = value.traceEvents.find(
      (event) => event.eventType === "capability.verified"
    );
    const terminal = value.traceEvents.at(-1);
    if (verification === undefined || terminal === undefined) {
      throw new Error("demo verification or terminal missing");
    }
    verification.evidenceRefs = [preparedReference];
    terminal.evidenceRefs = terminal.evidenceRefs.filter(
      (reference) => !reference.includes("attestation-result-001")
    );
    value.traceEvents = resealTrace(value.traceEvents);
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining([
        "capability.side-effect-safety",
        "outcome.acceptance-evidence"
      ])
    );
  });

  it("rejects result evidence created before its exact commit", () => {
    const value = bundle();
    const result = value.attestations.find(
      (attestation) => attestation.attestationId === "attestation-result-001"
    );
    if (result === undefined) throw new Error("demo result attestation missing");
    Object.assign(
      result,
      seal({ ...omitDigest(result), createdAt: "2026-07-17T11:59:59.000Z" })
    );
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining([
        "lineage.evidence-causality",
        "capability.side-effect-safety",
        "outcome.acceptance-evidence"
      ])
    );
  });

  it("does not let evidence from another capability satisfy a criterion", () => {
    const value = bundle();
    const result = value.attestations.find(
      (attestation) => attestation.attestationId === "attestation-result-001"
    );
    if (result === undefined) throw new Error("demo result attestation missing");
    Object.assign(
      result,
      seal({
        ...omitDigest(result),
        capabilityId: "unrelated-capability"
      })
    );
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining([
        "capability.side-effect-safety",
        "outcome.acceptance-evidence"
      ])
    );
  });

  it("does not let evidence from another action satisfy a criterion", () => {
    const value = bundle();
    const result = value.attestations.find(
      (attestation) => attestation.attestationId === "attestation-result-001"
    );
    if (result === undefined) throw new Error("demo result attestation missing");
    Object.assign(
      result,
      seal({ ...omitDigest(result), subjectDigest: digestValue("unrelated-action") })
    );
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining([
        "capability.side-effect-safety",
        "outcome.acceptance-evidence"
      ])
    );
  });

  it("rejects compensation receipts when the capability does not declare compensate", () => {
    const value = bundle();
    const capability = value.capabilities[0];
    const attestation = value.attestations.find(
      (candidate) => candidate.attestationId === "attestation-result-001"
    );
    const terminal = value.traceEvents.find(
      (event) => event.eventType === "capability.verified"
    );
    if (capability === undefined || attestation === undefined || terminal === undefined) {
      throw new Error("demo lifecycle records missing");
    }
    value.capabilities[0] = seal({
      ...omitDigest(capability),
      riskClass: "medium",
      operations: capability.operations.filter((operation) => operation !== "compensate"),
      sideEffectPolicy: { ...capability.sideEffectPolicy, compensationRequired: false }
    });
    Object.assign(
      attestation,
      seal({ ...omitDigest(attestation), evidenceRole: "compensation-result" })
    );
    value.outcome = seal({
      ...omitDigest(value.outcome),
      acceptanceCriteria: value.outcome.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        evidenceRequirements: criterion.evidenceRequirements.map((requirement) => ({
          ...requirement,
          evidenceRole: "compensation-result" as const
        }))
      }))
    });
    terminal.eventType = "capability.compensated";
    terminal.attributes = {
      nodeId: "local-demo",
      capabilityId: capability.capabilityId,
      actionDigest: attestation.subjectDigest ?? "",
      authorityGrantId: value.authorityGrants[0]?.grantId ?? "",
      actorId: value.authorityGrants[0]?.subject ?? "",
      resource: "configuration://workspace/sample-feature"
    };
    value.traceEvents = resealTrace(value.traceEvents);
    expect(failedChecks(value)).toContain("capability.side-effect-safety");
  });

  it("rejects orphan compensation without a committed action and compensation evidence", () => {
    const value = bundle();
    const terminalIndex = value.traceEvents.findIndex((event) => event.eventType === "run.completed");
    const authority = value.authorityGrants[0];
    if (terminalIndex < 0 || authority === undefined) throw new Error("demo records missing");
    const orphan = appendTraceEvent(value.traceEvents[terminalIndex - 1], {
      eventId: "event-orphan-compensation",
      runId: value.execution.runId,
      sequence: terminalIndex,
      eventType: "capability.compensated",
      stratum: "capability",
      summary: "Compensation was claimed for an unknown action.",
      attributes: {
        nodeId: "local-demo",
        capabilityId: "generic-change",
        actionDigest: digestValue("unknown-action"),
        authorityGrantId: authority.grantId,
        actorId: authority.subject,
        resource: "configuration://workspace/sample-feature"
      },
      evidenceRefs: [],
      occurredAt: "2026-07-17T12:00:00.000Z"
    });
    value.traceEvents.splice(terminalIndex, 0, orphan);
    value.traceEvents = resealTrace(
      value.traceEvents.map((event, sequence) => ({ ...event, sequence }))
    );
    expect(failedChecks(value)).toContain("capability.side-effect-safety");
  });

  it("requires observed artifact evidence for a passed acceptance criterion", () => {
    const value = bundle();
    const authority = value.authorityGrants[0];
    if (authority === undefined) throw new Error("demo authority missing");
    const authorityReference = `urn:agentic-strata:authority:${authority.grantId}`;
    for (const result of value.criterionResults) {
      Object.assign(
        result,
        seal({ ...omitDigest(result), evidenceRefs: [authorityReference] })
      );
    }
    expect(failedChecks(value)).toContain("outcome.acceptance-evidence");
  });

  it("fails closed when an evidence-required criterion declares no exact requirement", () => {
    const value = bundle();
    value.outcome = seal({
      ...omitDigest(value.outcome),
      acceptanceCriteria: value.outcome.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        evidenceRequirements: []
      }))
    });
    expect(failedChecks(value)).toEqual(
      expect.arrayContaining(["schema.bundle", "outcome.acceptance-evidence"])
    );
  });

  it("requires bound artifact evidence for failed criteria as well", () => {
    const value = bundle();
    const authority = value.authorityGrants[0];
    const terminal = value.traceEvents.at(-1);
    if (authority === undefined || terminal === undefined) throw new Error("demo records missing");
    const authorityReference = `urn:agentic-strata:authority:${authority.grantId}`;
    value.criterionResults = value.criterionResults.map((result) =>
      seal({
        ...omitDigest(result),
        status: "failed" as const,
        summary: "The required outcome was not observed.",
        evidenceRefs: [authorityReference]
      })
    );
    terminal.eventType = "run.failed";
    terminal.summary = "The run failed without outcome evidence.";
    value.traceEvents = resealTrace(value.traceEvents);
    expect(failedChecks(value)).toContain("outcome.acceptance-evidence");
  });

  it("rejects duplicate acceptance criterion identifiers", () => {
    const value = bundle();
    const criterion = value.outcome.acceptanceCriteria[0];
    if (criterion === undefined) throw new Error("demo criterion missing");
    value.outcome = seal({
      ...omitDigest(value.outcome),
      acceptanceCriteria: [
        ...value.outcome.acceptanceCriteria,
        { ...criterion, assertion: "A different assertion reuses the same identifier." }
      ]
    });
    expect(failedChecks(value)).toContain("outcome.acceptance-evidence");
  });

  it("rejects duplicate commits for one action even with different idempotency keys", () => {
    const value = bundle();
    const commit = value.traceEvents.find(
      (event) => event.eventType === "capability.committed"
    );
    const terminalIndex = value.traceEvents.findIndex((event) => event.eventType === "run.completed");
    if (commit === undefined || terminalIndex < 0) throw new Error("demo events missing");
    const duplicate = structuredClone(commit);
    duplicate.eventId = "event-capability-committed-again";
    duplicate.attributes.idempotencyKey = "idempotency-change-002";
    value.traceEvents.splice(terminalIndex, 0, duplicate);
    value.traceEvents = resealTrace(
      value.traceEvents.map((event, sequence) => ({ ...event, sequence }))
    );
    expect(failedChecks(value)).toContain("capability.side-effect-safety");
  });

  it("rejects cyclic authority without a human or identity-provider root", () => {
    const value = bundle();
    const original = value.authorityGrants[0];
    if (original === undefined) throw new Error("demo authority missing");
    const first = seal({
      ...omitDigest(original),
      grantId: "grant-cycle-a",
      issuer: { type: "service-policy" as const, id: "agent-cycle-b" },
      subject: "agent-cycle-a",
      parentGrantId: "grant-cycle-b"
    });
    const second = seal({
      ...omitDigest(original),
      grantId: "grant-cycle-b",
      issuer: { type: "service-policy" as const, id: "agent-cycle-a" },
      subject: "agent-cycle-b",
      parentGrantId: "grant-cycle-a"
    });
    value.authorityGrants = [first, second];
    expect(failedChecks(value)).toContain("authority.grant-lineage");
  });

  it("rejects future and cyclic evidence across non-event records", () => {
    const value = bundle();
    const [first, second] = value.attestations;
    if (first === undefined || second === undefined) throw new Error("demo attestations missing");
    value.attestations[0] = seal({
      ...omitDigest(first),
      createdAt: "2030-01-01T00:00:00.000Z",
      provenanceRefs: [`urn:agentic-strata:artifact:${second.attestationId}`]
    });
    value.attestations[1] = seal({
      ...omitDigest(second),
      createdAt: "2030-01-01T00:00:00.000Z",
      provenanceRefs: [`urn:agentic-strata:artifact:${first.attestationId}`]
    });
    expect(failedChecks(value)).toContain("lineage.evidence-causality");
  });

  it("separates a failed run from structural conformance and outcome success", () => {
    const value = bundle();
    const terminal = value.traceEvents.at(-1);
    if (terminal === undefined) throw new Error("demo terminal missing");
    terminal.eventType = "run.failed";
    terminal.summary = "The run failed after verification.";
    const firstResult = value.criterionResults[0];
    if (firstResult === undefined) throw new Error("demo criterion result missing");
    value.criterionResults[0] = seal({
      ...omitDigest(firstResult),
      status: "failed",
      summary: "The requested value was not accepted."
    });
    value.traceEvents = resealTrace(value.traceEvents);
    const report = runConformance(value, "enterprise", {
      generatedAt: "2026-07-17T12:01:00.000Z"
    });
    expect(report.runStatus).toBe("failed");
    expect(report.status).toBe("pass");
  });
});
