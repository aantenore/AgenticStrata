# Contracts and conformance

## Contract families

| Family | Contracts | Purpose |
| --- | --- | --- |
| Application | `ApplicationManifest` | Declares strata, planes, policies, capability set, and imported specifications. |
| Meaning | `IntentEnvelope`, `OutcomeContract`, `CriterionResult` | Binds canonical meaning, constraints, requested outcomes, and evidence-backed criterion results. |
| Execution | `ExecutionEnvelope`, `BudgetUsage`, `RuntimeBoundaryEvidence` | Sets profile, SLA, partitions, limits, observed consumption, hosting, data boundary, and egress observations. |
| Authority | `AuthorityGrant`, `ApprovalReceipt`, `DelegationEnvelope` | Makes authorization explicit, attenuated, time-bounded, and action-specific. |
| Capability | `CapabilityContract` | Defines risk, effect, schemas, scopes, and side-effect lifecycle. |
| Evidence | `DecisionEvidence`, `RuntimeArtifact`, `ArtifactAttestation`, `TraceEvent` | Reconstructs what was selected, applied, observed, and attested. |
| Assessment | `ConformanceReport` | Records profile checks and evidence-backed pass/fail status. |
| Integration | `AdapterMapping` | Describes protocol projection and explicit information loss. |

All integrity-bearing records use deterministic SHA-256 digests over [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) output. AgenticStrata uses the maintained `canonicalize` implementation referenced by the RFC and tests standard key-ordering and number vectors. Inputs must be I-JSON values. Digest verification proves that a record matches its bytes and references; issuer authenticity requires an external signature or trusted append-only store.

## Mechanical invariants

The core profile checks:

- schema validity and API version;
- exactly seven strata and three planes;
- downward dependency direction;
- complete semantic and operational fingerprint bindings;
- one evidence-backed result for every acceptance criterion;
- unique identifiers and cross-record lineage;
- imported agent specifications by reference only;
- artifact payload and attestation digests;
- gap-free, chronological receipt replay plus an acyclic, backward-only causal graph across every evidence family;
- observed usage and authority budgets within the execution envelope;
- child grants and delegations that attenuate every dimension and reach a non-service trust root;
- authority issuance outside model compute;
- prepared, authorized effects with a one-to-one action/idempotency binding followed by an action-bound attested verification or compensation;
- one final terminal receipt, with run success kept separate from conformance success;
- capability input and output contracts that compile as JSON Schema 2020-12;
- summary-only decision evidence.

`local-private` additionally requires receipt-linked runtime boundary evidence rather than declarations alone. Enterprise adds exact approval for high-risk commits and control flags. Regulated and distributed profiles add their respective boundary checks.

Every report binds the run bundle, selected rule list, and effective merged profile configuration by digest. This makes the assessment reproducible and prevents a custom profile from silently downgrading a built-in name.

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
