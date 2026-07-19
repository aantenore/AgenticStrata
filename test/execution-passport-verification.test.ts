import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createExecutionPassport,
  digestValue,
  runConformance,
  runDemo,
  verifyExecutionPassport
} from "../src/index.js";
import type {
  ExecutionEvidenceBinding,
  ExecutionPassport
} from "../src/index.js";

const GENERATED_AT = "2026-07-17T12:00:00.000Z";
const ISSUED_AT = "2026-07-17T12:00:01.000Z";

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const bundle = runDemo().bundle;
  const report = runConformance(bundle, "enterprise", { generatedAt: GENERATED_AT });
  const oasfRecord = { externalRecord: "validated-by-owner" };
  const executionEvidenceResource = new TextEncoder().encode(
    '{"kind":"opaque-placement-evidence","run":"run-change-demo-001"}\n'
  );
  const executionEvidence: ExecutionEvidenceBinding = {
    contractType: "ExecutionEvidenceBinding",
    role: "execution-placement",
    producer: "placement-provider",
    runIdDigest: digestValue(bundle.execution.runId),
    observedAt: "2026-07-17T11:59:59.000Z",
    authority: "observation-only",
    resource: {
      name: "execution-placement-evidence",
      digest: { sha256: digestBytes(executionEvidenceResource) },
      mediaType: "application/vnd.example.execution-placement+json"
    },
    disclosure: "content-free"
  };
  const passport = createExecutionPassport({
    bundle,
    report,
    oasfRecord,
    oasfMediaType: "application/json",
    executionEvidence: [executionEvidence],
    issuedAt: ISSUED_AT
  });
  return { bundle, report, oasfRecord, executionEvidenceResource, passport };
}

describe("Execution Passport consumer verification", () => {
  it("verifies all subjects, predicate bindings, and exact evidence bytes", () => {
    const input = fixture();

    expect(
      verifyExecutionPassport({
        ...input,
        executionEvidenceResources: [input.executionEvidenceResource]
      })
    ).toEqual({
      valid: true,
      issues: [],
      verifiedSubjects: 3,
      verifiedExecutionEvidenceResources: 1
    });
  });

  it("rejects a different subject even when the Passport remains schema-valid", () => {
    const input = fixture();
    const result = verifyExecutionPassport({
      ...input,
      oasfRecord: { externalRecord: "replaced" },
      executionEvidenceResources: [input.executionEvidenceResource]
    });

    expect(result.valid).toBe(false);
    expect(result.verifiedSubjects).toBe(2);
    expect(result.issues).toContainEqual({
      path: "/subject/2",
      code: "subject-binding",
      message: "The subject descriptor does not match the supplied artifact."
    });
  });

  it("rejects a predicate that overstates the supplied report", () => {
    const input = fixture();
    const passport: ExecutionPassport = {
      ...input.passport,
      predicate: { ...input.passport.predicate, conformanceStatus: "fail" }
    };
    const result = verifyExecutionPassport({
      ...input,
      passport,
      executionEvidenceResources: [input.executionEvidenceResource]
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "/predicate",
      code: "predicate-binding",
      message: "The Passport predicate does not match the supplied run and report."
    });
  });

  it("requires a one-to-one match for every referenced evidence resource", () => {
    const input = fixture();
    const missing = verifyExecutionPassport(input);
    expect(missing.valid).toBe(false);
    expect(missing.issues[0]?.code).toBe("resource-missing");

    const changedResource = new TextEncoder().encode("changed\n");
    const changed = verifyExecutionPassport({
      ...input,
      executionEvidenceResources: [changedResource]
    });
    expect(changed.issues.map((issue) => issue.code)).toEqual([
      "resource-missing",
      "resource-unreferenced"
    ]);

    const duplicate = verifyExecutionPassport({
      ...input,
      executionEvidenceResources: [
        input.executionEvidenceResource,
        input.executionEvidenceResource
      ]
    });
    expect(duplicate.issues[0]?.code).toBe("resource-duplicate");
  });

  it("rejects an internally inconsistent artifact set before trusting descriptors", () => {
    const input = fixture();
    const bundle = structuredClone(input.bundle);
    bundle.manifest.metadata.description = "A different supplied application manifest.";
    const result = verifyExecutionPassport({
      ...input,
      bundle,
      executionEvidenceResources: [input.executionEvidenceResource]
    });

    expect(result).toMatchObject({
      valid: false,
      verifiedSubjects: 0,
      verifiedExecutionEvidenceResources: 0,
      issues: [{ path: "/", code: "artifact-set" }]
    });
  });

  it("rejects a non-v2 or structurally extended Passport", () => {
    const input = fixture();
    const result = verifyExecutionPassport({
      ...input,
      passport: { ...input.passport, signatures: [] } as unknown as ExecutionPassport,
      executionEvidenceResources: [input.executionEvidenceResource]
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "additionalProperties")).toBe(true);
  });
});
