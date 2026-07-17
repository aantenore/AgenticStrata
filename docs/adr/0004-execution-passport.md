# ADR 0004: Execution Passport as a strict external attestation statement

Status: accepted

## Context

A portable run lineage needs to bind the runtime bundle, the assessment actually performed over it, and the external agent record without copying those documents into another proprietary envelope. It must also preserve failed and incomplete state honestly, avoid carrying provider payloads, and allow deployments to add authenticity without coupling the contract core to one signing service.

## Decision

AgenticStrata defines Execution Passport v1 as a strict in-toto Statement. Its predicate URI is the project-controlled, versioned documentation path:

`https://github.com/aantenore/AgenticStrata/tree/main/docs/spec/attestations/execution-passport/v1`

The Statement has exactly three ordered subjects: `RunBundle`, complete `ConformanceReport`, and one opaque OASF record. Each uses a strict `ResourceDescriptor` with no payload or `content` field and at most one bounded stable HTTPS or URN reference. The predicate records run and conformance status separately and accepts optional execution-placement evidence only as descriptor bindings whose metadata remains subject to producer trust and redaction policy.

The core verifies schema, seals, ordered unique check-to-rule binding, derived conformance status, artifact bindings, receipt integrity, run identity, terminal status, report-after-evidence chronology, and issuance ordering before emission. OASF semantic validation remains external. Passport creation follows conformance evaluation and is not itself a conformance prerequisite.

The core emits RFC 8785 canonical Statement bytes but performs no signing. DSSE/Sigstore or another signature mechanism is an external adapter and consumer-policy concern.

## Consequences

- Consumers can reproduce every subject digest without importing a provider SDK.
- A failed or incomplete run can carry honest lineage without being described as successful.
- The execution-evidence contract has no payload or `content` field and does not accept a full provider result; descriptor metadata still requires trust, redaction, or pseudonymization.
- The OASF digest proves which bytes were bound, not that they satisfy OASF semantics.
- Unsigned Statements provide integrity and binding only. Authenticity, signer policy, transparency, revocation, and trusted time require external verification.
- Consumers that require authentication must reject bare Statements rather than silently accepting them after signature removal.
