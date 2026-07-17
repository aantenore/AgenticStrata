import { describe, expect, it } from "vitest";

import {
  EXECUTION_PASSPORT_PREDICATE_TYPE,
  EXECUTION_PASSPORT_SUBJECTS,
  appendTraceEvent,
  createExecutionPassport,
  digestValue,
  omitDigest,
  runConformance,
  runDemo,
  seal,
  validateAs,
  validateDocument
} from "../src/index.js";
import type {
  ConformanceReport,
  ExecutionEvidenceBinding,
  RunBundle
} from "../src/index.js";

const GENERATED_AT = "2026-07-17T12:00:00.000Z";
const ISSUED_AT = "2026-07-17T12:00:01.000Z";
const OASF_MEDIA_TYPE = "application/json";

function reportFor(bundle: RunBundle): ConformanceReport {
  return runConformance(bundle, "enterprise", { generatedAt: GENERATED_AT });
}

function resealReport(
  report: ConformanceReport,
  patch: Partial<Omit<ConformanceReport, "digest">>
): ConformanceReport {
  return seal({ ...omitDigest(report), ...patch });
}

function contentFreeEvidence(): ExecutionEvidenceBinding {
  return {
    role: "execution-placement",
    producer: "placement-provider",
    resource: {
      name: "execution-placement-evidence",
      digest: { sha256: digestValue({ opaqueEvidenceFixture: true }) },
      mediaType: "application/vnd.example.execution-placement+json",
      uri: "https://example.test/evidence/execution-placement.json"
    },
    disclosure: "content-free"
  };
}

function create(
  bundle: RunBundle,
  report: ConformanceReport = reportFor(bundle),
  options: {
    oasfRecord?: unknown;
    executionEvidence?: ExecutionEvidenceBinding[];
  } = {}
) {
  return createExecutionPassport({
    bundle,
    report,
    oasfRecord: options.oasfRecord ?? { opaqueExternalRecord: true },
    oasfMediaType: OASF_MEDIA_TYPE,
    executionEvidence: options.executionEvidence ?? [],
    issuedAt: ISSUED_AT
  });
}

describe("Execution Passport", () => {
  it("emits one strict in-toto Statement with exactly three ordered subjects", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    const oasfRecord = { opaqueExternalRecord: true, owner: "external-validator" };
    const passport = create(bundle, report, { oasfRecord });

    expect(passport._type).toBe("https://in-toto.io/Statement/v1");
    expect(passport.predicateType).toBe(EXECUTION_PASSPORT_PREDICATE_TYPE);
    expect(passport.subject.map((subject) => subject.name)).toEqual([
      EXECUTION_PASSPORT_SUBJECTS.runBundle,
      EXECUTION_PASSPORT_SUBJECTS.conformanceReport,
      EXECUTION_PASSPORT_SUBJECTS.oasfRecord
    ]);
    expect(passport.subject).toHaveLength(3);
    expect(passport.subject[0].digest.sha256).toBe(digestValue(bundle));
    expect(passport.subject[1].digest.sha256).toBe(digestValue(report));
    expect(passport.subject[1].digest.sha256).not.toBe(report.digest);
    expect(passport.subject[2].digest.sha256).toBe(digestValue(oasfRecord));
    expect(validateAs("ExecutionPassport", passport)).toEqual({ valid: true, issues: [] });
    expect(validateDocument(passport)).toEqual({ valid: true, issues: [] });
  });

  it("treats OASF as opaque canonical JSON rather than claiming semantic validity", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    const first = create(bundle, report, {
      oasfRecord: { z: "external", a: { second: 2, first: 1 } }
    });
    const second = create(bundle, report, {
      oasfRecord: { a: { first: 1, second: 2 }, z: "external" }
    });

    expect(first).toEqual(second);
  });

  it("records conformance and run state without implying success", () => {
    const failedConformanceBundle = structuredClone(runDemo().bundle);
    failedConformanceBundle.manifest.policies.approvalRequiredForHighRisk = false;
    const failedConformanceReport = reportFor(failedConformanceBundle);
    const failedConformancePassport = create(
      failedConformanceBundle,
      failedConformanceReport
    );
    expect(failedConformancePassport.predicate.conformanceStatus).toBe("fail");
    expect(failedConformancePassport.predicate.runStatus).toBe("completed");

    const incompleteBundle = structuredClone(runDemo().bundle);
    incompleteBundle.traceEvents.pop();
    const incompletePassport = create(incompleteBundle);
    expect(incompletePassport.predicate.runStatus).toBe("incomplete");
    expect(incompletePassport.predicate.terminalReceiptDigest).toBeNull();

    const failedRunBundle = structuredClone(runDemo().bundle);
    const terminal = failedRunBundle.traceEvents.at(-1);
    const previous = failedRunBundle.traceEvents.at(-2);
    if (terminal === undefined || previous === undefined) throw new Error("demo receipts missing");
    failedRunBundle.traceEvents[failedRunBundle.traceEvents.length - 1] = appendTraceEvent(
      previous,
      {
        eventId: terminal.eventId,
        runId: terminal.runId,
        sequence: terminal.sequence,
        eventType: "run.failed",
        stratum: terminal.stratum,
        summary: "The run terminated with an explicit failure.",
        attributes: terminal.attributes,
        evidenceRefs: terminal.evidenceRefs,
        occurredAt: terminal.occurredAt
      }
    );
    const failedRunPassport = create(failedRunBundle);
    expect(failedRunPassport.predicate.runStatus).toBe("failed");
    expect(failedRunPassport.predicate.terminalReceiptDigest).toBe(
      failedRunBundle.traceEvents.at(-1)?.digest
    );
  });

  it("admits only strict content-free execution evidence bindings", () => {
    const bundle = runDemo().bundle;
    const evidence = contentFreeEvidence();
    const passport = create(bundle, reportFor(bundle), { executionEvidence: [evidence] });
    expect(passport.predicate.executionEvidence).toEqual([evidence]);
    expect(JSON.stringify(passport)).not.toContain("opaqueEvidenceFixture");

    const contentBearing = {
      ...evidence,
      resource: { ...evidence.resource, content: "sensitive-output" }
    } as unknown as ExecutionEvidenceBinding;
    expect(() =>
      create(bundle, reportFor(bundle), { executionEvidence: [contentBearing] })
    ).toThrow("Execution evidence binding 0 is invalid");
    expect(() =>
      create(bundle, reportFor(bundle), { executionEvidence: [evidence, evidence] })
    ).toThrow("is duplicated");
  });

  it("rejects local subject locations and non-canonical descriptor extensions", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    expect(() =>
      createExecutionPassport({
        bundle,
        report,
        oasfRecord: { opaqueExternalRecord: true },
        oasfMediaType: OASF_MEDIA_TYPE,
        subjectUris: { oasfRecord: "file:///tmp/oasf.json" },
        issuedAt: ISSUED_AT
      })
    ).toThrow("Execution Passport is invalid");

    const passport = create(bundle, report);
    expect(validateAs("ExecutionPassport", { ...passport, signatures: [] }).valid).toBe(false);
  });

  it("rejects tampered or mismatched report seals and bindings", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    const tampered = structuredClone(report);
    tampered.status = "fail";
    expect(() => create(bundle, tampered)).toThrow("ConformanceReport seal does not match");

    const mismatched = resealReport(report, { runBundleDigest: "0".repeat(64) });
    expect(() => create(bundle, mismatched)).toThrow("not bound to the supplied RunBundle");

    const invalidEvaluator = resealReport(report, {
      evaluator: { ...report.evaluator, digest: "0".repeat(64) }
    });
    expect(() => create(bundle, invalidEvaluator)).toThrow("evaluator seal does not match");
  });

  it("rejects a report whose stated run status differs from the receipt history", () => {
    const bundle = runDemo().bundle;
    const report = resealReport(reportFor(bundle), { runStatus: "failed" });
    expect(() => create(bundle, report)).toThrow("does not match completed");
  });

  it("rejects an invalid receipt chain even when a report is freshly bound to it", () => {
    const bundle = structuredClone(runDemo().bundle);
    const event = bundle.traceEvents[1];
    if (event === undefined) throw new Error("demo receipt missing");
    event.summary = "tampered";
    const report = reportFor(bundle);
    expect(() => create(bundle, report)).toThrow("receipt chain is invalid");
  });

  it("rejects inconsistent run identities and issuance before the report", () => {
    const bundle = structuredClone(runDemo().bundle);
    bundle.budgetUsage.runId = "different-run";
    expect(() => create(bundle, reportFor(bundle))).toThrow("inconsistent run identifiers");

    const validBundle = runDemo().bundle;
    expect(() =>
      createExecutionPassport({
        bundle: validBundle,
        report: reportFor(validBundle),
        oasfRecord: { opaqueExternalRecord: true },
        oasfMediaType: OASF_MEDIA_TYPE,
        issuedAt: "2026-07-17T11:59:59.000Z"
      })
    ).toThrow("cannot precede");
  });
});
