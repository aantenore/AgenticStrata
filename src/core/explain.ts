import type { ConformanceReport, RunBundle } from "../contracts/types.js";
import { evidenceIndex, verifyTraceChain } from "./receipts.js";

function value(value: unknown): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function explainRun(bundle: RunBundle, report?: ConformanceReport): string {
  const replay = verifyTraceChain(bundle.traceEvents, evidenceIndex(bundle));
  const commitEvents = bundle.traceEvents.filter((event) => event.eventType === "capability.committed");
  const verificationEvents = bundle.traceEvents.filter((event) => event.eventType === "capability.verified");
  const lines = [
    `# Run explanation: ${bundle.execution.runId}`,
    "",
    "## Requested and bound",
    "",
    `- Canonical intent: ${bundle.intent.canonicalIntent}`,
    `- Intent confidence: ${bundle.intent.confidence}`,
    `- Intent ambiguity: ${bundle.intent.ambiguity}`,
    `- Outcome: ${bundle.outcome.objective}`,
    `- Execution profile: ${bundle.execution.profile}`,
    `- Privacy partition: ${bundle.execution.privacyPartition}`,
    `- Composite fingerprint: ${bundle.intent.fingerprint.digest}`,
    `- Safe cache key: ${bundle.intent.fingerprint.cacheKey}`,
    "",
    "## Authority and collaboration",
    "",
    `- Authority grants: ${bundle.authorityGrants.length}`,
    `- Approval receipts: ${bundle.approvals.length}`,
    `- Attenuated delegations: ${bundle.delegations.length}`,
    "",
    "## Decisions",
    ""
  ];

  for (const decision of bundle.decisions) {
    lines.push(`- ${decision.summary} Selected: ${decision.selectedOption}. Evidence: ${decision.evidenceRefs.join(", ")}.`);
  }
  if (bundle.decisions.length === 0) {
    lines.push("- No decision evidence was recorded.");
  }

  lines.push("", "## Side effects and verification", "");
  for (const event of commitEvents) {
    lines.push(
      `- Commit ${value(event.attributes.actionDigest)} via ${value(event.attributes.capabilityId)}; idempotency key ${value(event.attributes.idempotencyKey)}.`
    );
  }
  for (const event of verificationEvents) {
    lines.push(
      `- Verification ${value(event.attributes.verificationId)}: ${event.summary}`
    );
  }
  if (commitEvents.length === 0) {
    lines.push("- No side effect was committed.");
  }

  lines.push(
    "",
    "## Runtime evidence",
    "",
    `- Runtime artifacts: ${bundle.artifacts.length}`,
    `- Artifact attestations: ${bundle.attestations.length}`,
    `- Hash-linked receipts: ${bundle.traceEvents.length}`,
    `- Replay integrity: ${replay.valid ? "valid" : "invalid"}`,
    `- Final receipt digest: ${replay.finalDigest ?? "n/a"}`
  );

  if (report !== undefined) {
    lines.push(
      "",
      "## Conformance",
      "",
      `- Profile: ${report.profile}`,
      `- Status: ${report.status}`,
      ...report.checks.map((item) => `- [${item.status}] ${item.id}: ${item.message}`)
    );
  }

  lines.push(
    "",
    "> This explanation contains decision summaries and evidence references, not private model reasoning.",
    ""
  );
  return lines.join("\n");
}
