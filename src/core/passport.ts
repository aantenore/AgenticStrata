import { validateAs } from "../contracts/registry.js";
import {
  API_VERSION,
  EXECUTION_PASSPORT_MEDIA_TYPES,
  EXECUTION_PASSPORT_PREDICATE_TYPE,
  EXECUTION_PASSPORT_SUBJECTS,
  IN_TOTO_STATEMENT_V1_TYPE,
  type ConformanceReport,
  type ConformanceReportResourceDescriptor,
  type ExecutionEvidenceBinding,
  type ExecutionPassport,
  type OasfRecordResourceDescriptor,
  type ResourceDescriptor,
  type RunBundle,
  type RunBundleResourceDescriptor,
  type ValidationResult
} from "../contracts/types.js";
import { digestValue, verifySeal } from "./canonical.js";
import { evidenceIndex, verifyTraceChain } from "./receipts.js";

export interface ExecutionPassportSubjectUris {
  runBundle?: string;
  conformanceReport?: string;
  oasfRecord?: string;
}

export interface CreateExecutionPassportInput {
  bundle: RunBundle;
  report: ConformanceReport;
  oasfRecord: unknown;
  oasfMediaType: string;
  subjectUris?: ExecutionPassportSubjectUris;
  executionEvidence?: readonly ExecutionEvidenceBinding[];
  issuedAt?: string;
}

function validationMessage(result: ValidationResult): string {
  return result.issues
    .map((issue) => `${issue.path} ${issue.code}: ${issue.message}`)
    .join(", ");
}

function requireValid(label: string, result: ValidationResult): void {
  if (!result.valid) {
    throw new Error(`${label} is invalid: ${validationMessage(result)}`);
  }
}

function copyResourceDescriptor(resource: ResourceDescriptor): ResourceDescriptor {
  requireValid(
    `Execution evidence resource ${resource.name}`,
    validateAs("ResourceDescriptor", resource)
  );
  return {
    name: resource.name,
    digest: { sha256: resource.digest.sha256 },
    mediaType: resource.mediaType,
    ...(resource.uri === undefined ? {} : { uri: resource.uri })
  };
}

function copyExecutionEvidence(
  bindings: readonly ExecutionEvidenceBinding[]
): ExecutionEvidenceBinding[] {
  const seenDigests = new Set<string>();
  return bindings.map((binding, index) => {
    requireValid(
      `Execution evidence binding ${index}`,
      validateAs("ExecutionEvidenceBinding", binding)
    );
    const digest = binding.resource.digest.sha256;
    if (seenDigests.has(digest)) {
      throw new Error(`Execution evidence digest ${digest} is duplicated.`);
    }
    seenDigests.add(digest);
    return {
      role: binding.role,
      producer: binding.producer,
      resource: copyResourceDescriptor(binding.resource),
      disclosure: binding.disclosure
    };
  });
}

function requireOpaqueJsonRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The external OASF record must be a JSON object.");
  }
}

function requireConsistentRunIdentity(bundle: RunBundle): string {
  const runId = bundle.execution.runId;
  const observedRunIds = [
    bundle.budgetUsage.runId,
    ...bundle.runtimeBoundaries.map((item) => item.runId),
    ...bundle.criterionResults.map((item) => item.runId),
    ...bundle.traceEvents.map((item) => item.runId)
  ];
  if (observedRunIds.some((candidate) => candidate !== runId)) {
    throw new Error("The RunBundle contains inconsistent run identifiers.");
  }
  return runId;
}

function terminalBinding(
  bundle: RunBundle,
  report: ConformanceReport
): string | null {
  const terminalEvents = bundle.traceEvents.filter(
    (event) => event.eventType === "run.completed" || event.eventType === "run.failed"
  );
  const terminal = bundle.traceEvents.at(-1);
  const hasOneFinalTerminal = terminalEvents.length === 1 && terminalEvents[0] === terminal;
  const expectedRunStatus = !hasOneFinalTerminal
    ? "incomplete"
    : terminal?.eventType === "run.completed"
      ? "completed"
      : "failed";
  if (report.runStatus !== expectedRunStatus) {
    throw new Error(
      `The ConformanceReport run status ${report.runStatus} does not match ${expectedRunStatus}.`
    );
  }
  return hasOneFinalTerminal ? (terminal?.digest ?? null) : null;
}

function requireBoundReport(bundle: RunBundle, report: ConformanceReport): void {
  requireValid("RunBundle", validateAs("RunBundle", bundle));
  requireValid("ConformanceReport", validateAs("ConformanceReport", report));

  if (!verifySeal(report)) {
    throw new Error("The ConformanceReport seal does not match its content.");
  }
  if (!verifySeal(report.evaluator)) {
    throw new Error("The ConformanceReport evaluator seal does not match its content.");
  }

  const checkIds = report.checks.map((check) => check.id);
  if (new Set(checkIds).size !== checkIds.length) {
    throw new Error("The ConformanceReport contains duplicate check identifiers.");
  }
  if (report.rulesDigest !== digestValue(checkIds)) {
    throw new Error("The ConformanceReport rules digest does not match its ordered checks.");
  }
  const expectedStatus = report.checks.some((check) => check.status === "fail")
    ? "fail"
    : "pass";
  if (report.status !== expectedStatus) {
    throw new Error(
      `The ConformanceReport status ${report.status} does not match ${expectedStatus}.`
    );
  }

  const bundleDigest = digestValue(bundle);
  if (report.runBundleDigest !== bundleDigest) {
    throw new Error("The ConformanceReport is not bound to the supplied RunBundle.");
  }
  if (report.manifestDigest !== digestValue(bundle.manifest)) {
    throw new Error("The ConformanceReport manifest binding does not match the RunBundle.");
  }

  const replay = verifyTraceChain(bundle.traceEvents, evidenceIndex(bundle));
  if (!replay.valid) {
    throw new Error(`The RunBundle receipt chain is invalid: ${validationMessage(replay)}`);
  }
}

interface ObservedTimestamp {
  label: string;
  value: string;
}

function observedTimestamps(bundle: RunBundle): ObservedTimestamp[] {
  return [
    { label: "budget usage", value: bundle.budgetUsage.observedAt },
    ...bundle.traceEvents.map((event) => ({
      label: `trace event ${event.eventId}`,
      value: event.occurredAt
    })),
    ...bundle.runtimeBoundaries.map((boundary) => ({
      label: `runtime boundary ${boundary.boundaryEvidenceId}`,
      value: boundary.observedAt
    })),
    ...bundle.criterionResults.map((criterion) => ({
      label: `criterion result ${criterion.resultId}`,
      value: criterion.observedAt
    })),
    ...bundle.decisions.map((decision) => ({
      label: `decision ${decision.decisionId}`,
      value: decision.createdAt
    })),
    ...bundle.attestations.map((attestation) => ({
      label: `artifact attestation ${attestation.attestationId}`,
      value: attestation.createdAt
    })),
    ...bundle.approvals.map((approval) => ({
      label: `approval ${approval.approvalId}`,
      value: approval.issuedAt
    }))
  ];
}

function requireReportAfterObservedEvidence(
  bundle: RunBundle,
  report: ConformanceReport
): void {
  const reportMillis = Date.parse(report.generatedAt);
  if (!Number.isFinite(reportMillis)) {
    throw new Error("ConformanceReport generatedAt must be a valid date-time.");
  }
  for (const observed of observedTimestamps(bundle)) {
    const observedMillis = Date.parse(observed.value);
    if (!Number.isFinite(observedMillis)) {
      throw new Error(`${observed.label} must have a valid observed date-time.`);
    }
    if (reportMillis < observedMillis) {
      throw new Error(`The ConformanceReport cannot precede ${observed.label}.`);
    }
  }
}

function requireIssuedAt(issuedAt: string, report: ConformanceReport): void {
  const issuedAtMillis = Date.parse(issuedAt);
  const reportMillis = Date.parse(report.generatedAt);
  if (!Number.isFinite(issuedAtMillis)) {
    throw new Error("Execution Passport issuedAt must be a valid date-time.");
  }
  if (issuedAtMillis < reportMillis) {
    throw new Error("Execution Passport issuedAt cannot precede the ConformanceReport.");
  }
}

export function createExecutionPassport(
  input: CreateExecutionPassportInput
): ExecutionPassport {
  requireBoundReport(input.bundle, input.report);
  requireReportAfterObservedEvidence(input.bundle, input.report);
  requireOpaqueJsonRecord(input.oasfRecord);

  const runId = requireConsistentRunIdentity(input.bundle);
  const terminalReceiptDigest = terminalBinding(input.bundle, input.report);
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  requireIssuedAt(issuedAt, input.report);

  const runBundleSubject: RunBundleResourceDescriptor = {
    name: EXECUTION_PASSPORT_SUBJECTS.runBundle,
    digest: { sha256: digestValue(input.bundle) },
    mediaType: EXECUTION_PASSPORT_MEDIA_TYPES.runBundle,
    ...(input.subjectUris?.runBundle === undefined
      ? {}
      : { uri: input.subjectUris.runBundle })
  };
  const conformanceReportSubject: ConformanceReportResourceDescriptor = {
    name: EXECUTION_PASSPORT_SUBJECTS.conformanceReport,
    digest: { sha256: digestValue(input.report) },
    mediaType: EXECUTION_PASSPORT_MEDIA_TYPES.conformanceReport,
    ...(input.subjectUris?.conformanceReport === undefined
      ? {}
      : { uri: input.subjectUris.conformanceReport })
  };
  const oasfRecordSubject: OasfRecordResourceDescriptor = {
    name: EXECUTION_PASSPORT_SUBJECTS.oasfRecord,
    digest: { sha256: digestValue(input.oasfRecord) },
    mediaType: input.oasfMediaType,
    ...(input.subjectUris?.oasfRecord === undefined
      ? {}
      : { uri: input.subjectUris.oasfRecord })
  };

  const passport: ExecutionPassport = {
    _type: IN_TOTO_STATEMENT_V1_TYPE,
    subject: [runBundleSubject, conformanceReportSubject, oasfRecordSubject],
    predicateType: EXECUTION_PASSPORT_PREDICATE_TYPE,
    predicate: {
      apiVersion: API_VERSION,
      kind: "ExecutionPassport",
      runId,
      profile: input.report.profile,
      runStatus: input.report.runStatus,
      conformanceStatus: input.report.status,
      evaluatorDigest: input.report.evaluator.digest,
      terminalReceiptDigest,
      issuedAt,
      executionEvidence: copyExecutionEvidence(input.executionEvidence ?? [])
    }
  };

  requireValid("Execution Passport", validateAs("ExecutionPassport", passport));
  return passport;
}
