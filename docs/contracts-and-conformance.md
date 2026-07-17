# Contracts and conformance

## Contract families

| Family | Contracts | Purpose |
| --- | --- | --- |
| Application | `ApplicationManifest` | Declares strata, planes, policies, capability set, and imported specifications. |
| Meaning | `IntentEnvelope`, `OutcomeContract` | Binds canonical meaning, constraints, acceptance evidence, and forbidden outcomes. |
| Execution | `ExecutionEnvelope`, `BudgetUsage` | Sets profile, SLA, partitions, limits, and observed consumption. |
| Authority | `AuthorityGrant`, `ApprovalReceipt`, `DelegationEnvelope` | Makes authorization explicit, attenuated, time-bounded, and action-specific. |
| Capability | `CapabilityContract` | Defines risk, effect, schemas, scopes, and side-effect lifecycle. |
| Evidence | `DecisionEvidence`, `RuntimeArtifact`, `ArtifactAttestation`, `TraceEvent` | Reconstructs what was selected, applied, observed, and attested. |
| Assessment | `ConformanceReport` | Records profile checks and evidence-backed pass/fail status. |
| Integration | `AdapterMapping` | Describes protocol projection and explicit information loss. |

All integrity-bearing records use deterministic SHA-256 digests over canonical JSON. Digest verification proves that a record matches its bytes and references; issuer authenticity requires an external signature or trusted append-only store.

## Mechanical invariants

The core profile checks:

- schema validity and API version;
- exactly seven strata and three planes;
- downward dependency direction;
- complete semantic and operational fingerprint bindings;
- unique identifiers and cross-record lineage;
- imported agent specifications by reference only;
- artifact payload and attestation digests;
- gap-free, chronological receipt replay with backward-only resolvable evidence;
- observed usage and authority budgets within the execution envelope;
- child grants and delegations that attenuate every dimension;
- authority issuance outside model compute;
- prepared, idempotent effects followed by attested verification or compensation;
- summary-only decision evidence.

Enterprise adds exact approval for high-risk commits and control flags. Regulated and distributed profiles add their respective boundary checks.

## Evidence, not file detection

A conformance run consumes a `RunBundle`. It does not infer architecture from directory names, imports, or keywords. This avoids declaring success simply because a project contains a policy file or telemetry package. Conversely, a source scanner remains useful before runtime evidence exists; its result should be treated as a discovery signal rather than runtime proof.

## Extending profiles

Copy `config/conformance.profiles.yaml`, retain the API version, and pass it with `--profiles`. Profile inheritance is deterministic, duplicate rules execute once, cycles are rejected, and a configured rule without an implementation fails closed.

New rule implementations should:

1. operate on typed bundle data;
2. return a stable rule identifier;
3. provide an evidence reference when a concrete record supports the outcome;
4. distinguish absence from non-applicability;
5. include adversarial tests that mutate the evidence, not just the manifest.
