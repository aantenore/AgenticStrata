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
| Approval is reused for another action | Approval binds the prepared action digest, authority grant, capability, and expiry. | A compromised preparation implementation can misrepresent the action. |
| Duplicate or retried write | Capability-owned idempotency key and action-digest collision check. | Idempotency storage must be durable in a real adapter. |
| Write reports success without effect | Attested verification or compensation must follow a commit. | The verifier and producer may share a failure domain unless deployed independently. |
| Receipt history is edited | Sequence, previous digest, record digest, run id, and backward-only evidence references are replayed. | Hash linking alone does not authenticate the author or prevent wholesale replacement. |
| Semantic cache crosses policy or tenant | Composite fingerprint binds policy, capabilities, context, outcome, tenant, and privacy. | Incorrect upstream canonicalization can still create a false semantic match. |
| Sensitive reasoning leaks | Decision evidence is restricted to summaries and evidence references. | Applications must still redact summaries and artifact payloads. |
| Oversized or alias-heavy input exhausts the CLI | File size and YAML alias limits. | Deep but valid JSON may still require process-level resource limits for hostile multi-tenant use. |
| Imported agent definition becomes mutable | Reference plus digest; embedded redefinition is rejected. | Availability and signature verification belong to the artifact resolver. |

## Non-goals of the alpha

- key management, digital signatures, or trusted timestamping;
- a policy language or identity provider;
- credential brokering;
- sandboxing model-generated code;
- network transport security;
- regulatory certification.

Deployments requiring these properties should integrate established enforcement and attestation systems through the declared planes rather than placing secrets or authorization logic in prompts.

`BudgetUsage` is an integrity-bound observation, not a trusted meter by itself. Production deployments should source it from an independently controlled usage meter when cost or quota enforcement is material.
