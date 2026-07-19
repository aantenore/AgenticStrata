import { describe, expect, it } from "vitest";

import {
  API_VERSION,
  EXECUTION_PASSPORT_PREDICATE_TYPE,
  EXECUTION_PASSPORT_SUBJECTS,
  EXECUTION_PASSPORT_V1_PREDICATE_TYPE,
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
  RunBundle,
  RuntimeBoundaryEvidence
} from "../src/index.js";

const GENERATED_AT = "2026-07-17T12:00:00.000Z";
const ISSUED_AT = "2026-07-17T12:00:01.000Z";
const OASF_MEDIA_TYPE = "application/json";
const LATE_OBSERVATION = "2026-07-17T13:00:00.000Z";
const INVALID_EXTERNAL_URIS = [
  "data:text/plain;base64,U0VDUkVU",
  "blob:https://example.test/opaque",
  "javascript:alert(1)",
  "file:///tmp/private.json",
  "filesystem:https://example.test/private.json",
  "c:/Users/antonio/private.json",
  "https://user:password@example.test/private.json",
  "https://example.test/private.json?token=secret",
  "https://example.test/private.json#secret",
  `urn:example:${"a".repeat(2048)}`
] as const;

function reportFor(bundle: RunBundle): ConformanceReport {
  return runConformance(bundle, "enterprise", { generatedAt: GENERATED_AT });
}

function resealReport(
  report: ConformanceReport,
  patch: Partial<Omit<ConformanceReport, "digest">>
): ConformanceReport {
  return seal({ ...omitDigest(report), ...patch });
}

function contentFreeEvidence(runId = "run-change-demo-001"): ExecutionEvidenceBinding {
  return {
    contractType: "ExecutionEvidenceBinding",
    role: "execution-placement",
    producer: "placement-provider",
    runIdDigest: digestValue(runId),
    observedAt: "2026-07-17T11:59:59.000Z",
    authority: "observation-only",
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

  it("retains read-only validation for archived v1 Passports", () => {
    const bundle = runDemo().bundle;
    const current = create(bundle, reportFor(bundle), {
      executionEvidence: [contentFreeEvidence()]
    });
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    legacy.predicateType = EXECUTION_PASSPORT_V1_PREDICATE_TYPE;
    const predicate = legacy.predicate as { executionEvidence: Record<string, unknown>[] };
    for (const binding of predicate.executionEvidence) {
      for (const field of ["contractType", "runIdDigest", "observedAt", "authority"]) {
        Reflect.deleteProperty(binding, field);
      }
    }

    expect(validateDocument(legacy)).toEqual({ valid: true, issues: [] });
    expect(validateAs("ExecutionPassport", legacy).valid).toBe(false);
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

    const unrelated = contentFreeEvidence("unrelated-run");
    expect(() =>
      create(bundle, reportFor(bundle), { executionEvidence: [unrelated] })
    ).toThrow("belongs to a different run");
  });

  it("rejects inline, credentialed, unstable, oversized, and local subject URIs", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    for (const uri of INVALID_EXTERNAL_URIS) {
      expect(() =>
        createExecutionPassport({
          bundle,
          report,
          oasfRecord: { opaqueExternalRecord: true },
          oasfMediaType: OASF_MEDIA_TYPE,
          subjectUris: { oasfRecord: uri },
          issuedAt: ISSUED_AT
        })
      ).toThrow("Execution Passport is invalid");
    }

    const stable = createExecutionPassport({
      bundle,
      report,
      oasfRecord: { opaqueExternalRecord: true },
      oasfMediaType: OASF_MEDIA_TYPE,
      subjectUris: {
        runBundle: "https://example.test/runs/bundle.json",
        oasfRecord: "urn:example:oasf:record-1"
      },
      issuedAt: ISSUED_AT
    });
    expect(stable.subject[0].uri).toBe("https://example.test/runs/bundle.json");
    expect(stable.subject[2].uri).toBe("urn:example:oasf:record-1");
  });

  it("rejects inline, credentialed, unstable, oversized, and local evidence URIs", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    const evidence = contentFreeEvidence();
    for (const uri of INVALID_EXTERNAL_URIS) {
      const invalid = {
        ...evidence,
        resource: { ...evidence.resource, uri }
      };
      expect(() => create(bundle, report, { executionEvidence: [invalid] })).toThrow(
        "Execution evidence binding 0 is invalid"
      );
    }
  });

  it("rejects non-canonical descriptor extensions", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);

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

  it("rejects a passing report that contains a failed check", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    const checks = structuredClone(report.checks);
    const first = checks[0];
    if (first === undefined) throw new Error("conformance checks missing");
    checks[0] = {
      ...first,
      status: "fail",
      severity: "error",
      message: "Deliberate failed check."
    };
    const inconsistent = resealReport(report, { status: "pass", checks });
    expect(() => create(bundle, inconsistent)).toThrow("status pass does not match fail");
  });

  it("binds the ordered unique check identifiers to the rules digest", () => {
    const bundle = runDemo().bundle;
    const report = reportFor(bundle);
    const first = report.checks[0];
    if (first === undefined) throw new Error("conformance checks missing");

    const duplicateChecks = [...report.checks, structuredClone(first)];
    const duplicate = resealReport(report, {
      checks: duplicateChecks,
      rulesDigest: digestValue(duplicateChecks.map((check) => check.id))
    });
    expect(() => create(bundle, duplicate)).toThrow("duplicate check identifiers");

    for (const checks of [report.checks.slice(1), [...report.checks].reverse()]) {
      const inconsistent = resealReport(report, { checks });
      expect(() => create(bundle, inconsistent)).toThrow(
        "rules digest does not match its ordered checks"
      );
    }
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

  it("requires report generation after every observed evidence timestamp", () => {
    const cases: Array<{
      label: string;
      mutate: (bundle: RunBundle) => void;
    }> = [
      {
        label: "trace event",
        mutate: (bundle) => {
          const terminal = bundle.traceEvents.at(-1);
          if (terminal === undefined) throw new Error("terminal receipt missing");
          bundle.traceEvents[bundle.traceEvents.length - 1] = seal({
            ...omitDigest(terminal),
            occurredAt: LATE_OBSERVATION
          });
        }
      },
      {
        label: "budget usage",
        mutate: (bundle) => {
          bundle.budgetUsage = seal({
            ...omitDigest(bundle.budgetUsage),
            observedAt: LATE_OBSERVATION
          });
        }
      },
      {
        label: "runtime boundary",
        mutate: (bundle) => {
          const boundary: Omit<RuntimeBoundaryEvidence, "digest"> = {
            contractType: "RuntimeBoundaryEvidence",
            apiVersion: API_VERSION,
            boundaryEvidenceId: "boundary-late-observation",
            runId: bundle.execution.runId,
            modelHosting: "managed",
            dataBoundary: "global",
            networkEgressObserved: true,
            endpointDigest: digestValue({ endpoint: "redacted" }),
            producer: "boundary-observer",
            observationStartedAt: GENERATED_AT,
            observedAt: LATE_OBSERVATION
          };
          bundle.runtimeBoundaries.push(seal(boundary));
        }
      },
      {
        label: "criterion result",
        mutate: (bundle) => {
          const criterion = bundle.criterionResults[0];
          if (criterion === undefined) throw new Error("criterion result missing");
          bundle.criterionResults[0] = seal({
            ...omitDigest(criterion),
            observedAt: LATE_OBSERVATION
          });
        }
      },
      {
        label: "decision",
        mutate: (bundle) => {
          const decision = bundle.decisions[0];
          if (decision === undefined) throw new Error("decision evidence missing");
          bundle.decisions[0] = seal({
            ...omitDigest(decision),
            createdAt: LATE_OBSERVATION
          });
        }
      },
      {
        label: "artifact attestation",
        mutate: (bundle) => {
          const attestation = bundle.attestations[0];
          if (attestation === undefined) throw new Error("artifact attestation missing");
          bundle.attestations[0] = seal({
            ...omitDigest(attestation),
            createdAt: LATE_OBSERVATION
          });
        }
      },
      {
        label: "approval",
        mutate: (bundle) => {
          const approval = bundle.approvals[0];
          if (approval === undefined) throw new Error("approval receipt missing");
          bundle.approvals[0] = seal({
            ...omitDigest(approval),
            issuedAt: LATE_OBSERVATION
          });
        }
      }
    ];

    for (const testCase of cases) {
      const bundle = structuredClone(runDemo().bundle);
      testCase.mutate(bundle);
      expect(() => create(bundle, reportFor(bundle)), testCase.label).toThrow(
        "The ConformanceReport cannot precede"
      );
    }
  });
});
