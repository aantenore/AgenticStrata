# Contracts and conformance

## Contract families

| Family | Contracts | Purpose |
| --- | --- | --- |
| Application | `ApplicationManifest` | Declares strata, planes, policies, capability set, and imported specifications. |
| Meaning | `IntentEnvelope`, `OutcomeContract`, `CriterionResult` | Binds canonical meaning, constraints, requested outcomes, exact evidence requirements, and criterion results. |
| Execution | `ExecutionEnvelope`, `BudgetUsage`, `RuntimeBoundaryEvidence` | Sets profile, SLA, partitions, limits, observed consumption, hosting, data boundary, and egress observations. |
| Authority | `AuthorityGrant`, `ApprovalReceipt`, `DelegationEnvelope` | Makes authorization explicit, attenuated, time-bounded, and action-specific. |
| Capability | `CapabilityContract` | Defines risk, effect, schemas, scopes, and side-effect lifecycle. |
| Evidence | `DecisionEvidence`, `RuntimeArtifact`, `ArtifactAttestation`, `TraceEvent` | Reconstructs what was selected, applied, observed, and attested. |
| Assessment | `ConformanceReport` | Records profile checks and evidence-backed pass/fail status. |
| Attestation exchange | `ExecutionPassport`, `ExecutionEvidenceBinding`, `ResourceDescriptor` | Binds a run, assessment, external agent record, and content-free placement evidence without embedding payloads. |
| Integration | `AdapterMapping` | Describes protocol projection and explicit information loss. |

All integrity-bearing records use deterministic SHA-256 digests over [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) output. AgenticStrata uses the maintained `canonicalize` implementation referenced by the RFC and tests standard key-ordering and number vectors. Inputs must be I-JSON values; the file boundary rejects duplicate JSON member names before the parsed value can enter the contract runtime. Digest verification proves that a record matches its bytes and references; issuer authenticity requires an external signature or trusted append-only store.

## Mechanical invariants

The core profile checks:

- schema validity and API version;
- exactly seven strata and three planes;
- downward dependency direction;
- complete semantic and operational fingerprint bindings;
- one evidence-backed result for every acceptance criterion, matched against predeclared capability, action-digest, and evidence-role requirements;
- unique identifiers and cross-record lineage;
- imported agent specifications by reference only;
- artifact payload and attestation digests;
- gap-free, chronological receipt replay plus an acyclic, backward-only causal graph across every evidence family;
- observed usage and authority budgets within the execution envelope;
- child grants and delegations that attenuate every dimension and reach a non-service trust root;
- authority issuance outside model compute;
- prepared, authorized effects with a one-to-one action/idempotency binding followed by exactly one action-bound attested verification or compensation;
- phase-specific artifact roles (`prepared-action`, `observed-result`, and `compensation-result`), with post-effect attestations causally linked to the exact commit so pre-effect evidence cannot prove a post-effect result;
- one final terminal receipt, with run success kept separate from conformance success;
- capability input and output contracts that compile as JSON Schema 2020-12;
- summary-only decision evidence.

`local-private` additionally requires runtime boundary evidence rather than declarations alone. Every supplied observation must cover the complete receipt window, be linked by the unique terminal receipt, and consistently attest local data, local model hosting, and no observed egress. A stale, partial, unlinked, or contradictory observation fails the profile even if another observation passes. Enterprise adds exact approval for high-risk commits and control flags. Regulated and distributed profiles add their respective boundary checks.

Every report binds the run bundle, selected rule list, effective merged profile configuration, and evaluator identity by digest. Evaluator identity contains the package version plus an explicitly versioned conformance revision. This makes the assessment reproducible, prevents a custom profile from silently downgrading a built-in name, and exposes which evaluator semantics produced the result. The evaluator digest binds declared release metadata; authenticity and executable-byte attestation remain deployment concerns.

## Execution Passport invariants

The [v1 specification](spec/attestations/execution-passport/v1/README.md) is an in-toto Statement with one project-owned predicate URI. Its subject tuple has fixed order and length: run bundle, complete conformance report, external OASF record. Each subject is a strict `ResourceDescriptor` containing only a name, one SHA-256 digest, a media type, and an optional bounded stable HTTPS or URN reference. The report subject uses `digestValue(report)`, not `report.digest`: the former binds the complete serialized report, while the latter seals the report content before its own digest field is added.

The predicate records `runStatus` and `conformanceStatus` separately. Creation does not require either status to be successful, so an incomplete or failed run can be bound honestly. It does require unambiguous run identity, a valid receipt chain, a sealed report and evaluator identity, ordered unique check identifiers bound by `rulesDigest`, status derived from those checks, matching bundle and manifest digests, report/receipt status agreement, report generation no earlier than any included observed evidence, and issuance no earlier than report generation.

OASF input is accepted only as an opaque I-JSON object and canonicalized for its subject digest. AgenticStrata deliberately does not carry an OASF schema and therefore does not claim semantic validity. A caller must validate the record externally and provide the owner-declared media type.

`executionEvidence` accepts only strict bindings with no payload or `content` field. The producer computes and publishes the evidence artifact digest; AgenticStrata carries its descriptor but never receives the full provider result through the CLI. Descriptor metadata must be trusted and redacted or pseudonymized when sensitive, and the URI may be omitted.

The Passport is created after assessment and is not required by a conformance rule. Making it a prerequisite of the report it contains would create a circular dependency.

## Evidence, not file detection

A conformance run consumes a `RunBundle`. It does not infer architecture from directory names, imports, or keywords. This avoids declaring success simply because a project contains a policy file or telemetry package. Conversely, a source scanner remains useful before runtime evidence exists; its result should be treated as a discovery signal rather than runtime proof.

## Extending profiles

Copy `config/conformance.profiles.yaml`, retain the API version, add rules or inheritance, and pass it with `--profiles`. Built-in baseline rules are non-removable: custom configuration is merged additively so a named profile cannot silently weaken its contract. Profile inheritance is deterministic, duplicate rules execute once, cycles are rejected, and a configured rule without an implementation fails closed.

New rule implementations should:

1. operate on typed bundle data;
2. return a stable rule identifier;
3. provide an evidence reference when a concrete record supports the outcome;
4. distinguish absence from non-applicability;
5. include adversarial tests that mutate the evidence, not just the manifest.
