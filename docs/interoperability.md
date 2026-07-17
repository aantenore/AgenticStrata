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

Adapter YAML files are declarative mappings with an explicit `lossPolicy`. They contain no vendor SDK and can be replaced without changing the core contract registry.

## Agent and flow specifications

Portable agent specifications answer questions such as “what is this agent, which tools may it request, and how is a flow assembled?” AgenticStrata answers “what did this application run actually request, authorize, change, verify, and prove?”

`ApplicationManifest.architecture.externalAgentSpecifications` therefore stores only:

- an immutable or versioned reference;
- a content digest;
- a media type.

The external definition remains owned by its specification. Embedding a second agent-manifest dialect here would reduce portability and create conflicting sources of truth.

## Optional project adapters

Intent normalization systems and inference control planes can integrate at the Intent & Outcome and Model & Compute strata respectively. They remain optional adapters: the reference runtime has no direct dependency on either, and their output is admitted only through the same contracts and evidence checks.
