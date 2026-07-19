# ADR 0005: Run-bound execution evidence is observation-only

Status: accepted

## Context

Execution Passport v1 admitted strict content-free placement descriptors, but the descriptor did not cryptographically identify the run it observed. A valid descriptor could therefore be attached to another run if its resource digest remained unchanged. Placement metadata must also never be interpreted as permission to execute.

## Decision

Execution Passport v2 requires every `ExecutionEvidenceBinding` to carry `runIdDigest = SHA256(RFC8785(runId))`, normalized `observedAt`, and `authority = observation-only`. Passport creation validates the binding and rejects any run-digest mismatch or observation later than the bound report before emission.

Provider integrations are explicit reduction adapters. They validate the external artifact schema and producer seal, bind the complete artifact by digest, and emit only a strict descriptor.

The StageFabric adapter binds the exact canonical JSON file bytes written by StageFabric, including its trailing LF, rather than hashing a reparsed object. Its CLI path rejects alternative encodings so a URI can be verified byte-for-byte against the descriptor.

The evidence can explain where execution was observed. It cannot issue a grant, widen a grant, authorize a capability, or override an authority check. Provider payloads and result objects remain outside the Passport.

## Consequences

- Cross-run descriptor reuse fails closed.
- Future or differently serialized observations fail closed.
- Consumers can distinguish observation from authorization mechanically.
- External formats remain replaceable behind narrow validation adapters.
- A producer seal still provides integrity, not identity; authenticity remains an external signature or trusted-channel concern.
- V1 evidence cannot be upgraded by relabeling. It must be regenerated with a proven run binding or omitted.
