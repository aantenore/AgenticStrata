# Architecture

## Design rule

The model proposes; the runtime enforces. Every operation crosses a typed boundary owned outside model inference. State, policy, authority, and evidence therefore remain inspectable when models or orchestration frameworks are replaced.

## Dependency direction

Strata are ordered from user-facing concerns to replaceable compute. A stratum may depend only on a higher ordinal, never back toward interaction. Cross-cutting planes may observe or constrain all strata but do not become hidden business layers.

```text
interaction -> intent-outcome -> control-orchestration -> collaboration
            -> capability -> knowledge-state -> model-compute
```

The `lint` command validates the complete set, canonical ordinal, unique declaration, known dependencies, and direction. A modular monolith is a first-class deployment: the contracts create replaceable seams without forcing a network hop.

## Cross-cutting planes

### Trust & Authority

- Identity, policy, and human decisions issue grants.
- A model is never an issuer.
- Delegation can only reduce scope, resources, validity, and budget.
- High-risk commits bind the actor, resource, capability, prepared action digest, authority grant, and approval receipt.
- Retrieved or user-supplied untrusted text remains data even when it influences a proposal.

### Evidence & Operations

- Operational facts are hash-linked as receipts.
- Runtime payloads are externalized as artifacts and bound by attestations.
- Decisions expose concise summaries, selected and rejected options, and evidence references; private model reasoning is not a contract.
- Distributed mode requires node attribution on every receipt.

### Lifecycle & Conformance

- Profiles select composable rules from YAML configuration.
- Side effects use prepare, commit, verify, and—at higher risk—compensate.
- Idempotency is enforced at the capability boundary.
- The observed budget record is checked against the execution envelope rather than inferred from configuration alone.

## Runtime sequence

```mermaid
sequenceDiagram
    actor User
    participant Intent as Intent & Outcome
    participant Control as Control Runtime
    participant Policy as Authority Boundary
    participant Capability
    participant State as Knowledge & State

    User->>Intent: request + constraints
    Intent->>Intent: canonicalize and fingerprint
    Intent->>Control: IntentEnvelope + OutcomeContract
    Control->>Capability: prepare typed action
    Capability-->>Control: action digest
    Control->>Policy: request exact bounded authority
    Policy-->>Control: AuthorityGrant + ApprovalReceipt
    Control->>Capability: commit(action, authority, approval, idempotency)
    Capability->>State: apply side effect
    Capability->>State: independent read-back
    State-->>Control: attested artifact
    Control-->>User: outcome + explanation + conformance
```

## Safe semantic caching

Two utterances may normalize to the same canonical intent, but a cached answer is admitted only when operational context is also equivalent. The cache key binds:

1. contract version;
2. canonical intent;
3. constraints;
4. authoritative context digests;
5. outcome digest;
6. policy bundle digest;
7. capability-set digest;
8. tenant partition;
9. privacy partition.

Untrusted context is deliberately excluded from authority, but this does not make it harmless. Applications may include a separate content digest in constraints when untrusted content materially affects the result.

## Deployment profiles

The same contracts support a single process, a modular monolith, or distributed services. Deployment changes transport and failure modes, not ownership. A local-private profile can use local inference and state; an enterprise profile can use managed compute behind the same `Model & Compute` boundary.
