# Interoperability

AgenticStrata owns application-level runtime invariants. It deliberately leaves wire protocols, agent packaging, telemetry, and policy evaluation to focused standards and engines.

| External surface | AgenticStrata projection | Boundary retained |
| --- | --- | --- |
| AG-UI | Intent, lifecycle events, approval interaction | A UI confirmation is input evidence; policy validates it. |
| A2A | Delegation, task state, artifacts | Authority cannot expand during handoff. |
| MCP | Capability schemas, tool results, receipt events | Tool annotations do not grant executable authority. |
| OpenTelemetry GenAI | Spans, decision summaries, conformance status | Private reasoning and sensitive payloads stay out of telemetry. |
| CloudEvents | Receipt and artifact references | Correlation, tenant, privacy, and digest bindings survive transport. |
| Policy engine | Grant, approval, attenuation query | The external enforcement point remains authoritative. |
| OASF | Opaque agent-record subject descriptor | AgenticStrata binds canonical bytes but delegates semantic validation and media-type ownership. |
| in-toto / DSSE | Execution Passport Statement and optional external envelope | The core owns deterministic binding; signing, identity, transparency, and trusted time stay outside it. |
| Execution-placement provider | Content-free evidence descriptor | Inputs, outputs, prompts, response bodies, endpoints, raw errors, full plans, and provider payloads are excluded. |

Adapter YAML files are declarative mappings with an explicit `lossPolicy`. They contain no vendor SDK and can be replaced without changing the core contract registry.

## Attestation exchange

The Execution Passport uses the project-controlled predicate namespace documented at [`docs/spec/attestations/execution-passport/v1`](spec/attestations/execution-passport/v1/README.md). The core writes exact RFC 8785 Statement bytes. A deployment may pass those bytes to an external DSSE/Sigstore adapter using payload type `application/vnd.in-toto+json`; no signing key, certificate flow, or Sigstore dependency enters AgenticStrata.

Consumers choose one of two explicit policies:

- **unsigned allowed**: verify schema, canonical digests, report binding, and local transport trust; this establishes integrity and association, not signer authenticity;
- **authenticated required**: reject a bare Statement and require successful external envelope, signer-identity, and trust-material verification.

There is no implicit fallback from the second policy to the first. This prevents signature removal from becoming a silent trust downgrade.

## Agent and flow specifications

Portable agent specifications answer questions such as “what is this agent, which tools may it request, and how is a flow assembled?” AgenticStrata answers “what did this application run actually request, authorize, change, verify, and prove?”

`ApplicationManifest.architecture.externalAgentSpecifications` therefore stores only:

- an immutable or versioned reference;
- a content digest;
- a media type.

The external definition remains owned by its specification. Embedding a second agent-manifest dialect here would reduce portability and create conflicting sources of truth.

## Optional project adapters

Intent normalization systems and inference control planes can integrate at the Intent & Outcome and Model & Compute strata respectively. They remain optional adapters: the reference runtime has no direct dependency on either, and their output is admitted only through the same contracts and evidence checks.
