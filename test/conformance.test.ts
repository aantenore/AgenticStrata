import { describe, expect, it } from "vitest";

import {
  API_VERSION,
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
