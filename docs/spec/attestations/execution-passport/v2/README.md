# AgenticStrata Execution Passport v2

Status: alpha, versioned contract

Predicate type:

`https://github.com/aantenore/AgenticStrata/tree/main/docs/spec/attestations/execution-passport/v2`

## Purpose

Execution Passport v2 is a strict in-toto Statement that binds one runtime bundle, the complete conformance report produced for it, one externally validated OASF record, and optional content-free execution observations. It packages lineage; it is not a success certificate, an OASF validator, a digital signature, a trusted timestamp, or an authority grant.

The normative machine-readable shape is `$defs.ExecutionPassport` in [`schemas/v1/agentic-strata.schema.json`](../../../../../schemas/v1/agentic-strata.schema.json).

## Statement envelope and subjects

The top-level object contains exactly `_type`, `subject`, `predicateType`, and `predicate`. `_type` is `https://in-toto.io/Statement/v1`; `predicateType` is the v2 URI above. Signatures belong to an external envelope.

The ordered subject tuple has fixed length and meaning:

| Index | `name` | `mediaType` | SHA-256 input |
| --- | --- | --- | --- |
| 0 | `agentic-strata-run-bundle` | `application/vnd.aantenore.agenticstrata.run-bundle+json` | RFC 8785 canonical `RunBundle` |
| 1 | `agentic-strata-conformance-report` | `application/vnd.aantenore.agenticstrata.conformance-report+json` | RFC 8785 canonical complete `ConformanceReport` |
| 2 | `oasf-agent-record` | Declared by the external owner | RFC 8785 canonical opaque OASF JSON record |

Each subject is a strict `ResourceDescriptor`: name, one lowercase hexadecimal SHA-256 digest, media type, and optionally a bounded stable HTTPS or URN reference. Credentialed URLs, query strings, fragments, local paths, inline content, and extra fields are invalid.

## Predicate

The predicate contains the shared run identifier, selected conformance profile, separate run and conformance statuses, evaluator digest, terminal receipt digest, self-asserted issuance time, and zero or more execution-evidence bindings. Passport presence never changes either status and never implies success.

## Run-bound execution evidence

Every `ExecutionEvidenceBinding` contains exactly:

- `contractType: ExecutionEvidenceBinding`;
- `role: execution-placement`;
- a provider-neutral `producer` identifier;
- `runIdDigest`, computed as SHA-256 over RFC 8785 canonical JSON encoding of the Passport `runId`;
- `observedAt`, normalized to an RFC 3339 UTC date-time by a validated provider adapter;
- `authority: observation-only`;
- `disclosure: content-free`;
- one strict `ResourceDescriptor` for the complete separately stored evidence artifact.

The builder rejects a binding when `runIdDigest` does not match the bound run, when two evidence artifacts share a digest, when `observedAt` is later than the report, or when the descriptor is not strict. An observation can support lineage but cannot grant, widen, or substitute executable authority.

For StageFabric, the resource digest is SHA-256 over the exact UTF-8 bytes written by its safe writer: canonical JSON for the complete evidence object, including the producer seal, followed by one LF byte. The adapter accepts only its successful-run trace variants: `completed`, or `retryable_pre_output_status` with `429`, `502`, `503`, or `504`. The CLI rejects YAML, pretty JSON, missing or extra whitespace, and other reserializations. If a descriptor carries a URI, retrieval must return those exact bytes.

Provider adapters must validate their source contract and seal before creating a binding. They must not copy stage names, targets, prompts, model input or output, credentials, paths, or provider result objects into the binding. Descriptor metadata can still be sensitive and must be redacted or pseudonymized; the URI is optional.

## Creation checks

A conforming builder fails closed unless:

1. bundle and report satisfy their schemas and seals;
2. ordered report checks are unique, match `rulesDigest`, and derive the reported status;
3. report bundle and manifest digests match the supplied runtime bundle;
4. the receipt chain is intact and every observed run identifier agrees;
5. report run status agrees with the terminal receipt shape;
6. report generation is no earlier than bundle or external execution observations and issuance is no earlier than the report;
7. every subject descriptor and evidence binding is strict;
8. every execution-evidence `runIdDigest` equals the canonical digest of the Passport run identifier.

These checks establish deterministic internal consistency. They do not authenticate a producer or prevent wholesale replacement by an actor able to construct another self-consistent set.

## OASF, DSSE, and signing boundaries

OASF input is an opaque I-JSON object. Validate it with the owning ecosystem before Passport creation; its subject digest proves which canonical bytes were bound, not semantic OASF validity.

For authenticity, wrap the exact RFC 8785 Statement bytes in a DSSE envelope with payload type `application/vnd.in-toto+json`, then enforce signer identity, trust material, freshness, revocation, and transparency policy outside AgenticStrata. Consumers explicitly choose either unsigned integrity or authenticated-required policy; there is no automatic downgrade.

## Versioning and v1 migration

V2 adds mandatory run binding, observation time, and observation-only authority semantics to execution evidence. V1 evidence descriptors did not identify the observed run, so a valid v1 descriptor must not be promoted by merely changing the predicate URI. Recreate the descriptor from a producer artifact that proves the run binding, or omit it. The registry retains read-only validation of archived v1 Statements while all creation emits v2. Breaking predicate changes require a new versioned path.
