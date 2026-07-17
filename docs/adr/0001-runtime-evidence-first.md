# ADR 0001: Runtime evidence before architectural claims

Status: accepted

## Context

Layer diagrams and repository conventions explain intent but cannot show that a concrete run respected authority, budget, side-effect, and verification boundaries.

## Decision

Conformance consumes a declared application manifest plus actual contracts, artifacts, attestations, observed usage, and hash-linked receipts. Source-layout detection is outside the conformance core.

## Consequences

- Claims are reproducible and adversarially testable.
- Integrators must emit evidence, not only configuration.
- Early design reviews may still use separate static scanners before runtime data exists.
