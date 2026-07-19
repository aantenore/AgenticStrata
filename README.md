# AgenticStrata

AgenticStrata is an executable reference architecture for enterprise agentic applications. It defines application-level runtime contracts, tamper-evident receipts, and conformance profiles without prescribing a model, agent framework, cloud, database, or deployment topology.

The architecture is intentionally more than a layer diagram. A run can be validated, replayed, explained to a non-specialist, and checked against evidence produced by the actual capability lifecycle.

## The seven strata

```mermaid
flowchart TB
    I["0 · Interaction"] --> N["1 · Intent & Outcome"]
    N --> C["2 · Control & Orchestration"]
    C --> B["3 · Collaboration"]
    B --> P["4 · Capability"]
    P --> K["5 · Knowledge & State"]
    K --> M["6 · Model & Compute"]
    T["Trust & Authority"] -.-> I & N & C & B & P & K & M
    E["Evidence & Operations"] -.-> I & N & C & B & P & K & M
    L["Lifecycle & Conformance"] -.-> I & N & C & B & P & K & M
```

Logical strata may share one process. The rule is a dependency and responsibility boundary, not seven required services.

| Stratum | Owns | Must not own |
| --- | --- | --- |
| Interaction | Human, API, and event boundary | Authority issuance or model selection policy |
| Intent & Outcome | Canonical intent, constraints, acceptance criteria, safe cache fingerprint | Side effects |
| Control & Orchestration | Plans, budgets, routing, approvals, lifecycle state | Provider-specific business logic |
| Collaboration | Delegation, handoff, coordination | Authority expansion |
| Capability | Typed prepare/commit/verify/compensate operations | Hidden credentials or unbounded tools |
| Knowledge & State | Authoritative state, retrieval, artifacts, provenance | Treating retrieved text as authority |
| Model & Compute | Replaceable inference and compute providers | Authorization decisions |

## What is executable

- A JSON Schema 2020-12 contract bundle for manifests, intent, criterion results, execution, runtime boundaries, authority, delegation, capabilities, evidence, receipts, and conformance reports.
- A composite cache fingerprint that requires both semantic and operational equivalence: policy, capability set, authoritative context, tenant, privacy, constraints, and outcome are all bound.
- An RFC 8785 JSON Canonicalization Scheme implementation with cross-language golden vectors, strict duplicate-member rejection at the JSON boundary, and a hash-linked receipt chain with tamper and missing-evidence detection.
- Runtime conformance checks for rooted authority, causal evidence, actual budget consumption, exact-action idempotency, approval, read-back or compensation, predeclared criterion evidence bindings, layer direction, and model/authority separation.
- An [Execution Passport v2](docs/spec/attestations/execution-passport/v2/README.md) that binds one run bundle, its complete conformance report, one externally validated OASF record, and optional run-bound observations in a strict in-toto Statement without embedding those documents.
- Mapping-only adapter documents for AG-UI, A2A, MCP, OpenTelemetry GenAI, CloudEvents, an external policy engine, and OASF, plus an executable StageFabric evidence-reduction adapter.
- A neutral prepare/commit/read-back demo with exact-action approval and duplicate suppression.

## Quick start

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
npm run demo
```

The demo writes a `RunBundle`, `ConformanceReport`, and plain-language explanation under `.tmp/demo`.

```bash
node dist/cli.js validate examples/application.manifest.yaml
node dist/cli.js lint examples/application.manifest.yaml
node dist/cli.js conformance examples/generic-change/run.bundle.json --profile enterprise
node dist/cli.js replay examples/generic-change/run.bundle.json
node dist/cli.js explain examples/generic-change/run.bundle.json --profile enterprise
```

After producing a report, bind it to a real OASF record that has been validated by its owning ecosystem:

```bash
node dist/cli.js passport .tmp/demo/run.bundle.json \
  --report .tmp/demo/conformance-report.json \
  --oasf-record /path/to/validated-oasf-record.json \
  --oasf-media-type "$OASF_MEDIA_TYPE" \
  --output .tmp/demo/execution-passport.json
node dist/cli.js validate .tmp/demo/execution-passport.json
```

When StageFabric produces a sealed content-free placement artifact, reduce it to a run-bound descriptor before Passport creation:

```bash
node dist/cli.js bind-stagefabric /path/to/stagefabric-evidence.json \
  --uri urn:stagefabric:evidence:run-001 \
  --output .tmp/demo/stagefabric-binding.json
node dist/cli.js passport .tmp/demo/run.bundle.json \
  --report .tmp/demo/conformance-report.json \
  --oasf-record /path/to/validated-oasf-record.json \
  --oasf-media-type "$OASF_MEDIA_TYPE" \
  --execution-evidence .tmp/demo/stagefabric-binding.json \
  --output .tmp/demo/execution-passport.json
```

The output file contains exact RFC 8785 Statement bytes suitable for an external DSSE/Sigstore adapter. Repeat `--execution-evidence` only with strict v2 bindings whose `runIdDigest` matches the Passport run and whose authority is fixed to `observation-only`.

`bind-stagefabric` accepts only the exact canonical JSON plus trailing LF emitted by the StageFabric evidence writer. Pretty-printed JSON, YAML, or a reserialized object is rejected because the resulting descriptor digest identifies the retrievable file bytes, not merely an equivalent object.

All commands accept JSON; `validate` and `lint` also accept YAML. Build once with `npm run build` before invoking the repository-local CLI. Input documents are bounded to 16 MiB, JSON member names must be unique, and YAML alias expansion is limited.

## Profiles

Profiles are configuration, not hard-coded editions:

- `core`: contracts, lineage, authority attenuation, budget usage, safe effects, evidence, and receipt integrity.
- `local-private`: core plus terminally linked runtime evidence covering the full receipt window for local data, local model hosting, and no observed network egress.
- `enterprise`: core plus high-risk approval, attestation, retention, and policy controls.
- `regulated`: enterprise plus restricted handling and longer retention.
- `distributed`: enterprise plus node attribution on every receipt.

Extend the packaged profile configuration with `--profiles`. Built-in baseline rules cannot be removed, and an unknown rule fails closed.

## Standards boundary

AgenticStrata does not redefine agent or flow manifests. External agent specifications are imported by immutable reference, digest, and media type. It also does not replace transport protocols or telemetry conventions: adapter files describe how application contracts project onto them while preserving explicit loss.

This makes it complementary to:

- [AG-UI](https://docs.ag-ui.com/introduction) at the user/agent event boundary;
- [A2A](https://a2a-protocol.org/latest/specification/) for agent-to-agent exchange;
- [MCP](https://modelcontextprotocol.io/specification/2025-11-25) for tools and context;
- [OpenTelemetry GenAI](https://github.com/open-telemetry/semantic-conventions-genai) for operational telemetry;
- [CloudEvents](https://github.com/cloudevents/spec) for event interchange;
- [in-toto Statement v1](https://github.com/in-toto/attestation/tree/main/spec/v1) for the Execution Passport envelope;
- [Open Agent Spec](https://github.com/oracle/agent-spec) and [OSSA](https://openstandardagents.org/specification/) for portable pre-runtime definitions.

Pattern and source-layout scanners can discover whether a project appears to use architectural conventions. AgenticStrata instead evaluates a declared manifest together with runtime receipts and artifacts. These are different, compatible jobs.

Read [Architecture](docs/architecture.md), [Contracts and conformance](docs/contracts-and-conformance.md), [Interoperability](docs/interoperability.md), and the [Threat model](docs/threat-model.md).

## Product boundaries

- Hash linking detects mutation and gaps; it is not a digital signature or non-repudiation mechanism. Sign receipts or store them in an append-only trusted system when that property is required.
- Conformance proves the checks implemented for the selected profile over the supplied evidence. It is not regulatory certification.
- Prepared actions, observed results, and compensation results use distinct attested evidence roles. Each evidence-required acceptance criterion predeclares the exact capability, action digest, and role it accepts; reusing pre-effect or unrelated evidence fails conformance.
- Run status and conformance status are separate: a failed run can still have an intact, conformant evidence record, but it is never explained as a completed outcome.
- Reports bind the evaluator name, package version, semantic revision, selected rule set, and effective profile configuration. The evaluator digest identifies the declared implementation revision; it is not a code signature.
- An unsigned Execution Passport proves deterministic integrity and cross-artifact binding only. Authenticity requires an externally verified DSSE envelope or equivalent trusted channel, and consumers must make that requirement explicit so removing a signature cannot silently downgrade policy.
- The OASF subject digest proves which opaque record was bound; it does not prove that the record is semantically valid OASF. Validate it before passport creation with the specification owner’s tooling.
- Execution-placement evidence enters the predicate only as a strict, run-bound, observation-only descriptor with a normalized observation time and no payload or `content` field. A StageFabric descriptor hashes the exact canonical JSON file bytes, including its trailing LF. Descriptor metadata must come from a trusted producer and be redacted or pseudonymized when sensitive; its optional stable URI may be omitted. Full provider result objects are outside the Passport contract.
- The StageFabric adapter follows its finalized `0.7.0-alpha.1` successful-run contract: trace events are either completed placements or pre-output retries with status `429`, `502`, `503`, or `504`. Terminal failures, arbitrary HTTP codes, missing retry codes, and codes attached to completed events fail closed.
- A safe fingerprint binds the declared canonical intent. It does not prove that an upstream intent normalizer chose the correct meaning.
- Adapter documents are integration contracts, not bundled protocol SDKs or policy engines.
- The current release is an alpha contract surface. Version consumers explicitly before production adoption.

## Development

```bash
npm run release:check
```

The release gate runs strict lint and types, 80+ tests with coverage thresholds, build, repository hygiene, production audit, `publint`, and Are the Types Wrong.

Apache-2.0 licensed. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
