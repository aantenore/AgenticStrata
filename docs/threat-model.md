# Threat model

## Protected assets

- authority and approval boundaries;
- tenant and privacy separation;
- authoritative application state;
- capability credentials and side effects;
- lineage, artifacts, and audit evidence;
- execution budgets and service limits.

## Trust boundaries

Model output, retrieved content, external messages, tool descriptions, and imported manifests are untrusted until validated. Identity providers, human approvals, policy engines, system-of-record reads, and configured evidence stores are trusted only for their declared role.

## Threats and controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| Prompt text claims authorization | Grant issuer enum excludes models; authority checks occur outside model compute. | A compromised external issuer can still issue a bad grant. |
| Delegated agent expands access | Exact subset checks for scope, resources, time, and every budget dimension. | Resource matching is exact in the alpha runtime; production pattern engines need their own verified semantics. |
| Service policies create a circular authority chain | Grant lineages must be acyclic and terminate at a human or identity-provider root. | Compromise of a legitimate root remains outside hash-only verification. |
| Approval is reused for another action | Approval binds the prepared action digest, authority grant, capability, and expiry. | A compromised preparation implementation can misrepresent the action. |
| Duplicate or retried write | Each capability run enforces a one-to-one action-digest/idempotency-key relation and rejects a second commit for either binding. | Idempotency storage must be durable in a real adapter. |
| Prepared or unrelated output is replayed as proof of success | Acceptance criteria predeclare exact capability/action/role requirements; post-effect attestations identify the commit in their provenance and distinguish prepared, observed-result, and compensation-result roles. | The verifier and producer may share a failure domain unless deployed independently. |
| Write reports success without effect | Exactly one action-bound attested verification or compensation must follow a commit. | The verifier and producer may share a failure domain unless deployed independently. |
| Receipt history is edited | Sequence, previous digest, record digest, run id, and backward-only evidence references are replayed. | Hash linking alone does not authenticate the author or prevent wholesale replacement. |
| Future or cyclic evidence manufactures lineage | One timestamped dependency graph covers decisions, criteria, boundary evidence, attestations, approvals, authority, and events. | Trusted time and non-repudiation still require external infrastructure. |
| A local profile is satisfied by relabeling configuration, replaying stale evidence, or hiding a contradictory observation | `local-private` requires every supplied runtime hosting, data-boundary, endpoint, and observed-egress observation to be sealed, linked by the terminal receipt, cover the full receipt window, and remain consistently local. | The observer must be independently trusted and able to see relevant egress; omitted observations cannot be discovered from the bundle alone. |
| Semantic cache crosses policy or tenant | Composite fingerprint binds policy, capabilities, context, outcome, tenant, and privacy. | Incorrect upstream canonicalization can still create a false semantic match. |
| Sensitive reasoning leaks | Decision evidence is restricted to summaries and evidence references. | Applications must still redact summaries and artifact payloads. |
| Duplicate JSON keys or oversized/alias-heavy input confuse the CLI | Duplicate-member rejection, file-size limits, and YAML alias limits. | Deep but valid JSON may still require process-level resource limits for hostile multi-tenant use. |
| A report is replayed under ambiguous evaluator semantics | Reports bind evaluator name, package version, semantic revision, rule IDs, and effective configuration by digest. | The declared evaluator digest is not a code signature; trusted distribution or executable attestation is required for stronger provenance. |
| Imported agent definition becomes mutable | Reference plus digest; embedded redefinition is rejected. | Availability and signature verification belong to the artifact resolver. |
| A Passport mixes a run with another report or manifest | Creation recomputes canonical bundle and manifest digests, verifies the complete report and evaluator seals, and rejects mismatched run identity or terminal state. | Hashes do not establish who produced otherwise self-consistent artifacts. |
| A Passport is interpreted as proof of success | The predicate carries separate explicit run and conformance statuses and permits failed or incomplete states. | Consumers must still enforce the statuses appropriate to their decision. |
| Raw execution data leaks through placement evidence | The schema and CLI reject payload/content fields, inline or local URI schemes, credentialed HTTPS references, query strings, fragments, and oversized URIs. | Descriptor names, producer identifiers, media types, HTTPS paths, and URNs remain metadata channels; accept them only from trusted producers and redact, pseudonymize, or omit optional URIs. |
| Valid placement evidence is replayed onto another run or treated as permission | V2 binds each descriptor to `SHA256(RFC8785(runId))`, fixes its authority to `observation-only`, and rejects mismatches before Passport creation. | A compromised producer can still create false but internally consistent observations; authenticate and qualify producers externally. |
| A successful StageFabric observation smuggles a terminal failure or arbitrary HTTP status | A closed AJV union admits only `completed` events or pre-output retries with status `429`, `502`, `503`, or `504`; static types encode the same discriminated contract. | A future producer-contract change requires an explicit, versioned adapter update. |
| An external observation is backdated, postdates its report, or is reserialized behind its URI | The binding carries normalized `observedAt`; report chronology includes it; the StageFabric adapter verifies the producer timestamp grammar and hashes exact canonical writer bytes including LF. | Dates are self-asserted unless the producer is authenticated and backed by trusted time. Availability of the URI remains external. |
| A report claims success after checks are removed, reordered, duplicated, or changed | Creation requires unique ordered check identifiers, binds that order to `rulesDigest`, and derives report status from the checks. | Hash consistency does not authenticate the evaluator or its implementation. |
| A report or Passport appears to predate evidence it assesses | Creation requires report generation after every included observed evidence timestamp and issuance after report generation. | These are self-asserted consistency checks, not trusted timestamps; non-repudiation requires external infrastructure. |
| An OASF digest is mistaken for semantic validation | The record is treated as opaque I-JSON and documentation requires validation by the owning ecosystem before binding. | A caller can still bind an invalid record if it ignores that prerequisite. |
| A DSSE envelope is removed before consumption | Authenticated consumer policy rejects a bare Statement; unsigned acceptance is a separate explicit mode. | Trust still depends on external verifier configuration, signer identity constraints, and trust material. |
| Statement bytes and digest semantics diverge | Subject digests use RFC 8785 semantic JSON canonicalization, and the CLI emits those exact canonical Statement bytes for an external signer. | Other tooling must preserve the documented payload type and verify the exact DSSE payload bytes. |

## Non-goals of the alpha

- built-in key management, digital-signature services, or trusted timestamping;
- a policy language or identity provider;
- credential brokering;
- sandboxing model-generated code;
- network transport security;
- regulatory certification.

Deployments requiring these properties should integrate established enforcement and attestation systems through the declared planes rather than placing secrets or authorization logic in prompts.

`BudgetUsage` is an integrity-bound observation, not a trusted meter by itself. Production deployments should source it from an independently controlled usage meter when cost or quota enforcement is material.
