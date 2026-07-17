import { API_VERSION } from "../contracts/types.js";
import type {
  ArtifactAttestation,
  ApprovalReceipt,
  AuthorityGrant,
  DecisionEvidence,
  Digest,
  RunBundle,
  TraceEvent,
  ValidationIssue,
  ValidationResult
} from "../contracts/types.js";
import { digestValue, omitDigest } from "./canonical.js";

export type TraceEventDraft = Omit<TraceEvent, "contractType" | "apiVersion" | "previousDigest" | "digest">;

export function appendTraceEvent(previous: TraceEvent | undefined, draft: TraceEventDraft): TraceEvent {
  const unsigned: Omit<TraceEvent, "digest"> = {
    contractType: "TraceEvent",
    apiVersion: API_VERSION,
    ...draft,
    previousDigest: previous?.digest ?? null
  };
  return { ...unsigned, digest: digestValue(unsigned) };
}

function authorityRef(grant: AuthorityGrant): string {
  return `urn:agentic-strata:authority:${grant.grantId}`;
}

function approvalRef(receipt: ApprovalReceipt): string {
  return `urn:agentic-strata:approval:${receipt.approvalId}`;
}

function decisionRef(decision: DecisionEvidence): string {
  return `urn:agentic-strata:decision:${decision.decisionId}`;
}

function artifactRef(attestation: ArtifactAttestation): string {
  return `urn:agentic-strata:artifact:${attestation.attestationId}`;
}

export function evidenceIndex(bundle: RunBundle): Set<string> {
  return new Set([
    ...bundle.authorityGrants.map(authorityRef),
    ...bundle.approvals.map(approvalRef),
    ...bundle.decisions.map(decisionRef),
    ...bundle.attestations.map(artifactRef),
    ...bundle.traceEvents.map((event) => `urn:agentic-strata:event:${event.eventId}`)
  ]);
}

export interface ReplayReport extends ValidationResult {
  eventsReplayed: number;
  finalDigest: Digest | null;
}

export function verifyTraceChain(events: TraceEvent[], knownEvidence?: Set<string>): ReplayReport {
  const issues: ValidationIssue[] = [];
  let previous: TraceEvent | undefined;
  let runId: string | undefined;
  const eventSequenceByReference = new Map(
    events.map((event) => [
      `urn:agentic-strata:event:${event.eventId}`,
      event.sequence
    ])
  );

  for (const [index, event] of events.entries()) {
    if (event.sequence !== index) {
      issues.push({
        path: `/traceEvents/${index}/sequence`,
        code: "sequence",
        message: `Expected sequence ${index}, received ${event.sequence}.`
      });
    }
    if (runId === undefined) {
      runId = event.runId;
    } else if (event.runId !== runId) {
      issues.push({
        path: `/traceEvents/${index}/runId`,
        code: "run-id",
        message: "Every receipt in a chain must bind the same run."
      });
    }
    const expectedPrevious = previous?.digest ?? null;
    if (event.previousDigest !== expectedPrevious) {
      issues.push({
        path: `/traceEvents/${index}/previousDigest`,
        code: "chain-link",
        message: "Receipt does not link to the preceding digest."
      });
    }
    if (digestValue(omitDigest(event)) !== event.digest) {
      issues.push({
        path: `/traceEvents/${index}/digest`,
        code: "tamper-detected",
        message: "Receipt content does not match its digest."
      });
    }
    if (knownEvidence !== undefined) {
      for (const reference of event.evidenceRefs) {
        if (!knownEvidence.has(reference)) {
          issues.push({
            path: `/traceEvents/${index}/evidenceRefs`,
            code: "missing-evidence",
            message: `Evidence reference is not present in the runtime bundle: ${reference}`
          });
        } else {
          const referencedSequence = eventSequenceByReference.get(reference);
          if (referencedSequence !== undefined && referencedSequence >= event.sequence) {
            issues.push({
              path: `/traceEvents/${index}/evidenceRefs`,
              code: "future-evidence",
              message: "A receipt may reference only an earlier receipt in the same chain."
            });
          }
        }
      }
    }
    previous = event;
  }

  return {
    valid: issues.length === 0,
    issues,
    eventsReplayed: events.length,
    finalDigest: previous?.digest ?? null
  };
}
