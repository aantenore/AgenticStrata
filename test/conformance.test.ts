import { describe, expect, it } from "vitest";

import {
  createCompositeFingerprint,
  digestValue,
  omitDigest,
  reportIssues,
  runConformance,
  seal
} from "../src/index.js";
import type { ConformanceProfile, RunBundle } from "../src/index.js";
import { runDemo } from "../src/demo/demo.js";

function bundle(): RunBundle {
  return structuredClone(runDemo().bundle);
}

function failedChecks(value: RunBundle, profile: ConformanceProfile = "enterprise"): string[] {
  return runConformance(value, profile, { generatedAt: "2026-07-17T12:01:00.000Z" }).checks
    .filter((item) => item.status === "fail")
    .map((item) => item.id);
}

describe("runtime conformance", () => {
  it("passes the enterprise demo using actual receipts and artifacts", () => {
    const report = runConformance(bundle(), "enterprise", {
      generatedAt: "2026-07-17T12:01:00.000Z"
    });
    expect(report.status).toBe("pass");
    expect(report.checks.every((item) => item.status === "pass")).toBe(true);
    expect(reportIssues(report)).toEqual([]);
  });

  it("detects observed budget consumption beyond the envelope", () => {
    const value = bundle();
    value.budgetUsage = seal({
      ...value.budgetUsage,
      steps: value.execution.budget.maxSteps + 1,
      digest: undefined
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
    local.execution.profile = "privacy";
    expect(runConformance(local, "local-private").status).toBe("pass");

    const distributed = bundle();
    distributed.manifest.architecture.deploymentMode = "distributed";
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
});
