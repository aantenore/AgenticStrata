# AgenticStrata Execution Passport v1

Status: superseded historical contract

New producers must use [Execution Passport v2](../v2/README.md). V1 execution-evidence descriptors did not bind the observed run and must not be promoted by changing only the predicate URI. This document is retained for migration analysis; `validate` retains read-only v1 Statement support while the current creation schema and builder implement v2.

Predicate type:

`https://github.com/aantenore/AgenticStrata/tree/main/docs/spec/attestations/execution-passport/v1`

## Purpose

Execution Passport v1 is an in-toto Statement that binds one runtime bundle, the complete conformance report produced for that bundle, and one external OASF agent record. It packages lineage; it is not a success certificate, an OASF validator, a digital signature, or a trusted timestamp.

The historical shape is described here. The current `$defs.ExecutionPassport` in [`schemas/v1/agentic-strata.schema.json`](../../../../../schemas/v1/agentic-strata.schema.json) implements v2.

## Statement envelope

The top-level object contains exactly four fields:

| Field | Required value |
| --- | --- |
| `_type` | `https://in-toto.io/Statement/v1` |
| `subject` | The exact ordered three-element tuple below |
| `predicateType` | The predicate URI at the top of this document |
| `predicate` | The strict Execution Passport predicate |

Additional top-level fields, including embedded signatures, are invalid. A signature belongs to an external envelope.

## Ordered subjects

Subject order and cardinality are normative:

| Index | `name` | `mediaType` | SHA-256 input |
| --- | --- | --- | --- |
| 0 | `agentic-strata-run-bundle` | `application/vnd.aantenore.agenticstrata.run-bundle+json` | RFC 8785 canonical `RunBundle` |
| 1 | `agentic-strata-conformance-report` | `application/vnd.aantenore.agenticstrata.conformance-report+json` | RFC 8785 canonical complete `ConformanceReport` |
| 2 | `oasf-agent-record` | Declared by the external record owner | RFC 8785 canonical opaque OASF JSON record |

The report subject digest is `digestValue(report)`. It is deliberately not `report.digest`, because `report.digest` seals the report before its own digest field is present while the subject binds the complete exchanged artifact.

Each subject is a strict ResourceDescriptor with only:

- `name`;
- `digest`, containing exactly one lowercase hexadecimal `sha256` value;
- `mediaType`;
- optional bounded stable `uri`: either HTTPS without user information, query, or fragment, or a URN without query or fragment.

`content`, `downloadLocation`, annotations, inline URI schemes, local paths, extra digest algorithms, and any other extension are invalid in v1. URI values are limited to 2,048 characters.

## Predicate

The predicate contains exactly these fields:

| Field | Meaning |
| --- | --- |
| `apiVersion` | AgenticStrata contract API version |
| `kind` | Fixed value `ExecutionPassport` |
| `runId` | One run identifier shared by the bound runtime records |
| `profile` | Profile evaluated by the bound report |
| `runStatus` | `completed`, `failed`, or `incomplete` |
| `conformanceStatus` | `pass` or `fail`, independent of run status |
| `evaluatorDigest` | Digest of the report evaluator identity |
| `terminalReceiptDigest` | Final terminal receipt digest, or `null` for an incomplete run |
| `issuedAt` | Self-asserted date-time no earlier than report generation |
| `executionEvidence` | Zero or more strict content-free evidence bindings |

Passport presence never changes either status and never implies success.

## Execution evidence

An execution-evidence entry contains exactly:

- `role: execution-placement`;
- a provider-neutral `producer` identifier;
- `disclosure: content-free`;
- one strict ResourceDescriptor for a separately stored evidence artifact.

The producer computes the descriptor digest before Passport creation. The AgenticStrata CLI reads the binding document, not the provider’s full execution result, and the contract has no payload or `content` field. Descriptor metadata is not inherently non-sensitive: `producer`, resource name, media type, and an optional stable URI must come from a trusted producer and be redacted or pseudonymized when necessary. The URI may be omitted. Evidence descriptors remain predicate support and do not add a fourth Statement subject.

## Creation checks

A conforming builder fails closed unless:

1. the bundle and report satisfy their JSON Schemas;
2. the report seal and nested evaluator seal match their content;
3. report check identifiers are unique, their ordered list matches `rulesDigest`, and report status is derived from those checks;
4. `report.runBundleDigest` equals the canonical bundle digest;
5. `report.manifestDigest` equals the canonical bound manifest digest;
6. the receipt chain is intact and every observed run identifier agrees;
7. report run status agrees with the final receipt shape;
8. `report.generatedAt` is no earlier than every included trace, usage, boundary, criterion, decision, attestation, or approval observation time;
9. `issuedAt` is a valid date-time no earlier than `report.generatedAt`;
10. every descriptor and execution-evidence binding is strict and duplicate evidence digests are absent.

These checks establish internal consistency. Hashes alone do not authenticate a producer and cannot prevent wholesale replacement by an actor able to create a new self-consistent set.

## OASF boundary

AgenticStrata requires the OASF input to be an I-JSON object so it can compute a deterministic digest. It does not define or import an OASF schema. Callers must validate the record with tooling and version rules from its owning ecosystem before invoking Passport creation. A matching subject digest proves byte-equivalent canonical content, not semantic OASF validity.

## Optional DSSE and Sigstore

Signing is external to the core:

1. obtain the exact RFC 8785 Statement bytes emitted by the CLI output file;
2. use DSSE payload type `application/vnd.in-toto+json`;
3. sign and verify with Sigstore or another configured trust system;
4. enforce signer identity, trust material, transparency, revocation, and freshness in consumer policy.

The Statement does not contain keys, certificates, signatures, or Sigstore bundles. External verification must return the authenticated Statement bytes; the consumer then validates this schema and its subject bindings.

Consumer policy has two explicit modes:

- **unsigned allowed** establishes deterministic integrity and association only;
- **authenticated required** rejects a bare Statement and requires successful external envelope verification.

There is no automatic downgrade between modes.

## Versioning

The predicate URI and this directory identify v1 semantics. Breaking field, subject, digest, or validation changes require a new versioned path and predicate URI. Additive package releases may keep v1 only when every existing v1 document retains the same meaning and validation result.
